-- CapNet — M6/M7 Messaging and underwriting guards

BEGIN;

-- ---------------------------------------------------------------------------
-- Append-only: the conversation and the underwriting sequence are the record
-- ---------------------------------------------------------------------------
-- The merchant is promised a complete record of every conversation and every
-- status change. A message that can be deleted makes that a claim rather than
-- a fact, and the deleted message is always the one a dispute turns on.

REVOKE UPDATE, DELETE ON underwriting_states FROM app_user;

CREATE TRIGGER underwriting_states_append_only
  BEFORE UPDATE OR DELETE ON underwriting_states
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Messages: no deletes, and no edits except redaction and safety review.
-- Redaction hides content from the counterparty; it never removes the row.
CREATE OR REPLACE FUNCTION messages_redact_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'messages are permanent' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.sender_user_id IS DISTINCT FROM OLD.sender_user_id
     OR NEW.sender_org_id  IS DISTINCT FROM OLD.sender_org_id
     OR NEW.body           IS DISTINCT FROM OLD.body
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'message content is immutable; redact instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

GRANT UPDATE (redacted_at, redacted_by_user_id, reviewed_at, reviewed_by_user_id)
  ON messages TO app_user;

CREATE TRIGGER messages_redact_only
  BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_redact_only();

-- ---------------------------------------------------------------------------
-- A decline always carries a coded reason
-- ---------------------------------------------------------------------------
-- Enforced in the state machine and again here. An uncoded decline is the
-- black box the platform exists to replace, and the code is also the routing
-- key for the decline-flow acquisition channel.

ALTER TABLE underwriting_states
  ADD CONSTRAINT underwriting_decline_requires_reason
  CHECK (status <> 'declined' OR decline_reason_code IS NOT NULL);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE underwriting_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_participant ON conversations
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

CREATE POLICY messages_participant ON messages
  FOR SELECT TO app_user
  USING (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.provider_org_id::text = current_setting('app.current_org_id', true)
         OR c.application_id IN (
              SELECT a.id FROM applications a
              JOIN merchant_businesses mb ON mb.id = a.business_id
              WHERE mb.org_id::text = current_setting('app.current_org_id', true)
            )
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

-- A funder sees its own underwriting decisions. The merchant sees all of them,
-- but through merchantStatusView, which aggregates rather than streaming raw
-- declines. No funder ever sees a competitor's decision on the same file.
CREATE POLICY underwriting_states_visibility ON underwriting_states
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

CREATE POLICY notifications_own ON notifications
  FOR ALL TO app_user
  USING (
    user_id::text = current_setting('app.current_user_id', true)
    OR current_setting('app.current_org_type', true) = 'system'
  );

COMMIT;
