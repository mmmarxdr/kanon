# Kanon

**Project management, rebuilt for the age of AI coding agents.**

<!-- SCREENSHOT: main kanban board with AI agent activity visible.
     Recommended size: 1600x900, .png, commit it to docs/assets/kanban.png -->

<img width="1912" height="856" alt="image" src="https://github.com/user-attachments/assets/13e1698b-cd48-4e34-9a24-becdf49f7752" />


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
- **Zero-friction AI setup** — one command (`npx @kanon-pm/setup`) configures
  your AI tools with MCP, skills and workflows.
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

## Quick start

> Requires Node.js 20+, pnpm and Docker.

```bash
git clone https://github.com/mmmarxdr/kanon.git
cd kanon
pnpm setup      # install deps, run migrations, build
pnpm dev:start  # boot Postgres, API, web and Engram
```

Open [http://localhost:5173](http://localhost:5173) and sign in with
`dev@kanon.io` / `Password1!` (workspace: `kanon-dev`).

To wire up your AI tools:

```bash
npx @kanon-pm/setup
```

For advanced install options (manual Postgres, no-Docker setup, CI scripting),
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
| `@kanon/bridge`    | `packages/bridge` | Shared types and contracts    |
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
