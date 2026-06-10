import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateDocumentBody,
  DocumentIdParam,
  IssueKeyParam,
  UpdateDocumentBody,
} from "./schema.js";
import { requireIssueMember, requireIssueRole, requireDocumentMember } from "../../middleware/require-role.js";
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
   * requireDocumentMember resolves project from document and applies the KAN-19
   * scope guard (enforceProjectAccess) before setting request.member.
   * The handler re-fetches the document with author to produce the response;
   * the issue join is stripped so the response shape stays identical to before.
   */
  app.get(
    "/documents/:id",
    {
      preHandler: [requireDocumentMember("id")],
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
        },
      });

      if (!document) {
        throw new AppError(404, "DOCUMENT_NOT_FOUND", `Document "${documentId}" not found`);
      }

      return document;
    },
  );

  /**
   * PATCH /api/documents/:id
   *
   * Update a design record. Only the document's author may edit it;
   * service enforces authorship. requireDocumentMember resolves project
   * from document and applies the KAN-19 scope guard (enforceProjectAccess)
   * before setting request.member.
   */
  app.patch(
    "/documents/:id",
    {
      preHandler: [requireDocumentMember("id")],
      schema: {
        params: DocumentIdParam,
        body: UpdateDocumentBody,
      },
    },
    async (request, reply) => {
      const { id: documentId } = request.params;
      const updated = await documentService.updateDocument(
        documentId,
        request.body,
        request.member!.id,
      );
      return reply.status(200).send(updated);
    },
  );
}
