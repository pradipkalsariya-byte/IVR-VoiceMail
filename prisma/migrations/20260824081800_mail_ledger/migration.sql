-- CreateTable
CREATE TABLE "MailLedgerEntry" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT,
    "source" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "recipients" TEXT[],
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "requestId" TEXT,

    CONSTRAINT "MailLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailLedgerEntry_messageId_key" ON "MailLedgerEntry"("messageId");

-- CreateIndex
CREATE INDEX "MailLedgerEntry_processedAt_idx" ON "MailLedgerEntry"("processedAt");

-- CreateIndex
CREATE INDEX "MailLedgerEntry_requestId_idx" ON "MailLedgerEntry"("requestId");

-- AddForeignKey
ALTER TABLE "MailLedgerEntry" ADD CONSTRAINT "MailLedgerEntry_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: unlike recruitment's ledger (whose pre-ledger mail had lost sender and subject,
-- so its record honestly starts at its birthday), front-desk kept everything on the Request
-- row — so the ledger can carry the full history from day one. One row per already-ingested
-- message (sourceMessageId is the same unique key live ingestion writes), outcome derived
-- from what the request became. Deterministic ids ('led-' + request id) keep this idempotent
-- if a migration is ever re-applied against restored data. Seeded demo rows carry no
-- sourceMessageId and are correctly untouched.
INSERT INTO "MailLedgerEntry"
  ("id", "messageId", "threadId", "source", "channel", "fromName", "fromEmail", "recipients",
   "subject", "receivedAt", "processedAt", "outcome", "detail", "requestId")
SELECT
  'led-' || r."id",
  r."sourceMessageId",
  r."sourceThreadId",
  -- Source by DATA SHAPE, not by fixture prefix: real Gmail thread ids are long hex, every
  -- fixture's is a readable slug ('demo-thr-…', 'app-thr-…', 't-…'). The first cut keyed on
  -- a '<demo-' Message-ID prefix and misclassified the '<app-fixture-…' rows as gmail —
  -- which rendered an Open-in-Gmail link on fabricated mail (caught live, 24-Aug).
  CASE
    WHEN r."channel" <> 'email' THEN 'app'
    WHEN r."sourceThreadId" ~ '^[0-9a-f]{10,}$' THEN 'gmail'
    ELSE 'demo'
  END,
  r."channel",
  NULL,
  r."senderEmail",
  r."originalRecipients",
  r."subject",
  r."arrivedAt",
  r."arrivedAt",
  CASE
    WHEN r."isVendorNoise" THEN 'parked_vendor'
    WHEN r."isAutomated"   THEN 'parked_automated'
    ELSE 'new_request'
  END,
  'Backfilled from the request record — replies that joined this thread are on the request itself.',
  r."id"
FROM "Request" r
-- email + app only: missed-call CAPTURES also carry a (derived) sourceMessageId, but they are
-- per-call rows exploded out of one report mail, not mailbox messages — the report itself is
-- the ledger's row. Live ingestion draws the same line (one row per IncomingMessage).
WHERE r."sourceMessageId" IS NOT NULL AND r."channel" IN ('email', 'app')
ON CONFLICT ("messageId") DO NOTHING;
