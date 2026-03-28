# Kanon — Project Specification

> **κανών** (kanṓn): "rule, standard, measure" — Ancient Greek.
> An AI-native project management system designed for spec-driven development workflows.

**Version:** 0.1.0-draft
**Author:** Marc Dechand 
**Date:** 2026-03-21
**Status:** Source of Truth — Pre-Development

---

## 1. Vision & Problem Statement

### Problem

Developers working with AI coding agents (Claude Code, Cursor, etc.) across multiple simultaneous projects lack a project management tool that:

1. Understands AI-assisted, spec-driven development workflows natively.
2. Integrates bidirectionally with the AI agent's context (via MCP) so that the agent can read, update, and close tasks without leaving the terminal.
3. Bridges semantic memory systems (like Engram) with structured project tracking, so that every issue carries rich, searchable context.
4. Provides a fast visual overview (Kanban board, sprint view) to orient a developer at the start of each session.

Existing tools (Jira, Linear, Notion) are designed for team-centric Agile/Scrum and have no concept of AI agent integration, spec-driven phases, or semantic memory hydration.

### Vision

Kanon is a lightweight, self-hostable project management system that treats the AI coding agent as a first-class participant. It models the full spec-driven development lifecycle as issue states, integrates with Engram for semantic context, and exposes a Kanban + Sprint UI alongside an MCP server so both humans and AI agents can manage work seamlessly.

---

## 2. Core Concepts & Domain Model

### 2.1 Workspace

The top-level container. A single Kanon instance can host multiple workspaces. Each workspace is isolated (projects, members, settings).

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `slug` | string | URL-friendly identifier (e.g., `personal`, `company-x`) |
| `name` | string | Display name |
| `created_at` | timestamp | Creation date |

### 2.2 Project

A project groups related work (e.g., "NITROSUITE", "SpendWise", "Kanon"). Each project has its own board, backlog, and sprint configuration.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `workspace_id` | UUID | FK → Workspace |
| `key` | string(6) | Short prefix for issue IDs (e.g., `NITRO`, `SW`, `KAN`) |
| `name` | string | Full project name |
| `description` | text | Project overview |
| `default_branch` | string | Optional: default git branch |
| `engram_namespace` | string | Engram namespace for this project's semantic memory |
| `created_at` | timestamp | Creation date |
| `archived` | boolean | Soft-delete flag |

### 2.3 Issue

The fundamental unit of work. Issues follow the spec-driven lifecycle as their state machine.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `project_id` | UUID | FK → Project |
| `key` | string | Auto-generated: `{project.key}-{sequence}` (e.g., `KAN-42`) |
| `title` | string | Short summary |
| `description` | text (markdown) | Full description, acceptance criteria, context |
| `type` | enum | `feature`, `bug`, `task`, `spike` |
| `priority` | enum | `critical`, `high`, `medium`, `low` |
| `state` | enum | See §2.4 Issue States |
| `assignee_id` | UUID? | FK → Member (nullable) |
| `sprint_id` | UUID? | FK → Sprint (nullable, null = backlog) |
| `parent_id` | UUID? | FK → Issue (for sub-tasks / child issues) |
| `labels` | string[] | Freeform tags |
| `story_points` | integer? | Complexity estimate |
| `engram_context` | jsonb | Hydrated context from Engram at creation/update |
| `spec_artifacts` | jsonb | References to .md spec files (paths, checksums) |
| `created_at` | timestamp | Creation date |
| `updated_at` | timestamp | Last modification |
| `completed_at` | timestamp? | When moved to `archived` |

### 2.4 Issue States (Spec-Driven Lifecycle)

States model the exact workflow of spec-driven AI development:

```
backlog → explore → propose → design → spec → tasks → apply → verify → archived
```

| State | Description | Kanban Column |
|-------|-------------|---------------|
| `backlog` | Captured but not started. Sitting in the icebox. | Backlog (hidden from board by default) |
| `explore` | Active investigation. Gathering requirements, understanding the domain. | Explore |
| `propose` | A proposal/approach has been formulated. Awaiting review/approval. | Propose |
| `design` | System design in progress (architecture, data model, API contracts). | Design |
| `spec` | Writing detailed spec documents (.md). Defining acceptance criteria. | Spec |
| `tasks` | Spec approved. Breaking down into implementable sub-tasks. | Tasks |
| `apply` | Code is being written (by human, AI, or both). | Apply |
| `verify` | Implementation complete. Running tests, QA, review. | Verify |
| `archived` | Done and verified. Moved to archive. | Done |

