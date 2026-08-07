---
name: kanon-issue-triage
description: "Triage Kanon community issues before implementation. Trigger: new issue, bug report, feature request, duplicate, reproduce report."
license: Apache-2.0
metadata:
  author: kanon-maintainers
  version: "1.0"
---

# Kanon Issue Triage

## Rules

- Search open and closed issues before creating a new one.
- Treat the reported mechanism as a hypothesis; reproduce the symptom on
  current `main` before planning a fix.
- Group reports by root cause. Two symptoms sharing one root need one shared
  correction, not parallel guards.
- Questions and support requests should not become implementation issues unless
  they identify a reproducible product gap.
- Sanitize secrets, private hosts, home paths, usernames, tokens, and internal
  project names before publishing evidence.

## Classification

Choose one outcome:

- `duplicate`: link the canonical issue and add confirming evidence.
- `bug`: include reproduction, expected/actual behavior, scope, and regression test.
- `feature`: state the user problem, smallest useful outcome, and alternatives.
- `support`: answer with a runnable next step; do not promise code.
- `needs-information`: ask only for facts required to reproduce.
- `superseded`: name the shipped or in-flight change and its proof.

## Workflow

1. Search with `gh issue list --state all --search '<terms>'`.
2. Reproduce from a clean current-main checkout when safe.
3. Map the affected shared boundary before proposing call-site patches.
4. Check current issue templates; use one if present.
5. Publish concise reproduction, impact, acceptance criteria, and verification
   plan. Never include local worktree or agent-session details.
6. Stop after issue creation unless implementation is separately authorized.

## Output

Return classification, duplicate/root cluster, reproduction verdict, severity,
sanitized evidence, and recommended next action.
