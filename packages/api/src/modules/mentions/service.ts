import type { PrismaClient } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library.js";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";

/**
 * Prisma transaction client type (subset of PrismaClient without tx-banned methods).
 */
type PrismaTransactionClient = Omit<PrismaClient, ITXClientDenyList>;

/**
 * Regex to extract @mentions from text.
 * Matches @ followed by one or more word characters (a-z, A-Z, 0-9, _).
 * Case-sensitive: @Alice ≠ @alice.
 */
const MENTION_REGEX = /@(\w+)/g;

/**
 * Build a context snippet centered on the first occurrence of @username.
 * Takes up to 30 chars before and 60 chars after the @mention.
 */
function buildContext(body: string, username: string): string {
  const idx = body.indexOf(`@${username}`);
  if (idx === -1) return `@${username}`;
  const start = Math.max(0, idx - 30);
  const end = Math.min(body.length, idx + username.length + 1 + 60);
  return body.slice(start, end).trim();
}

/**
 * Delta entry returned by parseAndUpsertMentions for newly-created mentions.
 * Used by callers to emit mention.created events (D1, S3/KAN-27).
 */
export interface MentionDeltaEntry {
  mentionId: string;
  mentionedMemberId: string;
  context: string;
}

/**
 * Return value of parseAndUpsertMentions.
 * `created` contains only the mentions that did NOT exist before the sweep
 * (i.e., genuinely new mentions not previously notified).
 */
export interface ParseAndUpsertMentionsResult {
  created: MentionDeltaEntry[];
}

/**
 * Emit one `mention.created` event per newly-created mention. Each emit is
 * wrapped in its own try/catch — event emission is fire-and-forget and must
 * never break the surrounding mutation. Returns the memberIds whose event was
 * emitted successfully (callers that need to dedup against other notifications,
 * e.g. createComment, use this; others ignore it).
 */
export function emitMentionEvents(
  created: MentionDeltaEntry[],
  params: {
    workspaceId: string;
    actorMemberId: string;
    issueId: string;
    issueKey: string;
    issueTitle: string;
    commentId: string | null;
    via?: string | null;
  },
): string[] {
  const emittedMemberIds: string[] = [];
  for (const entry of created) {
    try {
      eventBus.emit({
        type: "mention.created",
        workspaceId: params.workspaceId,
        actorId: params.actorMemberId,
        payload: {
          mentionId: entry.mentionId,
          issueId: params.issueId,
          issueKey: params.issueKey,
          issueTitle: params.issueTitle,
          commentId: params.commentId,
          mentionedMemberId: entry.mentionedMemberId,
          mentionedByMemberId: params.actorMemberId,
          context: entry.context,
        },
        via: params.via ?? null,
      });
      // Only record after a successful emit — if emit throws, the member is NOT
      // recorded, so callers won't wrongly exclude them from other notifications.
      emittedMemberIds.push(entry.mentionedMemberId);
    } catch {
      // Fire-and-forget; never break the mutation.
    }
  }
  return emittedMemberIds;
}

/**
 * Core mention upsert implementation.
 * Receives a transaction-or-plain client; all DB operations go through it.
 * The delete+create loop is atomic when `client` is a Prisma transaction client.
 */
