# mcp-pm-guidance Specification

## Purpose

Deliver PM persona coaching and title-quality enforcement at the MCP server layer, reaching every client (Claude Code, Cursor, Codex, REST harnesses) regardless of whether a skill is loaded.

## Requirements

### Requirement: PM Persona in SERVER_INSTRUCTIONS

`SERVER_INSTRUCTIONS` MUST contain a PM persona block that coaches the AI on title format, pre-creation checks, and response format defaults. The total byte length of `SERVER_INSTRUCTIONS` MUST NOT exceed 1,500 bytes, enforced by an automated test in `@kanon/mcp`.

#### Scenario: Instructions contain persona and respect ceiling

- GIVEN the `SERVER_INSTRUCTIONS` constant is exported from `packages/mcp/src/instructions.ts`
- WHEN its byte length is measured via `Buffer.byteLength(SERVER_INSTRUCTIONS, 'utf8')`
- THEN the result MUST be less than or equal to 1,500
- AND the string MUST match `/PM Persona/i` or equivalent persona heading
- AND the string MUST contain the title format pattern `[Area] Imperative verb phrase`

#### Scenario: Instructions still include deferred-tool routing

- GIVEN the updated `SERVER_INSTRUCTIONS`
- WHEN a consumer reads the string
- THEN it MUST still list every tool in `DEFERRED_TOOLS` under a deferred-tools section
- AND the CORE TOOLS section MUST remain present

---

### Requirement: Title Validation with Coaching Error

`CreateIssueInput.title` MUST be validated with a Zod `.refine()` (or `.superRefine()`) that enforces the pattern `^\[.+\] .{3,}`. When the pattern is not satisfied, the validation error message MUST be a coaching sentence that names the correct format and gives a concrete good example. The validation MUST be applied at the MCP layer only — no API-side changes.

#### Scenario: Valid title accepted

- GIVEN `CreateIssueInput` schema
- WHEN `.parse({ title: "[Auth] Fix Google OAuth redirect", projectKey: "KAN" })` is called
- THEN parsing MUST succeed with no validation errors

#### Scenario: Bare title rejected with coaching message

- GIVEN `CreateIssueInput` schema
- WHEN `.parse({ title: "fix thing", projectKey: "KAN" })` is called
- THEN parsing MUST throw a ZodError
- AND the error message MUST contain the phrase `[Area]` (coaching the correct format)
- AND the error message MUST include a concrete good example (e.g. `[Auth] Fix OAuth redirect`)

#### Scenario: SDD path title rejected

- GIVEN `CreateIssueInput` schema
- WHEN `.parse({ title: "sdd/ai-pm-assistant/apply", projectKey: "KAN" })` is called
- THEN parsing MUST throw a ZodError (pattern `^\[.+\] .{3,}` not matched)

#### Scenario: Short but valid title accepted

- GIVEN `CreateIssueInput` schema
- WHEN `.parse({ title: "[API] Fix crash", projectKey: "KAN" })` is called
- THEN parsing MUST succeed (`{3,}` allows 9-char body)

---

### Requirement: Enriched kanon_create_issue Description

The tool description for `kanon_create_issue` MUST include a coaching firing-pin that names the title format requirement and the `kanon_list_groups` pre-step. The description MUST remain within the existing `Win C` byte ceiling enforced in `descriptions.test.ts`.

#### Scenario: Description contains title coaching

- GIVEN the tool registration for `kanon_create_issue`
- WHEN its description string is inspected
- THEN it MUST mention the `[Area] Verb` title pattern or equivalent
- AND the total description bytes for all tools MUST remain within the Win C ceiling

#### Scenario: Description coaching does not exceed ceiling

- GIVEN descriptions.test.ts Win C ceiling test
- WHEN `pnpm --filter @kanon/mcp test -- --run` executes
- THEN the test MUST remain green after the description enrichment
