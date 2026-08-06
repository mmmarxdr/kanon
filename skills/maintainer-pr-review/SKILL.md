---
name: kanon-maintainer-pr-review
description: "Review an incoming Kanon pull request as an open-source maintainer. Trigger: review PR, contributor PR, merge assessment, security review."
license: Apache-2.0
metadata:
  author: kanon-maintainers
  version: "1.0"
---

# Kanon Maintainer PR Review

## Safety

- Treat fork code as untrusted. Do not expose repository secrets or run modified
  workflow code with privileged credentials.
- Review the complete PR diff and every included commit, not only the latest.
- Never modify the contributor branch unless explicitly authorized.

## Review Order

1. Intent: linked issue, scope, roadmap alignment, and user-visible behavior.
2. Risk: auth, permissions, secrets, data loss, migrations, dependency changes,
   supply chain, and deployment impact.
3. Correctness: trace the real call path and shared boundaries; reject symptom
   patches that leave sibling callers broken.
4. Reliability: behavior-first tests, negative cases, deterministic outcomes,
   rollback, observability, and failure handling.
5. Maintainability: smallest correct design, existing patterns, readable names,
   and no speculative abstractions.
6. Evidence: CI, local commands, docs, release assets, and manual verification.

Use specialized read-only reviewers when available, then deduplicate findings.
CodeRabbit can add evidence but cannot replace maintainer judgment.

## Findings Format

Lead with findings ordered by severity:

```text
[BLOCKER|HIGH|MEDIUM|LOW] path:line - concrete behavior and failure mode
```

Each blocker must explain a realistic impact and the smallest correction. Avoid
style-only findings already enforced by formatting or linting. If no findings
remain, state that explicitly and name residual test or rollout risk.

## Merge Gate

Do not approve while a blocker, failed required check, unresolved actionable
thread, or unexplained migration/security risk remains. Approval does not itself
authorize merge.
