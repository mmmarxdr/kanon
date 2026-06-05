# Archive Report: register-password-ux

**Status**: ARCHIVED  
**Archive Date**: 2026-06-05  
**Final Verdict**: PASS (0 CRITICAL, 1 WARNING RESOLVED, 1 SUGGESTION DEFERRED)

---

## Executive Summary

The `register-password-ux` change (KAN-5) has been completed and archived. Users registering on `/register` now receive live feedback on password requirements (min 8 / max 128 chars, match confirmation) with a dynamic checklist that updates per keystroke. A confirm-password field prevents typos; the submit button is disabled until all requirements are met. Implementation includes strict TDD unit + component + integration + e2e tests (484 passed, 0 failed, 5 todo). The change is web-only, client-side only, with no API schema changes.

---

## Scope & Implementation Summary

### Overview

**Issue**: KAN-5 — Confirm-password field + dynamic requirements indicator on `/register`

**Affected packages**: `@kanon/web` only

**Commits**: 4 commits on `feat/register-password-ux`
- `1b3172e` — feat(web): add password-policy pure functions and unit tests
- `6266f15` — feat(web): add PasswordRequirements stateless checklist component
- `adbcba4` — feat(web): integrate confirm field, requirements indicator, and submit gating into RegisterForm
- `2fcf40f` — test(e2e): fill confirm password field and assert requirements indicator

### Key Changes

#### New Files Created
- `packages/web/src/lib/password-policy.ts` — Pure functions `evaluatePassword` and `isPasswordValid`; constants `MIN = 8`, `MAX = 128` with comment linking to `RegisterBody` Zod schema
- `packages/web/src/lib/__tests__/password-policy.test.ts` — 11 unit tests covering boundaries (7/8/128/129 chars), match/mismatch, empty confirm
- `packages/web/src/components/password-requirements.tsx` — Stateless checklist component; `aria-live="polite"` region; max-length item filtered to show only when violated
- `packages/web/src/components/__tests__/password-requirements.test.tsx` — 6 component tests for rendered/unrendered states, data-met attributes

#### Files Modified
- `packages/web/src/routes/register.tsx` — Added confirm field (id `confirmPassword`, label "Confirm password"), `pwTouched` latch state, derived `valid` flag, submit button gating (`disabled={loading || !agreedToTerms || !valid}`), on-submit guard, `aria-describedby="password-requirements"` on password input
- `packages/web/src/routes/__tests__/register-invite.test.tsx` — 12 new test cases in strict TDD order: mismatch blocks fetch, checklist visibility, requirements updates, disabled submit until valid
- `packages/web/src/routes/__tests__/register-polish.test.tsx` — Benign selector fix: RP-2/RP-3 now use `getByLabelText("Password", { exact: true })` instead of `/password/i` and fill confirm field before asserting submit state
- `packages/e2e/tests/auth/register.spec.ts` — Updated to fill `#confirmPassword` before submit; ToS checkbox already required

**No API changes**: `packages/api` `RegisterBody` unchanged; only `password` field sent to API, not `confirmPassword`.

### Architecture Decisions

1. **Logic/presentation split**: `password-policy.ts` (pure functions) computes requirements; `PasswordRequirements` (stateless component) renders them. Single source of truth, unit-testable, reusable for setup/reset-password later.

2. **Derived validity**: `valid` computed on every render from pure functions, no redundant state. Derived state cannot drift.

3. **Checklist visibility**: `pwTouched` flag latches on first onChange, never resets. Container always mounted for `aria-live` to guarantee first announcement to screen readers.

4. **Max-length filtering**: "At most 128 characters" item renders only when unmet (paste-guard UX). Policy module is still complete; component filters display.

5. **Styling convention**: Inline `style={{}}` + CSS custom properties (`var(--ink-3)`, `var(--accent)`), matching auth-layout convention (no Tailwind classes on auth screens).

---

## Verification Results

### Test Coverage

| Layer | Tests | Status |
|-------|-------|--------|
| Unit | `password-policy.test.ts` (11 tests) | PASS |
| Component | `password-requirements.test.tsx` (6 tests) | PASS |
| Integration | `register-invite.test.tsx` (12 tests) | PASS |
| Polish | `register-polish.test.tsx` (selector fix, RP-2/RP-3) | PASS |
| E2E | `register.spec.ts` (updated) | PASS (CI-only) |

