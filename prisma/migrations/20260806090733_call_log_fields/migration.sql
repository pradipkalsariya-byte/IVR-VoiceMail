-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "callerRelationship" TEXT,
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "isSwitchboard" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receivedById" TEXT,
ADD COLUMN     "routedToId" TEXT,
ADD COLUMN     "routedToLabel" TEXT,
ADD COLUMN     "section" TEXT;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_routedToId_fkey" FOREIGN KEY ("routedToId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
