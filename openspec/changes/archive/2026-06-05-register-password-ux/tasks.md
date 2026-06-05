# Tasks: Register Password UX — Confirm Field + Dynamic Requirements Indicator

## Delivery

Single PR, ~150–250 changed lines. All tasks are sequential unless noted.
Strict TDD Mode is active: every work unit begins with a [TEST-RED] step.
Tests live in the same commit as the behavior they verify (work-unit-commits rule).

---

## Work Unit 1 — Policy module (foundation)

**Satisfies**: Requirement: Policy Single Source of Truth

**No dependencies.** This unit produces the `Requirement` interface and pure functions
that all subsequent units consume.

- [x] **T1.1 [TEST-RED]** Create `packages/web/src/lib/__tests__/password-policy.test.ts`
  - Assert `evaluatePassword` returns `min-length` item with `met: false` for 7-char password
  - Assert `min-length` item `met: true` for 8-char password (boundary)
  - Assert `max-length` item `met: true` for 128-char password (boundary)
  - Assert `max-length` item `met: false` for 129-char password
  - Assert `match` item `met: true` when password === confirm (non-empty)
  - Assert `match` item `met: false` when password !== confirm
  - Assert `match` item `met: false` when confirm is empty string
  - Assert `isPasswordValid` returns `true` only when all requirements are met
  - Run `pnpm --filter @kanon/web test` — tests MUST fail at this step

