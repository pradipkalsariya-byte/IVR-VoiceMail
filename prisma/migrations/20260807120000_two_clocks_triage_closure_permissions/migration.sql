-- Two clocks, the triage gate, closure requirements, permissions, and the alumnus sender kind.
-- Rulings: QM-D10 (seriousness + second pair of eyes; approval never gates the response),
-- QM-D12 (acknowledgement is a measured state firing on filing), QM-D15 (NO stored overdue flag
-- anywhere -- derived on read), QM-D18 (closure needs a rating OR a coded absence reason),
-- QM-D34 (the `app` channel; response target consumes SD-COM-11's locked per-campus target),
-- QM-D40 (alumnus as its own sender kind), QM-D9/D26 (capability grants replace isLeadership).

-- The two clocks
ALTER TABLE "Request" ADD COLUMN "ackDueAt" TIMESTAMP(3);
ALTER TABLE "Request" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);

-- Triage gate (QM-D10)
ALTER TABLE "Request" ADD COLUMN "seriousness" TEXT;
ALTER TABLE "Request" ADD COLUMN "triageApprovedById" TEXT;
ALTER TABLE "Request" ADD COLUMN "triageApprovedAt" TIMESTAMP(3);
ALTER TABLE "Request" ADD CONSTRAINT "Request_triageApprovedById_fkey"
  FOREIGN KEY ("triageApprovedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Closure (QM-D18)
ALTER TABLE "Request" ADD COLUMN "satisfaction" INTEGER;
ALTER TABLE "Request" ADD COLUMN "satisfactionAbsentReason" TEXT;

-- Capability grants (empty = no special capability; seed grants the oversight set)
ALTER TABLE "Staff" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
