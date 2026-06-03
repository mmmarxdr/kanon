# Installing Kanon MCP

One command installs the Kanon MCP server, verifies its integrity, and configures your AI coding tools.

## Quick install

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.4.0/install.sh)"
```

**Pin to a specific release** (recommended — tamper-resistant):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.4.0/install.sh)"
```

Fetch `main` (always latest, no tamper-resistance guarantee):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/main/install.sh)"
```

When prompted, paste your `kanon://` onboarding link. Press Enter to skip and run the interactive setup wizard instead.

## What the installer does

| Step | Action |
|------|--------|
| 1. Download | Fetches `kanon-mcp-0.4.0.tar.gz` from the pinned GitHub Release |
| 2. Verify | Checks sha256 **before** extracting — aborts on mismatch, nothing written |
| 3. Install | Extracts to `~/.kanon/mcp`; writes a version marker for idempotency |
| 4. Configure | Invokes `node setup` to write MCP config for your detected tools |

## Pinned version + tamper-resistance

The installer always fetches an exact version (`0.4.0`) — never `latest`.

**How tamper-resistance works (hash-in-tag):**

At release time, the CI workflow:

1. Builds the tarball and computes its sha256.
2. Stamps `EXPECTED_SHA256="<hash>"` directly into `install.sh`.
3. Commits that script to `main`.
4. Tags that commit `mcp-v0.4.0`.

When you fetch the script via the tag URL:

```
https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.4.0/install.sh
```

The hash is embedded in the script itself — not downloaded from a separate file. A compromised CDN or release server **cannot** substitute a matching tarball+checksum pair, because the expected hash is not fetched from the network.

> **Note:** Fetching via `main` (instead of the tag) does NOT guarantee tamper-resistance — an attacker who can push to `main` can update both the script and the tarball. Always pin to a tag for production or security-sensitive installations.

**Version scheme:** The release tag and tarball version track the MCP server version (`@kanon/mcp`). The setup package version is internal and not reflected in the artifact name.

| Artifact | Naming |
|----------|--------|
| Tag | `mcp-v<version>` (e.g. `mcp-v0.4.0`) |
| Tarball | `kanon-mcp-<version>.tar.gz` |
| Checksum | `kanon-mcp-<version>.tar.gz.sha256` |

## Distribution

The tarball IS the distribution. There is no npm package for the installer. This eliminates the npx supply-chain path (`npx @kanon-pm/setup`) — the release tarball bundles everything needed (MCP server, wrapper, setup) as self-contained esbuild bundles.

## Idempotency

Re-running the installer when `~/.kanon/mcp` already contains the pinned version prints `already installed` and skips the download. The setup step still runs so you can reconfigure tools.

## Link passing (KAN-36)

The `bash -c "$(curl -fsSL ...)"` form evaluates the script as a string, freeing stdin from the curl pipe. This lets the installer `read` your onboarding link interactively from the TTY.

You can also pass the link non-interactively:

```bash
# Via environment variable (highest priority)
KANON_ONBOARD_LINK="kanon://your-link" bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.4.0/install.sh)"

# Via piped stdin
echo "kanon://your-link" | bash install.sh
```

Passing a `kanon://` link as a positional argument (`node setup kanon://...`) is no longer supported and emits a deprecation error.

## Manual install

If you cannot use curl:

1. Download `kanon-mcp-0.4.0.tar.gz` and `kanon-mcp-0.4.0.tar.gz.sha256` from the [GitHub Release](https://github.com/mmmarxdr/kanon/releases/tag/mcp-v0.4.0).
2. Verify: `sha256sum -c kanon-mcp-0.4.0.tar.gz.sha256` (Linux) or `shasum -a 256 -c kanon-mcp-0.4.0.tar.gz.sha256` (macOS).
3. Extract: `mkdir -p ~/.kanon/mcp && tar -xzf kanon-mcp-0.4.0.tar.gz -C ~/.kanon/mcp --strip-components=1`
4. Configure: `node ~/.kanon/mcp/setup/dist/index.js`

## Advanced / CI overrides

| Variable | Purpose |
|----------|---------|
| `KANON_INSTALL_BASE_URL` | Override download base URL (e.g. a local fixture for testing) |
| `KANON_INSTALL_DIR` | Override install directory (default: `~/.kanon/mcp`) |
| `KANON_INSTALL_SKIP_SETUP` | Set to `1` to skip the `node setup` invocation |
| `KANON_REPO` | Override GitHub `owner/repo` (default: `mmmarxdr/kanon`) |
| `KANON_ONBOARD_LINK` | Pass onboarding link without interactive prompt |

## Next step

After installation, restart your AI coding tool to pick up the new MCP server configuration.
