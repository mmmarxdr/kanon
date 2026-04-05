// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  displayName: string;
  configPath: (winHome?: string) => string;
  rootKey: string;
  detect: () => Promise<boolean>;
  wslDetect?: (winHome: string) => Promise<boolean>;
  skillDest: (winHome?: string) => string;
  workflowDest?: (winHome?: string) => string;
  templateSource: string;
  templateTarget: (winHome?: string) => string;
  templateMode: "marker-inject" | "file-copy";
  isWindowsNative: boolean;
}

export interface SetupOptions {
  apiUrl: string;
  apiKey: string;
  tools: ToolDefinition[];
  remove: boolean;
  wslMode: boolean;
  winHome?: string;
}

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}
