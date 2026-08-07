---
name: kanon-work-unit-commits
description: "Plan Kanon commits as reviewable work units. Trigger: split commits, large diff, stacked work, prepare commit history."
license: Apache-2.0
metadata:
  author: kanon-maintainers
  version: "1.0"
---

# Kanon Work-Unit Commits

## Rules

- A commit delivers one behavior, fix, migration, documentation update, or
  release unit.
- Keep tests with the code they verify and docs with the user-visible change.
- Never split by file type when intermediate commits do not work.
- Each commit must be independently understandable and reasonably reversible.
- Generated files belong with the source change that regenerates them.
- Use the repository's existing Conventional Commit style without AI trailers.

## Decision Process

1. List changed behaviors, their tests, and rollback boundaries.
2. Group files by behavior rather than directory.
3. Order prerequisites before consumers while keeping every commit coherent.
4. If one PR becomes difficult to review, split at work-unit boundaries. Do not
   invent a fixed line budget that repository policy does not define.
5. Before each commit, inspect staged diff, unstaged diff, status, and recent
   commit messages.

## Checklist

- One clear outcome.
- No unrelated formatting or cleanup.
- Tests and docs included where relevant.
- Focused verification recorded.
- Rollback does not remove another work unit.
- Commit message describes the outcome, not the file list.

## Output

Return the proposed commit order with purpose, included files, verification,
and rollback boundary for each work unit.
