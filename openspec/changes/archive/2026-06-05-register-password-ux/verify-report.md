# Verify Report: register-password-ux

## Verdict

PASS — 0 CRITICAL, 1 WARNING, 1 SUGGESTION

## Test Suite Results

- **Runner**: `pnpm --filter @kanon/web test` (Vitest)
- **Result**: 484 passed, 0 failed, 5 todo — 74 test files, 1 skipped
- **TypeScript**: `pnpm --filter @kanon/web typecheck` — clean, 0 errors
- **E2E**: Static review only (CI-only per tasks.md) — `packages/e2e/tests/auth/register.spec.ts`

## Scenario Coverage (13 of 13)

### Requirement: Confirm Password Field

| Scenario | Test | Status |
|---|---|---|
| Confirm field present on register page | `register-invite.test.tsx` — `fillAndSubmit` fills `getByLabelText("Confirm password")`; `register-polish.test.tsx` RP-2/RP-3 use same selector | PASS |
| Confirm field present on invite flow | `register-invite.test.tsx` — "invite flow: submit is disabled when requirements are unmet" + "with invite: calls register WITH the token" both render with `invite` prop and interact with "Confirm password" | PASS |

### Requirement: Live Requirements Indicator

| Scenario | Test | Status |
|---|---|---|
| Checklist hidden before first keystroke | "checklist container is present before any interaction with no requirement items" — asserts container present, zero `requirement-*` children | PASS |
| Checklist appears on first keystroke in password field | "checklist items appear after typing into the Password field" | PASS |
| Checklist appears on first keystroke in confirm field | "checklist items appear after typing into the Confirm password field (without touching Password)" | PASS |
| Requirements update live — all satisfied | No test asserts three rendered items when all met. See WARNING below. | WARNING |
| Max-length boundary | `password-policy.test.ts` 129-char unmet boundary; `password-requirements.test.tsx` "DOES render max-length item when it is unmet" | PASS |
| Passwords-match item reflects mismatch | `password-policy.test.ts` "is unmet when password does not equal confirm"; integration: "submit button is disabled when passwords do not match" | PASS |

### Requirement: Submit Gating

| Scenario | Test | Status |
|---|---|---|
| Submit disabled when requirements unmet | "submit button is disabled when passwords do not match"; "submit button is disabled when password is fewer than 8 characters"; `register-polish.test.tsx` RP-1 | PASS |
| Submit enabled when all requirements met | "all requirements met + ToS checked → submit enabled and fetchApi is called" | PASS |
| On-submit guard fires when submit is forced | "no fetchApi call when passwords do not match and submit is invoked" (direct `fireEvent.submit` bypassing button disabled state) | PASS |
| Invite flow submit gating parity | "invite flow: submit is disabled when requirements are unmet" | PASS |

### Requirement: Policy Single Source of Truth

| Scenario | Test / Check | Status |
|---|---|---|
| Policy module is sole owner of length bounds | `grep` across `packages/web/src` for `\.length [<>] 8`, `\.length [<>] 128`, inline password-equality comparisons in non-policy non-test files — zero matches | PASS |

## Contract Verification

