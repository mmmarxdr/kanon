## Verification Report

**Change**: codex-cli-integration (KAN-128)
**Version**: codex-install-parity spec (delta)
**Mode**: Strict TDD

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 20 |
| Tasks complete | 19 |
| Tasks incomplete | 1 (F2 — optional manual smoke) |

All implementation phases A–E and verify gate F1 are complete. F2 (`node packages/setup/dist/index.js --tool codex -y` manual smoke) was explicitly marked optional and was not run during apply or verify.

### Build & Tests Execution

**Build**: ➖ Not run (setup package has no separate build step for tests; vitest runs TypeScript directly)

**Tests**: ✅ 381 passed / ❌ 0 failed / ⚠️ 0 skipped

```text
$ cd .claude/worktrees/agent-codex-agy-1781703794
$ pnpm --filter @kanon-pm/setup test

Test Files  21 passed (21)
     Tests  381 passed (381)
Duration  4.33s
```

**Coverage**: ➖ Not available (no coverage threshold configured for `@kanon-pm/setup`)

### TDD Compliance (Strict TDD)

Apply-progress includes a TDD Cycle Evidence table mapping RED/GREEN files for each phase. Cross-checked against codebase and runtime results:

| Phase | RED evidence | GREEN evidence | Runtime |
|-------|--------------|----------------|---------|
| A TOML adapter | `mcp-config.test.ts` mergeToml/removeToml + auth TOML | `mcp-config.ts` | ✅ 50 mcp-config tests pass |
| B Registry | `registry.test.ts` codex block | `registry.ts` | ✅ 9 codex registry tests pass |
| C Dispatch | `mcp-config.test.ts` installTool/removeTool dispatch | `index.ts` + dispatch helpers | ✅ dispatch tests pass |
| D Smoke/leakage | `codex-install-smoke.test.ts`, `leakage-guard.test.ts` | wiring | ✅ 8 smoke + codex leakage tests pass |
| E Docs | — (docs task, no RED) | `AI_TOOLS.md`, `kanon-onboard/SKILL.md` | Static only |

**TDD summary**: 5/5 code phases have RED→GREEN file pairs and passing tests. Apply-progress table uses file references rather than strict `✅ Written` / `✅ Passed` tokens — format deviation only.

**Test layer distribution** (codex-related files):

| Layer | Files | Tests |
|-------|-------|-------|
| Unit | `mcp-config.test.ts`, `registry.test.ts`, `leakage-guard.test.ts` | ~40+ codex-related |
| Integration/smoke | `codex-install-smoke.test.ts` (composed primitives) | 8 |
| E2E | — | 0 |

### Spec Compliance Matrix

| Requirement | Scenario | Test / Evidence | Result |
|-------------|----------|-----------------|--------|
| Codex registry entry | Registry contract | `registry.test.ts` > `uses mcp_servers rootKey with toml configFormat`; platform/mcpMode/no template/agents/commands tests | ✅ COMPLIANT |
| Codex registry entry | CODEX_HOME override | `registry.test.ts` > `resolves paths under CODEX_HOME when env is set`; `codex-install-smoke.test.ts` > `writes config.toml under CODEX_HOME` (sets `CODEX_HOME` in beforeEach) | ✅ COMPLIANT |
| Tool detection | Detect via CLI or config | `registry.test.ts` > `detect returns true when config.toml exists under codex home` | ⚠️ PARTIAL — `config.toml` branch tested; `codex` on PATH branch implemented (`commandExists("codex")` in `registry.ts`) but not covered by codex-specific test |
| TOML MCP merge and remove | Fresh install merges MCP | `mcp-config.test.ts` > `mergeTomlMcpConfig` preserves/other entries; `codex-install-smoke.test.ts` > preserves unrelated + kanon-mcp command/args | ✅ COMPLIANT |
| TOML MCP merge and remove | Remove cleans MCP entry | `mcp-config.test.ts` > `removeTomlMcpConfig` removes table + env; smoke > `remove cleans MCP + skills` | ✅ COMPLIANT |
| Product surface install | Skills installed | `codex-install-smoke.test.ts` > `installs all 3 product skills under CODEX_HOME/skills` | ✅ COMPLIANT |
| Leakage guard | No AGENTS.md write | `codex-install-smoke.test.ts` > `LEAKAGE — no AGENTS.md`; `leakage-guard.test.ts` > `codex — personal-config leakage guard` | ✅ COMPLIANT |
| Idempotent install/remove | Re-run and clean remove | `codex-install-smoke.test.ts` > idempotent re-run + second remove no-op; `mergeTomlMcpConfig` idempotent test | ✅ COMPLIANT |
| Test harness parity | Smoke test passes | Full suite `pnpm --filter @kanon-pm/setup test` — 381 passed including `codex-install-smoke.test.ts`, registry G5, TOML merge/remove | ✅ COMPLIANT |
| Onboarding documentation | Docs reference Codex | Static: `docs/AI_TOOLS.md` Codex CLI row + paths + `kanon-setup --tool codex`; `kanon-onboard/SKILL.md` Codex troubleshooting section | ⚠️ PARTIAL — content verified by inspection; no automated doc test |

