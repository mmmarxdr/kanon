/*
  Warnings:

  - A unique constraint covering the columns `[binding_id,entity_type,external_id]` on the table `external_refs` will be added. If there are existing duplicate values, this will fail.
  - Made the column `binding_id` on table `external_refs` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "external_refs" DROP CONSTRAINT "external_refs_binding_id_fkey";

-- AlterTable
ALTER TABLE "external_refs" ALTER COLUMN "binding_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "external_refs_binding_id_entity_type_external_id_key" ON "external_refs"("binding_id", "entity_type", "external_id");

-- AddForeignKey
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
