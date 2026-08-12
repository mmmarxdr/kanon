import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export const ISSUE_DETAIL_SECTIONS = ["general", "activity", "relationships", "resources", "development"] as const;
type WorkspaceState = { kind: "loading" | "error" | "not-found" | "ready" };
export interface IssueDetailWorkspaceProps { state: WorkspaceState; general?: ReactNode; activity?: ReactNode; relationships?: ReactNode; resources?: ReactNode; metadata?: ReactNode; onRetry?: () => void; onBack?: () => void; }

/** One-document issue workspace. Every state keeps the same landmarks mounted. */
export function IssueDetailWorkspace({ state, general, activity, relationships, resources, metadata, onRetry, onBack }: IssueDetailWorkspaceProps) {
  const { t } = useTranslation("issue");
  const [current, setCurrent] = useState("general");
  const [announcement, setAnnouncement] = useState("");
  const setLocation = useCallback((id: string) => {
    setCurrent(id);
    setAnnouncement(t("sectionAnnouncement", {
      section: t(`section${id[0]!.toUpperCase()}${id.slice(1)}`),
    }));
  }, [t]);

  const navigate = useCallback((id: string) => {
    const target = document.getElementById(`issue-heading-${id}`) as HTMLElement | null;
    if (!target) return;
    target.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    target.focus({ preventScroll: true });
    setLocation(id);
  }, [setLocation]);

  const sections = ISSUE_DETAIL_SECTIONS.map((id) => ({ id, label: t(`section${id[0]!.toUpperCase()}${id.slice(1)}`) }));
  const fallback = state.kind === "loading" ? t("loading") : state.kind === "error" ? t("issueLoadError") : state.kind === "not-found" ? t("issueNotFound") : null;
  const body = (content?: ReactNode, showBack = false) => state.kind === "ready" ? content ?? null : fallback ? <div role={state.kind === "error" ? "alert" : "status"}>{fallback}{state.kind === "error" && onRetry ? <button type="button" onClick={onRetry}>{t("retry")}</button> : null}{state.kind === "not-found" && showBack && onBack ? <button type="button" onClick={onBack}>{t("back")}</button> : null}</div> : null;
  return <div className="issue-detail-workspace"><nav aria-label={t("sectionNavigationLabel")} className="issue-detail-nav">{sections.map(({ id, label }) => <button key={id} type="button" aria-current={current === id ? "location" : undefined} onClick={() => navigate(id)}>{label}</button>)}</nav><div id="issue-detail-scroll" data-testid="issue-detail-scroll" className="issue-detail-scroll"><span data-testid="issue-section-announcement" className="sr-only" role="status" aria-live="polite">{announcement}</span><WorkspaceSection id="general" title={sections[0]!.label}>{body(general, true)}</WorkspaceSection><WorkspaceSection id="activity" title={sections[1]!.label}>{body(activity)}</WorkspaceSection><WorkspaceSection id="relationships" title={sections[2]!.label}>{body(relationships)}</WorkspaceSection><WorkspaceSection id="resources" title={sections[3]!.label}>{body(resources)}</WorkspaceSection><WorkspaceSection id="development" title={sections[4]!.label}>{state.kind === "ready" ? <p>{t("developmentUnavailable")}</p> : body()}</WorkspaceSection>{state.kind === "ready" && metadata ? <aside className="issue-metadata-rail">{metadata}</aside> : null}</div></div>;
}
function WorkspaceSection({ id, title, children }: { id: string; title: string; children: ReactNode }) { return <section id={`issue-section-${id}`} aria-labelledby={`issue-heading-${id}`} tabIndex={-1} className="issue-detail-section"><h2 id={`issue-heading-${id}`} tabIndex={-1}>{title}</h2>{children}</section>; }
