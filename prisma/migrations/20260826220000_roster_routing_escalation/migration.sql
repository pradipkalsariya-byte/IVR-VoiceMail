-- Roster, category routing and the escalation inputs (feedback #18, #20, #21).

-- Who is on the desk, per campus, per day.
CREATE TABLE "RosterDay" (
    "id" TEXT NOT NULL,
    "campusOrgUnitId" TEXT NOT NULL,
    "onDate" TIMESTAMP(3) NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RosterDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RosterDay_campusOrgUnitId_onDate_staffId_key"
  ON "RosterDay"("campusOrgUnitId", "onDate", "staffId");
CREATE INDEX "RosterDay_campusOrgUnitId_onDate_idx" ON "RosterDay"("campusOrgUnitId", "onDate");

-- Which person usually handles which kind of request. A default, never a rule.
CREATE TABLE "CategoryRoute" (
    "id" TEXT NOT NULL,
    "campusOrgUnitId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    CONSTRAINT "CategoryRoute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CategoryRoute_campusOrgUnitId_category_key"
  ON "CategoryRoute"("campusOrgUnitId", "category");

-- CASCADE from Staff on both: a roster slot or a route belonging to a removed person is
-- meaningless on its own. Deliberately unlike the audit trail, which must outlive people.
ALTER TABLE "RosterDay" ADD CONSTRAINT "RosterDay_campusOrgUnitId_fkey"
  FOREIGN KEY ("campusOrgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RosterDay" ADD CONSTRAINT "RosterDay_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CategoryRoute" ADD CONSTRAINT "CategoryRoute_campusOrgUnitId_fkey"
  FOREIGN KEY ("campusOrgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CategoryRoute" ADD CONSTRAINT "CategoryRoute_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The away flag, and when the current owner took a request on.
ALTER TABLE "Staff" ADD COLUMN "awayUntil" TIMESTAMP(3);
ALTER TABLE "Request" ADD COLUMN "ownerSetAt" TIMESTAMP(3);

-- Existing owned requests get a starting point so the timer has something to judge, rather
-- than every historical item escalating at once on the first tick after deploy. Their filing
-- time is the closest honest answer to "when did somebody take this on".
UPDATE "Request" SET "ownerSetAt" = "arrivedAt" WHERE "ownerId" IS NOT NULL;
