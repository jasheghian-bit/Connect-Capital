/**
 * Nightly audit chain verification.
 *
 * Recomputes every hash from genesis and reports the first break. Publish the
 * head hash externally afterwards — a chain nobody checks proves nothing, and
 * a chain nobody publishes proves only that we didn't rewrite it ourselves.
 *
 *   npm run audit:verify
 */

import { verifyChain } from '../lib/audit';

const result = await verifyChain();

if (!result.ok) {
  console.error(`AUDIT CHAIN BROKEN at seq ${result.brokenAt}`);
  console.error('Treat as a security incident. Do not restart the app.');
  process.exit(1);
}

console.log(`audit chain verified — head ${result.head}`);
process.exit(0);