| Contract | Expected | Actual | Status |
|---|---|---|---|
| API drift — RegisterBody min/max | min=8, max=128 | `packages/api/src/modules/auth/schema.ts` line 9-11: min(8)/max(128) | PASS |
| policy-module MIN/MAX | 8 / 128 with mirror comment | `password-policy.ts` lines 6-7: `MIN = 8` / `MAX = 128` with `// mirrors RegisterBody` | PASS |
| evaluatePassword signature | `(password: string, confirm: string): Requirement[]` | Matches exactly | PASS |
| isPasswordValid signature | `(requirements: Requirement[]): boolean` | Matches exactly | PASS |
| PasswordRequirements props | `{ requirements: Requirement[] }` | Matches exactly | PASS |
| Container data-testid | `password-requirements` | Present in `password-requirements.tsx` line 20 | PASS |
| Container id | `password-requirements` | Present, `aria-live="polite"` | PASS |
| Container always mounted | Yes (even when requirements=[]) | `PasswordRequirements` always returns the outer div; `register.tsx` passes `pwTouched ? requirements : []` — container stays in DOM | PASS |
| Item data-testid | `requirement-{id}` | `data-testid={\`requirement-\${r.id}\`}` | PASS |
| Item data-met | `"true"` / `"false"` (string) | `data-met={String(r.met)}` | PASS |
| max-length only shown when violated | Yes | `visible` filter in `password-requirements.tsx` line 14-16 | PASS |
| pwTouched latched / never reset | Set on first onChange, never reset | `register.tsx` lines 183-185, 197-199 — `if (!pwTouched) setPwTouched(true)` | PASS |
| Submit disabled expression | `loading \|\| !agreedToTerms \|\| !valid` | `register.tsx` line 259 | PASS |
| On-submit guard | `if (!valid) { setError(...); return; }` before fetch | `register.tsx` lines 57-60 | PASS |
| API payload | `{ email, password, displayName?, invite? }` — no confirmPassword | `register.tsx` lines 71-76, 88-93; test "API payload does NOT include confirmPassword field" | PASS |
| aria-describedby on password input | `aria-describedby="password-requirements"` | `register.tsx` line 190 | PASS |
| Inline styles, no Tailwind | CSS vars `var(--ink-3)` / `var(--accent)` | Both `password-requirements.tsx` and `register.tsx` use inline `style={{}}` only | PASS |
| Exact-label test selectors | `getByLabelText("Password", { exact: true })` and `getByLabelText("Confirm password")` | Consistently used across all three test files | PASS |
| E2E fills #confirmPassword | Yes | `register.spec.ts` lines 45, 73 | PASS |
| E2E checks ToS checkbox | `page.locator('[data-testid="tos-checkbox"]').check()` | `register.spec.ts` lines 48, 75 | PASS |
| register-polish.test.tsx selector fix | RP-2/RP-3 now use `getByLabelText("Password", { exact: true })` and fill "Confirm password" before asserting submit state | Benign, correct update — no regression | PASS |

## Findings

### WARNING: Spec wording vs. design filter — "Requirements update live" scenario

**Spec** states: "all three requirement items MUST show a satisfied state" when password is 10 chars and matches confirm.

**Implementation**: when max-length is met, the component deliberately hides it (design decision: "max-length item renders only when violated" — paste guard UX). A 10-char matching password would render exactly 2 visible items (min-length and match), not 3.

**No test asserts 3 rendered items** in the "all requirements met" state — the integration test only checks that the submit button is enabled and `fetchApi` is called. This is consistent with the design intent, but the spec wording is technically violated.

**Impact**: Low. The behavior is correct per the design decision (confirmed by user). The spec wording should be updated to read: "all satisfied requirement items MUST show a satisfied state" (or note the max-length filter).

**Recommendation**: Update `spec.md` Scenario "Requirements update live" to reflect the display-filter decision, or add a clarifying note. No code change required.

### SUGGESTION: No unit-level test for the "max-length boundary" render path in RegisterForm integration

The 129-char max-length unmet path is covered at the unit level (`password-policy.test.ts`) and at the component level (`password-requirements.test.tsx`). However, the integration test suite (`register-invite.test.tsx`) does not include a test that types a 129-char password into the RegisterForm and asserts the max-length item becomes visible.

**Impact**: Negligible — unit + component coverage is sufficient for this path. Adding it would complete the layer-by-layer coverage matrix but is not required for archive.

## Tasks Completion

All 9 tasks confirmed complete in `apply-progress.md` and verified against code:

- [x] T1.1 TEST-RED — `password-policy.test.ts` (11 assertions across 8 `it()` blocks)
- [x] T1.2 GREEN — `password-policy.ts` created with correct interface and exports
- [x] T1.3 VERIFY — API drift check: confirmed min=8/max=128, no drift
- [x] T2.1 TEST-RED — `password-requirements.test.tsx` (6 tests)
- [x] T2.2 GREEN — `password-requirements.tsx` created
- [x] T3.1 TEST-RED — `register-invite.test.tsx` updated (12 tests in WU3 describe block)
- [x] T3.2 GREEN — `register.tsx` modified with all required features
- [x] T4.1 — `register.spec.ts` updated (E2E, CI-only)
- [x] register-polish.test.tsx selector fix — benign, correct update

## Summary

Implementation fully satisfies the spec. One WARNING (spec wording vs. design) requires only a documentation update before archive. No code changes needed.
