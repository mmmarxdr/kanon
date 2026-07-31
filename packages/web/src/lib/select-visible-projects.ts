export const PROJECTS_SOFT_LIMIT = 8;

export interface SoftProject {
  id: string;
  key: string;
  name: string;
}

export interface SelectVisibleProjectsInput {
  projects: SoftProject[];
  activeKey: string;
  softLimit?: number;
  expanded: boolean;
}

export interface SelectVisibleProjectsResult {
  visible: SoftProject[];
  hiddenCount: number;
  total: number;
}

function sortProjects(
  projects: SoftProject[],
  activeKey: string,
): SoftProject[] {
  const copy = [...projects];
  if (!activeKey) {
    return copy.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }
  const active: SoftProject[] = [];
  const rest: SoftProject[] = [];
  for (const p of copy) {
    if (p.key === activeKey) active.push(p);
    else rest.push(p);
  }
  rest.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return [...active, ...rest];
}

export function selectVisibleProjects(
  input: SelectVisibleProjectsInput,
): SelectVisibleProjectsResult {
  const softLimit = input.softLimit ?? PROJECTS_SOFT_LIMIT;
  const total = input.projects.length;
  const sorted = sortProjects(input.projects, input.activeKey);

  if (input.expanded || total <= softLimit) {
    return { visible: sorted, hiddenCount: 0, total };
  }

  let visible = sorted.slice(0, softLimit);
  const { activeKey } = input;

  if (activeKey) {
    const active = sorted.find((p) => p.key === activeKey);
    if (active && !visible.some((p) => p.key === activeKey)) {
      visible = [...visible.slice(0, softLimit - 1), active];
    }
  }

  return {
    visible,
    hiddenCount: total - visible.length,
    total,
  };
}
