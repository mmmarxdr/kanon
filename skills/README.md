# Kanon Development Skills

Project-specific workflows for contributors and maintainers. The repository is
the source of truth: each skill must read the current workflow or contribution
policy before acting instead of preserving stale commands in memory.

`AGENTS.md` is the compact runtime registry loaded at session start. It exposes
only names, triggers, and paths; full skill bodies are read on demand.

| Skill | Use it for |
| --- | --- |
| `kanon-pre-pr` | Reproduce GitHub Actions CI locally before publication. |
| `kanon-branch-pr` | Prepare a branch, commit, push, and open a focused PR. |
| `kanon-pr-guardian` | Drive CI and CodeRabbit to a clean review state. |
| `kanon-work-unit-commits` | Split work into reviewable, reversible commits. |
| `kanon-issue-triage` | Reproduce and classify community reports before coding. |
| `kanon-maintainer-pr-review` | Review external PRs for correctness, risk, and evidence. |
| `kanon-release` | Publish MCP/setup releases or confirm container delivery. |

The normal shipping sequence is:

1. `kanon-work-unit-commits`
2. `kanon-pre-pr`
3. `kanon-branch-pr`
4. `kanon-pr-guardian`

These skills are development policy, not end-user Kanon skills. Do not copy
them into `packages/setup/assets/skills`.