**Compliance summary**: 8/10 scenarios fully compliant, 2/10 partial (detect PATH branch; docs static-only)

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Codex registry entry | ✅ Implemented | `name: "codex"`, `rootKey: "mcp_servers"`, `configFormat: "toml"`, four platforms, `resolveCodexHome` |
| Tool detection | ✅ Implemented | `commandExists("codex") \|\| fs.existsSync(config.toml)` |
| TOML MCP merge/remove | ✅ Implemented | `mergeTomlMcpConfig`, `removeTomlMcpConfig`, `formatCodexMcpEntry` via `smol-toml` |
| Product surface (skills only) | ✅ Implemented | No template/agents/commands paths on codex entry; smoke installs 3 PRODUCT_SKILLS |
| Leakage guard | ✅ Implemented | No AGENTS.md writes; registry omits personal harness paths |
| Idempotent install/remove | ✅ Implemented | TOML upsert + smoke re-run/remove tests |
| Test harness | ✅ Implemented | `codex-install-smoke.test.ts` created per spec |
| Onboarding docs | ✅ Implemented | AI_TOOLS + kanon-onboard updated |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| TOML parse/merge (not shell-out) | ✅ Yes | `smol-toml` in `mcp-config.ts` |
| `configFormat` routing | ✅ Yes | `index.ts` branches on `tool.configFormat === "toml"` |
| Flat command/args + `.env` subtable | ✅ Yes | Tests assert subtable shape |
| MCP + skills only (no harness) | ✅ Yes | Registry + leakage guard |
| `resolveCodexHome` + `CODEX_HOME` | ✅ Yes | Single resolver for config + skills |
| Dispatch in `index.ts` | ⚠️ Partial | Design specified branching in `index.ts`; `installToolMcpConfig` / `removeToolMcpConfig` helpers added in `mcp-config.ts` for testability — does not break spec |
| Comment preservation limitation documented | ✅ Yes | kanon-onboard Codex troubleshooting |

### Issues Found

**CRITICAL**: None

**WARNING**:
- F2 optional manual smoke (`node packages/setup/dist/index.js --tool codex -y`) not executed — composed smoke tests cover same artifacts but not full CLI `run()` path
- Detect scenario: `codex` on PATH branch not covered by codex-specific test (only `config.toml` existence)
- Documentation scenarios verified statically only (no doc lint/test)

**SUGGESTION**:
- Add registry test mocking `commandExists("codex")` → true without `config.toml` to close detect OR branch
- Run F2 manual smoke once before merge for end-to-end CLI confidence

### Verdict

**PASS WITH WARNINGS**

All required implementation tasks are complete; 381 setup tests pass including codex smoke, registry G5, TOML merge/remove, dispatch, and leakage guard. Spec scenarios are implemented and covered by runtime tests except partial gaps on detect-PATH branch and static-only doc verification. Optional F2 manual CLI smoke remains unchecked. Ready for PR/archive after accepting warnings.