**Transition Rules:**
- Forward transitions are always allowed (any state → any later state).
- Backward transitions are allowed but trigger a `state_regression` event for tracking.
- `backlog` can jump directly to any state (fast-tracking).
- `archived` is terminal but reversible (reopen → any state).
- States can be skipped (e.g., a hotfix bug goes `backlog → apply → verify → archived`).

**Customization:** Projects may disable or rename states, but the default set covers the standard spec-driven workflow. Custom states are not supported in v1 — instead, use labels for additional categorization.

### 2.5 Sprint

Time-boxed iteration for organizing work.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `project_id` | UUID | FK → Project |
| `name` | string | Sprint name (e.g., "Sprint 12", "March W3") |
| `goal` | text | Sprint goal description |
| `start_date` | date | Sprint start |
| `end_date` | date | Sprint end |
| `status` | enum | `planning`, `active`, `completed` |
| `created_at` | timestamp | Creation date |

**Rules:**
- Only one sprint per project can be `active` at a time.
- Issues not completed when a sprint ends can be auto-carried to the next sprint or returned to backlog (configurable per project).
- Sprint velocity is calculated from completed story points.

### 2.6 Member

A participant in a workspace. Prepared for multi-user but initially single-user.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `workspace_id` | UUID | FK → Workspace |
| `username` | string | Unique within workspace |
| `email` | string | For auth and notifications |
| `role` | enum | `owner`, `admin`, `member`, `viewer` |
| `api_key` | string | For MCP authentication |
| `created_at` | timestamp | Creation date |

### 2.7 Activity Log

Every state change, assignment, comment, and MCP-triggered update is logged.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `issue_id` | UUID | FK → Issue |
| `actor` | string | Username or `mcp:claude-code` for agent actions |
| `action` | enum | `created`, `state_changed`, `assigned`, `commented`, `sprint_changed`, `edited`, `engram_synced` |
| `details` | jsonb | Action-specific payload (e.g., `{from: "explore", to: "propose"}`) |
| `created_at` | timestamp | When it happened |

### 2.8 Comment

Discussion on issues, supporting both human and AI-generated context.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `issue_id` | UUID | FK → Issue |
| `author_id` | UUID? | FK → Member (null for system/MCP) |
| `source` | enum | `human`, `mcp`, `engram_sync`, `system` |
| `body` | text (markdown) | Comment content |
| `created_at` | timestamp | When posted |

---

## 3. Architecture Overview

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Kanon System                             │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────┐ │
│  │   Web UI      │   │  MCP Server  │   │   REST API          │ │
│  │   (React)     │   │  (stdio/SSE) │   │   (Internal)        │ │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬──────────┘ │
│         │                  │                       │            │
│         └──────────────────┼───────────────────────┘            │
│                            │                                    │
│                   ┌────────▼─────────┐                          │
│                   │   Core Service   │                          │
│                   │   (Business      │                          │
│                   │    Logic)        │                          │
│                   └────────┬─────────┘                          │
│                            │                                    │
│              ┌─────────────┼──────────────┐                     │
│              │             │              │                      │
│     ┌────────▼───┐  ┌─────▼──────┐  ┌───▼──────────┐          │
│     │ PostgreSQL │  │  Engram     │  │  File System  │          │
│     │ Database   │  │  Bridge     │  │  (.md specs)  │          │
│     └────────────┘  └────────────┘  └───────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Breakdown

**Web UI (React):**
- Kanban board with drag-and-drop state transitions.
- Sprint planning view (backlog → sprint assignment).
- Project switcher for multi-project management.
- Issue detail panel with activity log, comments, Engram context.
- Dashboard with sprint progress, velocity charts, cross-project overview.
- Responsive design (desktop-first, mobile-usable).

**MCP Server:**
- Exposes Kanon operations as MCP tools for AI coding agents.
- Communicates via stdio (for Claude Code local) or SSE (for remote).
- Authenticates via API key.
- Can query Engram before creating/updating issues to hydrate context.

