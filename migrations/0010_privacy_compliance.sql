-- CapNet — Privacy and compliance (consents, email preferences, deletion)

-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
-- Postgres and the new values cannot be used in the same transaction, so the
-- enum changes run first, outside BEGIN.
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'marketing_email';
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'cookie_preferences';

BEGIN;

-- ---------------------------------------------------------------------------
-- Email preferences (STATE) and suppression events (EVIDENCE)
-- ---------------------------------------------------------------------------
-- Marketing defaults to false: opt-in, never assumed. Transactional email is
-- not represented here because it cannot be opted out of while the account
-- is active (lib/email-preferences.ts).

CREATE TABLE IF NOT EXISTS email_preferences (
  user_id    uuid PRIMARY KEY REFERENCES users(id),
  marketing  boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_suppression_events (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES users(id),
  category    text NOT NULL CHECK (category IN ('marketing', 'transactional')),
  action      text NOT NULL CHECK (action IN ('unsubscribe', 'resubscribe')),
  source      text NOT NULL CHECK (source IN ('one_click', 'link', 'settings', 'support')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ip          text,
  user_agent  text
);

CREATE INDEX email_suppression_events_user_idx
  ON email_suppression_events (user_id, occurred_at);

-- Evidence: "were they unsubscribed when we sent that?" must not be editable.
REVOKE UPDATE, DELETE ON email_suppression_events FROM app_user;
CREATE TRIGGER email_suppression_events_append_only
  BEFORE UPDATE OR DELETE ON email_suppression_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- Data deletion requests (STATE) and events (EVIDENCE)
-- ---------------------------------------------------------------------------
-- The request row holds the current status; every transition, with the plan
-- that was executed, is an append-only event. Proving a deletion happened is
-- itself a record we must keep — it contains no erased data, only field names.

DO $$ BEGIN
  CREATE TYPE deletion_status AS ENUM ('requested', 'verified', 'blocked', 'completed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  subject_type         text NOT NULL,
  subject_id           uuid NOT NULL,
  status               deletion_status NOT NULL DEFAULT 'requested',
  blocked_reason       text,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz,
  CONSTRAINT blocked_has_reason
    CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS data_deletion_events (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  request_id    uuid NOT NULL REFERENCES data_deletion_requests(id),
  from_status   deletion_status,
  to_status     deletion_status NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  plan_json     text,
  note          text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX data_deletion_events_request_idx
  ON data_deletion_events (request_id, occurred_at);

REVOKE UPDATE, DELETE ON data_deletion_events FROM app_user;
CREATE TRIGGER data_deletion_events_append_only
  BEFORE UPDATE OR DELETE ON data_deletion_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Requests are state, but never deleted: a vanished request is how "we never
-- received it" becomes unfalsifiable. Status moves; the row stays.
REVOKE DELETE ON data_deletion_requests FROM app_user;

-- Mirrors lib/data-deletion.ts DELETION_TRANSITIONS. The TypeScript half
-- fails loudly; this half catches a direct UPDATE.
CREATE OR REPLACE FUNCTION enforce_deletion_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
       (OLD.status = 'requested' AND NEW.status IN ('verified', 'rejected'))
    OR (OLD.status = 'verified'  AND NEW.status IN ('blocked', 'completed', 'rejected'))
    OR (OLD.status = 'blocked'   AND NEW.status IN ('verified', 'rejected'))
  ) THEN
    RAISE EXCEPTION 'illegal deletion transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- Completion cannot outrun a hold placed after verification.
  IF NEW.status = 'completed' AND under_legal_hold(NEW.subject_type, NEW.subject_id) THEN
    RAISE EXCEPTION 'subject is under legal hold' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER data_deletion_requests_transition
  BEFORE UPDATE ON data_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_deletion_transition();

-- ---------------------------------------------------------------------------
-- RLS — a user sees their own rows; platform/system sees all
-- ---------------------------------------------------------------------------

ALTER TABLE email_preferences        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppression_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_deletion_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_deletion_events     ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_preferences_self ON email_preferences
  FOR ALL TO app_user
  USING (
    user_id::text = current_setting('app.current_user_id', true)
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY email_suppression_events_self ON email_suppression_events
  FOR ALL TO app_user
  USING (
    user_id::text = current_setting('app.current_user_id', true)
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY data_deletion_requests_self ON data_deletion_requests
  FOR ALL TO app_user
  USING (
    requested_by_user_id::text = current_setting('app.current_user_id', true)
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY data_deletion_events_self ON data_deletion_events
  FOR ALL TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM data_deletion_requests r
      WHERE r.id = data_deletion_events.request_id
        AND r.requested_by_user_id::text = current_setting('app.current_user_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

COMMIT;
