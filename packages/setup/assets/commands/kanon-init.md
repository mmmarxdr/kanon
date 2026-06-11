---
name: kanon-init
description: Automated project onboarding — scan codebase, create Kanon project, seed initial issues, groups, and roadmap items from TODOs and architecture gaps.
---

You are running the kanon-init onboarding flow. Follow the kanon-init skill protocol:

1. Scan the current codebase for TODO/FIXME comments and architecture gaps.
2. Resolve or create a Kanon project via `kanon_list_projects` / `kanon_create_project`.
3. Create groups via `kanon_list_groups` / (create if missing).
4. Seed issues from TODO/FIXME findings — one issue per actionable item.
5. Seed roadmap items for deferred/architectural gaps.
6. Report a summary: project key, issues created, roadmap items created.

One command takes a repo from unknown to fully tracked. Do not invent issues — only log findings from the codebase scan.
