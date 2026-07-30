# Delta for cursor-full-fidelity

## ADDED Requirements

### Requirement: Complete Onboarding

The invite onboarding path MUST install every supported Cursor product surface
that explicit setup installs.

#### Scenario: Cursor onboarding succeeds

- GIVEN a valid Kanon invite and detected Cursor installation
- WHEN onboarding completes
- THEN the current MCP runtime, Kanon skills, and Cursor agent are installed
- AND no second setup command is required

### Requirement: WSL Dual Target

WSL setup MUST treat Windows Cursor IDE and Cursor CLI inside WSL as separate
runtime targets.

#### Scenario: Both Cursor surfaces exist

- GIVEN Cursor IDE uses the Windows home and Cursor CLI uses the WSL home
- WHEN Kanon setup runs from WSL
- THEN each home receives a valid MCP entry for its execution environment
- AND both resolve the same packaged Kanon version and tool set

#### Scenario: Windows Cursor home is not initialized

- GIVEN WSL resolves a Windows home without a `.cursor` directory
- WHEN setup configures Cursor
- THEN only the local WSL CLI target is created

#### Scenario: Workspace identity exists in one target

- GIVEN either WSL Cursor target contains `KANON_WORKSPACE_ID`
- WHEN setup upgrades wrapper entries
- THEN both targets receive that workspace identity

### Requirement: Native Windows Release

Native Windows MUST install from the same pinned GitHub release tarball as
Unix/WSL and MUST protect refresh credentials from other local users.

#### Scenario: PowerShell onboarding succeeds

- GIVEN a tagged release with a stamped PowerShell installer
- WHEN a Windows user runs it with a valid onboarding link
- THEN the installer verifies the embedded SHA-256 before extraction
- AND work/staging directories are protected before download/extraction
- AND setup, MCP, and wrapper files are validated before replacement
- AND an existing install is restored if replacement fails
- AND packaged setup installs MCP, skills, and the Cursor agent in one pass
- AND the refresh token file grants access only to the current user

#### Scenario: Unpinned local fixture

- GIVEN the main-branch installer has no embedded hash
- WHEN a test enables the unpinned local seam
- THEN only a local non-UNC `file:` source is accepted

#### Scenario: Windows release gate

- WHEN release publication starts
- THEN a required `windows-latest` job executes install, idempotency, and repair
- AND another run for the same version cannot overlap
- AND existing tags or releases fail before cleanup is armed
- AND failure cleanup removes only artifacts created by the current run
- AND release creation verifies that the pushed tag already exists

### Requirement: Safe Configuration

Setup MUST preserve unrelated user configuration and MUST fail closed on
malformed input.

#### Scenario: Existing config is invalid

- GIVEN an existing malformed `mcp.json`
- WHEN setup attempts to install Kanon
- THEN setup reports the parse error
- AND the original file remains byte-for-byte unchanged

#### Scenario: Legacy native Windows Cursor config

- GIVEN `%APPDATA%/Cursor/User/mcp.json` contains Kanon and unrelated servers
- WHEN setup installs or removes Cursor
- THEN only `mcpServers.kanon-mcp` is removed from the legacy file
- AND only the exact legacy `~/.cursor/rules/kanon.mdc` is deleted

### Requirement: Cursor Agent Contract

The installed Cursor agent MUST use current Cursor frontmatter and MUST NOT
claim unsupported per-agent MCP restrictions.

#### Scenario: Agent installation

- WHEN setup installs the `kanon` Cursor agent
- THEN its header contains only documented Cursor fields
- AND its body uses current Kanon tool names and schemas
- AND Claude-only `allowed-tools` is absent

### Requirement: Native Tool Discovery

Kanon MUST rely on Cursor's dynamic MCP tool discovery rather than injecting a
second host-specific deferral mechanism.

#### Scenario: Cursor starts a Kanon session

- WHEN Cursor loads the Kanon MCP server
- THEN all tool names are discoverable
- AND Cursor may retrieve full schemas on demand
- AND Kanon does not require a separate deferred-tool registry for Cursor

### Requirement: Permission Safety

Setup MUST NOT silently autoapprove every Kanon MCP operation.

#### Scenario: Existing deny policy

- GIVEN a user has Cursor MCP deny rules
- WHEN setup installs or updates Kanon
- THEN deny rules remain unchanged
- AND no broad `kanon_*` allow rule is added

### Requirement: Work Lifecycle Correctness

Cursor events MUST NOT be treated as exact work boundaries unless an idempotent
issue lease is owned by that conversation.

#### Scenario: Agent loop stops but conversation continues

- WHEN Cursor emits `stop`
- THEN Kanon does not stop the work session

#### Scenario: Cursor crashes

- GIVEN a work lease emitted heartbeats
- WHEN no `sessionEnd` event arrives
- THEN Kanon calculates effective work only through the last heartbeat
- AND server TTL expires the stale session

#### Scenario: Two conversations use one issue

- GIVEN two Cursor conversations reference the same issue
- WHEN one conversation ends
- THEN it cannot stop a lease owned by the other conversation

### Requirement: Cloud Isolation

Local Cursor configuration MUST NOT be presented as Cloud Agent support.

#### Scenario: Cloud support is documented

- WHEN Kanon advertises Cloud Agent support
- THEN a separately verified HTTP MCP and Cloud lifecycle path exists
- AND no local WSL path or user hook is required in the Cloud VM
