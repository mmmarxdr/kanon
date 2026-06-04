/**
 * One-time data-migration script: grant isInstanceAdmin=true to the existing
 * super-admin on an already-claimed live instance (KAN-49 PR1a).
 *
 * Background
 * ----------
 * The setup token for admin@kanon.io (or the first-run operator) is single-use
 * and was already consumed before PR1a was deployed. Re-running the claim flow
 * is NOT an option. This script grants the instance-admin flag directly to the
 * user identified by InstanceSettings.ownerUserId.
 *
 * Usage
 * -----
 *   DATABASE_URL=postgres://... npx tsx prisma/scripts/grant-existing-admin.ts
 *
 * Safety
 * ------
 * - Dry-run by default. Pass --apply to write the change.
 * - If no ownerUserId is set, the script exits without touching any rows.
 * - The update is idempotent — running it twice is safe.
 *
 * DO NOT run this against the test database. It is for production use only.
 */

import { PrismaClient } from "@prisma/client";

const isDryRun = !process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  const settings = await prisma.instanceSettings.findFirst({
    select: { ownerUserId: true },
  });

  if (!settings?.ownerUserId) {
    console.log("[grant-existing-admin] No ownerUserId set — instance not yet claimed. Nothing to do.");
    return;
  }

  const owner = await prisma.user.findUnique({
    where: { id: settings.ownerUserId },
    select: { id: true, email: true, isInstanceAdmin: true, isSuperAdmin: true },
  });

  if (!owner) {
    console.error("[grant-existing-admin] ownerUserId references a missing user — check data integrity.");
    process.exit(1);
  }

  // Only skip if BOTH flags are already set — partial state still needs a fix.
  if (owner.isInstanceAdmin && owner.isSuperAdmin) {
    console.log(`[grant-existing-admin] User ${owner.email} already has isInstanceAdmin=true AND isSuperAdmin=true. Nothing to do.`);
    return;
  }

  if (isDryRun) {
    console.log(`[grant-existing-admin] DRY RUN — would set isInstanceAdmin=true and isSuperAdmin=true for ${owner.email} (${owner.id})`);
    console.log("[grant-existing-admin] Re-run with --apply to commit the change.");
    return;
  }

  await prisma.user.update({
    where: { id: owner.id },
    data: { isInstanceAdmin: true, isSuperAdmin: true },
  });

  console.log(`[grant-existing-admin] SUCCESS — set isInstanceAdmin=true and isSuperAdmin=true for ${owner.email} (${owner.id})`);
}

main()
  .catch((err) => {
    console.error("[grant-existing-admin] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
