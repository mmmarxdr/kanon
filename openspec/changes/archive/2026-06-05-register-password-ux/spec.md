# register-password-ux Specification

## Purpose

Client-side password confirmation and live requirements feedback on the register form (`/register`), mirroring the API `RegisterBody` contract (min 8 / max 128, no complexity). No API changes.

---

## Requirements

### Requirement: Confirm Password Field

The register form MUST include a second password input labeled exactly "Confirm password" positioned after the primary password field. Only the primary `password` value SHALL be sent to the API; the confirm field is client-side only.

#### Scenario: Confirm field present on register page

- GIVEN a user navigates to `/register`
- WHEN the page renders
- THEN a field with label "Confirm password" MUST be visible
- AND a field with label "Password" MUST remain present

#### Scenario: Confirm field present on invite flow

- GIVEN a user navigates to `/register?invite=<token>`
- WHEN the page renders
- THEN a field with label "Confirm password" MUST be visible
- AND behavior is identical to the open-signup flow (no special case)

---

### Requirement: Live Requirements Indicator

A requirements checklist MUST appear after the first keystroke in the "Password" field or the "Confirm password" field. The checklist SHALL remain visible until the form is submitted or reset. The checklist MUST reflect these conditions, each independently:

| Condition | Display label |
|-----------|--------------|
| Password ≥ 8 characters | "At least 8 characters" |
| Password ≤ 128 characters | "At most 128 characters" |
| Password and confirm match | "Passwords match" |

Each item MUST visually distinguish a satisfied state from an unsatisfied state.

#### Scenario: Checklist hidden before first keystroke

- GIVEN the register form is freshly loaded
- WHEN no input has been entered in either password field
- THEN the requirements checklist MUST NOT be visible

#### Scenario: Checklist appears on first keystroke in password field

- GIVEN the register form is freshly loaded
- WHEN the user types a single character into the "Password" field
- THEN the requirements checklist MUST become visible

#### Scenario: Checklist appears on first keystroke in confirm field

- GIVEN the register form is freshly loaded
- WHEN the user types a single character into the "Confirm password" field without touching the "Password" field
- THEN the requirements checklist MUST become visible

#### Scenario: Requirements update live

- GIVEN the checklist is visible
- WHEN the user types a password that is 10 characters and matches the confirm field
- THEN all satisfied requirement items MUST show a satisfied state
- AND no item MUST show an unsatisfied state
- NOTE: the "At most 128 characters" item renders only while violated (paste-guard UX, see design), so a fully satisfied checklist renders two items: "At least 8 characters" and "Passwords match"

#### Scenario: Max-length boundary

- GIVEN the checklist is visible
- WHEN the user types a password that exceeds 128 characters
- THEN the "At most 128 characters" item MUST show an unsatisfied state

#### Scenario: Passwords-match item reflects mismatch

- GIVEN the checklist is visible
- WHEN the "Password" and "Confirm password" fields contain different values
- THEN the "Passwords match" item MUST show an unsatisfied state

---

### Requirement: Submit Gating

The submit button MUST be disabled while any of the following is true:
- Password length < 8
- Password length > 128
- Password and confirm values do not match

Additionally, the submit handler MUST include an on-submit guard that prevents the API call when the same conditions hold, as belt-and-suspenders.

#### Scenario: Submit disabled when requirements unmet

- GIVEN the register form is loaded
- WHEN at least one requirement item is unsatisfied
- THEN the submit button MUST be disabled

#### Scenario: Submit enabled when all requirements met

- GIVEN all three requirement conditions are satisfied
- WHEN no other form-level error is active
- THEN the submit button MUST be enabled

#### Scenario: On-submit guard fires when submit is forced

- GIVEN all requirements are unsatisfied
- WHEN the submit handler is invoked directly (bypassing disabled state)
- THEN no API call SHALL be made
- AND an error MUST be surfaced to the user

#### Scenario: Invite flow submit gating parity

- GIVEN a user is on `/register?invite=<token>`
- WHEN password requirements are not all satisfied
- THEN the submit button MUST be disabled (identical to open-signup flow)

---

### Requirement: Policy Single Source of Truth

Password requirement predicates MUST be derived from a single shared module that mirrors `RegisterBody` exactly. The module SHALL expose pure functions. No inline copies of the policy MAY exist in the form or checklist component. The component MUST be designed so it can be extracted for reuse on other forms without modification to its public contract.

#### Scenario: Policy module is the sole owner of length bounds

- GIVEN the policy constants are changed from 8 to any value N
- WHEN the checklist renders
- THEN the checklist MUST reflect the new value N without changes to any other file
