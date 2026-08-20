-- Connect Capital — M10/M11 Admin and hardening

BEGIN;

-- ---------------------------------------------------------------------------
-- Elevation: admin access to merchant data is time-boxed and merchant-visible
-- ---------------------------------------------------------------------------
-- An admin reading a merchant's bank statements is sometimes necessary — a
-- dispute, a fraud investigation. It should never be routine, never silent,
-- and never open-ended.

CREATE TABLE IF NOT EXISTS admin_elevations (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  granted_to_user_id uuid NOT NULL REFERENCES users(id),
  application_id    uuid REFERENCES applications(id),
  reason            text NOT NULL,
  approved_by_user_id uuid NOT NULL REFERENCES users(id),
  granted_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  CONSTRAINT elevation_requires_substantive_reason
    CHECK (length(trim(reason)) >= 20),
  -- Four hours. Long enough to investigate, short enough that nobody holds
  -- standing access to a merchant's financial life.
  CONSTRAINT elevation_bounded
    CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '4 hours'),
  -- Self-approval defeats the point of approval.
  CONSTRAINT elevation_not_self_approved
    CHECK (approved_by_user_id <> granted_to_user_id)
);

CREATE INDEX admin_elevations_active_idx
  ON admin_elevations (granted_to_user_id, expires_at)
  WHERE revoked_at IS NULL;

REVOKE UPDATE, DELETE ON admin_elevations FROM app_user;
GRANT UPDATE (revoked_at) ON admin_elevations TO app_user;

CREATE TRIGGER admin_elevations_append_only
  BEFORE DELETE ON admin_elevations
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- Trust and safety findings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trust_findings (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  provider_org_id uuid NOT NULL REFERENCES organizations(id),
  finding_type    text NOT NULL,
  severity        text NOT NULL,
  summary         text NOT NULL,
  evidence_json   jsonb NOT NULL,
  suggested_action text NOT NULL,
  status          text NOT NULL DEFAULT 'open',
  -- Required on close. "Reviewed, no action" is a decision that needs a name
  -- attached to it, not a checkbox.
  resolution_note text,
  reviewed_by_user_id uuid REFERENCES users(id),
  detected_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  CONSTRAINT trust_findings_resolution_documented
    CHECK (status <> 'resolved' OR (resolution_note IS NOT NULL AND length(trim(resolution_note)) >= 15))
);

CREATE INDEX trust_findings_queue_idx ON trust_findings (status, severity, detected_at);
CREATE INDEX trust_findings_provider_idx ON trust_findings (provider_org_id, detected_at);

-- ---------------------------------------------------------------------------
-- Legal hold
-- ---------------------------------------------------------------------------
-- Retention deletion must not touch anything under hold. Recording the hold in
-- the database rather than in someone's calendar is the difference between a
-- policy and a practice.

CREATE TABLE IF NOT EXISTS legal_holds (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  subject_type   text NOT NULL,
  subject_id     uuid NOT NULL,
  reason         text NOT NULL,
  placed_by_user_id uuid NOT NULL REFERENCES users(id),
  placed_at      timestamptz NOT NULL DEFAULT now(),
  released_at    timestamptz,
  released_by_user_id uuid REFERENCES users(id)
);

CREATE UNIQUE INDEX legal_holds_active_idx
  ON legal_holds (subject_type, subject_id)
  WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION under_legal_hold(p_type text, p_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM legal_holds
    WHERE subject_type = p_type AND subject_id = p_id AND released_at IS NULL
  );
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------
-- Document reads in particular: an authorized provider enumerating every
-- document on every file they can reach is technically permitted and is
-- exactly the harvesting pattern lib/anomaly.ts looks for.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count       integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION consume_rate_limit(
  p_key text, p_limit integer, p_window_seconds integer
) RETURNS boolean AS $$
DECLARE
  cur record;
BEGIN
  SELECT * INTO cur FROM rate_limit_buckets WHERE id = p_key FOR UPDATE;

  IF cur IS NULL OR cur.window_start < now() - make_interval(secs => p_window_seconds) THEN
    INSERT INTO rate_limit_buckets (id, window_start, count)
    VALUES (p_key, now(), 1)
    ON CONFLICT (id) DO UPDATE SET window_start = now(), count = 1;
    RETURN true;
  END IF;

  IF cur.count >= p_limit THEN
    RETURN false;
  END IF;

  UPDATE rate_limit_buckets SET count = count + 1 WHERE id = p_key;
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- RLS on the new tables
-- ---------------------------------------------------------------------------

ALTER TABLE admin_elevations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_findings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_holds      ENABLE ROW LEVEL SECURITY;

-- A merchant can see that their file was accessed under elevation and why.
-- Surveillance the subject can read is a different thing from surveillance.
CREATE POLICY admin_elevations_visibility ON admin_elevations
  FOR SELECT TO app_user
  USING (
    current_setting('app.current_org_type', true) IN ('platform', 'system')
    OR application_id IN (
      SELECT a.id FROM applications a
      JOIN merchant_businesses mb ON mb.id = a.business_id
      WHERE mb.org_id::text = current_setting('app.current_org_id', true)
    )
  );

-- Findings are platform-only. A funder who could read the detector would
-- learn precisely which thresholds to stay under.
CREATE POLICY trust_findings_platform_only ON trust_findings
  FOR ALL TO app_user
  USING (current_setting('app.current_org_type', true) IN ('platform', 'system'));

CREATE POLICY legal_holds_platform_only ON legal_holds
  FOR ALL TO app_user
  USING (current_setting('app.current_org_type', true) IN ('platform', 'system'));

COMMIT;
