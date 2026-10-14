-- CapNet — M5 Banking guards

BEGIN;

-- ---------------------------------------------------------------------------
-- Append-only: raw banking data is evidence
-- ---------------------------------------------------------------------------
-- If a transaction row can be edited, every metric derived from it is an
-- assertion rather than a finding — and these metrics are what a funder
-- underwrites against.

REVOKE UPDATE, DELETE ON bank_transactions FROM app_user;

CREATE TRIGGER bank_transactions_append_only
  BEFORE UPDATE OR DELETE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- detected_positions is append-only EXCEPT for the merchant's confirmation.
-- A detection is a hypothesis; the merchant gets the last word on it, and
-- nothing else about the row may move.
CREATE OR REPLACE FUNCTION detected_positions_confirm_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'detections are permanent' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.business_id     IS DISTINCT FROM OLD.business_id
     OR NEW.counterparty IS DISTINCT FROM OLD.counterparty
     OR NEW.payment_amount IS DISTINCT FROM OLD.payment_amount
     OR NEW.frequency    IS DISTINCT FROM OLD.frequency
     OR NEW.first_seen   IS DISTINCT FROM OLD.first_seen
     OR NEW.confidence   IS DISTINCT FROM OLD.confidence THEN
    RAISE EXCEPTION 'only merchant_confirmed may be updated on a detection'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

GRANT UPDATE (merchant_confirmed) ON detected_positions TO app_user;

CREATE TRIGGER detected_positions_confirm_only
  BEFORE UPDATE OR DELETE ON detected_positions
  FOR EACH ROW EXECUTE FUNCTION detected_positions_confirm_only();

-- ---------------------------------------------------------------------------
-- A connection always carries its consent
-- ---------------------------------------------------------------------------
-- consent_id is NOT NULL in the schema. This adds the coherence half: a
-- revoked connection records when, an active one does not look revoked.

ALTER TABLE bank_connections
  ADD CONSTRAINT bank_connections_revocation_coherent
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status <> 'revoked' AND revoked_at IS NULL)
  );

-- ---------------------------------------------------------------------------
-- RLS — raw banking data never reaches a funder
-- ---------------------------------------------------------------------------
-- This is the sharpest boundary in the database. A funder sees
-- financial_profiles: normalized metrics with no counterparties. Raw
-- transactions carry the merchant's entire customer and vendor list, and no
-- authorization scope reaches them. There is deliberately no provider clause
-- in any policy below.

ALTER TABLE bank_connections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE detected_positions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE financing_signals   ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_connections_own ON bank_connections
  FOR ALL TO app_user
  USING (
    business_id IN (
      SELECT id FROM merchant_businesses
      WHERE org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) = 'system'
  );

CREATE POLICY bank_accounts_own ON bank_accounts
  FOR ALL TO app_user
  USING (
    connection_id IN (
      SELECT bc.id FROM bank_connections bc
      JOIN merchant_businesses mb ON mb.id = bc.business_id
      WHERE mb.org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) = 'system'
  );

-- Note the absence of a platform clause: an admin reading a merchant's
-- transaction stream needs elevation through the application layer, which
-- logs it and shows it to the merchant. Blanket admin SQL access to a
-- business's customer list is not a capability worth having.
CREATE POLICY bank_transactions_own ON bank_transactions
  FOR ALL TO app_user
  USING (
    account_id IN (
      SELECT ba.id FROM bank_accounts ba
      JOIN bank_connections bc ON bc.id = ba.connection_id
      JOIN merchant_businesses mb ON mb.id = bc.business_id
      WHERE mb.org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) = 'system'
  );

CREATE POLICY detected_positions_own ON detected_positions
  FOR ALL TO app_user
  USING (
    business_id IN (
      SELECT id FROM merchant_businesses
      WHERE org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY financing_signals_visibility ON financing_signals
  FOR SELECT TO app_user
  USING (
    business_id IN (
      SELECT id FROM merchant_businesses
      WHERE org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

COMMIT;
