# Apply Progress: antigravity-cli-integration (KAN-130)

**Status**: Complete — ready for verify
**Mode**: Strict TDD
**Tests**: 429 green (`pnpm --filter @kanon-pm/setup test`)

## Summary

Full Antigravity CLI install parity in `packages/setup`:

- `ANTIGRAVITY_CLI_PATHS` const + `antigravity-cli` registry entry (`mcpServers`, JSON, `direct` on all platforms)
- Detection: `agy` on PATH OR `~/.gemini/antigravity-cli/` config dir
- Reuses existing JSON `mergeConfig` / `removeConfig` — no `mcp-config.ts` changes
- Tests: registry G5, `antigravity-cli-install-smoke.test.ts`, leakage guard extension
- Docs: `AI_TOOLS.md` IDE vs CLI table; `kanon-onboard` troubleshooting section

## Files changed

| File | Change |
|------|--------|
| `packages/setup/src/registry.ts` | `ANTIGRAVITY_CLI_PATHS` + entry |
| `packages/setup/src/index.ts` | `--tool` help string |
| `packages/setup/src/__tests__/registry.test.ts` | G5 block |
| `packages/setup/src/__tests__/antigravity-cli-install-smoke.test.ts` | New smoke test |
| `packages/setup/src/__tests__/leakage-guard.test.ts` | CLI leakage block |
| `docs/AI_TOOLS.md` | Antigravity CLI section |
| `packages/setup/assets/skills/kanon-onboard/SKILL.md` | CLI troubleshooting |