**REST API (Internal):**
- Powers the Web UI.
- Standard RESTful JSON endpoints.
- JWT-based authentication.
- WebSocket support for real-time board updates.

**Core Service:**
- Business logic layer shared by all interfaces.
- State machine enforcement.
- Sprint management rules.
- Engram bridge orchestration.

**Engram Bridge:**
- On issue creation: queries Engram for related context by project namespace and issue description. Attaches results to `engram_context`.
- On issue state change: pushes a structured event to Engram so the AI's memory stays current.
- On issue close: archives the full context (description + activity log + comments) into Engram for future retrieval.
- Engram connection is optional — Kanon works standalone without it but loses semantic features.

### 3.3 Tech Stack (Recommended)

The spec is implementation-agnostic, but the recommended stack based on the project requirements:

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend runtime | Node.js (LTS) | Consistent ecosystem, strong MCP SDK support |
| Backend framework | Express or Fastify | Lightweight, well-known, flexible |
| Language | TypeScript | Type safety across full stack |
| Database | PostgreSQL 16+ | Robust, JSONB support, proven at scale |
| ORM | Prisma or Drizzle | Type-safe queries, migrations |
| Web UI | React 18+ with Vite | Modern DX, fast builds |
| UI styling | Tailwind CSS | Rapid prototyping, consistent design |
| UI components | shadcn/ui or Radix | Accessible, composable primitives |
| Drag-and-drop | @dnd-kit | Modern, accessible DnD for Kanban |
| Real-time | WebSockets (native or Socket.io) | Live board updates |
| Auth | JWT + bcrypt | Simple, stateless, extensible |
| MCP SDK | @modelcontextprotocol/sdk | Official MCP TypeScript SDK |
| Containerization | Docker + Docker Compose | Easy self-hosting |
| Migrations | Prisma Migrate or dbmate | Schema versioning |

### 3.4 Deployment

```yaml
# docker-compose.yml (conceptual)
services:
  kanon-api:
    build: ./packages/api
    ports:
      - "3000:3000"
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://kanon:kanon@postgres:5432/kanon
      JWT_SECRET: ${JWT_SECRET}
      ENGRAM_URL: ${ENGRAM_URL:-}  # Optional

  kanon-web:
    build: ./packages/web
    ports:
      - "5173:5173"
    depends_on:
      - kanon-api

  postgres:
    image: postgres:16-alpine
    volumes:
      - kanon_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: kanon
      POSTGRES_USER: kanon
      POSTGRES_PASSWORD: kanon

volumes:
  kanon_data:
```

Single `docker compose up` brings up the entire system. The MCP server runs as a separate process (stdio mode) launched by Claude Code's config, pointing at the API.

---

## 4. MCP Server Specification

### 4.1 Overview

The MCP server is the primary interface for AI coding agents to interact with Kanon. It exposes a set of tools that map to Kanon operations, and can optionally query Engram for context enrichment.

### 4.2 MCP Tools

#### Project Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `kanon_list_projects` | List all projects in the workspace | `workspace?` |
| `kanon_get_project` | Get project details + active sprint | `project_key` |

#### Issue Operations

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `kanon_create_issue` | Create a new issue, optionally hydrating from Engram | `project_key`, `title`, `description`, `type`, `priority`, `state?`, `labels?`, `parent_key?`, `hydrate_engram: bool` |
| `kanon_update_issue` | Update issue fields | `issue_key`, `title?`, `description?`, `priority?`, `labels?`, `story_points?`, `assignee?` |
| `kanon_transition_issue` | Move issue to a new state | `issue_key`, `to_state`, `comment?` |
| `kanon_get_issue` | Get full issue detail with activity and Engram context | `issue_key` |
| `kanon_list_issues` | List/filter issues | `project_key`, `state?`, `sprint?`, `assignee?`, `label?`, `type?` |
| `kanon_add_comment` | Add a comment to an issue | `issue_key`, `body`, `source: "mcp"` |
| `kanon_search_issues` | Full-text search across issues | `query`, `project_key?` |

