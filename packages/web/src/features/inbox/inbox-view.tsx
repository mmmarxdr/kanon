import { useNavigate } from "@tanstack/react-router";
import {
  useApplyProposalMutation,
  useDashboardQuery,
  useDismissProposalMutation,
} from "./use-dashboard-query";
import { ProposalRow } from "./proposal-row";
import { CurrentCycleCard } from "./current-cycle-card";
import { MentionRow } from "./mention-row";
import { NotificationRow } from "./notification-row";
import { ProjectPickerPopover } from "./project-picker-popover";
import { useActiveWorkspaceId } from "@/hooks/use-workspace-query";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { useAuthStore } from "@/stores/auth-store";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { Icon } from "@/components/ui/icons";
import { Avatar, Kbd, StatePip, TypeGlyph, avatarInitials } from "@/components/ui/primitives";
import { useNotificationsQuery } from "./use-notifications-query";
import {
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} from "./use-notification-mutations";

import type { Issue } from "@/types/issue";
import type { McpProposal } from "@/types/proposal";
import type { ActiveAgentSession } from "./use-dashboard-query";

export function InboxView() {
  const workspaceId = useActiveWorkspaceId();
  const { data, isLoading } = useDashboardQuery(workspaceId ?? null);
  const { data: projects } = useProjectsQuery(workspaceId ?? undefined);
  const apply = useApplyProposalMutation(workspaceId ?? null, "inbox");
  const dismiss = useDismissProposalMutation(workspaceId ?? null, "inbox");
  const user = useAuthStore((s) => s.user);
  const openPalette = useCommandPaletteStore((s) => s.open);
  const navigate = useNavigate();

  const activeProjects = projects ?? [];

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const greeting = greetingFor(user?.displayName ?? user?.email ?? "");

  const counts = data?.counts ?? {
    openIssues: 0,
    inProgress: 0,
    awaitingReview: 0,
    activeAgents: 0,
  };
  const assigned = (data?.assigned ?? []) as Issue[];
  const proposals = (data?.proposals ?? []) as McpProposal[];
  const agents = (data?.agents ?? []) as ActiveAgentSession[];

  const { data: notifications } = useNotificationsQuery(workspaceId ?? null);
  const markRead = useMarkNotificationReadMutation(workspaceId ?? "");
  const markAllRead = useMarkAllNotificationsReadMutation(workspaceId ?? "");
  const notificationList = notifications ?? [];
  const unreadCount = notificationList.filter((n) => !n.read).length;

  function openIssue(issue: Issue) {
    void navigate({
      to: "/issue/$key",
      params: { key: issue.key },
      search: { from: "inbox" },
    });
  }

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 28px 14px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10.5,
              color: "var(--ink-4)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Today · {today}
          </div>
          <h1
            style={{
              margin: "6px 0 0",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {greeting}
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--ink-2)",
            }}
          >
            {counts.activeAgents} agent
            {counts.activeAgents === 1 ? "" : "s"} working ·{" "}
            {assigned.length} issue{assigned.length === 1 ? "" : "s"} assigned
            to you
          </p>
        </div>

        {/* Stat strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <Stat n={counts.openIssues} label="Open issues" />
          <Stat n={counts.inProgress} label="In progress" tone="accent" />
          <Stat n={counts.awaitingReview} label="Awaiting review" />
          <Stat n={counts.activeAgents} label="Active agents" tone="ai" />
        </div>

        {/* Assigned to you */}
        <Section title="Assigned to you" hint={isLoading ? "loading…" : undefined}>
          {assigned.length === 0 ? (
            <EmptyHint>You're all caught up.</EmptyHint>
          ) : (
            assigned.map((issue) => (
              <InboxRow
                key={issue.key}
                issue={issue}
                onOpen={() => openIssue(issue)}
              />
            ))
          )}
        </Section>

        {/* MCP proposals */}
        <Section
          title="MCP proposals"
          hint={
            proposals.length > 0
              ? `${proposals.length} pending`
              : "generated by Claude · MCP"
          }
        >
          {proposals.length === 0 ? (
            <EmptyHint>
              No proposals yet. Agents push suggestions here as they propose
              changes.
            </EmptyHint>
          ) : (
            proposals.map((p) => (
              <ProposalRow
                key={p.id}
                proposal={p}
                onApply={(id) => apply.mutate(id)}
                onDismiss={(id) => dismiss.mutate(id)}
                isPending={apply.isPending || dismiss.isPending}
              />
            ))
          )}
        </Section>

        {/* Mentions */}
        <Section
          title="Mentions"
          hint={
            (data?.mentions?.length ?? 0) > 0
              ? `${data?.mentions?.length}`
              : undefined
          }
        >
          {(data?.mentions ?? []).length === 0 ? (
            <EmptyHint>No mentions.</EmptyHint>
          ) : (
            (data?.mentions ?? []).map((m) => (
              <MentionRow key={m.id} mention={m} />
            ))
          )}
        </Section>

        {/* Notifications */}
        <Section
          title="Notifications"
          hint={unreadCount > 0 ? `${unreadCount} unread` : undefined}
          action={
            unreadCount > 0 ? (
              <button
                type="button"
                data-testid="mark-all-read-btn"
                onClick={() => markAllRead.mutate()}
                style={{
                  fontSize: 10.5,
                  color: "var(--ink-4)",
                  cursor: "pointer",
                  padding: "1px 4px",
                  borderRadius: 3,
                }}
              >
                Mark all read
              </button>
            ) : undefined
          }
        >
          {notificationList.length === 0 ? (
            <EmptyHint>No notifications.</EmptyHint>
          ) : (
            notificationList.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onMarkRead={(id) => markRead.mutate(id)}
              />
            ))
          )}
        </Section>
      </div>

      {/* Right rail */}
      <div
        style={{
          width: 320,
          borderLeft: "1px solid var(--line)",
          background: "var(--bg-2)",
          overflow: "auto",
          padding: "16px 16px 20px",
          flexShrink: 0,
        }}
      >
        {/* Current cycle card — FIRST in right rail (REQ-INBOX-CYCLE-007) */}
        <RailCard title="Current cycle">
          <CurrentCycleCard
            activeCycle={data?.activeCycle ?? null}
            multipleActiveProjects={data?.multipleActiveProjects ?? false}
            isLoading={isLoading}
          />
        </RailCard>

        <RailCard title="Active agents" sub="MCP runners">
          {agents.length === 0 ? (
            <EmptyHint>No agents currently active.</EmptyHint>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {agents.map((a) => (
                <AgentRow key={`${a.memberId}-${a.issueKey}`} agent={a} />
              ))}
            </div>
          )}
        </RailCard>

        <RailCard title="Quick actions">
          {/* Row 1: New issue — REQ-INBOX-QUICK-005 */}
          <QuickRow
            icon={<Icon.Plus />}
            label="New issue"
            kbd="C"
            data-testid="quick-action-row"
            data-action="new-issue"
            onClick={() => useCommandPaletteStore.getState().requestCreateIssue()}
          />
          {/* Row 2: Ask Kanon — REQ-INBOX-QUICK-005 */}
          <QuickRow
            icon={<Icon.Spark style={{ color: "var(--ai)" }} />}
            label="Ask Kanon"
            kbd="⌘J"
            data-testid="quick-action-row"
            data-action="ask-kanon"
            onClick={() => openPalette("ai")}
          />
          {/* Row 3: Open dependency graph — REQ-INBOX-QUICK-001, design §4.4 */}
          <ProjectPickerPopover
            projects={activeProjects}
            onSelect={(projectKey) =>
              void navigate({ to: "/dependencies/$projectKey", params: { projectKey } })
            }
            data-testid="quick-dep-graph"
          >
            {(open, disabled, isOpen) => (
              <QuickRow
                icon={<Icon.Graph />}
                label="Open dependency graph"
                data-testid="quick-action-row"
                data-action="dep-graph"
                disabled={disabled}
                aria-haspopup={disabled ? undefined : "menu"}
                aria-expanded={disabled ? undefined : isOpen}
                onClick={open}
                title={disabled ? "No active project" : undefined}
              />
            )}
          </ProjectPickerPopover>
          {/* Row 4: Plan next cycle — REQ-INBOX-QUICK-002, design §4.4 */}
          {/* NOTE: "Search…" row removed (REQ-INBOX-QUICK-005 — 4 rows; search accessible via ⌘K + topbar lupa) */}
          <ProjectPickerPopover
            projects={activeProjects}
            onSelect={(projectKey) =>
              void navigate({ to: "/cycles/$projectKey", params: { projectKey } })
            }
            data-testid="quick-plan-cycle"
          >
            {(open, disabled, isOpen) => (
              <QuickRow
                icon={<Icon.Road style={{ color: "var(--ai)" }} />}
                label="Plan next cycle"
                data-testid="quick-action-row"
                data-action="plan-cycle"
                disabled={disabled}
                aria-haspopup={disabled ? undefined : "menu"}
                aria-expanded={disabled ? undefined : isOpen}
                onClick={open}
                title={disabled ? "No active project" : undefined}
              />
            )}
          </ProjectPickerPopover>
        </RailCard>
      </div>
    </div>
  );
}

