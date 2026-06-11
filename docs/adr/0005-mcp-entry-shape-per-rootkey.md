# ADR 0005 — MCP Entry Shape Per Root Key

**Status**: Accepted

## Context

The `@kanon/setup` package writes MCP server entries to the config files of
multiple AI tools. These tools expect different JSON shapes under different
root keys:

- **Claude Code**, **Cursor**, and **Antigravity** use the `mcpServers` root
  key. Each server is stored as a named object entry:
  ```json
  {
    "mcpServers": {
      "kanon-mcp": { "command": "node", "args": ["/path/to/server.js"], "env": {} }
    }
  }
  ```

- **OpenCode** uses the `mcp` root key. Servers are still stored as named
  object entries (keyed by server name), but each entry's **value** uses an
  array-form `command` with an explicit `type` discriminator:
  ```json
  {
    "mcp": {
      "kanon-mcp": { "type": "local", "command": ["/path/to/node", "/path/to/server.js"], "environment": {} }
    }
  }
  ```

  The `type: "local"` discriminator and the `environment` key (not `env`) are
  required by OpenCode's `McpLocalConfig` schema. The `command` is an array
  (not split into `command` + `args`) which preserves paths containing spaces
  without shell escaping.

The root key selects the per-server **entry shape**, not the container shape:
both `mcp` and `mcpServers` store servers as named object entries under the
root key. `"mcp"` → array-form `command` + `type`/`environment`;
`"mcpServers"` → `command` + `args` + `env`. No additional runtime flag is
needed.

## Decision

`formatMcpEntry(rootKey, entry)` in `packages/setup/src/mcp-config.ts` is
the single source of truth for per-root-key shaping. `mergeConfig` calls it
so callers remain agnostic about which tools use which shape.

The `ToolDefinition.rootKey` field in each registry entry is the input to
`formatMcpEntry`. OpenCode's registry entry sets `rootKey: "mcp"`.

## Consequences

- Adding a new tool with a known `rootKey` (`"mcp"` or `"mcpServers"`)
  requires no changes to `formatMcpEntry` — the registry entry alone is
  sufficient.
- Adding a third entry shape requires a new branch in `formatMcpEntry` and a
  matching test in `mcp-config.test.ts`.
- Callers outside `mergeConfig` that construct entries directly must be
  aware of the per-root-key shape (e.g. `removeConfig` operates on the raw
  on-disk entry by key lookup and never needs the formatter).
