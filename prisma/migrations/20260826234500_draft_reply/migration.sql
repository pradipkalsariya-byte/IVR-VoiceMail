-- A suggested reply the desk edits and sends themselves. The app has no send path; this is
-- text, not an outbox. Nullable because most requests never get one -- safeguarding by design.
ALTER TABLE "Request" ADD COLUMN "draftReply" TEXT;
ALTER TABLE "Request" ADD COLUMN "draftReplyAt" TIMESTAMP(3);
