-- Connect Capital — M9 Funding and fee guards

BEGIN;

-- ---------------------------------------------------------------------------
-- Append-only: fundings are the transaction record
-- ---------------------------------------------------------------------------
-- Everything about a funding is frozen except the merchant's own confirmation
-- of what arrived. The funder's attested amount is the fee basis and an
-- invoice has been sent against it.

CREATE OR REPLACE FUNCTION fundings_merchant_confirm_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fundings are permanent' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.application_id      IS DISTINCT FROM OLD.application_id
     OR NEW.offer_revision_id IS DISTINCT FROM OLD.offer_revision_id
     OR NEW.provider_org_id   IS DISTINCT FROM OLD.provider_org_id
     OR NEW.funded_amount     IS DISTINCT FROM OLD.funded_amount
     OR NEW.funded_at         IS DISTINCT FROM OLD.funded_at THEN
    RAISE EXCEPTION 'funding facts are immutable; only merchant confirmation may be added'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

GRANT UPDATE (merchant_confirmed_amount, merchant_confirmed_at, net_disbursed, contract_ref)
  ON fundings TO app_user;

CREATE TRIGGER fundings_merchant_confirm_only
  BEFORE UPDATE OR DELETE ON fundings
  FOR EACH ROW EXECUTE FUNCTION fundings_merchant_confirm_only();

-- ---------------------------------------------------------------------------
-- Fee schedules are never edited in place
-- ---------------------------------------------------------------------------
-- Changing a rate on a live schedule silently reprices every historical
-- funding computed against it, and the invoices already sent stop matching.
-- A rate change closes the old schedule and opens a new one.

CREATE OR REPLACE FUNCTION fee_schedules_close_dont_edit() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fee schedules are closed, never deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.rate_bps       IS DISTINCT FROM OLD.rate_bps
     OR NEW.tiers_json  IS DISTINCT FROM OLD.tiers_json
     OR NEW.min_fee     IS DISTINCT FROM OLD.min_fee
     OR NEW.max_fee     IS DISTINCT FROM OLD.max_fee
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
    RAISE EXCEPTION 'close this schedule with effective_to and create a new one'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

GRANT UPDATE (effective_to) ON fee_schedules TO app_user;

CREATE TRIGGER fee_schedules_close_dont_edit
  BEFORE UPDATE OR DELETE ON fee_schedules
  FOR EACH ROW EXECUTE FUNCTION fee_schedules_close_dont_edit();

-- A computed fee is frozen except for its lifecycle status.
CREATE OR REPLACE FUNCTION platform_fees_status_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'accrued fees are permanent' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.funding_id      IS DISTINCT FROM OLD.funding_id
     OR NEW.basis_amount IS DISTINCT FROM OLD.basis_amount
     OR NEW.fee_amount   IS DISTINCT FROM OLD.fee_amount
     OR NEW.rate_bps     IS DISTINCT FROM OLD.rate_bps THEN
    RAISE EXCEPTION 'a computed fee is immutable; waive or dispute it instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

GRANT UPDATE (status, invoice_ref, invoiced_at, paid_at, dispute_note)
  ON platform_fees TO app_user;

CREATE TRIGGER platform_fees_status_only
  BEFORE UPDATE OR DELETE ON platform_fees
  FOR EACH ROW EXECUTE FUNCTION platform_fees_status_only();

-- ---------------------------------------------------------------------------
-- Coherence
-- ---------------------------------------------------------------------------

ALTER TABLE fundings
  ADD CONSTRAINT fundings_positive_amount CHECK (funded_amount > 0);

ALTER TABLE fee_schedules
  ADD CONSTRAINT fee_schedules_sane_rate CHECK (rate_bps >= 0 AND rate_bps <= 10000);

ALTER TABLE fee_schedules
  ADD CONSTRAINT fee_schedules_effective_order
  CHECK (effective_to IS NULL OR effective_to > effective_from);

ALTER TABLE platform_fees
  ADD CONSTRAINT platform_fees_non_negative CHECK (fee_amount >= 0);

-- ---------------------------------------------------------------------------
-- Seed the platform default
-- ---------------------------------------------------------------------------
-- R6: 3% is a row with an effective date, not a constant in code. The first
-- provider who negotiates 2.5% gets a new row, not a deployment.

INSERT INTO fee_schedules (provider_org_id, product_type, channel, fee_type, rate_bps, effective_from)
VALUES (NULL, NULL, NULL, 'success', 300, '2026-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- A provider sees its own fundings and its own fees. Fee schedules are
-- platform-only: a provider learning that a competitor negotiated 2.5% would
-- reprice every negotiation the platform has.

ALTER TABLE fundings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_fees  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_schedules  ENABLE ROW LEVEL SECURITY;

CREATE POLICY fundings_visibility ON fundings
  FOR ALL TO app_user
  USING (
    provider_org_id::text = current_setting('app.current_org_id', true)
    OR application_id IN (
      SELECT a.id FROM applications a
      JOIN merchant_businesses mb ON mb.id = a.business_id
      WHERE mb.org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY platform_fees_visibility ON platform_fees
  FOR SELECT TO app_user
  USING (
    funding_id IN (
      SELECT f.id FROM fundings f
      WHERE f.provider_org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY fee_schedules_platform_only ON fee_schedules
  FOR ALL TO app_user
  USING (current_setting('app.current_org_type', true) IN ('platform', 'system'));

COMMIT;
