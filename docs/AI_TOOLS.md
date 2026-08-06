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

On Linux, macOS, or WSL, run:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.13.0/install.sh)"
```

On native Windows PowerShell, run:

```powershell
irm https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.13.0/install.ps1 | iex
```

> Use the **tagged** installer (`mcp-v<version>`), not `main`. The tagged script has
> the release sha256 baked in as its trust root; the copy on `main` ships unpinned
> and refuses to run over the network (KAN-52).

The installer:

- Downloads the pinned `@kanon/mcp` release tarball.
- Verifies its sha256 **before** extracting — on mismatch it aborts and writes
  nothing.
- On Windows, downloads and extracts only inside current-user DACL-protected
  directories, validates setup/MCP/wrapper, then replaces the installation with
  backup/rollback rather than extracting over live files.
- Installs to `~/.kanon/mcp`. Re-runs skip the download only when the version,
  setup, MCP server, and wrapper are all present.
- Prompts for your `kanon://` link, then runs setup.

## 3. Paste the link

When prompted:

```
Paste your kanon:// onboarding link:
```

paste the link from step 1. Setup then:

- Exchanges the link's token for credentials and stores them in
  `~/.kanon/credentials`, keyed by the instance's API URL.
- Detects your installed AI tools and installs their complete supported Kanon
  surface: MCP config, product skills, and custom agent where supported.
- Stores refresh credentials at `~/.kanon/credentials` with POSIX permissions
  on Unix or a protected DACL containing only the current Windows SID.

Restart your AI tool and the `kanon_*` tools are live against your board.

## Supported tools

| Tool        | Platform              | Status    |
| ----------- | --------------------- | --------- |
| Claude Code | WSL2, Linux           | Supported |
| Cursor      | macOS, Linux, WSL2, Windows | Supported |
| Antigravity | Windows, WSL2, Linux  | Supported |
| Antigravity CLI | macOS, Linux, WSL2, Windows | Supported |
| OpenCode    | macOS, Linux, WSL2    | Beta      |
| Codex CLI   | macOS, Linux, WSL2, Windows | Supported |

### Cursor IDE and CLI

Cursor uses the documented global MCP config and user skill/agent directories:

| Runtime | MCP config | Skills and agent |
| ------- | ---------- | ---------------- |
| Linux/macOS/native Windows | `~/.cursor/mcp.json` | `~/.cursor/skills/`, `~/.cursor/agents/kanon.md` |
| Windows Cursor IDE configured from WSL | `<Windows home>/.cursor/mcp.json` | `<Windows home>/.cursor/skills/`, `<Windows home>/.cursor/agents/kanon.md` |
| Cursor CLI running inside WSL | `$HOME/.cursor/mcp.json` | `$HOME/.cursor/skills/`, `$HOME/.cursor/agents/kanon.md` |

One `--tool cursor` run always configures the local WSL CLI target first and
adds the Windows IDE target only when `<Windows home>/.cursor` already exists.
The Windows entry uses `wsl env ...`; the WSL CLI invokes the same installed
release directly. During upgrades, a workspace ID found in either target is
written to both. Native Windows setup migrates only the legacy `kanon-mcp` entry from the old
`%APPDATA%/Cursor/User/mcp.json` and removes only the legacy
`~/.cursor/rules/kanon.mdc`. Other servers and user rules are preserved. Setup
does not install a new global rule or broad MCP allowlist.

Fully quit and restart Cursor after setup. In Cursor CLI, verify the server and
current tool set with:

```bash
agent mcp list
agent mcp list-tools kanon
```

In the IDE, open **Customize > MCP**, confirm `kanon` is connected, then ask
the agent to list your Kanon workspaces.

### Antigravity IDE vs Antigravity CLI

These are **separate registry entries** with different config directories:

| Surface | Binary | MCP config | Skills |
| ------- | ------ | ---------- | ------ |
| Antigravity IDE | Desktop app | `~/.gemini/antigravity/mcp_config.json` | `~/.gemini/antigravity/skills/` |
| Antigravity CLI | `agy` | `~/.gemini/antigravity-cli/mcp_config.json` | `~/.gemini/antigravity-cli/skills/` |

On WSL, the **IDE** entry bridges to the Windows host (`wsl-bridge`). The **CLI** entry writes to the WSL Linux homedir (`direct`) because `agy` runs natively in WSL.

Install or remove Kanon for Antigravity CLI only:

```bash
kanon-setup --tool antigravity-cli -y
kanon-setup --tool antigravity-cli --remove -y
```

On Windows, ensure `%LOCALAPPDATA%\agy\bin` is on PATH after `agy install`, or run setup after the CLI has created `~/.gemini/antigravity-cli/`.

Setup does **not** write `settings.json` or `keybindings.json` — those are personal CLI preferences, not MCP config.

### Codex CLI paths

Codex uses a global home directory (not project-scoped):

| Path | Purpose |
| ---- | ------- |
| `$CODEX_HOME` (default `~/.codex`) | Codex CLI home override |
| `$CODEX_HOME/config.toml` | MCP server config (TOML) |
| `$CODEX_HOME/agents/kanon.toml` | Native Kanon subagent |
| `~/.agents/skills/` | Current shared user skills directory |

Install or remove Kanon for Codex only:

```bash
kanon-setup --tool codex -y
kanon-setup --tool codex --remove -y
```

Setup writes `[mcp_servers.kanon]` with flat `command`/`args` and env vars
under `[mcp_servers.kanon.env]`. TOML round-trip via `smol-toml` may drop
comments in `config.toml`; existing Kanon tool approval policy is preserved while
the legacy `kanon-mcp` table is migrated.

## Non-interactive use

The installer reads the link from stdin when it is not attached to a TTY, so it
can run unattended (CI, provisioning scripts):

```bash
echo "kanon://<your-host>/onboard?token=<jwt>" \
  | bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.13.0/install.sh)"
```

Native Windows can set `$env:KANON_ONBOARD_LINK` before invoking the tagged
PowerShell installer.

Advanced overrides (test seams / pinned mirrors) are read from the environment:

| Variable | Purpose |
| -------- | ------- |
| `KANON_INSTALL_DIR` | Install directory (default `~/.kanon/mcp`) |
| `KANON_INSTALL_BASE_URL` | Override the release download base URL |
| `KANON_REPO` | Override the GitHub `owner/repo` (default `mmmarxdr/kanon`) |
| `KANON_INSTALL_SKIP_SETUP` | Set to `1` to install the MCP without running setup |
| `KANON_INSTALL_ALLOW_UNPINNED_LOCAL` | Test-only: set to `1` with a local, non-UNC `file:` fixture when using the unstamped `main` installer |

The unpinned local seam is only for repository tests. It rejects UNC paths,
remote file authorities, and network URLs. Normal installation must always use
the tagged script with its embedded hash.

## Troubleshooting

If a tool is not detected after install, check that:

1. The tool is installed in its default path.
2. You ran the installer from a shell with access to your home directory
   (use PowerShell for native Windows or a WSL shell for WSL-hosted tools).
3. The instance behind your `kanon://` link is reachable from this machine —
   the host in the link comes from the API's `BASE_URL`, so a `localhost` link
   only works on the same machine as the instance.

A consumed or expired link will fail the token exchange — generate a fresh one
from **Settings → Members** and re-run the installer.
