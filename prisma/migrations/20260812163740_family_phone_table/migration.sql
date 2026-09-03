/*
  Warnings:

  - You are about to drop the column `phoneKey` on the `Family` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Family_phoneKey_idx";

-- AlterTable
ALTER TABLE "Family" DROP COLUMN "phoneKey";

-- CreateTable
CREATE TABLE "FamilyPhone" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "FamilyPhone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FamilyPhone_phoneKey_idx" ON "FamilyPhone"("phoneKey");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyPhone_familyId_phoneKey_key" ON "FamilyPhone"("familyId", "phoneKey");

-- AddForeignKey
ALTER TABLE "FamilyPhone" ADD CONSTRAINT "FamilyPhone_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
