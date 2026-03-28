// ─── CLI Configuration ──────────────────────────────────────────────────────

/**
 * Resolved configuration for the CLI.
 * Values come from CLI flags first, then env vars, then defaults.
 */
export interface CliConfig {
  engramUrl: string;
  kanonApiUrl: string;
  kanonApiKey?: string;
}

/**
 * Load CLI configuration from environment variables.
 * CLI flags (passed via Commander options) take precedence and are merged
 * by the caller after calling this function.
 */
export function loadConfig(overrides?: Partial<CliConfig>): CliConfig {
  const config: CliConfig = {
    engramUrl:
      overrides?.engramUrl ??
      process.env["ENGRAM_URL"] ??
      "http://localhost:7437",
    kanonApiUrl:
      overrides?.kanonApiUrl ??
      process.env["KANON_API_URL"] ??
      "http://localhost:3000",
    kanonApiKey:
      overrides?.kanonApiKey ?? process.env["KANON_API_KEY"] ?? undefined,
  };

  return config;
}
