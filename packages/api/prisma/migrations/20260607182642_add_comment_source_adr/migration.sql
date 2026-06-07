-- AlterEnum
-- PostgreSQL requires ALTER TYPE ... ADD VALUE to run outside a transaction.
-- Prisma wraps migrations in transactions by default.
-- This statement is safe to run without a transaction; Prisma will apply it
-- directly. If running manually, do NOT wrap this in BEGIN/COMMIT.
ALTER TYPE "CommentSource" ADD VALUE 'adr';
