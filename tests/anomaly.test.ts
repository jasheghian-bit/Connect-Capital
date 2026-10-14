/**
 * CapNet — Trust and safety tests
 *
 *   npx tsx tests/anomaly.test.ts
 */

import { describe, it, expect } from 'vitest';
import { detectAnomalies, isClean, type ProviderActivity } from '../lib/anomaly';

const GOOD: ProviderActivity = {
  providerOrgId: 'org_harbor',
  providerName: 'Harbor Point Capital',
  windowDays: 30,
  documentsOpened: 48, documentsDownloaded: 22, distinctMerchantsAccessed: 18,
  deniedAccessAttempts: 0, postRevocationAttempts: 0,
  authorizationsReceived: 20, filesReviewed: 19, offersMade: 11,
  declinesIssued: 8, declinesWithinOneHour: 2,
  flaggedMessages: 0, distinctMerchantsFlagged: 0,
  offHoursAccesses: 6,
};

const has = (a: ProviderActivity, t: string) =>
  detectAnomalies(a).some((f) => f.type === t);

describe('a funder in good standing is clean', () => {
  it('produces no findings', () => {
    expect(isClean(GOOD)).toBe(true);
  });
});

describe('harvesting — the one that matters most', () => {
  it('flags a funder opening files and never offering', () => {
    const a = { ...GOOD, authorizationsReceived: 40, offersMade: 1, distinctMerchantsAccessed: 38 };
    expect(has(a, 'harvesting_without_offers')).toBe(true);
    expect(detectAnomalies(a)[0].severity).toBe('critical');
  });

  it('does NOT flag a funder having a slow week', () => {
    expect(has({ ...GOOD, authorizationsReceived: 6, offersMade: 0 }, 'harvesting_without_offers')).toBe(false);
  });

  it('does NOT flag a selective but active funder', () => {
    expect(has({ ...GOOD, authorizationsReceived: 40, offersMade: 9 }, 'harvesting_without_offers')).toBe(false);
  });

  it('suggests asking before accusing', () => {
    const a = { ...GOOD, authorizationsReceived: 40, offersMade: 1 };
    const f = detectAnomalies(a).find((x) => x.type === 'harvesting_without_offers');
    expect(f.suggestedAction.toLowerCase().includes('ask')).toBe(true);
  });
});

describe('post-revocation probing', () => {
  it('flags repeated attempts on revoked files', () => {
    expect(has({ ...GOOD, postRevocationAttempts: 7 }, 'post_revocation_attempt')).toBe(true);
  });

  it('tolerates one — a stale browser tab is not an attack', () => {
    expect(has({ ...GOOD, postRevocationAttempts: 1 }, 'post_revocation_attempt')).toBe(false);
  });
});

describe('off-platform contact patterns', () => {
  it('flags a funder sharing contact details across several merchants', () => {
    const a = { ...GOOD, flaggedMessages: 9, distinctMerchantsFlagged: 6 };
    expect(has(a, 'off_platform_contact_pattern')).toBe(true);
  });

  it('does not flag a single misunderstanding', () => {
    expect(has({ ...GOOD, flaggedMessages: 1, distinctMerchantsFlagged: 1 }, 'off_platform_contact_pattern')).toBe(false);
  });

  it('points at the evidence an anti-circumvention claim needs', () => {
    const a = { ...GOOD, flaggedMessages: 9, distinctMerchantsFlagged: 6 };
    const f = detectAnomalies(a).find((x) => x.type === 'off_platform_contact_pattern');
    expect(f.suggestedAction.toLowerCase().includes('circumvention')).toBe(true);
  });
});

describe('bulk download', () => {
  it('flags archiving-scale downloads relative to files worked', () => {
    expect(has({ ...GOOD, documentsDownloaded: 200, authorizationsReceived: 20 }, 'bulk_download')).toBe(true);
  });

  it('does not flag normal document-heavy underwriting', () => {
    expect(has({ ...GOOD, documentsDownloaded: 60, authorizationsReceived: 20 }, 'bulk_download')).toBe(false);
  });

  it('is a warning, not a critical — usually innocent', () => {
    const a = { ...GOOD, documentsDownloaded: 200, authorizationsReceived: 20 };
    const f = detectAnomalies(a).find((x) => x.type === 'bulk_download');
    expect(f.severity).toBe('warning');
  });
});

describe('rapid declines point at the platform, not the funder', () => {
  it('flags a pattern of declining within the hour', () => {
    expect(has({ ...GOOD, declinesIssued: 20, declinesWithinOneHour: 18 }, 'rapid_decline')).toBe(true);
  });

  it('suggests checking the blinded card first', () => {
    const a = { ...GOOD, declinesIssued: 20, declinesWithinOneHour: 18 };
    const f = detectAnomalies(a).find((x) => x.type === 'rapid_decline');
    expect(f.suggestedAction.toLowerCase().includes('blinded card')).toBe(true);
  });
});

describe('findings are actionable and ordered', () => {
  it('critical findings sort first', () => {
    const a = {
      ...GOOD,
      authorizationsReceived: 40, offersMade: 1,
      documentsDownloaded: 300,
      offHoursAccesses: 60, documentsOpened: 60,
    };
    expect(detectAnomalies(a)[0].severity).toBe('critical');
  });

  it('every finding carries evidence and a next step', () => {
    const a = { ...GOOD, authorizationsReceived: 40, offersMade: 1, postRevocationAttempts: 5 };
    for (const f of detectAnomalies(a)) {
      expect(Object.keys(f.evidence).length > 0).toBe(true);
      expect(f.suggestedAction.length > 20).toBe(true);
    }
  });
});
