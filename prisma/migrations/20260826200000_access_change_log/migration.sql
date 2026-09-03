-- Access changes get their own append-only table (feedback #34).
--
-- Not a row on "Activity": that table's requestId is required, and an access change belongs to
-- no request. Relaxing that column would weaken every existing audit row's guarantee to
-- accommodate one new case.
CREATE TABLE "AccessChange" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "subjectEmail" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "AccessChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccessChange_at_idx" ON "AccessChange"("at");
CREATE INDEX "AccessChange_subjectEmail_idx" ON "AccessChange"("subjectEmail");

-- SET NULL rather than CASCADE: a Staff row should never be deleted (it is referenced by owned
-- requests and by the audit trail), but if one ever is, the record of what they changed must
-- survive them.
ALTER TABLE "AccessChange"
  ADD CONSTRAINT "AccessChange_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
