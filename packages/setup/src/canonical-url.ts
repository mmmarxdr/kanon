/**
 * canonicalizeApiUrl — normalize an API base URL for use as a credential key.
 *
 * Rules applied:
 *   - Scheme lowercased
 *   - Host lowercased
 *   - localhost / 127.0.0.1 / ::1 → force http (no TLS on loopback)
 *   - Default ports stripped (:443 on https, :80 on http)
 *   - Path, query, and fragment stripped (origin only)
 *   - Trailing slashes stripped
 *
 * Consumes: both @kanon/mcp credential-store and @kanon-pm/setup onboard
 * write the same key so credential lookups never drift.
 *
 * NOTE: This file is the canonical source. Packages that need it at runtime
 * (mcp, setup) receive a prebuild-copy so they stay self-contained at publish.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Return the canonical API base URL string.
 * Only origin components (scheme + host + optional port) are preserved.
 */
export function canonicalizeApiUrl(input: string): string {
  // Parse with standard URL — normalize scheme before parsing so uppercase
  // schemes like "HTTPS://" are handled correctly.
  const normalized = input.trim().replace(/^([A-Za-z]+):\/\//, (_, s: string) => `${s.toLowerCase()}://`);

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    // Not a valid URL — return input stripped of trailing slashes as fallback.
    return input.replace(/\/+$/, "");
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback = LOOPBACK_HOSTS.has(host);

  // Force http for loopback hosts; keep as-is for everything else.
  const scheme = isLoopback ? "http" : parsed.protocol.replace(/:$/, "").toLowerCase();

  // Strip default ports.
  let port = parsed.port;
  if ((scheme === "https" && port === "443") || (scheme === "http" && port === "80")) {
    port = "";
  }

  const portSuffix = port ? `:${port}` : "";
  return `${scheme}://${host}${portSuffix}`;
}
