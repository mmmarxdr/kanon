---
name: kanon-branch-pr
description: "Prepare and open a focused Kanon pull request. Trigger: create PR, push branch, publish changes, prepare for review."
license: Apache-2.0
metadata:
  author: kanon-maintainers
  version: "1.0"
---

# Kanon Branch and PR

## Preconditions

- Publication must be explicitly requested by the user.
- Read `CONTRIBUTING.md` and the current PR-related workflows.
- Run `kanon-pre-pr`, or state exactly which checks remain and why.
- Public contributions need an issue first. Link it with `Closes #N` when the
  PR actually resolves that GitHub issue.

## Workflow

1. Fetch `origin` and branch from current `origin/main` using a Conventional
   Commit prefix: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `ci/`, or
   `chore/`.
2. Inspect `git status`, the complete diff, `git diff --check`, and recent
   commit style.
3. Stage only intended files. Never include `.codegraph/`, credentials,
   generated local reports, environment files, or unrelated user changes.
4. Commit one work unit at a time using Conventional Commits. Do not add AI
   attribution trailers.
5. Push without force and create the PR with `gh`.
6. Return the PR URL and hand off to `kanon-pr-guardian`.

## PR Body

```markdown
## Summary
- What changed and why

## Verification
- `exact command` - result

## Risks
- Migration, compatibility, rollout, or `None`

Closes #N
```

Omit `Closes #N` only when no GitHub issue exists and the maintainer explicitly
accepts that exception. Do not include local paths, worktrees, agent metadata,
or command transcripts in the PR body.

## Stop Conditions

- The branch contains unrelated changes.
- The base moved and creates a semantic conflict.
- Required verification failed.
- A secret or private identifier appears in the diff or PR body.

Opening a PR does not authorize merging it.
