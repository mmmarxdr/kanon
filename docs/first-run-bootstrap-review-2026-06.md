# First-Run / Bootstrap Flow Review — 2026-06

**Context:** A freshly deployed, freshly-claimed self-hosted Kanon instance is **not usable end-to-end**. After claiming super-admin, the operator dead-ends: no workspace exists, so onboarding/invite links can't be generated, and there is no UI path to create the first workspace or project. This review traces the entire first-run journey (deploy → claim → workspace → project → invite → signup policy), grounded in the **actual box DB state**, and proposes a minimal "v1 usable" scope.

Box: `i-00bc0fb1e0ec1b1e6` / `https://50.17.53.72.sslip.io`. Investigated 2026-06-04.

---

## 1. Empirical box state (ground truth)

Queried the box Postgres directly via SSM.

| Table | Rows | Detail |
|-------|------|--------|
| users | 2 | `marxdr7@gmail.com` (13:35, NOT owner), `admin@kanon.io` (16:48, **instance owner**) |
| workspaces | **0** | none |
| members | **0** | instance owner has **no** workspace membership |
| projects | **0** | none |
| instance_settings | 1 | ownerUserId=admin@kanon.io, name="", signupMode=`open`, allowedSignupDomains=`{}` |

- **Box was NOT seeded.** Dockerfile CMD = `prisma generate && prisma migrate deploy && node dist/index.js`. No `prisma db seed`. The seed's artifacts (`kanon-dev` workspace, `dev@kanon.io`, `KAN` project) are absent.
- **The sidebar "Kanon workspace" is a PHANTOM** — `app-sidebar.tsx:128-162` renders a hardcoded `"Kanon" / "workspace"` label regardless of DB state. There is no real workspace.
- **Ownership note:** the real instance owner is `admin@kanon.io`, not `marxdr7@gmail.com`. The setup token was consumed at 16:48:48 = `admin@kanon.io` creation time.

---

## 2. The bootstrap chain — where it breaks

The **API path works** (verified): `claim` → `POST /api/workspaces` (any authed user; auto-creates an `owner` Member) → `POST /api/workspaces/:wid/invites/onboarding`. The breakage is in the **web navigation + missing UI + unenforced policy**.

