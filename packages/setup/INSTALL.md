# Installing Kanon MCP

One command installs the Kanon MCP server, verifies its integrity, and configures your AI coding tools.

## Quick install

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.11.0/install.sh)"
```

Native Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.11.0/install.ps1 | iex
```

**Always use the pinned, tagged installer** — the only form that works:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.11.0/install.sh)"
```

> The `main` branch ships with `EXPECTED_SHA256=""` and intentionally **aborts**
> over the network (KAN-52). Only the tagged installer has the sha256 baked in as
> its trust root, so a compromised CDN cannot substitute a matching tarball+checksum
> pair.

When prompted, paste your `kanon://` onboarding link. Press Enter to skip and run the interactive setup wizard instead.

## What the installer does

| Step | Action |
|------|--------|
| 1. Download | Fetches `kanon-mcp-0.11.0.tar.gz` from the pinned GitHub Release |
| 2. Verify | Checks sha256 **before** extracting — aborts on mismatch, nothing written |
| 3. Install | Validates setup/MCP/wrapper in staging, then replaces `~/.kanon/mcp` with backup/rollback |
| 4. Configure | Invokes `node setup` to write MCP config for your detected tools |

## Pinned version + tamper-resistance

The installer always fetches an exact version (`0.9.0`) — never `latest`.

**How tamper-resistance works (hash-in-tag):**

At release time, the CI workflow:

1. Builds the tarball and computes its sha256.
2. Stamps the same SHA-256 and version directly into `install.sh` and
   `install.ps1` on a detached HEAD commit.
3. Tags that detached commit `mcp-v<version>` and pushes **only the tag** — `main` is never touched.

When you fetch the script via the tag URL:

```
https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.11.0/install.sh
```

The hash is embedded in the script itself — not downloaded from a separate file. A compromised CDN or release server **cannot** substitute a matching tarball+checksum pair, because the expected hash is not fetched from the network.

**`main` intentionally carries `EXPECTED_SHA256=""`** (empty). Over a network
origin this means the sha256 check would rely on a same-origin `.sha256` file —
which a compromised origin can serve alongside a malicious tarball, making the
check worthless. To prevent false security guarantees, the installer **aborts**
when run from `main` over the network (KAN-52).

> **Summary:** always use the tagged installer (`mcp-v0.11.0`). `main` will not
> run over the network by design.

**Version scheme:** The release tag and tarball version must match both
`@kanon/mcp` and `@kanon-pm/setup`; release creation fails on drift.

| Artifact | Naming |
|----------|--------|
| Tag | `mcp-v<version>` (e.g. `mcp-v0.11.0`) |
| Tarball | `kanon-mcp-<version>.tar.gz` |
| Checksum | `kanon-mcp-<version>.tar.gz.sha256` |

## Distribution

The tarball IS the distribution. There is no npm package for the installer. This eliminates the npx supply-chain path (`npx @kanon-pm/setup`) — the release tarball bundles everything needed (MCP server, wrapper, setup) as self-contained esbuild bundles.

## Idempotency

Re-running the installer skips the download only when the pinned version and all
three runtime files exist: setup, MCP server, and wrapper. A partial install is
re-downloaded and transactionally replaced. The setup step still runs so tools
can be reconfigured.

## Link passing (KAN-36)

The `bash -c "$(curl -fsSL ...)"` form evaluates the script as a string, freeing stdin from the curl pipe. This lets the installer `read` your onboarding link interactively from the TTY.

You can also pass the link non-interactively:

```bash
# Via environment variable (highest priority — read by the setup binary)
KANON_ONBOARD_LINK="kanon://your-link" bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.11.0/install.sh)"

# Via piped stdin
echo "kanon://your-link" | bash install.sh
```

Passing a `kanon://` link as a positional argument (`node setup kanon://...`) is no longer supported and emits a deprecation error.

On Windows, set `$env:KANON_ONBOARD_LINK` before the PowerShell command for
non-interactive onboarding. Both installers download the same tarball and run
the same packaged setup binary.

## Manual install

If you cannot use curl:

1. Download `kanon-mcp-0.11.0.tar.gz` and `kanon-mcp-0.11.0.tar.gz.sha256` from the [GitHub Release](https://github.com/mmmarxdr/kanon/releases/tag/mcp-v0.11.0).
2. Verify: `sha256sum -c kanon-mcp-0.11.0.tar.gz.sha256` (Linux) or `shasum -a 256 -c kanon-mcp-0.11.0.tar.gz.sha256` (macOS).
3. Extract: `mkdir -p ~/.kanon/mcp && tar -xzf kanon-mcp-0.11.0.tar.gz -C ~/.kanon/mcp --strip-components=1`
4. Configure: `node ~/.kanon/mcp/setup/dist/index.js`

## Advanced / CI overrides

| Variable | Purpose |
|----------|---------|
| `KANON_INSTALL_BASE_URL` | Override download base URL (e.g. a local fixture for testing) |
| `KANON_INSTALL_DIR` | Override install directory (default: `~/.kanon/mcp`) |
| `KANON_INSTALL_SKIP_SETUP` | Set to `1` to skip the `node setup` invocation |
| `KANON_INSTALL_ALLOW_UNPINNED_LOCAL` | Test-only opt-in for a local, non-UNC `file:` fixture with the unstamped script |
| `KANON_REPO` | Override GitHub `owner/repo` (default: `mmmarxdr/kanon`) |
| `KANON_ONBOARD_LINK` | Pass onboarding link without interactive prompt (read by the setup binary, not install.sh) |

`KANON_INSTALL_ALLOW_UNPINNED_LOCAL` never permits network or UNC sources. It
exists only for local installer smoke tests; tagged installers use the embedded
SHA-256 and do not need it.

## Next step

After installation, restart your AI coding tool to pick up the new MCP server configuration.
