# Design: Register Password UX — Confirm Field + Dynamic Requirements Indicator

## Technical Approach

Client-only change in `packages/web`. A pure policy module is the single source of truth for password rules (mirroring API `RegisterBody`: min 8 / max 128, plus client-side match). A dumb presentational checklist renders whatever requirement list it is given. `RegisterForm` composes both, derives validity at render, gates submit; API payload unchanged (only `password` sent).

## Architecture Decisions

### Decision: Logic/presentation split

**Choice**: `password-policy.ts` (pure functions, no React) computes `Requirement[]`; `PasswordRequirements` (props-driven, stateless) only renders the list.
**Alternatives considered**: inline checks in `RegisterForm`; component computing its own requirements.
**Rationale**: one source of truth, unit-testable without DOM, reusable later by setup/reset-password (different requirement array, same renderer — no rework). Honors the no-duplicated/divergent-code constraint.

### Decision: Derived validity, no redundant state

**Choice**: compute `requirements` and `valid` on every render from the pure functions; no `isValid` state.
**Alternatives considered**: `useState` + effect syncing validity.
**Rationale**: derived state cannot drift; matches the existing controlled-input pattern in `register.tsx`.

### Decision: Checklist visibility — latched `touched` flag

**Choice**: `const [pwTouched, setPwTouched] = useState(false)`, set `true` on first `onChange` of password OR confirm; never reset. The `aria-live` container is ALWAYS mounted; requirement items render inside it only when `pwTouched`.
**Alternatives considered**: derive from non-empty values (re-hides when user clears the field — confusing); always visible (rejected in proposal Decision 3); conditionally mounting the whole container (screen readers do not announce content present at mount — first state would be silent).
**Rationale**: matches the confirmed "after first keystroke" decision, and mutating children of an already-watched live region guarantees the first announcement.

### Decision: `max-length` item renders only when violated

**Choice**: the "at most 128 characters" item appears in the checklist only when unmet (paste case) — `maxLength={128}` on the input makes it always-green noise otherwise. `evaluatePassword` still always returns it (policy is complete); the component filters display.
**Rationale**: complete policy in the module (single source of truth), minimal noise in the UI.

### Decision: Styling follows auth-layout convention, not Tailwind utilities

**Choice**: inline `style={{}}` + CSS custom properties (`var(--ink-3)`, `var(--accent)`), same as every component in `auth-layout.tsx` and `register.tsx`.
**Rationale**: auth screens do not use Tailwind classes today; introducing them here would be the divergence the constraint forbids.

## Data Flow

    password / confirmPassword (useState, controlled)
            │ render-time
            ▼
    evaluatePassword(password, confirm) ──→ Requirement[] ──→ <PasswordRequirements requirements={...} />
            │
            └─ valid = every(met) ──→ PrimaryBtn disabled={loading || !agreedToTerms || !valid}
                                  └─→ handleSubmit guard: if (!valid) setError + return (no fetch)

API request body unchanged: `{ email, password, displayName?, invite? }`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/web/src/lib/password-policy.ts` | Create | Pure predicates + `evaluatePassword`; pins 8/128 with comment referencing `RegisterBody` |
| `packages/web/src/lib/__tests__/password-policy.test.ts` | Create | Unit tests for boundaries (7/8/128/129, match/mismatch, empty) |
| `packages/web/src/components/password-requirements.tsx` | Create | Stateless checklist; `aria-live="polite"` wrapper; per-item met indicator |
| `packages/web/src/components/__tests__/password-requirements.test.tsx` | Create | Renders met/unmet states from props |
| `packages/web/src/routes/register.tsx` | Modify | Confirm `FormInput` (id `confirmPassword`, label "Confirm password", mirroring reset-password), `pwTouched` flag, derived validity, submit gating + guard |
| `packages/web/src/routes/__tests__/register-invite.test.tsx` | Modify | `fillAndSubmit` fills both fields with exact labels; new cases: mismatch blocks fetch, checklist updates, disabled submit |
| `packages/e2e/tests/auth/register.spec.ts` | Modify | Fill `#confirmPassword` before submit (ToS checkbox already handled) |

## Interfaces / Contracts

```ts
// packages/web/src/lib/password-policy.ts
export interface Requirement {
  id: "min-length" | "max-length" | "match";
  label: string;   // e.g. "At least 8 characters"
  met: boolean;
}
export function evaluatePassword(password: string, confirm: string): Requirement[];
export function isPasswordValid(requirements: Requirement[]): boolean; // every(met)

// packages/web/src/components/password-requirements.tsx
interface PasswordRequirementsProps { requirements: Requirement[] }
```

**data-testid contract** (stable for unit + e2e):
- `password-requirements` — checklist container, also `id="password-requirements"`, `aria-live="polite"`, always mounted (empty before `pwTouched`)
- `requirement-{id}` — each item, with `data-met="true|false"`
- Existing: `register-form`, `register-error`, `tos-checkbox` unchanged

**Test selectors**: `getByLabelText("Password", { exact: true })` and `getByLabelText("Confirm password")` — never `/password/i` (collides).

## Accessibility

- One `aria-live="polite"` region wrapping the whole list, always mounted (per-item live regions would flood screen readers on every keystroke; conditionally mounted regions miss the first announcement).
- `FormInput` spreads `...rest`, so the password input gets `aria-describedby="password-requirements"` — pointing at the container's real `id`.
- Labels associated via existing `FormInput` `htmlFor`/`id` mechanism.

## Testing Strategy (strict TDD — tests first)

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `evaluatePassword` boundaries 7/8/128/129, match/mismatch/empty-confirm | Vitest, pure functions |
| Component | Container empty pre-keystroke (no `requirement-*` items — container itself stays mounted), items toggle `data-met`, aria-live present | Testing Library on `PasswordRequirements` + `RegisterForm` |
| Component | Mismatch → no `fetchApi` call; submit disabled until valid + ToS | Existing `register-invite.test.tsx` seam (`RegisterForm` props) |
| E2E | Happy path with confirm field; requirements visible while typing | Playwright `register.spec.ts` |

## Migration / Rollout

No migration. Web-only; rollback = revert single PR. Estimated ~150–250 changed lines — within 400-line budget, single PR.

## Open Questions

None — all four proposal decisions confirmed by user.
