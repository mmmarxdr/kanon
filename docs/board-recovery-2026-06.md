# KAN Board Recovery — 2026-06-04

## Incident Summary

On 2026-06-04 a `prisma migrate reset` wiped the local Kanon board. The reseed left only 13 demo/seed issues (KAN-1..13). The roadmap was re-created separately. This document records the partial recovery of issues KAN-27..49 (plus 2 that had not yet been created at the time of the wipe).

**KAN-1..26 (pre-seed) are unrecoverable.** KAN-1..13 on the live board are seed/demo data — do not delete them.

---

## Original → New Key Mapping

| Original Key | New Key | Title | Type | Priority | Group | State |
|---|---|---|---|---|---|---|
| KAN-27 | KAN-14 | [MCP] Document or disable KANON_API_KEY env bypass in non-dev environments | task | medium | mcp | backlog |
| KAN-28 | KAN-15 | [MCP] Fix incorrect admin-only label on kanon_create_project in instructions | bug | low | mcp | backlog |
| KAN-29 | KAN-16 | [Schema] Add @@unique([projectId, sequenceNum]) constraint to Issue model | bug | high | api | backlog |
| KAN-33 | KAN-17 | [API] Add browser session revocation and logout-all-devices endpoint | feature | medium | api | backlog |
| KAN-34 | KAN-18 | [Web] Fix forgot-password copy to match 60-minute API expiry | bug | low | web | backlog |
| KAN-40 | KAN-19 | Test createProject actorId-undefined branch | task | low | api | backlog |
| KAN-41 | KAN-20 | Assert tie-break warning log in middleware | task | low | api | backlog |
| KAN-47 | KAN-21 | [MCP] Remove dead npx fallback paths (post tarball-distribution) | task | low | mcp | backlog |
| KAN-48 | KAN-22 | [infra] Auto-chain CD: publish-images → deploy-dev via repository_dispatch | feature | medium | infra | backlog |
| _(uncreated)_ | KAN-23 | [API] Registration 500s when verification email fails — degrade gracefully | bug | high | api | backlog |
| _(uncreated)_ | KAN-24 | [infra] Verify real Resend domain + set EMAIL_FROM (persist in TF/SSM) | task | medium | infra | backlog |
| KAN-30 | KAN-25 | [API] Add email verification on user registration | feature | medium | api | **done** |
| KAN-31 | KAN-26 | [Web] Add workspace creation form for new users with no workspaces | feature | medium | web | **done** |
| KAN-32 | KAN-27 | [API] Implement invite-by-email flow for external users | feature | medium | api | **done** |
| KAN-35 | KAN-28 | [MCP] Pin setup package to exact version with integrity check | feature | medium | mcp | **done** |
| KAN-36 | KAN-29 | [MCP] Accept onboarding token via stdin or file instead of argv | bug | medium | mcp | **done** |
| KAN-37 | KAN-30 | [API] Fix double-consume race on onboarding invite token | bug | medium | api | **done** |
| KAN-38 | KAN-31 | [MCP] Reconcile OnboardingInviteBody schema: email vs userId mismatch | bug | medium | mcp | **done** |
| KAN-39 | KAN-32 | Build @kanon/bridge in setup.sh bootstrap | bug | high | infra | **done** |
| KAN-42 | KAN-33 | Redesign transactional emails (verify/reset/invite) per Claude Design | feature | medium | api | **done** |
| KAN-43 | KAN-34 | Update e2e Playwright suite to current surfaces + cover etapa-1 flows | task | high | web | **done** |
| KAN-44 | KAN-35 | AWS dev hosting — single-box EC2 + docker compose | task | high | — | **done** |
| KAN-45 | KAN-36 | [setup] Publish @kanon-pm/setup + remote install docs | task | medium | — | **done** |
| KAN-46 | KAN-37 | [MCP] Release workflow: esbuild tarball + sha256 + hash-in-tag publish | feature | medium | mcp | **done** |
| KAN-49 | KAN-38 | Instance layer: super-admin + InstanceSettings + first-boot setup token | feature | high | api | **in_progress** |

---

## Notes

- **KAN-1..13** on the live board are seed/demo data from the reseed. Do not delete them.
- **KAN-1..26** (the original pre-wipe issues before KAN-27) are unrecoverable — no snapshot was captured.
- **KAN-23 and KAN-24** were new issues that had not yet been created at the time of the wipe (noted as "originally uncreated, 2026-06-04" in their descriptions).
- Issues KAN-30..48 on the original board that are not listed above (KAN-30..32, KAN-35..39, KAN-42..46) were re-created in this recovery session and transitioned to `done` to reflect their completed status.
- All recovered issue descriptions are prefixed with `_Restored after the 2026-06-04 DB-reset incident (originally <KEY>)._`
- New key numbers are permanent — the original keys are referenced only in issue descriptions and this document.
