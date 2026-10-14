-- CapNet — M0 Kernel Guards
--
-- These are the guarantees that cannot be left to application discipline.
-- Twenty minutes of work here is worth more than any amount of code review,
-- because a generated route handler cannot forge its way past a revoked grant.

BEGIN;

-- ---------------------------------------------------------------------------
-- UUIDv7
-- ---------------------------------------------------------------------------
-- Non-enumerable but time-ordered, so it indexes like a serial. If your
-- Postgres is 18+, replace this with the built-in uuidv7().

CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$ LANGUAGE sql VOLATILE;

-- ---------------------------------------------------------------------------
-- Application role
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE ROLE app_user NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ---------------------------------------------------------------------------
-- Append-only enforcement (R4, R5)
-- ---------------------------------------------------------------------------
-- Not a convention. Not a code review item. A grant.
--
-- Every table listed here is evidence. Evidence that can be updated is not
-- evidence. As tables are added above the kernel (offer_revisions,
-- document_access_events, underwriting_states, disclosure_views,
-- counteroffers, authorization_events) they get appended to this list in
-- the same migration that creates them.

REVOKE UPDATE, DELETE ON audit_events FROM app_user;
REVOKE UPDATE, DELETE ON consents     FROM app_user;

-- Belt and braces: a superuser connection could still bypass the grant,
-- so trip a trigger too.

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % may not be %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER consents_append_only
  BEFORE UPDATE OR DELETE ON consents
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- Audit hash chain (R5)
-- ---------------------------------------------------------------------------
-- hash = sha256(prev_hash || canonical payload)
--
-- Serialized on a single advisory lock so the chain has a total order under
-- concurrency. This is a throughput ceiling on audit writes; at the volumes
-- the pilot will see it is irrelevant, and it buys a chain that actually
-- verifies. Revisit if audit insert rate ever becomes the bottleneck.

CREATE OR REPLACE FUNCTION audit_chain() RETURNS trigger AS $$
DECLARE
  prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_events_chain'));

  SELECT hash INTO prev FROM audit_events ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := COALESCE(prev, repeat('0', 64));

  NEW.hash := encode(
    digest(
      NEW.prev_hash
        || COALESCE(NEW.actor_user_id::text, '')
        || COALESCE(NEW.actor_org_id::text, '')
        || COALESCE(NEW.impersonated_by_user_id::text, '')
        || NEW.action
        || NEW.object_type
        || COALESCE(NEW.object_id::text, '')
        || COALESCE(NEW.application_id::text, '')
        || COALESCE(NEW.metadata::text, '')
        || NEW.at::text,
      'sha256'
    ),
    'hex'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TRIGGER audit_events_chain
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_chain();

-- Chain verification. Run nightly; publish the head hash to an external
-- store. A chain nobody checks proves nothing.

CREATE OR REPLACE FUNCTION verify_audit_chain(from_seq bigint DEFAULT 0)
RETURNS TABLE(broken_at bigint, expected text, found text) AS $$
DECLARE
  r        audit_events%ROWTYPE;
  running  text := repeat('0', 64);
  computed text;
BEGIN
  IF from_seq > 0 THEN
    SELECT hash INTO running FROM audit_events WHERE seq = from_seq;
  END IF;

  FOR r IN SELECT * FROM audit_events WHERE seq > from_seq ORDER BY seq LOOP
    computed := encode(digest(
      running
        || COALESCE(r.actor_user_id::text, '')
        || COALESCE(r.actor_org_id::text, '')
        || COALESCE(r.impersonated_by_user_id::text, '')
        || r.action || r.object_type
        || COALESCE(r.object_id::text, '')
        || COALESCE(r.application_id::text, '')
        || COALESCE(r.metadata::text, '')
        || r.at::text,
      'sha256'), 'hex');

    IF computed <> r.hash THEN
      broken_at := r.seq; expected := computed; found := r.hash;
      RETURN NEXT;
      RETURN;
    END IF;

    running := r.hash;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Row-level security — defense in depth (R2)
-- ---------------------------------------------------------------------------
-- The policy module in lib/policy.ts is the primary control. RLS exists so
-- that a route handler which forgets to call can() fails at the database
-- instead of leaking. If these two ever disagree, policy.ts is the bug.
--
-- The app sets app.current_org_id and app.current_org_type per transaction
-- from the authenticated session. Never from a request parameter.

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents      ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_self_read ON organizations
  FOR SELECT TO app_user
  USING (
    id::text = current_setting('app.current_org_id', true)
    OR current_setting('app.current_org_type', true) = 'platform'
  );

CREATE POLICY org_members_self_read ON org_members
  FOR SELECT TO app_user
  USING (
    org_id::text = current_setting('app.current_org_id', true)
    OR current_setting('app.current_org_type', true) = 'platform'
  );

CREATE POLICY consents_self_read ON consents
  FOR SELECT TO app_user
  USING (
    accepted_by_user_id::text = current_setting('app.current_user_id', true)
    OR current_setting('app.current_org_type', true) = 'platform'
  );

COMMIT;
