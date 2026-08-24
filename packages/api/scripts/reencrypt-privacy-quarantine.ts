import { PrismaClient } from "@prisma/client";
import { decryptPrivacyQuarantine, encryptPrivacyQuarantine, loadPrivacyQuarantineKeyring } from "../src/modules/integrations/core/crypto.js";
import { createPrivacyQuarantineRepository } from "../src/modules/integrations/privacy-hold/privacy-quarantine-repository.js";
export async function reencryptPrivacyQuarantine(database: PrismaClient): Promise<number> {
  const keyring = loadPrivacyQuarantineKeyring();
  return database.$transaction(async (transaction) => {
    const repository = createPrivacyQuarantineRepository(transaction as never);
    return repository.reencryptAll((snapshot) => encryptPrivacyQuarantine(
      decryptPrivacyQuarantine(snapshot.payload, snapshot, keyring), snapshot, keyring, snapshot.snapshotSchema,
    ), (snapshot) => { decryptPrivacyQuarantine(snapshot.payload, snapshot, keyring); });
  });
}
if (process.argv[1]?.endsWith("reencrypt-privacy-quarantine.ts")) {
  const database = new PrismaClient();
  reencryptPrivacyQuarantine(database).then((count) => { process.stdout.write(`Re-encrypted ${count} privacy quarantine snapshots.\n`); }).finally(() => database.$disconnect());
}
