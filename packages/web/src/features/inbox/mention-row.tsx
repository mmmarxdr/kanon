import { useNavigate } from "@tanstack/react-router";
import type { MentionDashboardItem } from "@kanon/shared";
import { Avatar, avatarInitials } from "@/components/ui/primitives";

interface MentionRowProps {
  mention: MentionDashboardItem;
}

/**
 * MentionRow — renders a single mention entry in the Mentions section of Inbox.
 *
 * Clicking navigates to /issue/$key. The highlight/commentId params have been
 * removed as part of KAN-33 frontend deletions (KAN-108). Navigation uses
 * from: "inbox" only; the Timeline tab shows the full activity including mentions.
 *
 * REQ-MENTION-008
 */
export function MentionRow({ mention }: MentionRowProps) {
  const navigate = useNavigate();

  function handleClick() {
    void navigate({
      to: "/issue/$key",
      params: { key: mention.issueKey },
      search: { from: "inbox" },
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