async function _impl(
  args: {
    workspaceId: string;
    issueId: string;
    commentId: string | null;
    body: string;
    authorMemberId: string;
  },
  client: PrismaTransactionClient,
): Promise<ParseAndUpsertMentionsResult> {
  // 1. Extract unique usernames (preserve first-occurrence order)
  const matches = Array.from(args.body.matchAll(MENTION_REGEX));
  const uniqueUsernames = [...new Set(matches.map((m) => m[1]!))];

  // 2. Resolve username → member within workspace (case-sensitive query)
  //    Skip DB query when there are no candidates at all.
  const resolved =
    uniqueUsernames.length === 0
      ? []
      : await client.member.findMany({
          where: {
            workspaceId: args.workspaceId,
            username: { in: uniqueUsernames },
          },
          select: { id: true, username: true },
        });

  // 3. Exclude self-mentions (REQ-MENTION-005)
  const targets = resolved.filter((m) => m.id !== args.authorMemberId);

  // 4. Query prior mentionedMemberId set BEFORE sweep (D1 delta computation).
  //    Only query when there are incoming targets (avoids unnecessary DB round-trip).
  const priorMentionedIds = new Set<string>();
  if (targets.length > 0) {
    const priorMentions = await client.mention.findMany({
      where:
        args.commentId !== null
          ? { commentId: args.commentId }
          : { issueId: args.issueId, commentId: null },
      select: { mentionedMemberId: true },
    });
    for (const m of priorMentions) {
      priorMentionedIds.add(m.mentionedMemberId);
    }
  }

  // 5. Idempotency sweep: delete previous mentions for this exact source.
  //    For comments: identify by commentId.
  //    For description: identify by (issueId, commentId = null).
  if (args.commentId !== null) {
    await client.mention.deleteMany({
      where: { commentId: args.commentId },
    });
  } else {
    await client.mention.deleteMany({
      where: { issueId: args.issueId, commentId: null },
    });
  }

  // 6. Insert new mentions (no-op when targets is empty)
  //    Use individual create calls to get back IDs needed for delta.
  if (targets.length === 0) return { created: [] };

  const created: MentionDeltaEntry[] = [];

  for (const t of targets) {
    const context = buildContext(args.body, t.username);
    const mention = await client.mention.create({
      data: {
        workspaceId: args.workspaceId,
        issueId: args.issueId,
        commentId: args.commentId,
        mentionedMemberId: t.id,
        mentionedByMemberId: args.authorMemberId,
        context,
      },
      select: { id: true },
    });

    // 7. Delta: only include targets not in the prior set
    if (!priorMentionedIds.has(t.id)) {
      created.push({
        mentionId: mention.id,
        mentionedMemberId: t.id,
        context,
      });
    }
  }

  return { created };
}

/**
 * Parse @mentions from a body text, resolve them to workspace members,
 * and perform an idempotent DELETE+INSERT for the given source
 * (comment or issue description).
 *
 * Algorithm (per design D1):
 *  1. Extract unique usernames via /@(\w+)/g regex.
 *  2. Resolve usernames → memberIds within the workspace (case-sensitive).
 *  3. Exclude self-mentions (mentionedMemberId === authorMemberId).
 *  4. Query PRIOR mentionedMemberId set BEFORE sweep (for delta computation).
 *  5. DELETE existing mentions for this source (commentId or issueId+commentId=null).
 *  6. INSERT new mention rows using individual create (to get back IDs).
 *  7. Return delta: { created: entries not in prior set }.
 *
 * Atomicity (Fix 3 — S3 review):
 *  - When an external `tx` is provided, it owns atomicity (caller's transaction).
 *  - When NO `tx` is provided, the delete+create loop is wrapped in an internal
 *    `prisma.$transaction` so a partial create failure cannot orphan rows or
 *    silently suppress event emission.
 *
 * @param args.tx - Optional Prisma transaction client. Falls back to internal tx.
 */
export async function parseAndUpsertMentions(args: {
  workspaceId: string;
  issueId: string;
  commentId: string | null;
  body: string;
  authorMemberId: string;
  tx?: PrismaTransactionClient;
}): Promise<ParseAndUpsertMentionsResult> {
  const { tx, ...coreArgs } = args;

  // If an external transaction is provided, use it directly (caller owns atomicity).
  if (tx) {
    return _impl(coreArgs, tx);
  }

  // No external tx: wrap in an internal interactive transaction to ensure
  // delete+create is atomic (partial create failure rolls back the delete too).
  return prisma.$transaction((innerTx) => _impl(coreArgs, innerTx));
}