#### Sprint Operations

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `kanon_list_sprints` | List sprints for a project | `project_key`, `status?` |
| `kanon_get_active_sprint` | Get the current active sprint with issues | `project_key` |
| `kanon_create_sprint` | Create a new sprint | `project_key`, `name`, `goal?`, `start_date`, `end_date` |
| `kanon_assign_to_sprint` | Move issues to a sprint | `issue_keys[]`, `sprint_id` |
| `kanon_complete_sprint` | Complete sprint, handle unfinished issues | `sprint_id`, `unfinished_action: "carry" \| "backlog"` |

#### Context & Sync

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `kanon_board_status` | Get a snapshot of the current board (all columns with issue summaries) | `project_key` |
| `kanon_session_brief` | High-level summary for starting a new session: active sprint, in-progress issues, blockers, recent activity | `project_key` |
| `kanon_sync_engram` | Manually trigger Engram sync for an issue | `issue_key`, `direction: "pull" \| "push" \| "both"` |

### 4.3 MCP Resources

The MCP server also exposes read-only resources for richer context:

| Resource URI | Description |
|-------------|-------------|
| `kanon://projects` | List of all projects |
| `kanon://project/{key}/board` | Current board state |
| `kanon://project/{key}/sprint/active` | Active sprint details |
| `kanon://issue/{key}` | Full issue with activity |
| `kanon://project/{key}/velocity` | Sprint velocity history |

### 4.4 Engram Integration Flow

```
AI Agent calls kanon_create_issue(hydrate_engram: true)
    │
    ├─1→ MCP Server receives request
    ├─2→ Queries Engram: semantic_search(namespace=project.engram_namespace, query=title+description)
    ├─3→ Engram returns related memories (past bugs, decisions, patterns)
    ├─4→ MCP Server creates issue in Kanon DB with engram_context populated
    ├─5→ MCP Server pushes event to Engram: "Issue KAN-42 created: {title}"
    └─6→ Returns created issue to AI Agent
```

```
AI Agent calls kanon_transition_issue(KAN-42, "verify", comment="All tests passing")
    │
    ├─1→ MCP Server transitions state
    ├─2→ Logs activity: state_changed explore→verify
    ├─3→ Pushes to Engram: "KAN-42 moved to verify. Comment: All tests passing"
    └─4→ Returns updated issue
```

### 4.5 Claude Code Configuration

```json
// .claude/mcp.json
{
  "mcpServers": {
    "kanon": {
      "command": "npx",
      "args": ["kanon-mcp"],
      "env": {
        "KANON_API_URL": "http://localhost:3000",
        "KANON_API_KEY": "your-api-key",
        "KANON_DEFAULT_PROJECT": "NITRO"
      }
    }
  }
}
```

---

## 5. Web UI Specification

### 5.1 Views

#### 5.1.1 Board View (Primary)

The default view. A Kanban board showing the issue lifecycle columns.

**Layout:**
- Horizontal scrollable columns, one per active state.
- `backlog` is hidden by default (toggle to show).
- `archived` is hidden by default (toggle to show).
- Visible columns by default: `explore` | `propose` | `design` | `spec` | `tasks` | `apply` | `verify`
- Each column shows issue cards sorted by priority.
- Cards are draggable between columns (triggers state transition).
- Column headers show issue count and total story points.

**Issue Card:**
- Issue key + title (e.g., `KAN-42: Implement auth middleware`)
- Type icon (feature/bug/task/spike)
- Priority indicator (color-coded dot or border)
- Assignee avatar
- Labels as colored chips
- Story points badge
- Engram indicator (icon if `engram_context` is populated)
- Sub-task progress bar (if parent issue)

**Filters:**
- By assignee, label, type, priority.
- Text search.
- Sprint filter (active sprint, specific sprint, all).

#### 5.1.2 Sprint View

Focused on sprint planning and tracking.

**Layout:**
- Left panel: Backlog (unassigned issues, draggable).
- Right panel: Current/selected sprint issues.
- Sprint header: name, goal, date range, progress bar, velocity.
- Drag issues from backlog to sprint (and vice versa).
- Burndown chart (story points remaining over time).

#### 5.1.3 Issue Detail

Full issue view, accessible as a slide-over panel or full page.

