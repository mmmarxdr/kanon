import type { PrismaClient } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library.js";
import { prisma } from "../../config/prisma.js";

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
 * Parse @mentions from a body text, resolve them to workspace members,
 * and perform an idempotent DELETE+INSERT for the given source
 * (comment or issue description).
 *
 * Algorithm (per design §3.3):
 *  1. Extract unique usernames via /@(\w+)/g regex.
 *  2. Resolve usernames → memberIds within the workspace (case-sensitive).
 *  3. Exclude self-mentions (mentionedMemberId === authorMemberId).
 *  4. DELETE existing mentions for this source (commentId or issueId+commentId=null).
 *  5. INSERT new mention rows.
 *
 * @param args.tx - Optional Prisma transaction client. Falls back to global prisma.
 */
export async function parseAndUpsertMentions(args: {
  workspaceId: string;
  issueId: string;
  commentId: string | null;
  body: string;
  authorMemberId: string;
  tx?: PrismaTransactionClient;
}): Promise<void> {
  const client = (args.tx ?? prisma) as PrismaTransactionClient;

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

  // 4. Idempotency sweep: delete previous mentions for this exact source.
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

  // 5. Insert new mentions (no-op when targets is empty)
  if (targets.length === 0) return;

  await client.mention.createMany({
    data: targets.map((t) => ({
      workspaceId: args.workspaceId,
      issueId: args.issueId,
      commentId: args.commentId,
      mentionedMemberId: t.id,
      mentionedByMemberId: args.authorMemberId,
      context: buildContext(args.body, t.username),
    })),
  });
}
