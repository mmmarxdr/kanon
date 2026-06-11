/**
 * Token credential-scope helpers (KAN-19 / KAN-79).
 *
 * A scoped access token carries an `allowedProjectIds` claim. The discriminator
 * is length: a NON-EMPTY array means the token is restricted to those projects;
 * an absent or EMPTY array means the token is unscoped (full workspace access,
 * the backward-compatible default for legacy/cookie tokens).
 */

/**
 * Normalize the `allowedProjectIds` claim into a filter value.
 *
 * @returns the project-id allow-list when the token is SCOPED, or `null` when
 *   UNSCOPED — so callers can spread `...(ids ? { id: { in: ids } } : {})`.
 */
export function scopedProjectIds(allowedProjectIds?: string[] | null): string[] | null {
  return allowedProjectIds && allowedProjectIds.length > 0 ? allowedProjectIds : null;
}
