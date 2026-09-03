-- IVR voicemail audio (docs/IVR-VOICEMAIL-BRIEF.md) — the BACKLOG's ready item: the
-- /api/voicemail endpoint was specified, not built, until now. One row per call, 1:1 with the
-- Request it filed. Bytes are stored here (Postgres bytea) rather than kept metadata-only like
-- RequestMessage.attachments — an email attachment's original stays in Gmail; a voicemail has
-- no such second copy, and the brief itself asks that we hold the audio ourselves.
CREATE TABLE "VoicemailAudio" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "dialledNumber" TEXT NOT NULL,
    "callerNumber" TEXT NOT NULL,
    "ivrMenu" TEXT,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "audio" BYTEA NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoicemailAudio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoicemailAudio_requestId_key" ON "VoicemailAudio"("requestId");

ALTER TABLE "VoicemailAudio" ADD CONSTRAINT "VoicemailAudio_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
