-- Connect Capital — M1 Merchant intake guards
--
-- Every table added above the kernel gets classified on arrival: is it state,
-- or is it evidence? Evidence gets locked here, in the same migration that
-- creates it. Doing this later means auditing a live database to find out
-- which rows were edited before the lock went on.

BEGIN;

-- ---------------------------------------------------------------------------
-- Append-only: the new evidence tables
-- ---------------------------------------------------------------------------
-- document_versions   — replacing a document creates v2; v1 is the record of
--                       what a funder actually underwrote
-- document_access_events — the merchant's Access Center. If this is editable,
--                       "we can show you who opened your statements" is a
--                       claim rather than a fact.

REVOKE UPDATE, DELETE ON document_versions      FROM app_user;
REVOKE UPDATE, DELETE ON document_access_events FROM app_user;

CREATE TRIGGER document_versions_append_only
  BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER document_access_events_append_only
  BEFORE UPDATE OR DELETE ON document_access_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- documents itself stays mutable — current_version_id moves, deleted_at is set.
-- Deletion is soft by policy: a document a funder underwrote against is part
-- of the transaction record.

ALTER TABLE documents
  ADD CONSTRAINT documents_soft_delete_only
  CHECK (deleted_at IS NULL OR deleted_at >= created_at);

-- ---------------------------------------------------------------------------
-- R14 — origination attribution is immutable
-- ---------------------------------------------------------------------------
-- Set once at creation. Every question about acquisition cost, funder
-- reciprocity, and dual-channel economics depends on this being trustworthy,
-- and the pressure to "fix" an attribution later will be real.

CREATE OR REPLACE FUNCTION freeze_attribution() RETURNS trigger AS $$
BEGIN
  IF NEW.origination_channel IS DISTINCT FROM OLD.origination_channel
     OR NEW.referring_provider_org_id IS DISTINCT FROM OLD.referring_provider_org_id
     OR NEW.referral_token IS DISTINCT FROM OLD.referral_token THEN
    RAISE EXCEPTION 'origination attribution is immutable after creation'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER applications_freeze_attribution
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION freeze_attribution();

-- ---------------------------------------------------------------------------
-- Version numbering without a race
-- ---------------------------------------------------------------------------
-- Two concurrent uploads to the same document must not both become v2.
-- The unique index rejects the loser; the app retries.

CREATE OR REPLACE FUNCTION next_document_version() RETURNS trigger AS $$
BEGIN
  IF NEW.version_no IS NULL OR NEW.version_no = 0 THEN
    SELECT COALESCE(MAX(version_no), 0) + 1 INTO NEW.version_no
      FROM document_versions WHERE document_id = NEW.document_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_versions_autonumber
  BEFORE INSERT ON document_versions
  FOR EACH ROW EXECUTE FUNCTION next_document_version();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Backstop only. lib/policy.ts is the primary control — in particular the
-- raw-statement scope check, which RLS cannot express because it depends on
-- the authorization scope rather than on row ownership.

ALTER TABLE merchant_businesses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents               ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_events  ENABLE ROW LEVEL SECURITY;

CREATE POLICY merchant_businesses_own ON merchant_businesses
  FOR ALL TO app_user
  USING (
    org_id::text = current_setting('app.current_org_id', true)
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY applications_own ON applications
  FOR ALL TO app_user
  USING (
    business_id IN (
      SELECT id FROM merchant_businesses
      WHERE org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY documents_own ON documents
  FOR ALL TO app_user
  USING (
    business_id IN (
      SELECT id FROM merchant_businesses
      WHERE org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

-- A merchant sees every access to their own documents. A provider sees only
-- its own accesses — never which competitors also opened the file, because
-- that would leak the shape of the competition into a blind marketplace.
CREATE POLICY document_access_visibility ON document_access_events
  FOR SELECT TO app_user
  USING (
    actor_org_id::text = current_setting('app.current_org_id', true)
    OR document_version_id IN (
      SELECT dv.id FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id
      JOIN merchant_businesses mb ON mb.id = d.business_id
      WHERE mb.org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

COMMIT;
