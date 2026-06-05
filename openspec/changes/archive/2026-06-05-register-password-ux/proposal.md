# Proposal: Register Password UX — Confirm Field + Dynamic Requirements Indicator

## Intent

New users (invite-link or open signup persona) registering via `/register` get no feedback on password rules until the API rejects them, and typos go undetected because there is no confirm field. **User-visible win**: users see live requirement feedback while typing and catch mismatches before submit — no failed round-trips. Tracked as Kanon issue KAN-5.

## Scope

### In Scope
- Confirm-password field on `/register` (client-side only; API body unchanged)
- New `PasswordRequirements` checklist component + pure `password-policy` helpers, mirroring API `RegisterBody` exactly (≥8, ≤128 chars, passwords match)
- Submit disabled until valid, plus on-submit guard
- Unit tests (web) and e2e register spec update — strict TDD, test-first

### Out of Scope
- Any `packages/api` change (no schema/policy change)
- Reusing the component on setup/reset-password/profile (deferred to roadmap)
- Strength meter / entropy scoring; i18n

## Capabilities

### New Capabilities
- `register-password-ux`: client-side password confirmation and live requirements feedback on the register form, mirroring the API contract.

### Modified Capabilities
None.

## Open Decisions

Recommendations below are defaults, not unilateral resolutions — confirm or override before spec/design.

| # | Decision | Options | Recommendation | Tradeoff |
|---|----------|---------|----------------|----------|
| 1 | Password policy | Keep API min-8 vs align with `/setup` (12 + number-or-symbol) | **Keep min-8, mirror RegisterBody** | Aligning changes `packages/api` `RegisterBody` — breaking for CLI/integrations, breaks single-PR budget |
| 2 | Component scope | Register-only vs extract for setup/reset-password now | **Register-only** | Extraction grows scope; deferred to roadmap |
| 3 | Checklist visibility | Always visible vs after first keystroke | **After first keystroke** | Always-visible adds form noise before interaction |
| 4 | Submit behavior | Disabled-until-valid + guard vs on-submit only | **Disabled + guard** | Disabled buttons hide *why*; checklist mitigates |

## Approach

Extend `RegisterForm` (`register.tsx`) with a second `FormInput` following the reset-password confirm pattern; add pure policy predicates and a checklist component driven by them. **Hard constraint**: requirement set MUST mirror `RegisterBody` Zod (min 8 / max 128) — NOT setup claim rules. Only `password` is sent to the API.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/web/src/routes/register.tsx` | Modified | Confirm field, checklist, submit gating |
| `packages/web/src/lib/password-policy.ts` | New | Pure requirement predicates + tests |
| `packages/web/src/components/password-requirements.tsx` | New | Checklist component + tests |
| `packages/web/src/routes/__tests__/register-invite.test.tsx` | Modified | Fill both fields; specific labels (two fields match `/password/i`) |
| `packages/e2e/tests/auth/register.spec.ts` | Modified | Fill confirm field; ToS checkbox already required |
| `packages/api` | None | Unless Decision 1 overridden |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| UI rules drift from `RegisterBody` | Med | Spec pins requirements to Zod schema; verify compares |
| `/password/i` selector collision | High | Use exact labels ("Confirm password") in tests |
| Disabled submit vs HTML `required` inconsistency | Low | On-submit guard as belt-and-suspenders |

## Rollback Plan

Web-only, no Prisma migrations, no API contract change: revert the single PR (`git revert`). No data or integration impact.

## Dependencies

- Decision 1 confirmation (policy) before sdd-spec/sdd-design.

## Success Criteria

- [ ] Register requires matching passwords; mismatch never reaches the API
- [ ] Checklist updates per keystroke and mirrors RegisterBody exactly
- [ ] Submit blocked until all requirements satisfied
- [ ] Web unit + e2e suites pass; new tests written first (strict TDD)
- [ ] Single PR under 400 changed lines
