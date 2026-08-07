---
name: kanon-release
description: "Publish a Kanon MCP/setup release or verify application image delivery. Trigger: release, bump MCP version, publish tag, ship containers."
license: Apache-2.0
metadata:
  author: kanon-maintainers
  version: "1.0"
---

# Kanon Release

## Choose the Release Path

- Application shipping: merge to `main`, require green CI, then let
  `.github/workflows/publish-images.yml` publish GHCR images and trigger Dokploy.
- MCP/setup release: use `.github/workflows/release.yml` and the
  `mcp-v<version>` tag.
- Never use obsolete AWS, SSM, or manual infrastructure runbooks.

## MCP/Setup Release

1. Confirm the version does not already exist as a tag or GitHub release.
2. Choose semver from user impact. Features normally increment minor; fixes
   increment patch.
3. Keep `packages/mcp/package.json` and `packages/setup/package.json` versions
   identical.
4. Update changelog, pinned installer references, onboarding skill text, and
   release documentation. Keep `EXPECTED_SHA256` empty on `main`.
5. Run:

```bash
pnpm --filter @kanon/mcp test
pnpm --filter @kanon-pm/setup test
bash scripts/build-release-tarball.sh <version>
```

6. Verify bundle boot, tool parity, packaged onboarding, tarball checksum, and
   version metadata.
7. Publish the version bump through a focused PR.
8. From updated `main`, dispatch:

```bash
gh workflow run release.yml --ref main -f version=<version>
```

9. Watch the workflow and verify the final release has both tarball and checksum
   assets. Run the tagged remote installer into a temporary directory with setup
   disabled to prove download and embedded-hash verification.

## Trust Boundary

The tagged installers are the trust root. The release process creates a detached,
tag-only commit containing the tarball SHA-256; `main` remains unpinned and must
refuse network installation. Never publish a same-origin checksum as a substitute
for the embedded hash.

If GitHub Actions executes zero steps during a documented outage, do not improvise
a weaker release. Manual publication requires explicit maintainer authorization
and must reproduce tag/release absence checks, detached hash stamping, rollback
traps, asset upload, and a remote installer smoke test.

## Output

Return version, main commit, tag commit, release URL, asset names, SHA-256,
verification results, and any pending image/deployment workflow.
