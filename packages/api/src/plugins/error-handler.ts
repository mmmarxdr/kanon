import type { FastifyInstance, FastifyError } from "fastify";
import fp from "fastify-plugin";
import { ZodError } from "zod";
import { AppError } from "../shared/types.js";

/**
 * Global error handler plugin.
 * Maps known error types to structured JSON responses.
 */
async function errorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error: FastifyError | Error, request, reply) => {
    // Zod validation errors → 400
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));

      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        details,
      });
    }

    // Application errors with explicit status codes
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
    }

    // Fastify validation errors (from schema validation)
    if ("validation" in error && error.validation) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: error.message,
        details: error.validation,
      });
    }

    // Rate-limit rejections (KAN-77): @fastify/rate-limit throws a plain Error
    // with statusCode 429, which would otherwise fall through to the 500 branch
    // and reach the client as INTERNAL_ERROR. Surface a clean 429 instead. Its
    // message is a fixed, non-sensitive string ("Rate limit exceeded, retry in
    // …"), and any Retry-After / X-RateLimit-* headers the plugin already set on
    // the reply are preserved. Scoped to 429 only so other framework 4xx errors
    // keep their existing (message-masked-in-prod) 500 handling.
    if ((error as FastifyError).statusCode === 429) {
      return reply.status(429).send({
        error: "RATE_LIMIT_EXCEEDED",
        code: "RATE_LIMIT_EXCEEDED",
        message: error.message,
      });
    }

    // Unexpected errors → 500
    request.log.error(error, "Unhandled error");

    return reply.status(500).send({
      error: "INTERNAL_ERROR",
      message:
        process.env["NODE_ENV"] === "production"
          ? "Internal server error"
          : error.message,
    });
  });
}

export default fp(errorHandlerPlugin, {
  name: "error-handler",
});
