import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260818120000_domain_event_outbox/migration.sql",
  import.meta.url
);

describe("DomainEventOutbox migration", () => {
  it("backfills only unacknowledged lifecycle effects before dropping legacy claims", async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), "utf8");

    expect(sql).toContain('CREATE TABLE "domain_event_outbox"');
    expect(sql).toContain('FROM "work_transition_lifecycles" lifecycle');
    expect(sql).toContain('lifecycle."effects_emitted_at" IS NULL');
    expect(sql).toContain('lifecycle."work_log_id" IS NOT NULL');
    expect(sql).toContain('ON CONFLICT ("delivery_key") DO NOTHING');
    expect(sql.match(/INSERT INTO "domain_event_outbox"/g)).toHaveLength(1);
    expect(sql).toContain(
      "'work-session:' || lifecycle.\"issue_id\"::text || ':' || lifecycle.\"user_id\"::text"
    );
    expect(sql).toContain('ORDER BY lifecycle."created_at", lifecycle."id", effect."ordinal"');
    expect(sql).toContain('DROP COLUMN "effects_claimed_at"');
    expect(sql).toContain('DROP COLUMN "effect_claim_token"');
    expect(sql).toContain('DROP COLUMN "effects_emitted_at"');
    expect(sql.indexOf('INSERT INTO "domain_event_outbox"')).toBeLessThan(
      sql.indexOf('DROP COLUMN "effects_claimed_at"')
    );
  });
});
