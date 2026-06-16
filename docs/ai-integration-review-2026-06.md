# Kanon AI-Integration Review — 2026-06

Read-only audit of Kanon's AI integration surface: MCP tools, skills, the `kanon` sub-agent, and the installer wiring. Goal: map the whole integration, decide what's necessary vs cruft, and inform the proposal-model direction (KAN-104 PR2) and where the tool is heading.

Scope: `packages/mcp` (tools, instructions, client), `packages/setup` (installer + shipped skills/agent), `.claude/skills/_shared` (dev-only). No code was changed.

---

## 1. Architecture — the three layers (intentional, not accidental)

```
User prompt
  │
  ▼
Orchestrator (host coding-agent: Claude Code / Cursor / Antigravity / opencode)
  │  reads injected CLAUDE.md/GEMINI.md snippet → routes by trigger
  │
  ├─ board-op triggered ─► kanon sub-agent (model: haiku, ~/.<host>/agents/kanon.md)
  │                            allowed-tools: mcp__kanon*, mem_{save,search,get_observation}
  │                            └─► MCP server (packages/mcp) ─► Kanon REST API
  │
  ├─ skill trigger ──────► kanon-agent/SKILL.md loaded inline (dispatch rules + on-demand sections)
  ├─ /kanon-init ────────► kanon-init/SKILL.md
  └─ onboarding ─────────► kanon-onboard/SKILL.md
```

Three distinct layers, each earning its place:

