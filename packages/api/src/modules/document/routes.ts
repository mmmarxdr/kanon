import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateDocumentBody,
  DocumentIdParam,
  IssueKeyParam,
  UpdateDocumentBody,
} from "./schema.js";
import { requireIssueMember, requireIssueRole } from "../../middleware/require-role.js";
import * as documentService from "./service.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";

/**
 * Document routes plugin.
 * Registered under /api prefix.
 */
export default async function documentRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/issues/:key/documents
   */
  app.post(
    "/issues/:key/documents",
    {
      preHandler: [requireIssueRole("key", "member")],
      schema: {
        params: IssueKeyParam,
        body: CreateDocumentBody,
      },
    },
    async (request, reply) => {
      const document = await documentService.createDocument(
        request.params.key,
        request.body,
        request.member!.id,
        request.via,
      );
      return reply.status(201).send(document);
    },
  );

  /**
   * GET /api/issues/:key/documents
   */
  app.get(
    "/issues/:key/documents",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: IssueKeyParam,
      },
    },
    async (request, _reply) => {
      return documentService.listDocuments(request.params.key);
    },
  );

  /**
   * GET /api/documents/:id
   *
   * Get a single design record by ID.
   * Requires the requester to be a member of the workspace.
   * Single query: fetches document with author + issue.project.workspaceId,
   * performs 404 + membership check, then strips the issue join from the response.
   */
  app.get(
    "/documents/:id",
    {
      schema: {
        params: DocumentIdParam,
      },
    },
    async (request, _reply) => {
      const { id: documentId } = request.params;

      const document = await prisma.issueDocument.findUnique({
        where: { id: documentId },
        include: {
          author: {
            select: {
              id: true,
              username: true,
            },
          },
          issue: {
            select: {
              project: { select: { workspaceId: true } },
            },
          },
        },
      });

      if (!document) {
        throw new AppError(404, "DOCUMENT_NOT_FOUND", `Document "${documentId}" not found`);
      }

      const { workspaceId } = document.issue.project;
      const member = await prisma.member.findUnique({
        where: {
          userId_workspaceId: {
            userId: request.user.userId,
            workspaceId,
          },
        },
        select: { id: true },
      });

      if (!member) {
        throw new AppError(403, "FORBIDDEN", "You are not a member of this workspace");
      }

      // Strip the issue join — return only the document fields + author
      const { issue: _issue, ...documentWithoutIssue } = document;
      return documentWithoutIssue;
    },
  );

  /**
   * PATCH /api/documents/:id
   *
   * Update a design record. Only the document's author may edit it.
   * Auth: any authenticated user; service enforces authorship.
   *
   * To resolve member.id from user.id, we fetch the document first to get the
   * workspaceId, then look up the Member row.
   */
  app.patch(
    "/documents/:id",
    {
      schema: {
        params: DocumentIdParam,
        body: UpdateDocumentBody,
      },
    },
    async (request, reply) => {
      const { id: documentId } = request.params;

      // Resolve the Member context: find document → issue → workspace → member
      const document = await prisma.issueDocument.findUnique({
        where: { id: documentId },
        select: {
          issue: { select: { project: { select: { workspaceId: true } } } },
        },
      });

      if (!document) {
        throw new AppError(404, "DOCUMENT_NOT_FOUND", `Document "${documentId}" not found`);
      }

      const workspaceId = document.issue.project.workspaceId;

      const member = await prisma.member.findUnique({
        where: {
          userId_workspaceId: {
            userId: request.user.userId,
            workspaceId,
          },
        },
        select: { id: true },
      });

      if (!member) {
        throw new AppError(403, "FORBIDDEN", "You are not a member of this workspace");
      }

      const updated = await documentService.updateDocument(
        documentId,
        request.body,
        member.id,
      );
      return reply.status(200).send(updated);
    },
  );
}