function greetingFor(name: string): string {
  const hour = new Date().getHours();
  const time =
    hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const first = name.split(/[\s@]/)[0] ?? "there";
  const cap = first.charAt(0).toUpperCase() + first.slice(1);
  return `Good ${time}, ${cap}.`;
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone?: "accent" | "ai";
}) {
  const color =
    tone === "accent"
      ? "var(--accent)"
      : tone === "ai"
        ? "var(--ai)"
        : "var(--ink)";
  return (
    <div
      style={{
        padding: "16px 20px",
        borderRight: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color,
          fontFamily: "Inter Tight",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {n}
      </div>
      <div
        style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}
      >
        {label}
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "16px 24px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </h2>
        {hint && (
          <span
            className="mono"
            style={{ fontSize: 10.5, color: "var(--ink-4)" }}
          >
            {hint}
          </span>
        )}
        {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {children}
      </div>
    </div>
  );
}

function InboxRow({
  issue,
  onOpen,
}: {
  issue: Issue;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        textAlign: "left",
        borderRadius: 4,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-3)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <TypeGlyph value={issue.type} />
      <span
        className="mono"
        style={{ fontSize: 11, color: "var(--ink-3)", width: 80 }}
      >
        {issue.key}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 12.5,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {issue.title}
      </span>
      <StatePip state={issue.state} />
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        fontSize: 12,
        color: "var(--ink-4)",
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}

function RailCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "12px 12px 14px",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 6,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>{title}</span>
        {sub && (
          <span
            className="mono"
            style={{ fontSize: 10.5, color: "var(--ink-4)" }}
          >
            {sub}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function QuickRow({
  icon,
  label,
  kbd,
  onClick,
  disabled,
  "data-testid": testId,
  "data-action": dataAction,
  "aria-disabled": ariaDisabled,
  "aria-haspopup": ariaHasPopup,
  "aria-expanded": ariaExpanded,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  kbd?: string;
  onClick?: () => void;
  disabled?: boolean;
  "data-testid"?: string;
  "data-action"?: string;
  "aria-disabled"?: boolean | "true" | "false";
  "aria-haspopup"?: boolean | "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog";
  "aria-expanded"?: boolean | "true" | "false";
  title?: string;
}) {
  const isDisabled = disabled ?? !!ariaDisabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      data-action={dataAction}
      aria-disabled={ariaDisabled}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 4,
        width: "100%",
        textAlign: "left",
        color: "var(--ink-2)",
        fontSize: 12,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = isDisabled ? "transparent" : "var(--bg-3)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "transparent")
      }
    >
      <span style={{ color: "var(--ink-3)" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
}

function AgentRow({ agent }: { agent: ActiveAgentSession }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
        borderBottom: "1px dashed var(--line)",
      }}
    >
      <Avatar
        initials={avatarInitials(agent.username, "AI")}
        name={agent.username}
        size={18}
        isAgent
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--ink)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {agent.username}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
          }}
        >
          {agent.source}
        </div>
      </div>
      <span
        className="mono"
        style={{ fontSize: 10.5, color: "var(--accent)" }}
      >
        {agent.issueKey}
      </span>
    </div>
  );
}
