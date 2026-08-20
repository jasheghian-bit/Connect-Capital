-- Connect Capital — M8 Offer and disclosure guards

BEGIN;

-- ---------------------------------------------------------------------------
-- Append-only: the negotiation IS the record
-- ---------------------------------------------------------------------------
-- The merchant is promised a complete history of every offer and every
-- revision. A negotiation where the earlier number can be edited is not a
-- record — it is whatever the last writer says happened.

REVOKE UPDATE, DELETE ON offer_revisions   FROM app_user;
REVOKE UPDATE, DELETE ON counteroffers     FROM app_user;
REVOKE UPDATE, DELETE ON offer_events      FROM app_user;
REVOKE UPDATE, DELETE ON disclosure_views  FROM app_user;

CREATE TRIGGER offer_revisions_append_only
  BEFORE UPDATE OR DELETE ON offer_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER counteroffers_append_only
  BEFORE UPDATE OR DELETE ON counteroffers
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER offer_events_append_only
  BEFORE UPDATE OR DELETE ON offer_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER disclosure_views_append_only
  BEFORE UPDATE OR DELETE ON disclosure_views
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- counteroffers.status is the one thing that legitimately moves, so it gets a
-- narrow grant back after the blanket revoke above.
GRANT UPDATE (status) ON counteroffers TO app_user;

-- ---------------------------------------------------------------------------
-- A revision always carries its disclosure
-- ---------------------------------------------------------------------------
-- The columns are NOT NULL in the schema. This adds the substance test: a
-- disclosure that is present but empty is the same failure with better
-- paperwork.

ALTER TABLE offer_revisions
  ADD CONSTRAINT offer_revisions_disclosure_present
  CHECK (
    jsonb_typeof(disclosure_json) = 'object'
    AND disclosure_json ? 'amountFinanced'
    AND disclosure_json ? 'financeCharge'
    AND disclosure_json ? 'totalRepayment'
    AND length(disclosure_hash) = 64
    AND length(disclosure_ruleset_version) > 0
  );

-- Repayment below the amount advanced is not an MCA, it is a data error, and
-- it would produce a negative finance charge in a regulated disclosure.
ALTER TABLE offer_revisions
  ADD CONSTRAINT offer_revisions_repayment_exceeds_advance
  CHECK (total_repayment >= gross_amount);

ALTER TABLE offer_revisions
  ADD CONSTRAINT offer_revisions_positive_payment
  CHECK (payment_amount > 0);

-- ---------------------------------------------------------------------------
-- Revision numbering without a race
-- ---------------------------------------------------------------------------
-- Two underwriters revising the same offer at once must not both become
-- revision 3. The unique index rejects the loser; the app retries.

CREATE OR REPLACE FUNCTION next_offer_revision() RETURNS trigger AS $$
BEGIN
  IF NEW.revision_no IS NULL OR NEW.revision_no = 0 THEN
    SELECT COALESCE(MAX(revision_no), 0) + 1 INTO NEW.revision_no
      FROM offer_revisions WHERE offer_id = NEW.offer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER offer_revisions_autonumber
  BEFORE INSERT ON offer_revisions
  FOR EACH ROW EXECUTE FUNCTION next_offer_revision();

-- ---------------------------------------------------------------------------
-- RLS — the blind marketplace, enforced at the database
-- ---------------------------------------------------------------------------
-- A funder sees its own offers and no others. This is the structural half of
-- the blind-offer decision: even a query written by mistake cannot surface a
-- competitor's terms.

ALTER TABLE offers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE counteroffers   ENABLE ROW LEVEL SECURITY;

CREATE POLICY offers_visibility ON offers
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

CREATE POLICY offer_revisions_visibility ON offer_revisions
  FOR ALL TO app_user
  USING (
    offer_id IN (
      SELECT o.id FROM offers o
      WHERE o.provider_org_id::text = current_setting('app.current_org_id', true)
         OR o.application_id IN (
              SELECT a.id FROM applications a
              JOIN merchant_businesses mb ON mb.id = a.business_id
              WHERE mb.org_id::text = current_setting('app.current_org_id', true)
            )
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY counteroffers_visibility ON counteroffers
  FOR ALL TO app_user
  USING (
    offer_id IN (
      SELECT o.id FROM offers o
      WHERE o.provider_org_id::text = current_setting('app.current_org_id', true)
         OR o.application_id IN (
              SELECT a.id FROM applications a
              JOIN merchant_businesses mb ON mb.id = a.business_id
              WHERE mb.org_id::text = current_setting('app.current_org_id', true)
            )
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

COMMIT;