**Sections:**
- Header: key, title, state badge, type, priority.
- Description (markdown rendered).
- Spec artifacts (links to .md files).
- Engram context (collapsible, shows related memories).
- Sub-tasks list (if parent).
- Activity log (timeline of all changes).
- Comments (threaded, supports markdown).
- Metadata sidebar: assignee, sprint, labels, story points, dates.

#### 5.1.4 Dashboard

Cross-project overview for session orientation.

- Active sprints across all projects with progress.
- Issues in `apply` or `verify` state (things in flight).
- Recently updated issues.
- Velocity chart per project.
- Quick actions: create issue, start session brief.

#### 5.1.5 Project Settings

- Project name, key, description.
- Engram namespace configuration.
- Sprint defaults (duration, carry-over behavior).
- Board column visibility/ordering.
- Members and roles (prepared for multi-user).

### 5.2 Real-Time Updates

When the MCP server modifies data (e.g., AI agent transitions an issue), the Web UI updates in real-time via WebSocket:

- Issue cards move between columns.
- Activity logs update.
- Sprint progress refreshes.
- Toast notification: "Claude Code moved KAN-42 to verify".

---

## 6. Authentication & Authorization

### 6.1 Auth Model (v1)

- **Web UI:** Email + password login → JWT (access token + refresh token).
- **MCP Server:** API key per member, passed via environment variable.
- **API:** JWT for web sessions, API key for programmatic access.

### 6.2 Roles

| Role | Permissions |
|------|------------|
| `owner` | Full access. Manage workspace, members, billing (future). |
| `admin` | Manage projects, sprints, members (except owner removal). |
| `member` | Create/edit/transition issues, manage own assignments. |
| `viewer` | Read-only access to boards and issues. |

### 6.3 Future Auth Extensions (Not v1)

- OAuth2 (GitHub, Google).
- SSO/SAML for enterprise.
- Fine-grained permissions per project.

---

## 7. Engram Bridge Detail

### 7.1 What is Engram?

Engram is an MCP-compatible semantic memory server backed by SQLite with vector search. It stores structured memories organized by namespace and supports semantic retrieval. In the Kanon context, it serves as the "long-term memory" that the AI agent uses to maintain context across sessions.

### 7.2 Integration Points

| Trigger | Direction | What Happens |
|---------|-----------|-------------|
| Issue created with `hydrate_engram: true` | Engram → Kanon | Query Engram for related memories. Attach to `engram_context`. |
| Issue state changed | Kanon → Engram | Push structured event: state transition + comment. |
| Comment added (any source) | Kanon → Engram | Push comment content as memory. |
| Issue archived | Kanon → Engram | Push full issue summary (title + description + resolution + key learnings). |
| `kanon_sync_engram` called | Bidirectional | Pull latest Engram context AND push current issue state. |
| `kanon_session_brief` called | Engram → Kanon | Include relevant Engram memories in the brief alongside Kanon data. |

### 7.3 Engram Query Strategy

When hydrating context from Engram, Kanon queries with:

```
namespace: project.engram_namespace
query: issue.title + " " + issue.description (truncated to 500 chars)
filters: { domain: project.key }
limit: 10
```

Results are stored in `engram_context` as:

```json
{
  "hydrated_at": "2026-03-21T14:30:00Z",
  "memories": [
    {
      "engram_id": "mem_abc123",
      "content": "Resolved NULL bug in solicitud_asignacion by...",
      "relevance_score": 0.87,
      "domain": "NITRO",
      "created_at": "2026-03-15T10:00:00Z"
    }
  ]
}
```

### 7.4 Engram Configuration

```env
# Kanon .env
ENGRAM_ENABLED=true
ENGRAM_URL=http://localhost:3001  # Engram server URL
ENGRAM_API_KEY=your-engram-key    # If auth is required
ENGRAM_AUTO_SYNC=true             # Auto-push on state changes
ENGRAM_HYDRATE_ON_CREATE=true     # Auto-hydrate on issue creation
```

When `ENGRAM_ENABLED=false`, all Engram features are silently skipped and Kanon operates as a standalone tool.

---

## 8. API Endpoints (Internal REST)

### 8.1 Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login → JWT |
| `POST` | `/api/auth/refresh` | Refresh token |
| `POST` | `/api/auth/api-key` | Generate API key |