- [x] **T1.2 [GREEN]** Create `packages/web/src/lib/password-policy.ts`
  - Export `Requirement` interface: `id: "min-length" | "max-length" | "match"`, `label: string`, `met: boolean`
  - Export `evaluatePassword(password: string, confirm: string): Requirement[]`
    - Labels: "At least 8 characters", "At most 128 characters", "Passwords match"
    - Constants `MIN = 8` / `MAX = 128` with inline comment: `// mirrors RegisterBody (packages/api)`
    - `max-length` item always present in the returned array (display filtering is the component's concern)
  - Export `isPasswordValid(requirements: Requirement[]): boolean` — `requirements.every(r => r.met)`
  - Run `pnpm --filter @kanon/web test` — all T1.x tests MUST pass

- [x] **T1.3 [VERIFY]** Confirm that the `RegisterBody` Zod schema in `packages/api` uses the same
  bounds (min 8 / max 128). If the API uses different values, update the constants before
  proceeding. No code change is expected — this is a drift check.

---

## Work Unit 2 — PasswordRequirements component

**Satisfies**: Requirement: Live Requirements Indicator (rendering contract)

**Depends on**: T1.2 (`Requirement` type and evaluatePassword output shape)

- [x] **T2.1 [TEST-RED]** Create `packages/web/src/components/__tests__/password-requirements.test.tsx`
  - When given a `requirements` array, renders one `[data-testid^="requirement-"]` item per entry
  - Each item has `data-met="true"` or `data-met="false"` matching the `met` field
  - Container `[data-testid="password-requirements"]` with `aria-live="polite"` is present in the DOM
    even when `requirements` is an empty array (always-mounted contract)
  - When `requirements` contains a `max-length` item with `met: true`, that item is NOT rendered
    (max-length only shown when violated)
  - When `requirements` contains a `max-length` item with `met: false`, that item IS rendered
  - Styling is inline (no Tailwind class assertions needed; test `data-met` only)
  - Run `pnpm --filter @kanon/web test` — tests MUST fail

- [x] **T2.2 [GREEN]** Create `packages/web/src/components/password-requirements.tsx`
  - Props: `interface PasswordRequirementsProps { requirements: Requirement[] }`
  - Container: `<div data-testid="password-requirements" id="password-requirements" aria-live="polite">`
    — always rendered, even when `requirements` is empty
  - Map `requirements`, skip max-length items where `met === true`
  - Each item: `<div data-testid={"requirement-" + r.id} data-met={String(r.met)}>`
  - Inline `style={{}}` + CSS vars (`var(--ink-3)` unmet / `var(--accent)` met) — NO Tailwind utilities
  - Visual indicator: e.g. `✓` / `✗` prefix or color change driven by `data-met`
  - Run `pnpm --filter @kanon/web test` — all T2.x tests MUST pass

---

## Work Unit 3 — RegisterForm integration

**Satisfies**: Requirement: Confirm Password Field, Live Requirements Indicator (visibility),
Submit Gating (all scenarios incl. invite parity)

**Depends on**: T1.2, T2.2

This is the only unit that modifies existing files.

- [x] **T3.1 [TEST-RED]** Modify `packages/web/src/routes/__tests__/register-invite.test.tsx`
  - Update `fillAndSubmit` helper to fill `getByLabelText("Confirm password")` as well as
    `getByLabelText("Password", { exact: true })` — both with valid matching values by default
  - Add test: checklist container is absent from the DOM before any interaction
    (verify `data-testid="password-requirements"` is present but has no `requirement-*` children)
  - Add test: checklist items appear after typing into `getByLabelText("Password", { exact: true })`
  - Add test: checklist items appear after typing into `getByLabelText("Confirm password")`
    without touching the Password field
  - Add test: submit button is disabled when passwords do not match
  - Add test: submit button is disabled when password is fewer than 8 characters
  - Add test: no `fetchApi` call when passwords do not match and submit is invoked
  - Add test: all requirements met + ToS checked → submit enabled and `fetchApi` called
  - Add test: API payload does NOT include `confirmPassword` field
  - Add test: invite flow (`invite` prop) — submit is disabled when requirements unmet (parity)
  - Run `pnpm --filter @kanon/web test` — new tests MUST fail

- [x] **T3.2 [GREEN]** Modify `packages/web/src/routes/register.tsx`
  - Add `confirmPassword` controlled state (`useState("")`)
  - Add `pwTouched` state (`useState(false)`) — set to `true` on first `onChange` of either
    password field; never reset
  - Add "Confirm password" `FormInput` (id `confirmPassword`, label "Confirm password",
    type `password`) positioned after the primary password field, mirroring the pattern used
    in the reset-password flow
  - Add `aria-describedby="password-requirements"` to the primary password `FormInput`
    (via `...rest` spread or explicit prop — whichever pattern the file already uses)
  - Derive `requirements` and `valid` on every render using `evaluatePassword` and `isPasswordValid`
    — no new `useState` for these values
  - Mount `<PasswordRequirements requirements={pwTouched ? requirements : []} />` always in the DOM
  - Gate primary button: `disabled={loading || !agreedToTerms || !valid}`
  - In `handleSubmit`: `if (!valid) { setError("..."); return; }` before any `fetchApi` call
  - API call body remains `{ email, password, displayName?, invite? }` — no `confirmPassword`
  - Inline styles only, no Tailwind utilities
  - Run `pnpm --filter @kanon/web test` — all T3.x tests MUST pass

---

## Work Unit 4 — E2E update

**Satisfies**: End-to-end regression coverage for the new confirm field and requirements checklist

**Depends on**: T3.2

NOTE: E2E (Playwright) is NOT part of the TDD loop. It runs in CI only.
Do not block on this step locally — commit and let CI validate.

- [x] **T4.1** Modify `packages/e2e/tests/auth/register.spec.ts`
  - Fill `#confirmPassword` with the same value as `#password` before submitting
  - Assert that the `[data-testid="password-requirements"]` container becomes visible
    after typing into the password field
  - Verify the ToS checkbox is checked before submission (already present; confirm not removed)
  - Ensure the happy-path test still passes end to end

---

## Commit Map (work-unit-commits)

| Commit | Message | Files |
|--------|---------|-------|
| C1 | `feat(web): add password-policy pure functions and unit tests` | `password-policy.ts`, `password-policy.test.ts` |
| C2 | `feat(web): add PasswordRequirements stateless checklist component` | `password-requirements.tsx`, `password-requirements.test.tsx` |
| C3 | `feat(web): integrate confirm field, requirements indicator, and submit gating into RegisterForm` | `register.tsx`, `register-invite.test.tsx` |
| C4 | `test(e2e): fill confirm password field and assert requirements indicator` | `register.spec.ts` |

---

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines | ~150–250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Decision needed before apply | No |
