import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";

export interface SettingsListColumn {
  key: string;
  label: ReactNode;
  className?: string;
  hideBelow?: "sm" | "md";
}

export interface SettingsListProps {
  columns: SettingsListColumn[];
  /** Grid used from the `sm` breakpoint up. */
  gridTemplateColumns: string;
  /**
   * Grid used below `sm`. Must only account for columns that remain visible
   * after `hideBelow: "sm"` (display:none does not remove CSS grid tracks).
   * Defaults to the desktop grid when omitted.
   */
  mobileGridTemplateColumns?: string;
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

/** Desktop: member | email | joined | role | actions */
export const WORKSPACE_MEMBERS_GRID =
  "minmax(0,2fr) minmax(0,1.5fr) minmax(0,1fr) auto auto";
/** Mobile: member (email under name) | role | actions */
export const WORKSPACE_MEMBERS_GRID_MOBILE = "minmax(0,1fr) auto auto";

/** Desktop: label | status | role | email | uses | expires | createdBy | actions */
export const INVITES_GRID =
  "minmax(0,1.5fr) auto auto minmax(0,1.2fr) auto auto minmax(0,1fr) auto";
/** Mobile: label (meta stacked) | actions */
export const INVITES_GRID_MOBILE = "minmax(0,1fr) auto";

/** Desktop: member | email | role | actions */
export const PROJECT_MEMBERS_GRID = "minmax(0,2fr) minmax(0,1.5fr) auto auto";
/** Mobile: member (email under name) | role | actions */
export const PROJECT_MEMBERS_GRID_MOBILE = "minmax(0,1fr) auto auto";

export const NOTIFICATIONS_GRID = "auto minmax(0,1fr)";

const HIDE_BELOW_CLASS: Record<"sm" | "md", string> = {
  sm: "hidden sm:block",
  md: "hidden md:block",
};

interface SettingsListContextValue {
  gridTemplateColumns: string;
  mobileGridTemplateColumns: string;
  columns: SettingsListColumn[];
}

const SettingsListContext = createContext<SettingsListContextValue | null>(null);

function columnCellClass(hideBelow?: "sm" | "md", extra?: string): string {
  const parts: string[] = ["min-w-0"];
  if (hideBelow) parts.push(HIDE_BELOW_CLASS[hideBelow]);
  if (extra) parts.push(extra);
  return parts.join(" ");
}

function gridVarStyle(
  gridTemplateColumns: string,
  mobileGridTemplateColumns: string,
  extra?: CSSProperties,
): CSSProperties {
  return {
    ...extra,
    ["--settings-list-cols" as string]: gridTemplateColumns,
    ["--settings-list-cols-mobile" as string]: mobileGridTemplateColumns,
  };
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
    // Status/role/uses/email stack under the label below `sm`.
    { key: "status", label: t("listColStatus"), hideBelow: "sm" },
    { key: "role", label: t("listColRole"), hideBelow: "sm" },
    { key: "email", label: t("listColEmail"), hideBelow: "sm" },
    { key: "uses", label: t("listColUses"), hideBelow: "sm" },
    { key: "expires", label: t("listColExpires"), hideBelow: "sm" },
    { key: "createdBy", label: t("listColCreatedBy"), hideBelow: "sm" },
    { key: "actions", label: t("listColActions"), className: "text-right" },
  ];
}

export function SettingsList({
  columns,
  gridTemplateColumns,
  mobileGridTemplateColumns,
  children,
  showHeader = true,
  "data-testid": testId,
}: SettingsListProps) {
  const mobileCols = mobileGridTemplateColumns ?? gridTemplateColumns;

  const ctx: SettingsListContextValue = {
    gridTemplateColumns,
    mobileGridTemplateColumns: mobileCols,
    columns,
  };

  return (
    <SettingsListContext.Provider value={ctx}>
      <div data-testid={testId} className="w-full min-w-0 max-w-full">
        {showHeader && (
          <div
            role="row"
            data-testid="settings-list-header"
            data-settings-list-grid
            className="settings-list-grid border-b border-border pb-2 mb-1"
            style={gridVarStyle(gridTemplateColumns, mobileCols)}
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

  return (
    <div
      role="row"
      aria-label={label}
      data-testid={testId}
      data-settings-list-grid
      className={`settings-list-grid settings-list-row border-b border-border/50 last:border-b-0 py-1 hover:bg-secondary/30 transition-colors ${className ?? ""}`}
      style={gridVarStyle(ctx.gridTemplateColumns, ctx.mobileGridTemplateColumns, {
        minHeight: "48px",
      })}
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
