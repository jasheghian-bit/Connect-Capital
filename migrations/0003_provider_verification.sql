-- Connect Capital — M2 Provider verification guards
--
-- The verified badge carries the platform's liability. This migration makes it
-- structurally impossible to set by hand.

BEGIN;

-- ---------------------------------------------------------------------------
-- A verified provider has a KYB reference. Always.
-- ---------------------------------------------------------------------------
-- Without this, 'verified' is one UPDATE away for anyone with database access,
-- and the badge means whatever the last person to touch the row believed.
-- With it, the claim is enforced by the same system that stores it.

ALTER TABLE providers
  ADD CONSTRAINT providers_verified_requires_kyb
  CHECK (
    verification_status <> 'verified'
    OR (kyb_ref IS NOT NULL AND verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL)
  );

-- A suspended or offboarded provider always carries a reason. "Why is this
-- funder gone" must be answerable from the row.
ALTER TABLE providers
  ADD CONSTRAINT providers_negative_status_requires_reason
  CHECK (
    verification_status NOT IN ('suspended', 'offboarded')
    OR (status_reason IS NOT NULL AND length(trim(status_reason)) >= 10)
  );

-- ---------------------------------------------------------------------------
-- Append-only: verification decisions are evidence
-- ---------------------------------------------------------------------------

REVOKE UPDATE, DELETE ON verification_events FROM app_user;

CREATE TRIGGER verification_events_append_only
  BEFORE UPDATE OR DELETE ON verification_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- Criteria history is preserved, not overwritten
-- ---------------------------------------------------------------------------
-- A funder asking "why didn't I see that deal last month" gets a real answer
-- only if the criteria as they stood last month still exist. Deactivating
-- closes effective_to; it never deletes.

CREATE OR REPLACE FUNCTION close_criterion_instead_of_delete() RETURNS trigger AS $$
BEGIN
  UPDATE provider_criteria
     SET active = false, effective_to = now()
   WHERE id = OLD.id AND effective_to IS NULL;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER provider_criteria_no_delete
  BEFORE DELETE ON provider_criteria
  FOR EACH ROW EXECUTE FUNCTION close_criterion_instead_of_delete();

-- ---------------------------------------------------------------------------
-- Decline taxonomy
-- ---------------------------------------------------------------------------
-- Routing key for the platform's primary acquisition channel. Fit declines are
-- high-intent, recently underwritten, near-zero-CAC demand. Credit declines go
-- to remediation. Fraud and compliance never enter matching at all.

INSERT INTO decline_reason_codes (code, category, label, merchant_facing_label, remediation_hint, routable) VALUES
  ('industry_excluded',    'fit',        'Industry not funded',           'This funder doesn''t fund your industry',        'Other funders on the platform do.',                              true),
  ('state_excluded',       'fit',        'State not served',              'This funder doesn''t operate in your state',     'Other funders on the platform do.',                              true),
  ('amount_below_min',     'fit',        'Below minimum',                 'Your request is below their minimum',           'Try a funder who works with smaller amounts.',                   true),
  ('amount_above_max',     'fit',        'Above maximum',                 'Your request is above their maximum',           'Try a funder who works with larger amounts.',                    true),
  ('position_count',       'fit',        'Too many open positions',       'They prefer fewer open advances',               'Some funders take later positions.',                             true),
  ('tib_below_min',        'fit',        'Time in business too short',    'They need a longer operating history',          'Some funders start at six months.',                              true),
  ('product_mismatch',     'fit',        'Product not offered',           'They don''t offer this type of financing',      'Other funders on the platform do.',                              true),
  ('capacity',             'fit',        'No current capacity',           'They''re not taking new files right now',        'This may change — we''ll re-check.',                             true),

  ('revenue_insufficient', 'credit',     'Revenue below threshold',       'Revenue is below what funders need',            'Come back when monthly deposits are higher.',                    false),
  ('negative_days',        'credit',     'Too many negative days',        'Too many days with a negative balance',         'Three clean months usually changes this.',                       false),
  ('nsf_activity',         'credit',     'NSF activity',                  'Returned payments in recent statements',        'A clean statement period usually changes this.',                 false),
  ('recent_default',       'credit',     'Prior default',                 'A previous advance was not repaid',             'This takes time to move past.',                                  false),
  ('insufficient_history', 'credit',     'Not enough activity',           'Not enough banking activity yet',               'Funders need at least three months.',                            false),

  ('identity_mismatch',    'fraud',      'Identity mismatch',             'We need to verify some details',                NULL,                                                             false),
  ('document_integrity',   'fraud',      'Document integrity concern',    'We need to verify some details',                NULL,                                                             false),

  ('ofac_watchlist',       'compliance', 'Watchlist match',               'We can''t proceed with this application',       NULL,                                                             false),
  ('restricted_industry',  'compliance', 'Restricted industry',           'We can''t fund this industry',                  NULL,                                                             false)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- A provider reads and writes its own configuration. Merchants read verified
-- providers only — an unverified funder is invisible in matching rather than
-- shown with a warning label, because a merchant should never be choosing
-- between vouched and un-vouched counterparties.

ALTER TABLE providers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_criteria  ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_appetite  ENABLE ROW LEVEL SECURITY;

CREATE POLICY providers_visibility ON providers
  FOR SELECT TO app_user
  USING (
    org_id::text = current_setting('app.current_org_id', true)
    OR verification_status = 'verified'
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY providers_self_write ON providers
  FOR UPDATE TO app_user
  USING (
    org_id::text = current_setting('app.current_org_id', true)
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY provider_criteria_own ON provider_criteria
  FOR ALL TO app_user
  USING (
    provider_id IN (
      SELECT id FROM providers
      WHERE org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

CREATE POLICY provider_appetite_own ON provider_appetite
  FOR ALL TO app_user
  USING (
    provider_id IN (
      SELECT id FROM providers
      WHERE org_id::text = current_setting('app.current_org_id', true)
    )
    OR current_setting('app.current_org_type', true) IN ('platform', 'system')
  );

COMMIT;