### 8.2 Workspaces

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspaces` | List user's workspaces |
| `POST` | `/api/workspaces` | Create workspace |
| `PATCH` | `/api/workspaces/:id` | Update workspace |

### 8.3 Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspaces/:wid/projects` | List projects |
| `POST` | `/api/workspaces/:wid/projects` | Create project |
| `GET` | `/api/projects/:key` | Get project detail |
| `PATCH` | `/api/projects/:key` | Update project |
| `DELETE` | `/api/projects/:key` | Archive project |

### 8.4 Issues

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:key/issues` | List issues (filterable) |
| `POST` | `/api/projects/:key/issues` | Create issue |
| `GET` | `/api/issues/:issueKey` | Get issue detail |
| `PATCH` | `/api/issues/:issueKey` | Update issue |
| `POST` | `/api/issues/:issueKey/transition` | Transition state |
| `GET` | `/api/issues/:issueKey/activity` | Get activity log |
| `POST` | `/api/issues/:issueKey/comments` | Add comment |
| `GET` | `/api/issues/:issueKey/comments` | List comments |
| `POST` | `/api/issues/:issueKey/engram/sync` | Trigger Engram sync |

### 8.5 Sprints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:key/sprints` | List sprints |
| `POST` | `/api/projects/:key/sprints` | Create sprint |
| `GET` | `/api/sprints/:id` | Get sprint detail |
| `PATCH` | `/api/sprints/:id` | Update sprint |
| `POST` | `/api/sprints/:id/start` | Activate sprint |
| `POST` | `/api/sprints/:id/complete` | Complete sprint |
| `POST` | `/api/sprints/:id/issues` | Assign issues to sprint |

### 8.6 Board & Dashboard

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:key/board` | Board state (columns + issues) |
| `GET` | `/api/projects/:key/session-brief` | Session brief for AI agents |
| `GET` | `/api/dashboard` | Cross-project dashboard data |
| `GET` | `/api/projects/:key/velocity` | Velocity chart data |

---

## 9. Development Phases

### Phase 1: Foundation (MVP)

**Goal:** Working Kanban board + MCP server with core issue management.

- [ ] Project scaffolding (monorepo: `packages/api`, `packages/web`, `packages/mcp`)
- [ ] PostgreSQL schema + migrations
- [ ] Auth system (register, login, JWT, API keys)
- [ ] Core CRUD: workspaces, projects, issues, comments
- [ ] Issue state machine with transition validation
- [ ] REST API for all core operations
- [ ] MCP server with issue and project tools
- [ ] Web UI: Board view with drag-and-drop
- [ ] Web UI: Issue detail panel
- [ ] Web UI: Project switcher
- [ ] Docker Compose setup
- [ ] `kanon_board_status` and `kanon_session_brief` MCP tools

### Phase 2: Sprints & Planning

**Goal:** Sprint management and planning workflow.

- [ ] Sprint CRUD and lifecycle management
- [ ] Sprint planning view (backlog ↔ sprint drag-and-drop)
- [ ] Sprint velocity calculation
- [ ] Burndown chart
- [ ] MCP sprint tools
- [ ] Auto-carry or backlog on sprint completion

### Phase 3: Engram Integration

**Goal:** Bidirectional Engram sync for semantic context.

- [ ] Engram bridge service
- [ ] Hydrate on issue creation
- [ ] Push on state transitions
- [ ] Push on comments
- [ ] Archive summary on issue completion
- [ ] `kanon_sync_engram` MCP tool
- [ ] Engram context display in issue detail UI
- [ ] Session brief enriched with Engram memories

### Phase 4: Polish & Collaboration

**Goal:** Real-time updates, multi-user, and UX refinements.

- [ ] WebSocket real-time board updates
- [ ] Dashboard view (cross-project)
- [ ] Activity log timeline in UI
- [ ] Notification system (toast + optional email)
- [ ] Multi-user workspace collaboration
- [ ] Role-based UI (viewer restrictions)
- [ ] Sub-task management UI
- [ ] Keyboard shortcuts for power users

### Phase 5: Advanced (Post-MVP)

- [ ] Bulk operations (multi-select issues, batch transitions)
- [ ] Custom views / saved filters
- [ ] Time tracking
- [ ] Webhooks for external integrations
- [ ] Import from Jira/Linear
- [ ] Public board sharing (read-only link)
- [ ] CLI tool (`kanon` command)
- [ ] Mobile-optimized responsive UI

---

## 10. Repository Structure

```
kanon/
├── docker-compose.yml
├── .env.example
├── README.md
├── packages/
│   ├── api/                    # Backend API server
│   │   ├── src/
│   │   │   ├── config/         # DB, auth, engram config
│   │   │   ├── middleware/     # Auth, error handling, validation
│   │   │   ├── modules/
│   │   │   │   ├── auth/       # Register, login, tokens
│   │   │   │   ├── workspace/  # Workspace CRUD
│   │   │   │   ├── project/    # Project CRUD
│   │   │   │   ├── issue/      # Issue CRUD + state machine
│   │   │   │   ├── sprint/     # Sprint lifecycle
│   │   │   │   ├── comment/    # Comments
│   │   │   │   ├── activity/   # Activity log
│   │   │   │   └── engram/     # Engram bridge
│   │   │   ├── shared/         # Types, utils, constants
│   │   │   └── index.ts        # Server entrypoint
│   │   ├── prisma/
│   │   │   └── schema.prisma   # Database schema
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── web/                    # React frontend
│   │   ├── src/
│   │   │   ├── components/     # Shared UI components
│   │   │   ├── features/
│   │   │   │   ├── board/      # Kanban board
│   │   │   │   ├── sprint/     # Sprint planning
│   │   │   │   ├── issue/      # Issue detail
│   │   │   │   ├── dashboard/  # Cross-project dashboard
│   │   │   │   └── settings/   # Project settings
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   ├── api/            # API client
│   │   │   ├── stores/         # State management
│   │   │   └── App.tsx
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── mcp/                    # MCP server for Claude Code
│       ├── src/
│       │   ├── tools/          # MCP tool definitions
│       │   ├── resources/      # MCP resource definitions
│       │   ├── engram/         # Engram query helpers
│       │   ├── client.ts       # Kanon API client
│       │   └── index.ts        # MCP server entrypoint
│       ├── package.json
│       └── README.md
│
├── docs/                       # Documentation
│   ├── SPEC.md                 # This file
│   ├── API.md                  # API documentation
│   ├── MCP.md                  # MCP server documentation
│   └── DEPLOYMENT.md           # Deployment guide
│
└── scripts/                    # Dev utilities
    ├── seed.ts                 # Database seeding
    └── migrate.ts              # Migration runner
