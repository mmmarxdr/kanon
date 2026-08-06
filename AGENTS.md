# Kanon Agent Skills

Before acting, match the task against this compact registry. When a trigger
matches, read the linked `SKILL.md` before running tools or changing files.
Load multiple skills when needed, but never preload every skill body.

Repository policy and current workflows remain authoritative if a skill drifts.

| Skill | Trigger | Path |
| --- | --- | --- |
| `kanon-work-unit-commits` | Splitting implementation into commits or reviewable work units. | [`skills/work-unit-commits/SKILL.md`](skills/work-unit-commits/SKILL.md) |
| `kanon-pre-pr` | Preparing to publish, running CI locally, or verifying a candidate before review. | [`skills/pre-pr/SKILL.md`](skills/pre-pr/SKILL.md) |
| `kanon-branch-pr` | Creating a branch, committing, pushing, or opening a pull request. | [`skills/branch-pr/SKILL.md`](skills/branch-pr/SKILL.md) |
| `kanon-pr-guardian` | Monitoring CI, fixing failed checks, handling CodeRabbit, or assessing merge readiness. | [`skills/pr-guardian/SKILL.md`](skills/pr-guardian/SKILL.md) |
| `kanon-issue-triage` | Triaging, reproducing, classifying, or creating a community issue. | [`skills/issue-triage/SKILL.md`](skills/issue-triage/SKILL.md) |
| `kanon-maintainer-pr-review` | Reviewing an incoming contributor PR for correctness, risk, and evidence. | [`skills/maintainer-pr-review/SKILL.md`](skills/maintainer-pr-review/SKILL.md) |
| `kanon-release` | Publishing MCP/setup, checking GHCR image delivery, or preparing a release. | [`skills/release/SKILL.md`](skills/release/SKILL.md) |
