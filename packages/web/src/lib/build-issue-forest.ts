import type { Issue } from "@kanon/shared";

export const ISSUE_FOREST_MAX_DEPTH = 8;

/** Omit API `children` so nested nodes are typed as IssueNode, not Issue[]. */
export type IssueNode = Omit<Issue, "children"> & {
  children: IssueNode[];
  descendantCount: number;
  depth: number;
};

export type IssueForest = {
  roots: IssueNode[];
  byId: Map<string, IssueNode>;
  total: number;
  rootCount: number;
};

function wouldCreateCycle(
  byId: Map<string, IssueNode>,
  childId: string,
  parentId: string,
): boolean {
  let current: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === childId) return true;
    // Ancestor chain hit a separate cycle (not involving this child) — safe to attach.
    if (seen.has(current)) return false;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

function computeDescendantCounts(node: IssueNode): number {
  let count = 0;
  for (const child of node.children) {
    count += 1 + computeDescendantCounts(child);
  }
  node.descendantCount = count;
  return count;
}

function assignDepthAndCap(
  node: IssueNode,
  depth: number,
  maxDepth: number,
  promoted: IssueNode[],
): void {
  node.depth = depth;
  if (depth >= maxDepth && node.children.length > 0) {
    for (const child of node.children) {
      promoted.push(child);
      assignDepthAndCap(child, 0, maxDepth, promoted);
    }
    node.children = [];
    return;
  }
  for (const child of [...node.children]) {
    assignDepthAndCap(child, depth + 1, maxDepth, promoted);
  }
}

function sortByKey(nodes: IssueNode[]): void {
  nodes.sort((a, b) => a.key.localeCompare(b.key));
  for (const n of nodes) sortByKey(n.children);
}

/**
 * Build a defensive parent/child forest from a flat issue list.
 * Orphans and cycle participants become roots. Depth beyond maxDepth
 * promotes the overflowing children to roots.
 */
export function buildIssueForest(
  issues: Issue[],
  opts?: { maxDepth?: number },
): IssueForest {
  const maxDepth = opts?.maxDepth ?? ISSUE_FOREST_MAX_DEPTH;
  const byId = new Map<string, IssueNode>();

  for (const issue of issues) {
    byId.set(issue.id, {
      ...issue,
      children: [],
      descendantCount: 0,
      depth: 0,
    });
  }

  const childIds = new Set<string>();

  for (const node of byId.values()) {
    const parentId = node.parentId;
    if (!parentId || parentId === node.id) continue;
    const parent = byId.get(parentId);
    if (!parent) continue;
    if (wouldCreateCycle(byId, node.id, parentId)) continue;
    parent.children.push(node);
    childIds.add(node.id);
  }

  const roots: IssueNode[] = [];
  for (const node of byId.values()) {
    if (!childIds.has(node.id)) roots.push(node);
  }

  const promoted: IssueNode[] = [];
  for (const root of roots) {
    assignDepthAndCap(root, 0, maxDepth, promoted);
  }

  // Promoted nodes were detached from parents; ensure they appear as roots.
  const rootIds = new Set(roots.map((r) => r.id));
  for (const node of promoted) {
    if (!rootIds.has(node.id)) {
      roots.push(node);
      rootIds.add(node.id);
    }
  }

  sortByKey(roots);

  for (const root of roots) {
    computeDescendantCounts(root);
  }

  return {
    roots,
    byId,
    total: issues.length,
    rootCount: roots.length,
  };
}
