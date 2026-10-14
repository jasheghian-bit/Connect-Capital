-- CapNet — No pre-authorization visibility (founder decision, Sep 2026)
--
-- Supersedes the parts of 0004 that let a provider see a match before the
-- merchant granted access. A matched-but-unauthorized funder now sees NOTHING:
-- no blinded card, no match row, no "interested" action. Visibility begins
-- only with a live authorization. Grading and match scores are internal.
--
-- 0004 is not rewritten; it is history. This migration replaces its policy
-- and grant in place.

BEGIN;

-- ---------------------------------------------------------------------------
-- matches: internal routing output, never provider-readable
-- ---------------------------------------------------------------------------
-- 0004's matches_visibility let a provider SELECT its own match rows. That row
-- is itself a disclosure — "this merchant exists, applied, and fits you", plus
-- score and reasons — before the merchant said yes. The merchant still sees
-- which funders were suggested; the platform still sees everything.

DROP POLICY IF EXISTS matches_visibility ON matches;

CREATE POLICY matches_visibility_no_provider ON matches
  FOR SELECT TO app_user
  USING (
    application_id IN (
      SELECT a.id FROM applications a
      JOIN merchant_businesses mb ON mb.id = a.business_id
      WHERE mb.org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

-- ---------------------------------------------------------------------------
-- matches: the "interested" exception is gone
-- ---------------------------------------------------------------------------
-- 0004 granted UPDATE on provider_interested_at so a provider could click
-- "interested" on a blinded card. There is no card and no pre-auth action, so
-- the column-level grant is revoked and the row becomes fully append-only.
-- The column is kept for historical rows.

REVOKE UPDATE (provider_interested_at) ON matches FROM app_user;

DROP TRIGGER IF EXISTS matches_immutable_except_interest ON matches;

CREATE TRIGGER matches_append_only
  BEFORE UPDATE OR DELETE ON matches
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

DROP FUNCTION IF EXISTS matches_interest_only();

-- ---------------------------------------------------------------------------
-- authorizations: a provider sees its own grant rows, never anyone else's
-- ---------------------------------------------------------------------------
-- Unchanged from 0004 in effect, restated so the rule is explicit next to the
-- decision: an authorized funder is not told how many other funders hold the
-- file. A provider row filter on provider_org_id gives exactly that; a
-- provider can never count grants on an application it does not own.
-- (No DDL needed; see authorizations_visibility in 0004.)

COMMIT;
