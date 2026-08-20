/**
 * Connect Capital — Development seed
 *
 * R9 / Part LXV: nothing is faked. These are TEST organizations and they say
 * so in their legal name, so a labelled fixture can never be mistaken for a
 * real verified funder in a screenshot, a demo, or a staging environment
 * someone forgot was staging.
 *
 * Provider verification status stays 'pending' here. A verified badge means a
 * real KYB check happened. Seeding one would be exactly the fake verification
 * the founder brief prohibits — and the badge is the whole product.
 *
 *   npx tsx db/seed.ts     (refuses to run against production)
 */

import { withSystem } from '../lib/db';
import { users, organizations, orgMembers } from './kernel';

if (process.env.NODE_ENV === 'production') {
  throw new Error('seed refuses to run in production');
}

async function seed() {
  await withSystem(async (tx) => {
    // --- Platform ---------------------------------------------------------
    const [platformOrg] = await tx
      .insert(organizations)
      .values({
        type: 'platform',
        legalName: 'Connect Capital (Platform)',
        status: 'active',
      })
      .returning();

    const [admin] = await tx
      .insert(users)
      .values({
        authProviderId: 'seed_admin',
        email: 'admin@test.connectcapital.local',
        fullName: 'Test Admin',
        status: 'active',
        mfaEnabled: true,
      })
      .returning();

    await tx.insert(orgMembers).values({
      orgId: platformOrg.id,
      userId: admin.id,
      role: 'admin',
    });

    // --- Merchant ---------------------------------------------------------
    const [merchantOrg] = await tx
      .insert(organizations)
      .values({
        type: 'merchant',
        legalName: 'TEST MERCHANT — Northshore Auto Repair LLC',
        dba: 'TEST MERCHANT — Northshore Auto',
        status: 'active',
      })
      .returning();

    const [merchant] = await tx
      .insert(users)
      .values({
        authProviderId: 'seed_merchant',
        email: 'merchant@test.connectcapital.local',
        phone: '+15555550100',
        fullName: 'Test Merchant Owner',
        status: 'active',
      })
      .returning();

    await tx.insert(orgMembers).values({
      orgId: merchantOrg.id,
      userId: merchant.id,
      role: 'owner',
    });

    // --- Providers --------------------------------------------------------
    // Two, because a single provider cannot exercise the properties that
    // matter: blind offers, selective authorization, or revocation.
    for (const [i, name] of [
      'TEST PROVIDER 1 — Harbor Point Capital',
      'TEST PROVIDER 2 — Ridgeline Funding Group',
    ].entries()) {
      const [providerOrg] = await tx
        .insert(organizations)
        .values({
          type: 'provider',
          legalName: name,
          // Deliberately NOT active/verified. See header.
          status: 'pending',
        })
        .returning();

      const [rep] = await tx
        .insert(users)
        .values({
          authProviderId: `seed_provider_rep_${i + 1}`,
          email: `rep${i + 1}@test.connectcapital.local`,
          fullName: `Test Rep ${i + 1}`,
          status: 'active',
        })
        .returning();

      await tx.insert(orgMembers).values({
        orgId: providerOrg.id,
        userId: rep.id,
        role: 'rep',
      });
    }

    // --- Specialist -------------------------------------------------------
    const [specialistOrg] = await tx
      .insert(organizations)
      .values({
        type: 'specialist',
        legalName: 'TEST SPECIALIST — Connect Capital Advisory',
        status: 'pending',
      })
      .returning();

    const [specialist] = await tx
      .insert(users)
      .values({
        authProviderId: 'seed_specialist',
        email: 'specialist@test.connectcapital.local',
        fullName: 'Test Funding Specialist',
        status: 'active',
      })
      .returning();

    await tx.insert(orgMembers).values({
      orgId: specialistOrg.id,
      userId: specialist.id,
      role: 'specialist',
    });
  });

  console.log('seeded: 1 platform, 1 TEST MERCHANT, 2 TEST PROVIDERs, 1 TEST SPECIALIST');
  console.log('providers are status=pending — verification requires a real KYB check');
}

seed().then(() => process.exit(0));