**Full suite**: 484 passed, 0 failed, 5 todo (74 test files, 1 skipped)  
**TypeScript**: `pnpm --filter @kanon/web typecheck` — clean, 0 errors

### Scenario Coverage (13 of 13)

- ✅ Confirm field present on `/register` and invite flow
- ✅ Checklist hidden before first keystroke
- ✅ Checklist appears on first keystroke (password or confirm)
- ✅ Requirements update live (all satisfied items rendered, max-length filtered)
- ✅ Max-length boundary at 129 chars
- ✅ Passwords-match reflects mismatch
- ✅ Submit disabled when requirements unmet
- ✅ Submit enabled when all requirements met
- ✅ On-submit guard prevents API call when invalid
- ✅ Invite flow submit gating parity
- ✅ Policy module is sole owner of length bounds

### Spec Wording Update

The verify report identified a WARNING: the spec stated "every rendered requirement item MUST show a satisfied state" when all are met, but the design intentionally filters max-length item when satisfied (paste-guard UX). This wording mismatch has been resolved by updating `spec.md` Scenario "Requirements update live" to clarify:

> "all satisfied requirement items MUST show a satisfied state"
> "NOTE: the "At most 128 characters" item renders only while violated (paste-guard UX, see design), so a fully satisfied checklist renders two items: "At least 8 characters" and "Passwords match""

**No code change required.** The implementation is correct per the design decision (user-confirmed).

### Deferred Items

- **SUGGESTION**: RegisterForm integration test for 129-char max-length render path. Unit + component coverage is sufficient; integration test would be redundant. Deferred to roadmap for future test hygiene pass.

- **Roadmap items created** (KAN-62, KAN-63):
  - KAN-62: Unify password requirements across auth forms (setup/reset-password/login)
  - KAN-63: Tighten RegisterBody validation policy (complexity rules, wordlist check)

---

## Files Archived

All artifacts moved to `openspec/changes/archive/2026-06-05-register-password-ux/`:

- `explore.md` — Research on password-policy options and component architecture
- `proposal.md` — KAN-5 user-visible win, scope, approach, open decisions
- `spec.md` — 13 scenario-based requirements (wording updated for max-length filtering)
- `design.md` — Architecture decisions, data flow, testing strategy
- `tasks.md` — 9 work units (T1.1–T4.1) grouped by strict TDD phase
- `apply-progress.md` — 4 commits, 8 files changed, all 9 tasks marked complete
- `verify-report.md` — 0 CRITICAL, 1 WARNING (resolved), 1 SUGGESTION (deferred), 484 tests pass
- `archive-report.md` — This document

---

## Engram Artifacts

All change artifacts persist in Engram with topic keys for cross-session recovery:

| Artifact | Topic Key | Observation ID |
|----------|-----------|---|
| Proposal | `sdd/register-password-ux/proposal` | (see Engram) |
| Spec | `sdd/register-password-ux/spec` | (see Engram) |
| Design | `sdd/register-password-ux/design` | (see Engram) |
| Tasks | `sdd/register-password-ux/tasks` | (see Engram) |
| Apply Progress | `sdd/register-password-ux/apply-progress` | (see Engram) |
| Verify Report | `sdd/register-password-ux/verify-report` | (see Engram) |
| Archive Report | `sdd/register-password-ux/archive-report` | (this save) |

---

## Rollback

No-risk rollback: revert the single PR (`git revert <sha>`). Web-only, no Prisma migrations, no API contract changes. Data and integrations unaffected.

---

## Sign-Off

✅ **SDD Cycle Complete**  
✅ **Planning Phase**: proposal, spec, design, tasks — all approved  
✅ **Implementation Phase**: 4 commits, 8 files, strict TDD order followed  
✅ **Verification Phase**: 0 CRITICAL, WARNING resolved via spec update, SUGGESTION deferred to roadmap  
✅ **Archive Phase**: Artifacts persisted to filesystem + Engram, change folder moved to archive  

Ready for the next change.