| Layer | What it is | Value it adds |
|---|---|---|
| **MCP tools** (`packages/mcp`) | 38 `kanon_*` tools over the REST API | The actual capability surface |
| **Skills** (`packages/setup/assets/skills`) | Dispatch/how-to rules loaded inline into the orchestrator | WHEN/HOW to use the board; NL→field mapping the tool descriptions can't carry |
| **`kanon` agent** (`packages/setup/assets/agents/kanon.md`) | Haiku sub-agent, hard `allowed-tools` constraint | Cost (Haiku, not the orchestrator model) + context isolation (38 tool calls don't inflate the main thread) |

**Verdict on "does the agent earn its place?": YES — distinct function.** The skill *routes* (inline, orchestrator context); the agent *executes* (isolated, Haiku). They look similar in description but are architecturally different runtime roles. Not redundant.

---

## 2. MCP tools — inventory & assessment

38 tools total: **28 CORE / 10 DEFERRED**. Split is largely sensible (admin/destructive/PM-only correctly deferred).

### Byte-budget pressure (the key signal)
`descriptions.test.ts` enforces a context-budget ceiling on CORE tool descriptions. After the KAN-104 PR1 timesheet block, the margin is **~46 B** (current ~4216 B vs ceiling 4262 B). One medium description edit breaks CI. **Adding more CORE tools (PR2/PR3) will blow the budget** unless we defer non-daily tools first. This is the surface telling us it's near its lean limit.

### Keep / Defer / Cut
| Tool group | Rec | Rationale |
|---|---|---|
| Issues (list/get/create/update/transition) | Keep CORE | Daily essentials |
| Project nav (list_workspaces/list_projects/get_project) | Keep CORE | Orientation anchors |
| Cycles (list/get/create/attach/close) | Keep CORE | Sprint lifecycle |
| Roadmap (list/create/update/promote) | Keep CORE | Planning mainstays |
| `list_groups`, `batch_transition`, start/stop_work | Keep CORE | Prereqs + flow |
| Timesheet happy-path (list_my_worklogs/promote/update/submit) | Keep CORE | KAN-104 PR1 |
| **`add_dependency`, `remove_dependency`** | **Defer** | Once-per-planning-session; recovers ~100–150 B |
| **`adjust_time_entry`** | **Defer** | Post-approval edge case, not daily |
| create/update_project, delete_*, who_is_working, documents(3), approve/reject_time_entry | Keep DEFERRED | Correctly placed |

Deferring the three CORE candidates → CORE 28→25, recovers ~150 B of budget headroom for PR2/PR3.

### Real coverage gaps
1. **No comment/observation write tool.** `kanon_sync_observation` was the write-path for posting on an issue; removed with Engram (KAN-68). Current source has no replacement — an agent cannot post a comment/observation. (See §6 note: the *installed* global build is stale and still exposes it, masking the gap.)
2. **No member/user listing.** `assigneeId` is accepted as input but there's no tool to resolve a name → member id, nor id → name. **Directly related to KAN-117** (timeline leaks raw Member UUID because nothing resolves it).
3. No label enumeration (`label` accepted, no `list_labels`).
4. No roadmap-item GET by id (must filter `list_roadmap`).

### Correctness note
`kanon_close_cycle` (`cycles.ts`) orchestrates up to 3 sequential API calls with **no rollback** — a mid-sequence failure leaves the cycle partially mutated. Orthogonal to tool count; worth a guard.

### Correction to an earlier finding
An initial pass flagged `kanon_get_issue_context` / `kanon_sync_observation` as "ghost tools advertised in `SERVER_INSTRUCTIONS` with no implementation." **This is a FALSE POSITIVE for current source** — there are no references to those names anywhere in `packages/mcp/src`. They were *removed* (KAN-68). They still appear in a running session only because the **globally-installed MCP build is stale** (v0.4.0). No source bug; see §6.

---

## 3. Skills — inventory & assessment

Shipped via `packages/setup/src/skills.ts` (`PRODUCT_SKILLS = [kanon-agent, kanon-init, kanon-onboard]`, recursive copy). `kanon-phase-common` is dev-only (`.claude/skills/_shared/`, not shipped). Retired skills are actively deleted on each install (`RETIRED_SKILLS`).

| Skill | Lines | Rec | Rationale |
|---|---|---|---|
| `kanon-agent/SKILL.md` (+4 on-demand sections) | 45 + sections | **Keep, minor trim** | Well-designed: short root + on-demand section dispatch. Design-records block lightly duplicates the `create_document` tool desc. |
| `kanon-init/SKILL.md` | 240 | **Trim ~40 lines** | Biggest bloat. "Best Practices" + "Edge Cases" tails restate rules already in the phases. Target ~160–180. |
| `kanon-onboard/SKILL.md` | 160 | **Keep, minor trim** | Justified complexity (wrapper mode, tokens, multi-host). Collapse "Multi-Server Coexistence". |
| `kanon-phase-common.md` (dev-only) | 46 | **Keep as-is** | Correctly scoped; sub-agent fallback envelope is the key bit. |

**Overlaps to resolve:**
- Deferred-items capture logic lives in BOTH `sections/roadmap.md` and `sections/sdd-hooks.md` → consolidate into `roadmap.md`.
- SDD phase→Kanon-state table in BOTH `sdd-hooks.md` and `kanon-phase-common.md` (orchestrator vs sub-agent audiences) → one canonical table, annotate audience.
- No compact rules declared for any global skill in the registry → orchestrators must pass full paths (cheap for `kanon-agent`, expensive for `kanon-init`).

---

## 4. Wiring / installer

Entry: `package.json` `setup:mcp` → `packages/setup/dist/index.js` (TS installer). Legacy `scripts/setup-mcp.sh` is **dead code** (deprecation warning only).

| Target | MCP config | Skills | Agent | Template injection |
|---|---|---|---|---|
| Claude Code | `~/.claude.json` | `~/.claude/skills/` | `~/.claude/agents/kanon.md` | marker-inject `CLAUDE.md` |
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/skills/` | `~/.cursor/agents/kanon.md` | copy `kanon.mdc` |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | `~/.gemini/.../skills/` | `~/.gemini/agents/kanon.md` | marker-inject `GEMINI.md` |
| **opencode** | `~/.config/opencode/opencode.json` | `~/.config/opencode/skills/` | **none** | **none** |

- **opencode is a second-class citizen** — no agent, no template injection. Not parity. (The LinkedIn post claims opencode is natively wired; today it's MCP+skills only.)
- `agents/kanon.md` `allowed-tools: ["mcp__kanon*", "mem_save", "mem_search", "mem_get_observation"]` — good security posture; cannot call code tools.
- `skills-lock.json` tracks the external `vercel-labs/skills` registry, NOT Kanon's `assets/skills/` — misleading name.

---

## 5. Cross-cutting findings (prioritized)

| # | Sev | Finding | Action |
|---|---|---|---|
| 1 | Med | Stale installed build vs source: global MCP still exposes removed tools (`get_issue_context`, `sync_observation`); the removal left a **real gap** — no comment/observation write tool | Decide: re-add an observation/comment write tool, or accept the gap. Ship a fresh build. |
| 2 | Med | No member-listing / id↔name resolution tool (underlies **KAN-117** UUID leak) | Add `kanon_list_members` (or resolve server-side); ties KAN-117 fix to a reusable tool |
| 3 | Med | CORE byte-budget margin ~46 B; PR2/PR3 will add tools | Defer `add_dependency`/`remove_dependency`/`adjust_time_entry` to recover ~150 B BEFORE adding PR2 tools |
| 4 | Low | opencode lacks agent + template injection | Add for parity (matches the public claim) |
| 5 | Low | `kanon-init` ~40 lines of restated content; skill overlaps (deferred-items, phase-state table) in 2–3 places | Trim + consolidate |
| 6 | Low | `close_cycle` multi-call has no rollback | Add a guard / make atomic |
| 7 | Low | Dead `scripts/setup-mcp.sh`; misleading `skills-lock.json` name | Delete / rename-or-comment |

---

## 6. Implications for the proposal model (KAN-104 PR2) and direction

The audit reframes the PR2 decision (does applying an `McpProposal` execute its payload, or stay a status-only flip?):

- **The 3-layer architecture supports option B cleanly.** "Agent proposes (MCP) → human applies → action executes" is exactly the proposal-by-default model (PDR-0003) the agent/skill/tool split is built for. The kanon agent already runs isolated on Haiku and proposes; making `apply` execute a typed payload is the missing back half.
- **Same gap hits forecast replan proposals**, not just estimation — both currently only flip status. Option B fixes both and is the concrete implementation of the *verifiable→enforce / ambiguous→escalate* routing idea on the roadmap (item `Proposal routing: hard-fail verifiable invariants, escalate ambiguous`).
- **Budget constraint is now explicit:** PR2 adds propose/confirm/dismiss tools. With ~46 B of CORE headroom, either these go DEFERRED or we defer the three non-daily CORE tools first (finding #3). This is a hard gate on PR2, surfaced by the byte-budget system.
- **A typed proposal-action ("apply executes payload by kind") may deserve a short ADR amendment** to ADR-0005 D7 — it's an architectural pattern (typed action dispatch + human-as-applier + attribution = the applying human, never the agent), reused across estimate + replan + future kinds.

**Direction takeaway:** the integration is lean and intentional; the fat is small and local (skill trimming, three deferrable tools, dead installer script). The strategic move is not cutting — it's (a) wiring the proposal *apply-executes-payload* pattern (the real "human approves → it happens" mechanism), (b) closing the member-resolution / observation-write gaps, and (c) reclaiming byte-budget before expanding. None of this clashes with a user's harness (it stays at the board/graph layer; the harness keeps owning code/PR).

---

## Suggested tickets

- **Defer 3 CORE tools** (`add_dependency`, `remove_dependency`, `adjust_time_entry`) → reclaim byte budget [small, do before PR2].
- **`kanon_list_members` / id↔name resolution** [small] — unblocks KAN-117 and the no-member-listing gap.
- **Observation/comment write tool** (decide: re-add or accept gap) [small–med].
- **ADR-0005 amendment + impl: typed `McpProposal` apply-executes-payload** (estimate + replan) [med] — this is KAN-104 PR2's real shape.
- **Skill trim/consolidate** (`kanon-init`, `sdd-hooks` overlaps, compact rules) [small].
- **opencode parity** (agent + template) [small–med].
- **`close_cycle` rollback guard**; **delete dead `setup-mcp.sh`**; **rename `skills-lock.json`** [housekeeping].
