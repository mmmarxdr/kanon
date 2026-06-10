// ─── CLI Configuration ──────────────────────────────────────────────────────

/**
 * Resolved configuration for the CLI.
 * Values come from CLI flags first, then env vars, then defaults.
 */
export interface CliConfig {
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
    kanonApiUrl:
      overrides?.kanonApiUrl ??
      process.env["KANON_API_URL"] ??
      "http://localhost:3000",
    kanonApiKey:
      overrides?.kanonApiKey ?? process.env["KANON_API_KEY"] ?? undefined,
  };

  return config;
}
