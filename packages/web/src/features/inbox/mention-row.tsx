import { useNavigate } from "@tanstack/react-router";
import type { MentionDashboardItem } from "@kanon/shared";
import { Avatar, avatarInitials } from "@/components/ui/primitives";

interface MentionRowProps {
  mention: MentionDashboardItem;
}

/**
 * MentionRow — renders a single mention entry in the Mentions section of Inbox.
 *
 * Clicking navigates to /issue/$key with highlight=mention and (if present) commentId.
 * When commentId is null (mention is in issue description), omits commentId from search.
 *
 * REQ-MENTION-008
 */
export function MentionRow({ mention }: MentionRowProps) {
  const navigate = useNavigate();

  function handleClick() {
    void navigate({
      to: "/issue/$key",
      params: { key: mention.issueKey },
      search:
        mention.commentId !== null
          ? { from: "inbox", highlight: "mention" as const, commentId: mention.commentId }
          : { from: "inbox", highlight: "mention" as const },
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        textAlign: "left",
        borderRadius: 4,
        cursor: "pointer",
        width: "100%",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-3)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Avatar
        initials={avatarInitials(mention.mentionedByUsername)}
        name={mention.mentionedByUsername}
        size={20}
      />
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          color: "var(--ink)",
          whiteSpace: "nowrap",
        }}
      >
        {mention.mentionedByUsername}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 12,
          color: "var(--ink-3)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {mention.context}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--ink-4)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 120,
        }}
      >
        {mention.issueTitle}
      </span>
    </button>
  );
}
