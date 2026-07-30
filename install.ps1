# Kanon MCP installer for native Windows.
# Run the pinned tagged copy, for example:
#   irm https://raw.githubusercontent.com/mmmarxdr/kanon/mcp-v0.10.1/install.ps1 | iex

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# release.yml stamps both values on the tag-only release commit.
$EXPECTED_SHA256 = "3394bc414a4ea0016e02a7d0712270e6adc0bf6053839caf11ad8bb9b72f7770"
$KANON_MCP_VERSION = "0.10.1"
$KanonRepo = if ($env:KANON_REPO) { $env:KANON_REPO } else { "mmmarxdr/kanon" }
if ($KanonRepo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
  throw "[kanon] invalid KANON_REPO '$KanonRepo'; expected owner/repo"
}

$DefaultBaseUrl = "https://github.com/$KanonRepo/releases/download/mcp-v$KANON_MCP_VERSION"
$BaseUrl = if ($env:KANON_INSTALL_BASE_URL) { $env:KANON_INSTALL_BASE_URL.TrimEnd('/') } else { $DefaultBaseUrl }
$InstallDir = if ($env:KANON_INSTALL_DIR) { $env:KANON_INSTALL_DIR } else { Join-Path $HOME ".kanon\mcp" }
$AssetName = "kanon-mcp-$KANON_MCP_VERSION.tar.gz"
$VersionFile = Join-Path $InstallDir "version"
$RequiredFiles = @(
  "setup\dist\index.js",
  "mcp\dist\index.js",
  "mcp\dist\wrapper-cli.js"
)
$NodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue |
  Select-Object -First 1
$NodePath = if ($NodeCommand) { $NodeCommand.Source } else { $null }
$SystemTar = Join-Path $env:SystemRoot "System32\tar.exe"
$TarPath = if (Test-Path $SystemTar -PathType Leaf) { $SystemTar } else { $null }

function Write-Info([string]$Message) {
  Write-Host "[kanon] $Message"
}

function Copy-Download([string]$Url, [string]$Destination) {
  if ($Url.StartsWith("file:", [StringComparison]::OrdinalIgnoreCase)) {
    $Uri = [Uri]$Url
    if (-not $Uri.IsFile -or $Uri.IsUnc -or $Uri.LocalPath.StartsWith("\\")) {
      throw "[kanon] file: test sources must be local and non-UNC"
    }
    Copy-Item $Uri.LocalPath $Destination
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
  }
}

