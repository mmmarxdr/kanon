---
name: kanon-pr-guardian
description: "Drive an open Kanon PR until CI and CodeRabbit are clean. Trigger: watch PR, fix CI, address CodeRabbit, ready to merge."
license: Apache-2.0
metadata:
  author: kanon-maintainers
  version: "1.0"
---

# Kanon PR Guardian

## Success Gate

A PR is ready only when all are true:

- GitHub `Test` check passes on the current head SHA.
- CodeRabbit reports success and has no unresolved actionable thread.
- The PR is mergeable and not stale against `main`.
- Every fix pushed after review has focused verification.

## Loop

1. Read PR metadata and current head SHA with `gh pr view`.
2. Watch checks with `gh pr checks <number> --watch --interval 10`.
3. For a failed check, inspect the failed job, annotations, and logs. Reproduce
   locally before editing when feasible.
4. Fix the root cause, run the smallest failing check plus affected package
   checks, commit, and push.
5. Read CodeRabbit summary, review comments, and inline threads. For each
   actionable finding, either fix it or reply with concrete evidence explaining
   why no change is correct. Resolve only after that response.
6. Repeat against the new head SHA until the success gate holds.

## Infrastructure Failures

Distinguish code failures from jobs that acquired no runner or executed zero
steps. Check GitHub Status and job metadata. During an outage:

- Run `kanon-pre-pr` instead of waiting idly.
- Do not retry in a tight loop.
- Do not claim a remote pass from local evidence.
- Bypass protection only with explicit maintainer authorization, complete local
  CI evidence, and immediate verified restoration of the original rule.

## Authority

CodeRabbit is advisory, not merge authority. A green bot cannot waive security,
data-loss, migration, or correctness concerns. Merge only when the user or
maintainer explicitly asks for it.

## Output

Return PR URL, head SHA, CI result, CodeRabbit result, unresolved threads,
mergeability, and the next blocking action.
