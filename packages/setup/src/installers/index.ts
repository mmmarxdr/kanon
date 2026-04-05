// ─── Installers ────────────────────────────────────────────────────────────────
// Re-exports from individual installer modules.

export { mergeConfig, removeConfig, buildMcpEntry, type McpResolution } from "../mcp-config.js";
export { installSkills, removeSkills } from "../skills.js";
export { installTemplate, removeTemplate } from "../templates.js";
export { installWorkflows, removeWorkflows } from "../workflows.js";
