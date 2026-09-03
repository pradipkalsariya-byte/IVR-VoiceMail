-- AlterTable
ALTER TABLE "Family" ALTER COLUMN "phoneKey" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "senderEmail" TEXT;
