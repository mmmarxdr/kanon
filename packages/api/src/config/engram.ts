import { EngramClient } from "@kanon/bridge";
import { env } from "./env.js";

const CONTEXT_TIMEOUT_MS = 2_000;

/**
 * Lazy singleton EngramClient for issue context queries.
 * Uses a shorter timeout (2s) than the default (5s) to avoid
 * blocking the API response when Engram is slow or unreachable.
 *
 * Returns `null` if ENGRAM_URL is not configured.
 */
let _client: EngramClient | null | undefined;

export function getEngramClient(): EngramClient | null {
  if (_client !== undefined) return _client;

  const url = env.ENGRAM_URL;
  if (!url) {
    _client = null;
    return null;
  }

  _client = new EngramClient({
    baseUrl: url,
    apiKey: env.ENGRAM_API_KEY,
    timeoutMs: CONTEXT_TIMEOUT_MS,
  });

  return _client;
}
