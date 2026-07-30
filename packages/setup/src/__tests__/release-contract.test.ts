import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

describe("release installer contract", () => {
  const mcpVersion = JSON.parse(read("packages/mcp/package.json")).version as string;
  const setupVersion = JSON.parse(read("packages/setup/package.json")).version as string;
  const sh = read("install.sh");
  const ps1 = read("install.ps1");
  const workflow = read(".github/workflows/release.yml");
  const tarball = read("scripts/build-release-tarball.sh");

  it("pins both main-branch scripts to the current package version", () => {
    expect(setupVersion).toBe(mcpVersion);
    expect(sh).toContain(`KANON_MCP_VERSION="${mcpVersion}"`);
    expect(ps1).toContain(`$KANON_MCP_VERSION = "${mcpVersion}"`);
    expect(sh).toContain(`kanon-mcp-${"${KANON_MCP_VERSION}"}.tar.gz`);
    expect(ps1).toContain('"kanon-mcp-$KANON_MCP_VERSION.tar.gz"');
  });

  it("PowerShell verifies SHA-256 before extracting or writing the version", () => {
    const protectWork = ps1.indexOf("Set-PrivateAcl $WorkDir $true");
    const download = ps1.indexOf("Copy-Download \"$BaseUrl/$AssetName\"");
    const hash = ps1.indexOf("Get-FileHash -Algorithm SHA256");
    const extract = ps1.indexOf("& $TarPath -xzf");
    const validate = ps1.indexOf("Test-CompleteInstall $StagingDir");
    const marker = ps1.indexOf("Set-Content -Path (Join-Path $StagingDir \"version\")");
    expect(protectWork).toBeGreaterThan(0);
    expect(download).toBeGreaterThan(protectWork);
    expect(hash).toBeGreaterThan(0);
    expect(extract).toBeGreaterThan(hash);
    expect(validate).toBeGreaterThan(extract);
    expect(marker).toBeGreaterThan(extract);
    expect(ps1).toContain(".kanon-mcp-backup-");
    expect(ps1).toContain("Move-Item $BackupDir $InstallDir");
    for (const required of [
      "setup\\dist\\index.js",
      "mcp\\dist\\index.js",
      "mcp\\dist\\wrapper-cli.js",
    ]) {
      expect(ps1).toContain(required);
    }
    expect(ps1).toContain("KANON_ONBOARD_LINK");
    expect(ps1).toContain("Read-Host");
    expect(ps1).toContain("KANON_INSTALL_ALLOW_UNPINNED_LOCAL");
    expect(ps1).toContain("IsUnc");
    expect(ps1.match(/Get-Command node\.exe/g)).toHaveLength(1);
    expect(ps1).toContain("$NodePath = if ($NodeCommand) { $NodeCommand.Source }");
    expect(ps1).toContain("& $NodePath $SetupPath");
    expect(ps1).not.toContain("Get-Command tar.exe");
    expect(ps1).toContain('Join-Path $env:SystemRoot "System32\\tar.exe"');
    expect(ps1).toContain("Test-Path $SystemTar -PathType Leaf");
    expect(ps1).toContain("& $TarPath -xzf");
  });

  it("Unix idempotency requires the complete runtime", () => {
    for (const required of [
      "$INSTALL_DIR/setup/dist/index.js",
      "$INSTALL_DIR/mcp/dist/index.js",
      "$INSTALL_DIR/mcp/dist/wrapper-cli.js",
    ]) {
      expect(sh).toContain(required);
    }
    expect(sh).toContain("if complete_install; then");
  });

  it("release tests/builds both packages and stamps both installers", () => {
    expect(workflow).toContain("pnpm --filter @kanon/mcp test");
    expect(workflow).toContain("pnpm --filter @kanon-pm/setup test");
    expect(workflow).toContain("pnpm --filter @kanon/mcp build");
    expect(workflow).toContain("pnpm --filter @kanon-pm/setup build");
    expect(workflow).toContain("git add install.sh install.ps1");
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("needs: windows-installer");
    expect(workflow).toContain("& .\\install.ps1");
    expect(workflow).toContain("missing wrapper did not force a clean reinstall");
    expect(workflow).toContain("missing MCP did not force a clean reinstall");
    expect(workflow).toContain("trap 'cleanup $?' ERR");
    expect(workflow).toContain("trap 'cleanup 130' INT");
    expect(workflow).toContain("trap 'cleanup 143' TERM");
    expect(workflow).toContain("trap 'cleanup $?' EXIT");
    expect(workflow).toContain("group: release-mcp-v${{ inputs.version }}");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("git ls-remote --exit-code --tags origin");
    expect(workflow).toContain("release(tagName: $tag)");
    expect(workflow).toContain('if [ "$release_created" = true ]');
    expect(workflow).toContain('if [ "$tag_pushed" = true ]');
    expect(workflow).toContain("gh release create \"$TAG\"");
    expect(workflow).toContain("--verify-tag");
    expect(workflow).toContain("gh release upload \"$TAG\"");
    expect(workflow.indexOf("git ls-remote --exit-code --tags origin")).toBeLessThan(
      workflow.indexOf("cleanup()"),
    );
    expect(workflow).not.toContain("- name: Push tag");
    expect(workflow).toContain("MCP_VERSION");
    expect(workflow).toContain("SETUP_VERSION");
  });

  it("tarball build rejects version drift and compares runtime tool lists", () => {
    expect(tarball).toContain("must match MCP");
    expect(tarball).toContain("packages/mcp/dist/index.js");
    expect(tarball).toContain("SOURCE_TOOLS");
    expect(tarball).toContain("PACKAGED_TOOLS");
    expect(tarball).not.toMatch(/\b44 tools\b/);
  });
});
