import { z } from "zod";

export const DOCUMENT_KINDS = ["adr", "pdr", "rfc", "note"] as const;

/**
 * Create document request body.
 */
export const CreateDocumentBody = z.object({
  kind: z.enum(DOCUMENT_KINDS).default("note"),
  title: z
    .string()
    .min(1, "Document title is required")
    .max(200, "Document title must be at most 200 characters"),
  body: z
    .string()
    .min(1, "Document body is required")
    .max(50000, "Document body must be at most 50000 characters"),
});
export type CreateDocumentBody = z.infer<typeof CreateDocumentBody>;

/**
 * Issue key param for document routes.
 */
export const IssueKeyParam = z.object({
  key: z.string(),
});

/**
 * Document ID param for PATCH /api/documents/:id.
 */
export const DocumentIdParam = z.object({
  id: z.string().uuid(),
});

/**
 * Update document request body — title, body, and kind can all be patched.
 */
export const UpdateDocumentBody = z.object({
  title: z
    .string()
    .min(1, "Document title is required")
    .max(200, "Document title must be at most 200 characters")
    .optional(),
  body: z
    .string()
    .min(1, "Document body is required")
    .max(50000, "Document body must be at most 50000 characters")
    .optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
});
export type UpdateDocumentBody = z.infer<typeof UpdateDocumentBody>;
