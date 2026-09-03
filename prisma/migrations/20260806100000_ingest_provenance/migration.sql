-- Ingestion provenance.
--
-- sourceMessageId is the idempotency key: the same mail reaches every desk member and polling
-- re-fetches by day granularity, so duplicates are the normal case. sourceThreadId lets a reply
-- join the existing request instead of opening a new one — real threads run to 775 messages.
-- isAutomated carries the 57%-machine finding into the queue logic.

ALTER TABLE "Request" ADD COLUMN "sourceMessageId" TEXT;
ALTER TABLE "Request" ADD COLUMN "sourceThreadId"  TEXT;
ALTER TABLE "Request" ADD COLUMN "senderKind"      TEXT;
ALTER TABLE "Request" ADD COLUMN "isAutomated"     BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Request_sourceMessageId_key" ON "Request"("sourceMessageId");
CREATE INDEX "Request_sourceThreadId_idx" ON "Request"("sourceThreadId");
