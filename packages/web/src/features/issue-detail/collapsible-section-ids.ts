/**
 * KAN-108 slice 3 — Section IDs for CollapsibleSection persistence.
 *
 * sessionStorage key pattern: `kan108:collapsed:${issueKey}:${sectionId}`
 */
export const SECTION_IDS = {
  DESIGN_RECORDS: "design-records",
  SUB_ISSUES: "sub-issues",
  DEPENDENCIES: "dependencies",
} as const;

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS];
