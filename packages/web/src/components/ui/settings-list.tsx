import { createContext, useContext, type ReactNode } from "react";

export interface SettingsListColumn {
  key: string;
  label: string;
  className?: string;
  hideBelow?: "sm" | "md";
}

export interface SettingsListProps {
  columns: SettingsListColumn[];
  gridTemplateColumns: string;
  children: ReactNode;
  showHeader?: boolean;
  "data-testid"?: string;
}

export interface SettingsListRowProps {
  columns: ReactNode[];
  className?: string;
  /** Accessible label for the row (e.g. primary cell text). */
  label?: string;
  "data-testid"?: string;
}

export const WORKSPACE_MEMBERS_GRID = "2fr 1.5fr 1fr auto auto";
export const INVITES_GRID = "1.5fr auto auto 1.5fr auto auto auto auto";
export const PROJECT_MEMBERS_GRID = "2fr 1.5fr auto auto";
export const NOTIFICATIONS_GRID = "auto 1fr";

const HIDE_BELOW_CLASS: Record<"sm" | "md", string> = {
  sm: "hidden sm:block",
  md: "hidden md:block",
};

interface SettingsListContextValue {
  gridTemplateColumns: string;
  columns: SettingsListColumn[];
}

const SettingsListContext = createContext<SettingsListContextValue | null>(null);

function columnCellClass(hideBelow?: "sm" | "md", extra?: string): string {
  const parts: string[] = ["min-w-0"];
  if (hideBelow) parts.push(HIDE_BELOW_CLASS[hideBelow]);
  if (extra) parts.push(extra);
  return parts.join(" ");
}

export function workspaceMembersColumns(
  t: (key: string) => string,
): SettingsListColumn[] {
  return [
    { key: "member", label: t("listColMember") },
    { key: "email", label: t("listColEmail"), hideBelow: "sm" },
    { key: "joined", label: t("listColJoined"), hideBelow: "sm" },
    { key: "role", label: t("listColRole") },
    { key: "actions", label: t("listColActions"), className: "text-right" },
  ];
}

export function projectMembersColumns(
  t: (key: string) => string,
): SettingsListColumn[] {
  return [
    { key: "member", label: t("listColMember") },
    { key: "email", label: t("listColEmail"), hideBelow: "sm" },
    { key: "role", label: t("listColRole") },
    { key: "actions", label: t("listColActions"), className: "text-right" },
  ];
}

export function invitesColumns(t: (key: string) => string): SettingsListColumn[] {
  return [
    { key: "label", label: t("listColLabel") },
    { key: "status", label: t("listColStatus") },
    { key: "role", label: t("listColRole") },
    { key: "email", label: t("listColEmail"), hideBelow: "sm" },
    { key: "uses", label: t("listColUses") },
    { key: "expires", label: t("listColExpires"), hideBelow: "sm" },
    { key: "createdBy", label: t("listColCreatedBy"), hideBelow: "sm" },
    { key: "actions", label: t("listColActions"), className: "text-right" },
  ];
}

export function SettingsList({
  columns,
  gridTemplateColumns,
  children,
  showHeader = true,
  "data-testid": testId,
}: SettingsListProps) {
  const gridStyle = {
    display: "grid",
    gridTemplateColumns,
    columnGap: "12px",
    alignItems: "center",
  } as const;

  const ctx: SettingsListContextValue = {
    gridTemplateColumns,
    columns,
  };

  return (
    <SettingsListContext.Provider value={ctx}>
      <div data-testid={testId} className="w-full max-w-full overflow-x-hidden">
        {showHeader && (
          <div
            role="row"
            data-testid="settings-list-header"
            style={gridStyle}
            className="border-b border-border pb-2 mb-1"
          >
            {columns.map((col) => (
              <div
                key={col.key}
                role="columnheader"
                data-column-key={col.key}
                data-hide-below={col.hideBelow ?? undefined}
                className={`text-xs uppercase tracking-wide text-muted-foreground ${columnCellClass(col.hideBelow, col.className)}`}
              >
                {col.label}
              </div>
            ))}
          </div>
        )}
        <div role="rowgroup">{children}</div>
      </div>
    </SettingsListContext.Provider>
  );
}

export function SettingsListRow({
  columns,
  className,
  label,
  "data-testid": testId,
}: SettingsListRowProps) {
  const ctx = useContext(SettingsListContext);
  if (!ctx) {
    throw new Error("SettingsListRow must be rendered inside SettingsList");
  }
  if (columns.length !== ctx.columns.length) {
    throw new Error(
      `SettingsListRow expected ${ctx.columns.length} columns, got ${columns.length}`,
    );
  }

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: ctx.gridTemplateColumns,
    columnGap: "12px",
    alignItems: "center",
    minHeight: "48px",
  } as const;

  return (
    <div
      role="row"
      aria-label={label}
      data-testid={testId}
      style={gridStyle}
      className={`border-b border-border/50 last:border-b-0 py-1 hover:bg-secondary/30 transition-colors ${className ?? ""}`}
    >
      {columns.map((cell, index) => {
        const col = ctx.columns[index]!;
        return (
          <div key={col.key} className={columnCellClass(col.hideBelow, col.className)}>
            {cell}
          </div>
        );
      })}
    </div>
  );
}
