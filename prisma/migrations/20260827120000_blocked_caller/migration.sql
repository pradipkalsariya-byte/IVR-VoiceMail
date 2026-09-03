-- A caller whose missed calls should stop becoming callback slips. One live number was
-- generating ~11.6 slips a day; it and the next-busiest share a landline prefix and read as the
-- school's own extensions. Blocking stops future slips and retires existing ones; nothing is
-- deleted.
CREATE TABLE "BlockedCaller" (
    "id" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlockedCaller_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlockedCaller_phoneKey_key" ON "BlockedCaller"("phoneKey");
