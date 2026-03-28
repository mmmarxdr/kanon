/**
 * Converts a groupKey like "sdd/auth-model" into a human-readable title "Auth Model".
 * Takes the last segment after '/', replaces dashes/underscores with spaces,
 * and title-cases each word.
 */
export function humanizeGroupKey(groupKey: string): string {
  const parts = groupKey.split("/");
  const name = parts[parts.length - 1] ?? groupKey;
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
