-- Marks a request as already read by the model second pass (lib/refine.ts), so a run never
-- re-sends mail it has already paid to classify. Nullable: every existing row predates the pass.
ALTER TABLE "Request" ADD COLUMN "modelClassifiedAt" TIMESTAMP(3);

-- The refine query filters on exactly this shape.
CREATE INDEX "Request_modelClassifiedAt_idx" ON "Request"("modelClassifiedAt");
