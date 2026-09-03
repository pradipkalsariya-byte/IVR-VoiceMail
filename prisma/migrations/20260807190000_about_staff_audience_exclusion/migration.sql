-- QM-D32/D33: a complaint ABOUT a staff member excludes them from the record's audience.
-- The field exists to EXCLUDE, never to ACCRUE (QM-D16(c)) — no index, because no query may
-- ever ask "complaints about person X".
ALTER TABLE "Request" ADD COLUMN "aboutStaffIds" TEXT[] NOT NULL DEFAULT '{}';
