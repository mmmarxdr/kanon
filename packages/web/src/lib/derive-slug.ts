/**
 * Derives a valid workspace slug from a human-readable name.
 *
 * Rules (matching API constraint: /^[a-z0-9]+(?:-[a-z0-9]+)*$/):
 *   - Lowercase everything
 *   - Replace any run of non-alphanumeric characters with a single hyphen
 *   - Strip leading and trailing hyphens
 */
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
