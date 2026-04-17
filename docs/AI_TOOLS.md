# AI Tool Setup

Kanon ships with an interactive setup wizard that wires up your AI coding
tools to the local Kanon instance — installing MCP config, skills,
templates, and workflows automatically.

## Quick setup

```bash
npx @kanon-pm/setup
```

What it does:

- Detects installed AI tools on your machine.
- Lets you pick which to configure.
- Resolves API credentials (from existing config, a running API, or prompts).
- Installs the MCP server config, skills, templates and workflows.
- Works on Windows (PowerShell), WSL2 and Linux.

## Supported tools

| Tool        | Platform              | Status    |
| ----------- | --------------------- | --------- |
| Claude Code | WSL2, Linux           | Supported |
| Cursor      | Windows, WSL2, Linux  | Supported |
| Antigravity | Windows, WSL2, Linux  | Supported |

## Usage patterns

```bash
# Interactive (recommended)
npx @kanon-pm/setup

# Non-interactive (CI / scripting)
npx @kanon-pm/setup --yes

# Configure a specific tool only
npx @kanon-pm/setup --tool claude-code

# Pass credentials explicitly
npx @kanon-pm/setup --api-url http://localhost:3000 --api-key YOUR_KEY

# Remove Kanon from all tools
npx @kanon-pm/setup --remove --yes
```

## Troubleshooting

If the wizard cannot detect your AI tool, make sure:

1. The tool is installed in its default path.
2. You are running the command from a shell that has access to your user
   home directory (on Windows, prefer WSL2 for Claude Code).
3. Your Kanon API is running on a port the wizard can reach.

For tool-specific issues, open an issue on the repo with the wizard's log
output (`npx @kanon-pm/setup --verbose`).
