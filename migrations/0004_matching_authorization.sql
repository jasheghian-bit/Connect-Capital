-- Connect Capital — M3 Matching and authorization guards

BEGIN;

-- ---------------------------------------------------------------------------
-- Append-only: authorization history is the merchant's proof
-- ---------------------------------------------------------------------------
-- The Access Center says "Cardinal Advance opened your bank summary on Aug 16,
-- access ended Aug 17." That is only a fact if the rows behind it cannot be
-- edited afterwards.

REVOKE UPDATE, DELETE ON authorization_events FROM app_user;
REVOKE UPDATE, DELETE ON matches             FROM app_user;
REVOKE UPDATE, DELETE ON match_runs          FROM app_user;

CREATE TRIGGER authorization_events_append_only
  BEFORE UPDATE OR DELETE ON authorization_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER match_runs_append_only
  BEFORE UPDATE OR DELETE ON match_runs
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- matches needs one narrow exception: a provider clicking "interested" on a
-- blinded card. Everything else about a match row is frozen.
CREATE OR REPLACE FUNCTION matches_interest_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'match rows are permanent' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.match_run_id       IS DISTINCT FROM OLD.match_run_id
     OR NEW.application_id  IS DISTINCT FROM OLD.application_id
     OR NEW.provider_id     IS DISTINCT FROM OLD.provider_id
     OR NEW.result          IS DISTINCT FROM OLD.result
     OR NEW.score           IS DISTINCT FROM OLD.score
     OR NEW.reasons_json    IS DISTINCT FROM OLD.reasons_json
     OR NEW.suppressed_reason IS DISTINCT FROM OLD.suppressed_reason THEN
    RAISE EXCEPTION 'match results are immutable; only interest may be recorded'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

GRANT UPDATE (provider_interested_at) ON matches TO app_user;

CREATE TRIGGER matches_immutable_except_interest
  BEFORE UPDATE OR DELETE ON matches
  FOR EACH ROW EXECUTE FUNCTION matches_interest_only();

-- ---------------------------------------------------------------------------
-- An authorization always carries its consent
-- ---------------------------------------------------------------------------
-- consent_id is NOT NULL in the schema. This adds the other half: a revoked
-- authorization must record when, and an active one must not look revoked.

ALTER TABLE authorizations
  ADD CONSTRAINT authorizations_revocation_coherent
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status <> 'revoked' AND revoked_at IS NULL)
  );

-- ---------------------------------------------------------------------------
-- R11 — a specialist can never be the granting actor
-- ---------------------------------------------------------------------------
-- policy.ts refuses it and this refuses it again. The rule is worth two
-- independent enforcements: it is the difference between merchant control and
-- a broker CRM, and it is the one an under-pressure change is most likely to
-- try to route around.

CREATE OR REPLACE FUNCTION enforce_merchant_granted() RETURNS trigger AS $$
DECLARE
  granting_org_type text;
BEGIN
  SELECT o.type INTO granting_org_type
    FROM org_members m
    JOIN organizations o ON o.id = m.org_id
   WHERE m.user_id = NEW.granted_by_user_id
     AND m.removed_at IS NULL
   LIMIT 1;

  IF granting_org_type IS DISTINCT FROM 'merchant' THEN
    RAISE EXCEPTION 'only a merchant may grant an authorization (attempted by %)',
      COALESCE(granting_org_type, 'unknown')
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER authorizations_merchant_granted
  BEFORE INSERT ON authorizations
  FOR EACH ROW EXECUTE FUNCTION enforce_merchant_granted();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- A provider sees only its own grants and its own matches. Seeing which
-- competitors were also matched would leak the shape of the competition into a
-- blind marketplace through a side channel.

ALTER TABLE authorizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorization_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches              ENABLE ROW LEVEL SECURITY;

CREATE POLICY authorizations_visibility ON authorizations
  FOR SELECT TO app_user
  USING (
    provider_org_id::text = current_setting('app.current_org_id', true)
    OR application_id IN (
      SELECT a.id FROM applications a
      JOIN merchant_businesses mb ON mb.id = a.business_id
      WHERE mb.org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY authorizations_merchant_write ON authorizations
  FOR ALL TO app_user
  USING (
    application_id IN (
      SELECT a.id FROM applications a
      JOIN merchant_businesses mb ON mb.id = a.business_id
      WHERE mb.org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY matches_visibility ON matches
  FOR SELECT TO app_user
  USING (
    provider_id IN (
      SELECT id FROM providers
      WHERE org_id::text = current_setting('app.current_org_id', true)
    )
    OR application_id IN (
      SELECT a.id FROM applications a
      JOIN merchant_businesses mb ON mb.id = a.business_id
      WHERE mb.org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

COMMIT;
