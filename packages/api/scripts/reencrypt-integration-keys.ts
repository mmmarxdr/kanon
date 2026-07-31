import { prisma } from "../src/config/prisma.js";
import { decodeKey } from "../src/modules/integrations/core/crypto.js";
import { reencryptCredentials } from "../src/modules/integrations/service.js";

async function main() {
  const oldKey = process.env["INTEGRATION_ENCRYPTION_KEY_OLD"];
  const newKey = process.env["INTEGRATION_ENCRYPTION_KEY_NEW"];
  if (!oldKey || !newKey) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY_OLD and INTEGRATION_ENCRYPTION_KEY_NEW are required");
  }
  const result = await reencryptCredentials({
    oldKey: decodeKey(oldKey),
    newKey: decodeKey(newKey),
    dryRun: process.argv.includes("--dry-run"),
  });
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