| Step | Status | Where | Why |
|------|--------|-------|-----|
| deploy → setup token | ✅ | app.ts onReady | token printed to logs |
| `/setup` claim | ✅ | setup.tsx (after CSRF fix #38) | owner created, session issued |
| post-claim redirect | ⛔ | setup.tsx:97-101 | lands on `/admin/instance` — a **dead-end**: no link forward, no sidebar entry to leave |
| reach create-workspace | ⛔ | — | create-workspace form lives at `/workspaces`, but nothing links there from where the operator lands |
| create workspace | ✅ (if reached) | workspace-select.tsx:384-405 → POST /api/workspaces | empty-state form works |
| **create project** | ⛔ | app-sidebar.tsx:308-315 (dead `+`, no onClick); project-select.tsx:51-55 (no create button) | **NO create-project UI exists anywhere** → Board/Roadmap/Cycles stay locked forever |
| reach Members → invite | ⛔ until workspace exists | settings.tsx:39-45, members-section.tsx:137-154 | needs workspace + admin/owner role |
| set signup policy (domains) | ⛔ | admin.instance.tsx | signupMode/domains shown **read-only**; PATCH not exposed; and **not enforced** in register (Layer 2) |

**Headline:** two hard dead-ends make the instance unusable even though the API supports the flow:
1. **Post-claim lands on a dead-end page** with no path to create the first workspace.
2. **No create-project UI** — after a workspace exists, you still can't make a project, so every project-scoped view (Board/Roadmap/Cycles/Dependencies) is permanently locked.

---

## 3. Bugs / dead-ends / gaps found

### P1 — blocks first-run (must fix for "usable")
- **B1. Post-claim dead-end.** `/admin/instance` has no nav out, no sidebar link, and no "create workspace" affordance. Operator is stranded. (setup.tsx:97-101, admin.instance.tsx, app-sidebar.tsx)
- **B2. No create-project UI.** Sidebar `+` is a no-op (app-sidebar.tsx:308-315); project-select empty state has no create action (project-select.tsx:51-55). `POST /api/workspaces/:id/projects` exists but is unreachable from the UI.
- **B3. No super-admin entry point.** No sidebar/menu link to `/admin/instance`; `/me` never exposes `isSuperAdmin`, so the UI can't conditionally surface admin nav. (app-sidebar.tsx, auth /me)

### P2 — control / safety for a real "v1"
- **B4. `POST /api/workspaces` is unguarded.** Any authenticated user (incl. self-registered, no invite) can create unlimited workspaces. No policy hook. (workspace/routes.ts:23-37)
- **B5. signupMode / allowedSignupDomains not enforced.** Stored, never read in `register()`. Anyone who finds the URL can register regardless of operator intent. (instance/service.ts:154 comment; auth/service.ts register) — *Layer 2, previously roadmapped, but directly blocks the operator's stated need to "control who can sign up".*
- **B6. signup policy not editable in UI.** `/admin/instance` renders signupMode/domains read-only; no control to change them even though `PATCH /api/instance/settings` supports it. (admin.instance.tsx)

### P3 — correctness / polish
- **B7. Phantom workspace label.** Sidebar shows hardcoded "Kanon / workspace" even with zero memberships. (app-sidebar.tsx:128-162)
- **B8. "New workspace" button hidden for single-workspace users.** Condition is `length > 1`, should be `>= 1`. (workspace-select.tsx:303)
- **B9. No active-workspace selection.** `useActiveWorkspaceId()` always returns `workspaces[0]`; selecting workspace #2 at `/workspaces` is not persisted; sidebar + settings always reflect #1. (use-workspace-query.ts:35)
- **B10. project-select empty state strands the user** — no create-project link, only "Back". (project-select.tsx:51-55)
- **B11. `app.tsx` is a dead stub** ("Routes and features coming soon.") never imported by the router. (app.tsx:1-10)
- **B12. No "Sign up" link in-app**; `/register` reachable only by knowing the URL or via invite.

---

## 4. Proposed "v1 usable" minimal scope

Goal: a fresh operator can deploy → claim → land somewhere usable → have a workspace + project → invite teammates → control signups. Recommended cut:

**Tier 1 — unblock first-run (P1):**
1. **Claim auto-provisions a default workspace + owner Member** (instance/service.ts, same transaction). Kills the chicken-egg, gives `/workspaces` real content, enables invites immediately. Return the workspace in the claim response. *(Alternative: redirect post-claim to `/workspaces` create-form — lighter, but leaves the operator to name a workspace before they understand the model. Auto-provision is more robust.)*
2. **Add create-project UI** — wire the sidebar `+` and/or a form on project-select → `POST /api/workspaces/:id/projects`. Unlocks Board/Roadmap/Cycles.
3. **Expose `isSuperAdmin` on `/me` + add an "Admin" sidebar entry** (conditional) → reachable instance settings.

**Tier 2 — make it controllable/safe (P2):**
4. **Enforce signupMode + allowedSignupDomains in `register()`** (closed → 403; invite → require token; domain allowlist). 
5. **Make signup policy editable** in `/admin/instance` (wire PATCH).
6. **Guard `POST /api/workspaces`** per instance policy (decide: super-admin-only, or open self-serve — product call).

**Tier 3 — polish (P3):** B7–B12 as a cleanup batch.

---

## 5. Recommendation

Tier 1 is the true blocker — without it the product is a dead-end regardless of the installer. Tier 2 is what the operator explicitly asked for ("control who can sign up / which domains"). Suggest: **SDD change for Tier 1 + Tier 2 as the "first usable version"**, Tier 3 as follow-up issues. Do NOT run the installer test until Tier 1 lands (a fresh install would dead-end identically).
