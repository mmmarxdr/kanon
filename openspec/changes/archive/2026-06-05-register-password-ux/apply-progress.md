# Apply Progress: register-password-ux

## Status: done

## Branch: feat/register-password-ux

## Commits

| SHA | Message |
|-----|---------|
| 1b3172e | feat(web): add password-policy pure functions and unit tests |
| 6266f15 | feat(web): add PasswordRequirements stateless checklist component |
| adbcba4 | feat(web): integrate confirm field, requirements indicator, and submit gating into RegisterForm |
| 2fcf40f | test(e2e): fill confirm password field and assert requirements indicator |

## Tasks Completed

- [x] T1.1 [TEST-RED] — password-policy.test.ts (11 tests, all RED → GREEN)
- [x] T1.2 [GREEN] — password-policy.ts created
- [x] T1.3 [VERIFY] — API drift check: RegisterBody min=8/max=128 confirmed, no drift
- [x] T2.1 [TEST-RED] — password-requirements.test.tsx (6 tests, RED → GREEN)
- [x] T2.2 [GREEN] — password-requirements.tsx created
- [x] T3.1 [TEST-RED] — register-invite.test.tsx updated (12 tests total, RED → GREEN)
- [x] T3.2 [GREEN] — register.tsx modified
- [x] T4.1 — register.spec.ts updated (E2E, runs in CI)

## Files Changed

| File | Action |
|------|--------|
| packages/web/src/lib/password-policy.ts | Created |
| packages/web/src/lib/__tests__/password-policy.test.ts | Created |
| packages/web/src/components/password-requirements.tsx | Created |
| packages/web/src/components/__tests__/password-requirements.test.tsx | Created |
| packages/web/src/routes/register.tsx | Modified |
| packages/web/src/routes/__tests__/register-invite.test.tsx | Modified |
| packages/web/src/routes/__tests__/register-polish.test.tsx | Modified (selector fix) |
| packages/e2e/tests/auth/register.spec.ts | Modified |

## Test Results

Full suite: 484 passed, 0 failed, 5 todo (74 test files, 1 skipped)

## Deviations / Notes

- register-polish.test.tsx required fixes: (1) RP-2 test now fills valid passwords before
  checking ToS (submit now also gates on password validity); (2) RP-3 selector switched from
  `/password/i` to `getByLabelText("Password", { exact: true })` to avoid ambiguity with the
  new "Confirm password" field. Both changes are correct updates to the existing test, not
  regressions.
- T1.3 drift check: API schema confirmed min=8/max=128, no constant update needed.
