import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BCRYPT_COST = 12;

async function main() {
  console.log("Seeding database...");

  // ── 1. Create workspace ──────────────────────────────────────────────────
  const workspace = await prisma.workspace.upsert({
    where: { slug: "kanon-dev" },
    update: {},
    create: {
      name: "Kanon Development",
      slug: "kanon-dev",
    },
  });
  console.log(`  Workspace: ${workspace.name} (${workspace.id})`);

  // ── 2. Create member ─────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("Password1!", BCRYPT_COST);

  const member = await prisma.member.upsert({
    where: {
      workspaceId_email: {
        workspaceId: workspace.id,
        email: "dev@kanon.io",
      },
    },
    update: {},
    create: {
      email: "dev@kanon.io",
      username: "dev",
      passwordHash,
      role: "owner",
      workspaceId: workspace.id,
    },
  });
  console.log(`  Member: ${member.username} (${member.id})`);

  // ── 3. Create project ────────────────────────────────────────────────────
  const project = await prisma.project.upsert({
    where: {
      workspaceId_key: {
        workspaceId: workspace.id,
        key: "KAN",
      },
    },
    update: {},
    create: {
      key: "KAN",
      name: "Kanon",
      description: "The Kanon project tracker itself",
      workspaceId: workspace.id,
    },
  });
  console.log(`  Project: ${project.name} (${project.key})`);

  console.log("\nSeed complete! Structural data (workspace, member, project) is ready.");
  console.log(`\n  Login credentials:`);
  console.log(`    Email:    dev@kanon.io`);
  console.log(`    Password: Password1!`);
  console.log(`    Workspace slug: kanon-dev`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