function Set-PrivateAcl([string]$Path, [bool]$Directory) {
  $Sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $Acl = if ($Directory) {
    [System.Security.AccessControl.DirectorySecurity]::new()
  } else {
    [System.Security.AccessControl.FileSecurity]::new()
  }
  $Acl.SetOwner($Sid)
  $Acl.SetAccessRuleProtection($true, $false)
  $Inheritance = if ($Directory) {
    [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  $Rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $Sid,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $Inheritance,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $Acl.AddAccessRule($Rule)
  Set-Acl -LiteralPath $Path -AclObject $Acl
}

function Test-CompleteInstall([string]$Root) {
  foreach ($Relative in $RequiredFiles) {
    if (-not (Test-Path (Join-Path $Root $Relative) -PathType Leaf)) { return $false }
  }
  return $true
}

function Invoke-KanonSetup([string]$SetupPath) {
  if ($env:KANON_INSTALL_SKIP_SETUP -eq "1") { return }
  if (-not $NodePath) {
    throw "[kanon] node.exe was not found; install Node.js 20 or newer"
  }

  $Link = $env:KANON_ONBOARD_LINK
  if (-not $Link -and [Environment]::UserInteractive) {
    $Link = Read-Host "Paste your kanon:// onboarding link (or press Enter for interactive setup)"
  }

  $PreviousLink = $env:KANON_ONBOARD_LINK
  try {
    if ($Link) { $env:KANON_ONBOARD_LINK = $Link }
    Write-Info "launching Kanon setup..."
    & $NodePath $SetupPath
    if ($LASTEXITCODE -ne 0) { throw "[kanon] setup exited with code $LASTEXITCODE" }
  } finally {
    $env:KANON_ONBOARD_LINK = $PreviousLink
  }
}

if (Test-Path $VersionFile -PathType Leaf) {
  $InstalledVersion = (Get-Content $VersionFile -Raw).Trim()
  if ($InstalledVersion -eq $KANON_MCP_VERSION -and (Test-CompleteInstall $InstallDir)) {
    Write-Info "already installed: kanon-mcp v$KANON_MCP_VERSION at $InstallDir"
    Invoke-KanonSetup (Join-Path $InstallDir "setup\dist\index.js")
    return
  }
  Write-Info "installation is incomplete; downloading a clean replacement"
}

if (-not $EXPECTED_SHA256) {
  if ($env:KANON_INSTALL_ALLOW_UNPINNED_LOCAL -ne "1") {
    throw "[kanon] this installer is UNPINNED. Use the tagged installer, or set KANON_INSTALL_ALLOW_UNPINNED_LOCAL=1 only for a local test fixture"
  }
  if (-not $BaseUrl.StartsWith("file:", [StringComparison]::OrdinalIgnoreCase)) {
    throw "[kanon] unpinned test installs require a local file: source"
  }
  $LocalUri = [Uri]$BaseUrl
  if (-not $LocalUri.IsFile -or $LocalUri.IsUnc -or $LocalUri.LocalPath.StartsWith("\\")) {
    throw "[kanon] unpinned file: source must be local and non-UNC"
  }
}

$WorkDir = Join-Path ([IO.Path]::GetTempPath()) ("kanon-install-" + [Guid]::NewGuid())
New-Item $WorkDir -ItemType Directory | Out-Null
$StagingDir = $null
$BackupDir = $null
$Installed = $false
try {
  Set-PrivateAcl $WorkDir $true
  $Archive = Join-Path $WorkDir $AssetName
  $Checksum = "$Archive.sha256"
  Write-Info "downloading kanon-mcp v$KANON_MCP_VERSION..."
  Copy-Download "$BaseUrl/$AssetName" $Archive
  Copy-Download "$BaseUrl/$AssetName.sha256" $Checksum

  $Expected = $EXPECTED_SHA256
  if (-not $Expected) { $Expected = ((Get-Content $Checksum -Raw) -split '\s+')[0] }
  $Actual = (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected.ToLowerInvariant()) {
    throw "[kanon] sha256 verification FAILED; nothing was installed"
  }
  Write-Info "sha256 verified."

  if (-not $TarPath) {
    throw "[kanon] tar.exe was not found"
  }

  $InstallParent = Split-Path $InstallDir -Parent
  New-Item $InstallParent -ItemType Directory -Force | Out-Null
  $StagingDir = Join-Path $InstallParent (".kanon-mcp-staging-" + [Guid]::NewGuid())
  New-Item $StagingDir -ItemType Directory | Out-Null
  Set-PrivateAcl $StagingDir $true
  & $TarPath -xzf $Archive -C $StagingDir --strip-components=1
  if ($LASTEXITCODE -ne 0) { throw "[kanon] tar extraction failed with code $LASTEXITCODE" }
  if (-not (Test-CompleteInstall $StagingDir)) {
    throw "[kanon] release archive is incomplete; required setup, MCP, or wrapper file is missing"
  }
  Set-Content -Path (Join-Path $StagingDir "version") -Value $KANON_MCP_VERSION -NoNewline

  if (Test-Path $InstallDir) {
    $BackupDir = Join-Path $InstallParent (".kanon-mcp-backup-" + [Guid]::NewGuid())
    Move-Item $InstallDir $BackupDir
  }
  try {
    Move-Item $StagingDir $InstallDir
    $StagingDir = $null
    $Installed = $true
  } catch {
    if ($BackupDir -and (Test-Path $BackupDir) -and -not (Test-Path $InstallDir)) {
      Move-Item $BackupDir $InstallDir
      $BackupDir = $null
    }
    throw
  }

  Write-Info "kanon-mcp v$KANON_MCP_VERSION installed to $InstallDir"
  Invoke-KanonSetup (Join-Path $InstallDir "setup\dist\index.js")
} finally {
  if ($StagingDir -and (Test-Path $StagingDir)) {
    Remove-Item $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($Installed -and $BackupDir -and (Test-Path $BackupDir)) {
    Remove-Item $BackupDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}
