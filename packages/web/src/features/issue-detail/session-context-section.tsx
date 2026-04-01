import { useIssueContextQuery } from "./use-issue-detail-queries";
import { useI18n } from "@/hooks/use-i18n";

interface SessionContextSectionProps {
  issueKey: string;
}

/**
 * Displays past AI coding session context for an issue.
 *
 * Shows the last 3 sessions with goal, date, and next steps.
 * Hidden when no data is available or query is still loading.
 * Never blocks issue panel rendering (parallel fetch).
 */
export function SessionContextSection({
  issueKey,
}: SessionContextSectionProps) {
  const { t } = useI18n();
  const { data } = useIssueContextQuery(issueKey);

  // Hidden when no data, loading, or empty sessions
  if (!data || data.sessionCount === 0) {
    return null;
  }

  // Show at most 3 sessions
  const sessions = data.sessions.slice(0, 3);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("issueDetail.aiContext")}
      </span>
      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Internal                                                           */
/* ------------------------------------------------------------------ */

interface SessionCardProps {
  session: {
    id: number;
    date: string;
    goal: string;
    nextSteps: string[];
  };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function SessionCard({ session }: SessionCardProps) {
  const { t } = useI18n();
  const nextStepsPreview = session.nextSteps.slice(0, 3);
  const remaining = session.nextSteps.length - 3;

  return (
    <div className="rounded-md border border-border bg-secondary/50 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-foreground font-medium leading-snug truncate flex-1">
          {session.goal}
        </p>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {formatDate(session.date)}
        </span>
      </div>
      {nextStepsPreview.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {nextStepsPreview.map((step, i) => (
            <li
              key={i}
              className="text-xs text-muted-foreground leading-relaxed pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[0.45em] before:w-1.5 before:h-1.5 before:rounded-full before:bg-primary/30"
            >
              {step}
            </li>
          ))}
          {remaining > 0 && (
            <li className="text-[10px] text-muted-foreground/70 pl-3">
              +{remaining} {t("issueDetail.more")}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
