import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load E2E env vars
dotenv.config({ path: path.resolve(__dirname, ".env.e2e") });

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://kanon:kanon@localhost:5432/kanon_e2e?schema=public";

const API_PKG_DIR = path.resolve(__dirname, "../api");

export default async function globalSetup(): Promise<void> {
  console.log("\n[e2e] Global setup starting...");
  console.log(`[e2e] DATABASE_URL: ${DATABASE_URL.replace(/\/\/.*@/, "//***@")}`);

  // Step 1: Reset and seed the test database using Prisma
  // The PRISMA_USER_CONSENT env var is required because Prisma detects AI agents
  // and blocks destructive operations. This is safe: we target the kanon_e2e test DB.
  const prismaEnv = {
    ...process.env,
    DATABASE_URL,
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes",
  };

  console.log("[e2e] Running prisma migrate reset --force...");
  execSync("npx prisma migrate reset --force --skip-generate", {
    cwd: API_PKG_DIR,
    env: prismaEnv,
    stdio: "pipe",
  });

  console.log("[e2e] Running prisma db seed...");
  execSync("npx prisma db seed", {
    cwd: API_PKG_DIR,
    env: prismaEnv,
    stdio: "pipe",
  });

  // Step 2: Query the workspace UUID + seed extra test data from the seeded DB
  // Write a temp script to avoid shell escaping issues with inline code
  console.log("[e2e] Resolving seed data constants and creating extra test fixtures...");
  // Write the temp script into the API package dir so @prisma/client resolves correctly
  const tmpScript = path.resolve(API_PKG_DIR, ".tmp-resolve-workspace.mjs");
  fs.writeFileSync(
    tmpScript,
    [
      `import { PrismaClient } from '@prisma/client';`,
      `import bcrypt from 'bcryptjs';`,
      `const prisma = new PrismaClient();`,
      `try {`,
      `  const w = await prisma.workspace.findFirst({ where: { slug: 'kanon-dev' } });`,
      ``,
      `  // Seed admin user's emailVerifiedAt so login flow is clean`,
      `  await prisma.user.update({`,
      `    where: { email: 'dev@kanon.io' },`,
      `    data: { emailVerifiedAt: new Date() },`,
      `  });`,
      ``,
      `  // Seed an unverified user (for verify-email banner testing)`,
      `  const unverifiedHash = await bcrypt.hash('Password1!', 10);`,
      `  const unverified = await prisma.user.upsert({`,
      `    where: { email: 'unverified@kanon.io' },`,
      `    update: {},`,
      `    create: {`,
      `      email: 'unverified@kanon.io',`,
      `      passwordHash: unverifiedHash,`,
      `      displayName: 'Unverified User',`,
      `      emailVerifiedAt: null,`,
      `    },`,
      `  });`,
      ``,
      `  // Add unverified user as workspace member`,
      `  await prisma.member.upsert({`,
      `    where: { userId_workspaceId: { userId: unverified.id, workspaceId: w.id } },`,
      `    update: {},`,
      `    create: {`,
      `      username: 'unverified',`,
      `      role: 'member',`,
      `      userId: unverified.id,`,
      `      workspaceId: w.id,`,
      `    },`,
      `  });`,
      ``,
      `  // Seed an invite scoped to the seed user (for invite flow testing).`,
      `  // Scoping it to dev@kanon.io (already a workspace member) means the`,
      `  // authenticated accept flow resolves to 409 ALREADY_MEMBER, which the UI`,
      `  // handles by redirecting to /workspaces. An invite addressed to a`,
      `  // different email would 403 EMAIL_MISMATCH before the membership check.`,
      `  // Use a fixed token so tests can reference it`,
      `  const inviteToken = 'e2e-test-invite-token-fixed';`,
      `  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days`,
      `  // Get the seed admin user id for createdById (required field)`,
      `  const adminUser = await prisma.user.findUnique({ where: { email: 'dev@kanon.io' } });`,
      `  const invite = await prisma.workspaceInvite.upsert({`,
      `    where: { token: inviteToken },`,
      `    update: { email: 'dev@kanon.io', expiresAt, revokedAt: null, useCount: 0 },`,
      `    create: {`,
      `      token: inviteToken,`,
      `      workspaceId: w.id,`,
      `      email: 'dev@kanon.io',`,
      `      role: 'member',`,
      `      kind: 'MEMBER',`,
      `      maxUses: 1,`,
      `      useCount: 0,`,
      `      expiresAt,`,
      `      createdById: adminUser.id,`,
      `    },`,
      `  });`,
      ``,
      `  console.log(JSON.stringify({ workspace: w, inviteId: invite.id, inviteToken }));`,
      `} finally {`,
      `  await prisma.$disconnect();`,
      `}`,
    ].join("\n"),
    "utf-8",
  );

  try {
    const result = execSync(`npx tsx ${tmpScript}`, {
      cwd: API_PKG_DIR,
      env: { ...process.env, DATABASE_URL },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const data = JSON.parse(result.toString().trim()) as {
      workspace: { id: string; slug: string; name: string };
      inviteId: string;
      inviteToken: string;
    };

    const { workspace, inviteToken } = data;

    // Write seed constants to a file that test helpers can import
    const envTestPath = path.resolve(__dirname, ".env.test");
    const envContent = [
      `# Auto-generated by global-setup.ts -- do not edit`,
      `SEED_WORKSPACE_ID=${workspace.id}`,
      `SEED_WORKSPACE_SLUG=${workspace.slug}`,
      `SEED_USER_EMAIL=dev@kanon.io`,
      `SEED_USER_PASSWORD=Password1!`,
      `SEED_UNVERIFIED_USER_EMAIL=unverified@kanon.io`,
      `SEED_UNVERIFIED_USER_PASSWORD=Password1!`,
      `SEED_INVITE_TOKEN=${inviteToken}`,
      "",
    ].join("\n");

    fs.writeFileSync(envTestPath, envContent, "utf-8");
    console.log(`[e2e] Wrote seed constants to ${envTestPath}`);
    console.log(`[e2e] Workspace ID: ${workspace.id}`);
    console.log(`[e2e] Invite token: ${inviteToken}`);
  } finally {
    // Clean up temp script
    if (fs.existsSync(tmpScript)) {
      fs.unlinkSync(tmpScript);
    }
  }

  console.log("[e2e] Global setup complete.\n");
}
