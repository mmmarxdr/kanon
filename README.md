# Kanon

**Project management, rebuilt for the age of AI coding agents.**

<!-- SCREENSHOT: main kanban board with AI agent activity visible.
     Recommended size: 1600x900, .png, commit it to docs/assets/kanban.png -->

---

## Why Kanon?

Jira, Linear and Trello were designed for humans clicking in browsers.
But more and more of the code that ships today is written by AI agents —
and those agents cannot drive a board that was never built for them.

Kanon treats AI agents as first-class users, not as a bolted-on integration.
Issues, sprints, transitions, dependencies — all operable natively through
the Model Context Protocol (MCP). The web UI is there for humans. The MCP
server is there for agents. Both talk to the same source of truth.

## The name

**Kanon** (Greek: *κανών, kanṓn*) — "the rule, the measuring rod".
In ancient Greek it referred to the straight standard against which every
other measurement is judged. Fitting, for a system whose job is to set the
cadence of engineering work.

## What you get

- **MCP-native** — your AI assistant (Claude Code, Cursor, Antigravity)
  creates, transitions and comments on issues directly, with no custom glue code.
- **Web Kanban** — a fast React 19 UI for the moments you want to drive the
  board yourself.
- **Self-hosted** — your data stays in your Postgres, your infra, your network.
- **SDD-aware lifecycle** — issues move through states that mirror real work:
  `backlog → explore → propose → spec → design → tasks → apply → verify → archive`.
- **Zero-friction AI setup** — one script (`install.sh`) wires your AI tools to
  any instance from a single `kanon://` onboarding link, over a sha256-pinned
  MCP release.
- **Real-time** — WebSocket-backed updates across clients.

## Inspiration

I built Kanon because my own workflow broke.

I was writing specs, having agents implement them, verifying output, archiving
changes — and the tools I was using to track that work (Notion boards, Linear,
custom Markdown trees) could not talk to the agents doing the work. Every
hand-off needed me to translate between the board and the agent.

Kanon started as a single-user tool to close that gap — a board where the
agent can create its own issue when it spots a TODO, update state when it
finishes a phase, and link dependencies without being asked. It is still
opinionated toward that workflow, and it is the laboratory where I keep
refining how humans and agents share a project.

---

## Quick start (local)

> Requires Node.js 20+, pnpm and Docker.

```bash
git clone https://github.com/mmmarxdr/kanon.git
cd kanon
pnpm bootstrap   # install deps, generate prisma, migrate, build mcp + setup
pnpm dev:start   # boot Postgres, API, web and MCP
```

