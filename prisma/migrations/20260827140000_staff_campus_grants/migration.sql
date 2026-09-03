-- Which campuses a person may work in. One row per campus held.
--
-- Staff.scopeOrgUnitId holds exactly one campus, so somebody covering two had to be given
-- 'group' (every campus, present and future) or entered twice. Ported from route-planning's
-- AppUserCampus, the estate's precedent for multi-campus rights.
CREATE TABLE "StaffCampus" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "campusOrgUnitId" TEXT,
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffCampus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffCampus_staffId_campusOrgUnitId_key" ON "StaffCampus"("staffId", "campusOrgUnitId");
CREATE INDEX "StaffCampus_staffId_idx" ON "StaffCampus"("staffId");

ALTER TABLE "StaffCampus" ADD CONSTRAINT "StaffCampus_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BACKFILL: every existing person keeps exactly the access they have today, expressed as a
-- grant. 'group' becomes the NULL (all-campuses) row; anything else becomes that one campus.
-- Nobody gains or loses access in this migration — that is the whole point of doing it here
-- rather than leaving the table empty and locking everyone out on deploy.
INSERT INTO "StaffCampus" ("id", "staffId", "campusOrgUnitId", "grantedBy", "grantedAt")
SELECT
    'sc_' || "id",
    "id",
    CASE WHEN "scopeOrgUnitId" = 'group' THEN NULL ELSE "scopeOrgUnitId" END,
    'migration:20260827140000',
    CURRENT_TIMESTAMP
FROM "Staff";
