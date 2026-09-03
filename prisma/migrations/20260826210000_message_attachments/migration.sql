-- Attachment metadata per message (feedback #23): name, type and size, never the bytes.
-- Defaults to an empty array so every existing row is immediately valid and no backfill is
-- needed — messages ingested before this simply report nothing attached, which is the honest
-- answer: we did not record it at the time.
ALTER TABLE "RequestMessage" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
