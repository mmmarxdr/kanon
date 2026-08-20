import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptPrivacyQuarantine, parsePrivacyQuarantineKeyring } from "../src/modules/integrations/core/crypto.js";

const databaseUrl = process.env.PRIVACY_RECOVERY_POSTGRES_URL;
const harness = databaseUrl ? describe : describe.skip;
const quarantineKey = Buffer.alloc(32, 7).toString("base64");
const keyring = parsePrivacyQuarantineKeyring({ currentKeyId: "test", keys: { test: quarantineKey } });

harness("privacy recovery PostgreSQL authority boundary", () => {
  const runtime = new PrismaClient({ datasourceUrl: databaseUrl });
  const authority = new PrismaClient({ datasourceUrl: databaseUrl });
  const operator = new PrismaClient({ datasourceUrl: databaseUrl });
  let recover: (typeof import("../src/modules/integrations/privacy-hold/privacy-authority.js"))["privacyAuthority"]["recover"];
  let replayRecovery: (typeof import("../src/modules/integrations/privacy-hold/privacy-authority.js"))["privacyAuthority"]["replayRecovery"];

  async function seed() {
    return authority.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE kanon_privacy_authority");
      await tx.$executeRawUnsafe("UPDATE privacy_authority.control SET recovery_enabled=true WHERE singleton");
      const user = await tx.user.create({ data: { email: `${randomUUID()}@recovery.test` } });
      const workspace = await tx.workspace.create({ data: { name: "Recovery", slug: randomUUID() } });
      const member = await tx.member.create({ data: { userId: user.id, workspaceId: workspace.id, username: randomUUID(), role: "owner", projectAccess: "workspace" } });
      const project = await tx.project.create({ data: { workspaceId: workspace.id, key: "RCV", name: "Recovery" } });
      const connection = await tx.integrationConnection.create({ data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.test", lifecycle: "active" } });
      const credential = await tx.memberIntegrationCredential.create({ data: { memberId: member.id, connectionId: connection.id, encryptedKey: "credential-ciphertext", lastAuthStatus: "valid" } });
      await tx.integrationConnection.update({ where: { id: connection.id }, data: { serviceCredentialId: credential.id } });
      const binding = await tx.integrationProjectBinding.create({ data: { connectionId: connection.id, projectId: project.id, remoteProjectId: "42", readMap: {}, writeMap: {}, lifecycle: "active" } });
      const issue = await tx.issue.create({ data: { projectId: project.id, key: `RCV-${randomUUID()}`, sequenceNum: 1, title: "[privacy hold]", privacyHeldAt: new Date(), privacyHoldGeneration: 1 } });
      const ref = await tx.externalRef.create({ data: { connectionId: connection.id, bindingId: binding.id, entityType: "issue", entityId: issue.id, externalId: "42" } });
      const envelope = encryptPrivacyQuarantine(JSON.stringify({ generation: 1, title: "Canonical title", description: "Canonical description" }), { issueId: issue.id, bindingId: binding.id, generation: 1 }, keyring);
      await tx.$executeRawUnsafe("INSERT INTO privacy_quarantine.issue_content(issue_id,binding_id,generation,snapshot_schema,envelope) VALUES ($1::uuid,$2::uuid,1,1,$3)", issue.id, binding.id, envelope);
      return { workspace, member, connection, credential, binding, issue, ref };
    });
  }

  function input(fixture: Awaited<ReturnType<typeof seed>>, keyHash = "a".repeat(64)) {
    return { issueId: fixture.issue.id, bindingId: fixture.binding.id, memberId: fixture.member.id, workspaceId: fixture.workspace.id, connectionId: fixture.connection.id, keyHash, credentialId: fixture.credential.id, credentialFingerprint: createHash("sha256").update(fixture.credential.encryptedKey).digest("hex"), lifecycleEpoch: fixture.connection.lifecycleEpoch, bindingLifecycleEpoch: fixture.binding.lifecycleEpoch, remoteIssueId: fixture.ref.externalId, scopeFingerprint: fixture.binding.remoteProjectId };
  }

  beforeAll(async () => {
    await runtime.$executeRawUnsafe("SET ROLE kanon_runtime");
    await operator.$executeRawUnsafe("SET ROLE kanon_privacy_operator");
    process.env.PRIVACY_OPERATOR_DATABASE_URL = databaseUrl;
    process.env.PRIVACY_QUARANTINE_KEYRING = JSON.stringify({ currentKeyId: "test", keys: { test: quarantineKey } });
    ({ privacyAuthority: { recover, replayRecovery } } = await import("../src/modules/integrations/privacy-hold/privacy-authority.js"));
  });
  afterAll(async () => { await Promise.all([runtime.$disconnect(), authority.$disconnect(), operator.$disconnect()]); });

  it("denies runtime recovery authority while allowing the separate operator pool", async () => {
    await expect(runtime.$queryRawUnsafe("SELECT * FROM privacy_authority.recovery_receipts")).rejects.toThrow();
    await expect(runtime.$queryRawUnsafe("SELECT privacy_authority.mint_recovery_capability(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)")).rejects.toThrow();
    const execute = await operator.$queryRawUnsafe<{ canMint: boolean }[]>("SELECT has_function_privilege(current_user, 'privacy_authority.mint_recovery_capability(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text,integer,integer,text,text,text,timestamptz)', 'EXECUTE') AS \"canMint\"");
    expect(execute).toEqual([{ canMint: true }]);
  });

  it("releases once, persists a receipt, and rejects same-member key reuse", async () => {
    const fixture = await seed();
    const snapshot = { title: "Remote title", description: "Remote body", digest: "b".repeat(64), observedAt: new Date() };
    await expect(recover(input(fixture), snapshot)).resolves.toEqual({ status: "released", generation: 2, idempotent: false });
    await expect(replayRecovery({ memberId: fixture.member.id, bindingId: fixture.binding.id, issueId: fixture.issue.id, keyHash: "a".repeat(64), generation: 2 })).resolves.toEqual({ status: "released", generation: 2, idempotent: true });
    await expect(recover(input(fixture), snapshot)).resolves.toMatchObject({ status: "held", reason: "idempotency_conflict", retryable: false });
    const state = await authority.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE kanon_privacy_authority");
      return Promise.all([tx.issue.findUniqueOrThrow({ where: { id: fixture.issue.id } }), tx.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) FROM privacy_authority.recovery_receipts WHERE issue_id=$1::uuid", fixture.issue.id)]);
    });
    expect(state[0]).toMatchObject({ title: "Canonical title", description: "Canonical description", privacyHeldAt: null, privacyHoldGeneration: 2 });
    expect(state[1][0]?.count).toBe(1n);
  });

  it("rejects mismatched ExternalRef and cross-context or generation key reuse without mutation", async () => {
    const fixture = await seed(), valid = input(fixture, "d".repeat(64));
    await expect(recover({ ...valid, remoteIssueId: "wrong" }, { title: "remote", description: "remote", digest: "e".repeat(64), observedAt: new Date() })).resolves.toEqual({ status: "held", reason: "scope_changed", retryable: false });
    await expect(recover(valid, { title: "remote", description: "remote", digest: "e".repeat(64), observedAt: new Date() })).resolves.toEqual({ status: "released", generation: 2, idempotent: false });
    await authority.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE kanon_privacy_authority");
      await tx.issue.update({ where: { id: fixture.issue.id }, data: { privacyHeldAt: new Date(), privacyHoldGeneration: 3 } });
    });
    await expect(recover({ ...valid, remoteIssueId: "other" }, { title: "remote", description: "remote", digest: "f".repeat(64), observedAt: new Date() })).resolves.toEqual({ status: "held", reason: "idempotency_conflict", retryable: false });
    const state = await authority.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE kanon_privacy_authority");
      return Promise.all([tx.issue.findUniqueOrThrow({ where: { id: fixture.issue.id } }), tx.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) FROM privacy_authority.recovery_receipts WHERE issue_id=$1::uuid", fixture.issue.id)]);
    });
    expect(state[0]).toMatchObject({ privacyHeldAt: expect.any(Date), privacyHoldGeneration: 3 });
    expect(state[1][0]?.count).toBe(1n);
  });

  it("rolls back a credential mismatch without exposing quarantined content", async () => {
    const fixture = await seed();
    const broken = { ...input(fixture, "c".repeat(64)), credentialFingerprint: "0".repeat(64) };
    await expect(recover(broken, { title: "remote", description: "remote", digest: "d".repeat(64), observedAt: new Date() })).resolves.toMatchObject({ status: "held" });
    const state = await authority.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE kanon_privacy_authority");
      return Promise.all([tx.issue.findUniqueOrThrow({ where: { id: fixture.issue.id } }), tx.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) FROM privacy_authority.recovery_receipts WHERE issue_id=$1::uuid", fixture.issue.id)]);
    });
    expect(state[0]).toMatchObject({ title: "[privacy hold]", description: null, privacyHoldGeneration: 1 });
    expect(state[0].privacyHeldAt).not.toBeNull();
    expect(state[1][0]?.count).toBe(0n);
  });

  it("rolls back a decrypt failure after capability mint without consuming or releasing", async () => {
    const fixture = await seed(), valid = input(fixture, "8".repeat(64));
    await authority.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE kanon_privacy_authority");
      await tx.$executeRawUnsafe("UPDATE privacy_quarantine.issue_content SET envelope='invalid' WHERE issue_id=$1::uuid", fixture.issue.id);
    });
    await expect(recover(valid, { title: "remote", description: "remote", digest: "7".repeat(64), observedAt: new Date() })).resolves.toMatchObject({ status: "held", reason: "snapshot_unavailable" });
    const state = await authority.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE kanon_privacy_authority");
      return Promise.all([tx.issue.findUniqueOrThrow({ where: { id: fixture.issue.id } }), tx.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) FROM privacy_authority.recovery_capabilities WHERE issue_id=$1::uuid", fixture.issue.id), tx.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) FROM privacy_authority.recovery_receipts WHERE issue_id=$1::uuid", fixture.issue.id)]);
    });
    expect(state[0]).toMatchObject({ title: "[privacy hold]", privacyHoldGeneration: 1 });
    expect(state[0].privacyHeldAt).not.toBeNull();
    expect(state[1][0]?.count).toBe(0n);
    expect(state[2][0]?.count).toBe(0n);
  });

  it("rejects forged and stale capabilities at the 60-second consume boundary", async () => {
    const fixture = await seed(), capability = randomUUID(), digest = "e".repeat(64);
    await authority.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE kanon_privacy_authority");
      await tx.$executeRawUnsafe("INSERT INTO privacy_authority.recovery_capabilities(id,binding_id,issue_id,generation,member_id,expires_at,key_hash,snapshot_digest,observed_at) VALUES ($1::uuid,$2::uuid,$3::uuid,1,$4::uuid,clock_timestamp()+interval '60 seconds',$5,$6,clock_timestamp()-interval '60.001 seconds')", capability, fixture.binding.id, fixture.issue.id, fixture.member.id, "f".repeat(64), digest);
    });
    await operator.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE kanon_privacy_operator");
      await expect(tx.$queryRawUnsafe("SELECT privacy_authority.load_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5)", capability, fixture.issue.id, fixture.binding.id, fixture.member.id, digest)).rejects.toThrow();
      await expect(tx.$queryRawUnsafe("SELECT privacy_authority.load_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5)", randomUUID(), fixture.issue.id, fixture.binding.id, fixture.member.id, digest)).rejects.toThrow();
    });
  });

  it("allows exactly one competing full release while the receipt transaction is paused", async () => {
    const fixture = await seed(), valid = input(fixture, "9".repeat(64)), gate = new PrismaClient({ datasourceUrl: databaseUrl });
    await authority.$executeRawUnsafe("CREATE OR REPLACE FUNCTION privacy_authority.test_pause_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(246246); RETURN NEW; END $$");
    await authority.$executeRawUnsafe("CREATE TRIGGER privacy_test_pause_release BEFORE INSERT ON privacy_authority.recovery_receipts FOR EACH ROW EXECUTE FUNCTION privacy_authority.test_pause_release()");
    let open!: () => void;
    const entered = new Promise<void>((resolve) => { open = resolve; });
    let close!: () => void;
    const locked = gate.$transaction(async (tx) => { await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(246246)"); open(); await new Promise<void>((resolve) => { close = resolve; }); });
    await entered;
    const first = recover(valid, { title: "remote", description: "remote", digest: "b".repeat(64), observedAt: new Date() });
    await expect.poll(async () => (await authority.$queryRawUnsafe<{ waiting: boolean }[]>("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=246246 AND NOT granted) AS waiting"))[0]?.waiting).toBe(true);
    await expect(recover(valid, { title: "remote", description: "remote", digest: "c".repeat(64), observedAt: new Date() })).resolves.toEqual({ status: "held", reason: "recovery_in_progress", retryable: true });
    close();
    await expect(first).resolves.toEqual({ status: "released", generation: 2, idempotent: false });
    await locked;
    await gate.$disconnect();
    await authority.$executeRawUnsafe("DROP TRIGGER privacy_test_pause_release ON privacy_authority.recovery_receipts");
    const receipts = await authority.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) FROM privacy_authority.recovery_receipts WHERE issue_id=$1::uuid", fixture.issue.id);
    expect(receipts[0]?.count).toBe(1n);
  });

  it("rolls back the whole release when receipt persistence is forced to fail", async () => {
    const fixture = await seed(), valid = input(fixture, "6".repeat(64));
    const envelope = (await authority.$queryRawUnsafe<{ envelope: string }[]>("SELECT envelope FROM privacy_quarantine.issue_content WHERE issue_id=$1::uuid", fixture.issue.id))[0]!.envelope;
    await authority.$executeRawUnsafe("INSERT INTO privacy_authority.held_row_associations(store_kind,row_pk,issue_id,hold_generation,registry_version,disposition) VALUES ('test', $1, $2::uuid, 1, 1, 'fence'), ('test', $3, $2::uuid, 1, 1, 'fence')", randomUUID(), fixture.issue.id, randomUUID());
    await authority.$executeRawUnsafe("CREATE OR REPLACE FUNCTION privacy_authority.test_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced receipt failure'; END $$");
    await authority.$executeRawUnsafe("CREATE TRIGGER privacy_test_fail_receipt BEFORE INSERT ON privacy_authority.recovery_receipts FOR EACH ROW EXECUTE FUNCTION privacy_authority.test_fail_receipt()");
    await expect(recover(valid, { title: "remote", description: "remote", digest: "5".repeat(64), observedAt: new Date() })).resolves.toMatchObject({ status: "held" });
    const state = await authority.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE kanon_privacy_authority");
      return Promise.all([tx.issue.findUniqueOrThrow({ where: { id: fixture.issue.id } }), tx.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) FROM privacy_authority.recovery_capabilities WHERE issue_id=$1::uuid", fixture.issue.id), tx.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) FROM privacy_authority.recovery_receipts WHERE issue_id=$1::uuid", fixture.issue.id), tx.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) FROM privacy_authority.held_row_associations WHERE issue_id=$1::uuid", fixture.issue.id), tx.$queryRawUnsafe<{ envelope: string }[]>("SELECT envelope FROM privacy_quarantine.issue_content WHERE issue_id=$1::uuid", fixture.issue.id)]);
    });
    expect(state[0]).toMatchObject({ title: "[privacy hold]", privacyHoldGeneration: 1 });
    expect(state[0].privacyHeldAt).not.toBeNull();
    expect(state[1][0]?.count).toBe(0n);
    expect(state[2][0]?.count).toBe(0n);
    expect(state[3][0]?.count).toBe(2n);
    expect(state[4][0]?.envelope).toBe(envelope);
    await authority.$executeRawUnsafe("DROP TRIGGER privacy_test_fail_receipt ON privacy_authority.recovery_receipts");
    await expect(recover(valid, { title: "remote", description: "remote", digest: "5".repeat(64), observedAt: new Date() })).resolves.toEqual({ status: "released", generation: 2, idempotent: false });
  });
});
