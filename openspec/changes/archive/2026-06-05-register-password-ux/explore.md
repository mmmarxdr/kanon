# Exploration: register-password-ux

## Goal

Improve the `/register` sign-up UX by adding a **confirm password** field and a **dynamic password-requirements indicator** that updates as the user types. The indicator must reflect what the backend actually accepts today so users are not surprised by validation errors after submit.

Persona: **new user** arriving via invite link (`/register?invite=…`) or open signup — anyone creating an account through the web form.

---

## Triggering Request

User asked for a UI/UX change on register (not immediate implementation):

1. Add **repassword** (confirm password) field.
2. Add a **dynamic component** showing whether the password meets requirements for an acceptable password.

---

## Current Register Flow — Map

| Layer | File | What happens today |
|---|---|---|
| Route | `packages/web/src/routes/register.tsx` | `RegisterForm` — displayName, email, password; POST `/api/auth/register` |
| Invite branch | same | With `?invite=` token: register + GET `/me` + navigate `/workspaces` |
| No-invite branch | same | Register + navigate `/login` |
| API schema | `packages/api/src/modules/auth/schema.ts` | `RegisterBody.password`: min **8**, max **128** — no complexity regex |
| API route | `packages/api/src/modules/auth/routes.ts` | Validates via Zod; no confirm-password field |
| E2E | `packages/e2e/tests/auth/register.spec.ts` | Fills `#email`, `#password`, submits |
| Unit | `packages/web/src/routes/__tests__/register-invite.test.tsx` | `fillAndSubmit` fills one password field via `getByLabelText(/password/i)` |

**Form primitives:** `AuthLayout`, `FormInput`, `PrimaryBtn`, `ErrorBox` from `packages/web/src/components/auth-layout.tsx`.

**Test seam:** `RegisterForm` is exported with `{ invite?, onNavigate }` props — tests do not go through the router.

---

## Password Policy Today — Cross-Surface Comparison

| Surface | Min length | Max | Complexity | Confirm field | Live requirements UI |
|---|---|---|---|---|---|
| **Register** | 8 | 128 | none | ❌ | ❌ |
| Login | 1 (required) | — | — | — | — |
| Reset password | 8 | 128 | none | ✅ client-only | ❌ |
| Change password (profile) | 8 | 128 | none | ✅ client-only | ❌ |
| Setup claim (`/setup`) | **12** | 128 | number **or** symbol | ❌ | ❌ (placeholder text only) |

**Key discovery:** Register uses the **weakest** policy in the product (8 chars, no complexity). Setup claim is stricter (12 + `/[0-9!@#$%^&*]/`). There is **no shared password-policy module** in web today — each form inlines its own checks.

---

## Existing Patterns to Reuse

### Confirm password — `reset-password.tsx`

```tsx
if (password !== confirmPassword) {
  setError("Passwords do not match");
  return;
}
```

Two `FormInput` fields (`password`, `confirmPassword`), validation on submit only, no submit-button disable.

### Inline field errors — `setup.tsx`

Per-field error divs below inputs (`data-testid="setup-password-error"`). Register currently uses a single form-level `ErrorBox` (`register-error`).

### Dynamic requirements — **none exist**

No `PasswordRequirements`, strength meter, or checklist component in the codebase. This change introduces the first one.

---

## Proposed UX (exploration draft — for proposal phase)

| Element | Behavior |
|---|---|
| Confirm password | New field below password; label "Confirm password" |
| Requirements list | Visible once user types in password **or** confirm field |
| Requirement items | At minimum: ≥8 chars, ≤128 chars, passwords match |
| Submit | Either disable until all satisfied **or** validate on submit (reset-password uses submit-time only) |
| API body | Unchanged — only `password` sent; confirm is client-side |

**Recommendation for proposal:** disable submit until valid (better UX, prevents round-trip) **and** keep submit-handler guard as belt-and-suspenders (matches defensive pattern in reset-password).

---

## Affected Packages

| Package | Change expected? |
|---|---|
| `packages/web` | **Yes** — register form, new shared component/lib, unit tests |
| `packages/api` | **No** — unless policy is tightened (out of scope unless decided) |
| `packages/e2e` | **Yes** — fill confirm field in register spec |
| `packages/mcp`, `packages/bridge`, `packages/cli` | No |

Estimated size: **small** (~150–250 lines). Well under 400-line review budget — **single PR**, no chain.

---

## Test Scaffolding Inventory

### Unit — `register-invite.test.tsx`

- `fillAndSubmit` must fill **both** password fields (label collision: `/password/i` will match two fields after change).
- New cases worth adding in apply phase:
  - mismatch → error shown, no fetch
  - requirements checklist updates (`data-testid` on component)
  - submit disabled when requirements unmet

### E2e — `register.spec.ts`

- Add `#confirmPassword` fill before submit.
- Optional: assert requirements list visible while typing.

### New unit tests (suggested)

- `password-policy.test.ts` — pure functions for requirement satisfaction
- `password-requirements.test.tsx` — renders checklist states

---

## Open Questions

1. **Policy alignment:** Keep register at API min-8, or tighten to match `/setup` (12 + symbol)? Tightening register would be an **API breaking change** for existing integrations/CLI — needs explicit decision in proposal.
2. **Shared component scope:** Build for register only, or extract for reset-password + setup in same change? Latter is slightly larger but reduces future duplication.
3. **Requirement visibility:** Show checklist only after first keystroke, or always visible under password field?
4. **Invite flow parity:** Confirm field applies equally to invite auto-login path — no special case expected.
5. **i18n:** Auth screens are English-only today — no i18n work needed.

---

## Risks

1. **Label ambiguity in tests** — two fields match `/password/i`; tests must use specific labels (`Confirm password`).
2. **Policy confusion** — if UI shows stricter rules than API, users pass UI but API accepts weaker passwords (or vice versa). Requirements component **must mirror `RegisterBody` Zod**, not setup claim rules.
3. **Submit disabled + HTML `required`** — ensure empty confirm still blocks native submit consistently.
4. **Partial code from aborted attempt** — two files were created then removed (`password-policy.ts`, `password-requirements.tsx`); apply phase starts clean.

---

## Out of Scope (defer to roadmap)

- Tightening API password policy globally
- Password strength meter / entropy scoring
- Reusing requirements component on setup, reset-password, profile (unless bundled in proposal)
- Sign-up link discoverability (B12 from first-run-bootstrap review)

---

## SDD Result Envelope

```yaml
status: complete
executive_summary: >
  Register today has a single password field with HTML minLength=8 and API Zod
  min 8 / max 128. Reset-password already confirms client-side; setup uses a
  stricter 12-char policy. No shared requirements UI exists. This change is
  web-only, small (~150–250 LOC), single PR. Main decision: keep API policy
  vs align with setup; main risk: UI rules must match RegisterBody exactly.
artifacts:
  - openspec/changes/register-password-ux/explore.md
next_recommended: sdd-propose
deferred_items:
  - title: "[Auth] Unify password requirements across register, setup, reset-password"
    reason: Shared component could extend to other auth forms after register ships
    suggested_horizon: later
  - title: "[Auth] Tighten RegisterBody password policy (complexity + min length)"
    reason: Only if product decides register should match setup claim bar
    suggested_horizon: later
risks:
  - UI requirements must mirror API RegisterBody, not setup claim schema
  - Test selectors break when second password field added
skill_resolution: n/a
```
