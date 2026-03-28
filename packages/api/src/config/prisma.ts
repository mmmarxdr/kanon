import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

/**
 * Singleton PrismaClient instance.
 * Logs queries in development for debugging.
 */
export const prisma = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  log: env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
});

/**
 * Gracefully disconnect Prisma on shutdown.
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
