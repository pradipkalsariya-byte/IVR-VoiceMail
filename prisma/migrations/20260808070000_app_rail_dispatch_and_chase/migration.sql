-- QM-D35: a reply is content + delivery intent; the engine's chosen rails are recorded on the
-- message so there is one outbound voice and one history whatever carried it.
ALTER TABLE "RequestMessage" ADD COLUMN "dispatch" TEXT[] NOT NULL DEFAULT '{}';

-- QM-D14: the chase is a real owned work item with its own lifecycle. Reference-only by
-- construction — no subject, family, or narrative column exists, so a chase can never widen
-- the audience of a restricted record.
CREATE TABLE "Chase" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "campusOrgUnitId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "outcome" TEXT,

    CONSTRAINT "Chase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Chase_requestId_idx" ON "Chase"("requestId");

ALTER TABLE "Chase" ADD CONSTRAINT "Chase_requestId_fkey" FOREIGN KEY ("requestId")
    REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Chase" ADD CONSTRAINT "Chase_closedById_fkey" FOREIGN KEY ("closedById")
    REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
