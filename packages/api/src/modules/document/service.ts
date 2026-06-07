import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { eventBus } from "../../services/event-bus/index.js";
import { createActivityLog } from "../activity/service.js";
import type { CreateDocumentBody, UpdateDocumentBody } from "./schema.js";

/**
 * Create a design record on an issue and log the activity.
 * Emits issue.updated SSE event with field: "documents" (fire-and-forget).
 */
export async function createDocument(
  issueKey: string,
  body: CreateDocumentBody,
  memberId: string,
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: {
      id: true,
      project: { select: { workspaceId: true } },
    },
  });

  if (!issue) {
    throw new AppError(
      404,
      "ISSUE_NOT_FOUND",
      `Issue "${issueKey}" not found`,
    );
  }

  const document = await prisma.issueDocument.create({
    data: {
      kind: body.kind,
      title: body.title,
      body: body.body,
      issueId: issue.id,
      authorId: memberId,
    },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  // Activity log — document_added action
  await createActivityLog({
    issueId: issue.id,
    memberId,
    action: "document_added",
    details: { documentId: document.id, kind: document.kind },
  });

  // Emit domain event (fire-and-forget) — reuse issue.updated with field: "documents"
  // use-domain-events.ts already invalidates issueKeys.all on issue.updated → web refresh free
  try {
    eventBus.emit({
      type: "issue.updated",
      workspaceId: issue.project.workspaceId,
      actorId: memberId,
      payload: { issueKey, issueId: issue.id, field: "documents" },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return document;
}

/**
 * List all design records for an issue, ordered by createdAt ASC.
 */
export async function listDocuments(issueKey: string) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true },
  });

  if (!issue) {
    throw new AppError(
      404,
      "ISSUE_NOT_FOUND",
      `Issue "${issueKey}" not found`,
    );
  }

  return prisma.issueDocument.findMany({
    where: { issueId: issue.id },
    orderBy: { createdAt: "asc" },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          user: { select: { email: true } },
        },
      },
    },
  });
}

/**
 * Get a single design record by ID.
 */
export async function getDocument(documentId: string) {
  const document = await prisma.issueDocument.findUnique({
    where: { id: documentId },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  if (!document) {
    throw new AppError(
      404,
      "DOCUMENT_NOT_FOUND",
      `Document "${documentId}" not found`,
    );
  }

  return document;
}

/**
 * Update an existing design record.
 *
 * - Verifies the document exists (404 if not).
 * - Verifies the requester is the original author (403 if not).
 * - Persists only the provided fields.
 * - Emits issue.updated SSE event with field: "documents" (fire-and-forget).
 */
export async function updateDocument(
  documentId: string,
  body: UpdateDocumentBody,
  memberId: string,
) {
  const existing = await prisma.issueDocument.findUnique({
    where: { id: documentId },
    include: {
      issue: {
        select: {
          id: true,
          key: true,
          project: { select: { workspaceId: true } },
        },
      },
      author: {
        select: {
          id: true,
          username: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  if (!existing) {
    throw new AppError(
      404,
      "DOCUMENT_NOT_FOUND",
      `Document "${documentId}" not found`,
    );
  }

  // Author-only update
  if (existing.authorId !== memberId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the document author can edit this document",
    );
  }

  // Build partial update (only fields provided)
  const data: Partial<{ title: string; body: string; kind: "adr" | "pdr" | "rfc" | "note" }> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.body !== undefined) data.body = body.body;
  if (body.kind !== undefined) data.kind = body.kind;

  const updated = await prisma.issueDocument.update({
    where: { id: documentId },
    data,
    include: {
      author: {
        select: {
          id: true,
          username: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  // Emit SSE event (fire-and-forget)
  try {
    eventBus.emit({
      type: "issue.updated",
      workspaceId: existing.issue.project.workspaceId,
      actorId: memberId,
      payload: { issueKey: existing.issue.key, issueId: existing.issue.id, field: "documents" },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return updated;
}