```

---

## 11. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Startup time | < 10s (docker compose up to usable) |
| Board load | < 500ms for 200 issues |
| MCP response | < 300ms for single operations |
| Database | Support up to 10,000 issues per project |
| Concurrent users | 10 (v1), extensible |
| Browser support | Chrome, Firefox, Safari (latest 2 versions) |
| Accessibility | WCAG 2.1 AA for core interactions |
| Data backup | PostgreSQL dump via Docker volume |

---

## 12. Open Questions

1. **Engram protocol:** What is the exact API surface of the Engram MCP server? The bridge assumes `semantic_search` and `add_memory` tools — need to confirm.
2. **Spec artifacts storage:** Should .md spec files be stored in Kanon's DB (as content) or referenced by file path (git repo)? File path keeps them in version control but requires filesystem access.
3. **Offline MCP:** Should the MCP server work without the API server (local SQLite fallback) for truly local development?
4. **Issue linking:** Should v1 support explicit issue relationships (blocks/blocked-by, relates-to) beyond parent/child?
5. **Git integration:** Should Kanon auto-transition issues based on branch names or commit messages (e.g., `KAN-42` in a commit message → move to `apply`)?

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **Engram** | MCP-compatible semantic memory server using SQLite + vector search |
| **MCP** | Model Context Protocol — standard for AI agent tool integration |
| **Spec-driven development** | Workflow where features go through explore → propose → design → spec → implement → verify |
| **Hydrate** | Enrich a Kanon entity with related context pulled from Engram |
| **Session brief** | A summary payload optimized for orienting an AI agent at the start of a coding session |
| **Issue key** | Human-readable identifier: `{PROJECT_KEY}-{sequence}` (e.g., `KAN-42`) |

---

*End of specification. This document is the source of truth for Kanon development.*