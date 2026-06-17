# AI Tool Setup

Kanon wires your AI coding tools to an instance through **one install path** —
the same whether the instance runs on your laptop or on a remote server. There
is no `npm`/`npx` step: the MCP is distributed as a signed release tarball and
installed by a script that verifies its sha256 **before** extracting.

The flow is always: **generate an onboarding link → run the installer → paste
the link.**

## 1. Generate an onboarding link

In the Kanon web UI of the instance you want to connect to, open
**Settings → Members → Generate Onboarding Link**. Kanon mints a single-use,
time-boxed link:

```
kanon://<your-host>/onboard?token=<jwt>
```

The host is taken from the API's `BASE_URL`, so the link points at exactly the
instance that issued it. Default lifetime is 72 hours
(`ONBOARDING_TOKEN_TTL_HOURS`).

## 2. Run the installer

On the machine where your AI tools live, run:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.6.3/install.sh)"
```

> Use the **tagged** installer (`mcp-v<version>`), not `main`. The tagged script has
> the release sha256 baked in as its trust root; the copy on `main` ships unpinned
> and refuses to run over the network (KAN-52).

The installer:

- Downloads the pinned `@kanon/mcp` release tarball.
- Verifies its sha256 **before** extracting — on mismatch it aborts and writes
  nothing.
- Installs to `~/.kanon/mcp` (idempotent: re-runs skip the download if the
  pinned version is already present).
- Prompts for your `kanon://` link, then runs setup.

## 3. Paste the link

When prompted:

```
Paste your kanon:// onboarding link:
```

paste the link from step 1. Setup then:

- Exchanges the link's token for credentials and stores them in
  `~/.kanon/credentials`, keyed by the instance's API URL.
- Detects your installed AI tools and patches each one's native config to add a
  Kanon MCP server entry pointing at that instance.

Restart your AI tool and the `kanon_*` tools are live against your board.

## Supported tools

| Tool        | Platform              | Status    |
| ----------- | --------------------- | --------- |
| Claude Code | WSL2, Linux           | Supported |
| Cursor      | Windows, WSL2, Linux  | Supported |
| Antigravity | Windows, WSL2, Linux  | Supported |
| OpenCode    | macOS, Linux, WSL2    | Beta      |
| Codex CLI   | macOS, Linux, WSL2, Windows | Supported |

### Codex CLI paths

Codex uses a global home directory (not project-scoped):

| Path | Purpose |
| ---- | ------- |
| `$CODEX_HOME` (default `~/.codex`) | Codex CLI home override |
| `$CODEX_HOME/config.toml` | MCP server config (TOML) |
| `$CODEX_HOME/skills/` | Global skills directory |

Install or remove Kanon for Codex only:

```bash
kanon-setup --tool codex -y
kanon-setup --tool codex --remove -y
```

Setup writes `[mcp_servers.kanon-mcp]` with flat `command`/`args` and env vars
under `[mcp_servers.kanon-mcp.env]`. TOML round-trip via `smol-toml` may drop
comments in `config.toml` — only the `kanon-mcp` tables are touched.

## Non-interactive use

The installer reads the link from stdin when it is not attached to a TTY, so it
can run unattended (CI, provisioning scripts):

```bash
echo "kanon://<your-host>/onboard?token=<jwt>" \
  | bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.6.3/install.sh)"
```

Advanced overrides (test seams / pinned mirrors) are read from the environment:

| Variable | Purpose |
| -------- | ------- |
| `KANON_INSTALL_DIR` | Install directory (default `~/.kanon/mcp`) |
| `KANON_INSTALL_BASE_URL` | Override the release download base URL |
| `KANON_REPO` | Override the GitHub `owner/repo` (default `mmmarxdr/kanon`) |
| `KANON_INSTALL_SKIP_SETUP` | Set to `1` to install the MCP without running setup |

## Troubleshooting

If a tool is not detected after install, check that:

1. The tool is installed in its default path.
2. You ran the installer from a shell with access to your home directory
   (on Windows, prefer WSL2 for Claude Code).
3. The instance behind your `kanon://` link is reachable from this machine —
   the host in the link comes from the API's `BASE_URL`, so a `localhost` link
   only works on the same machine as the instance.

A consumed or expired link will fail the token exchange — generate a fresh one
from **Settings → Members** and re-run the installer.
