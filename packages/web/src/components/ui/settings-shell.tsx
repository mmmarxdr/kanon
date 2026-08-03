import type { ReactNode } from "react";
import { TabList, type TabDef } from "@/components/ui/primitives";

export type SettingsShellMaxWidth = "default" | "wide";

const MAX_WIDTH: Record<SettingsShellMaxWidth, string> = {
  default: "min(1100px, 100%)",
  wide: "min(1200px, 100%)",
};

export interface SettingsShellProps {
  title: string;
  eyebrow?: string;
  /** When set, renders TabList in header; route owns activeKey state */
  tabs?: {
    idPrefix: string;
    tabs: TabDef<string>[];
    activeKey: string;
    onChange: (key: string) => void;
  };
  maxWidth?: SettingsShellMaxWidth;
  /** Required when tabs set — preserves KAN-212 a11y pairing */
  tabPanel?: { id: string; ariaLabelledBy: string };
  children: ReactNode;
}

export function SettingsShell({
  title,
  eyebrow,
  tabs,
  maxWidth = "default",
  tabPanel,
  children,
}: SettingsShellProps) {
  const innerColumnStyle = {
    maxWidth: MAX_WIDTH[maxWidth],
    width: "100%",
    display: "flex",
    flexDirection: "column" as const,
    gap: 24,
  };

  const bodyContent = tabPanel ? (
    <div
      role="tabpanel"
      id={tabPanel.id}
      aria-labelledby={tabPanel.ariaLabelledBy}
      style={innerColumnStyle}
    >
      {children}
    </div>
  ) : (
    <div style={innerColumnStyle}>{children}</div>
  );

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          padding: "20px 28px 0",
          borderBottom: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            marginBottom: tabs ? 10 : 12,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h1>
          {eyebrow && (
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-3)" }}
            >
              {eyebrow}
            </span>
          )}
        </div>
        {tabs && (
          <TabList
            idPrefix={tabs.idPrefix}
            tabs={tabs.tabs}
            activeKey={tabs.activeKey}
            onChange={tabs.onChange}
          />
        )}
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 28px 28px",
        }}
      >
        {bodyContent}
      </div>
    </div>
  );
}
