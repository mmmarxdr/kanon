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