Open [http://localhost:5173](http://localhost:5173) and sign in with
`dev@kanon.io` / `Password123!` (workspace: `kanon-dev`). This boots a ready-to-use
dev workspace.

Wiring your AI tools to a local instance uses the **exact same flow** as a
self-hosted one — generate an onboarding link, then run the installer. There is
only one install path; see steps **3 → 4** in
[Running your own instance](#running-your-own-instance) below.

---

## Running your own instance

Self-hosting Kanon is four steps: **run it → claim it → invite → install.**
Kanon does not prescribe _where_ you host it — any box, container or PaaS that
runs Node 20+ and can reach a PostgreSQL works. You bring the infrastructure;
Kanon brings the onboarding flow.

### 1. Run the stack, wherever you want

Point the API at your own PostgreSQL and start it however suits your setup
(systemd, Docker, a PaaS — your call). Kanon only asks for a handful of
environment variables:

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `DATABASE_URL` | **yes** | Your PostgreSQL connection string |
| `JWT_SECRET` | **yes** | ≥ 32 chars in production, not the dev default |
| `JWT_REFRESH_SECRET` | **yes** | ≥ 32 chars in production, not the dev default |
| `BASE_URL` | **yes (prod)** | Public API URL. It is embedded verbatim in every `kanon://` onboarding link — leave it as `localhost` and the links are unreachable from other machines. |
| `APP_URL` | recommended | Public web URL |
| `COOKIE_SECRET` | recommended | Cookie signing secret |
| `SETUP_TOKEN_TTL_DAYS` | no | First-boot claim token lifetime (default `7`) |
| `ONBOARDING_TOKEN_TTL_HOURS` | no | `kanon://` link lifetime (default `72`) |

Apply migrations and launch the API against your database:

```bash
pnpm --filter @kanon/api prisma:migrate:deploy
pnpm --filter @kanon/api build
pnpm --filter @kanon/api start
```

### 2. Claim the instance (become super-admin)

On its first boot the API mints a one-time **setup token** and prints it to
its own logs:

```
[SETUP-TOKEN do-not-store] Instance setup token (valid 7 days) — claim at /setup: <token>
```

Grab that token from the API logs. _Missed it?_ Restart the API — a fresh token
is minted on the next boot.

Open `https://<your-host>/setup`, paste the token, and set your operator email
and password. Claiming grants you **super-admin and instance-admin** in one
shot — the account that configures the instance and creates workspaces.

### 3. Create a workspace and generate an onboarding link

After claiming you land on the admin panel. Create your first workspace, then
open **Settings → Members → Generate Onboarding Link**. Kanon mints a
single-use, time-boxed link:

```
kanon://<your-host>/onboard?token=<jwt>
```

Hand this link to anyone — including yourself — who wants their AI tools wired
to this instance.

### 4. Run the install script

On the machine where your AI tools live (Claude Code, Cursor, Antigravity),
run the installer:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.9.0/install.sh)"
```

> Use the **tagged** installer (`mcp-v<version>`), not `main`. The tagged script has
> the release sha256 baked in as its trust root, so a compromised CDN cannot swap in a
> matching tarball+checksum pair. The copy on `main` ships unpinned and refuses to run
> over the network (KAN-52).

It downloads the pinned MCP release, verifies its sha256 **before** extracting,
installs to `~/.kanon/mcp`, then prompts:

```
Paste your kanon:// onboarding link:
```

Paste the link from step 3. Setup exchanges it for credentials, stores them in
`~/.kanon/credentials`, and patches each detected AI tool's MCP config to point
at your instance. Restart the tool and the `kanon_*` tools are live against your
board.

---

For advanced install options (manual Postgres, no-Docker dev, CI scripting),
see **[docs/INSTALL.md](docs/INSTALL.md)**.
For AI tool setup details and supported clients, see
**[docs/AI_TOOLS.md](docs/AI_TOOLS.md)**.

---

## Tech stack

Fastify 5, Prisma, PostgreSQL, React 19, Vite 6, TanStack Router + Query,
Tailwind CSS 4, Zustand, `@modelcontextprotocol/sdk`, Vitest, Playwright.
Monorepo with pnpm workspaces.

## Project layout

| Package            | Path              | Role                          |
| ------------------ | ----------------- | ----------------------------- |
| `@kanon/api`       | `packages/api`    | REST API (Fastify + Prisma)   |
| `@kanon/web`       | `packages/web`    | Web frontend (React + Vite)   |
| `@kanon/mcp`       | `packages/mcp`    | MCP server for AI agents      |
| `@kanon/cli`       | `packages/cli`    | CLI tool                      |
| `@kanon/e2e`       | `packages/e2e`    | Playwright end-to-end tests   |
| `@kanon-pm/setup`  | `packages/setup`  | AI tool setup wizard          |

For dev commands, build/test/release instructions and project internals,
see **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

---

## Status

Early development — v0.2.0. Expect breaking changes until v1.0.
Heading toward v1 with hardened multi-user support, a public API key
flow and a stabilized MCP surface.

## Contributing

Contributions are welcome. Read **[CONTRIBUTING.md](CONTRIBUTING.md)**
before opening a PR.

## License

Kanon is licensed under the [Apache License 2.0](./LICENSE).

Copyright © 2026 Marc Dechand. See [NOTICE](./NOTICE) for attribution requirements.

You are free to use, modify, and distribute Kanon — including for commercial
purposes — provided you preserve the copyright, license, and NOTICE files in
any redistribution. Apache 2.0 includes an explicit patent grant that protects
both users and contributors.
