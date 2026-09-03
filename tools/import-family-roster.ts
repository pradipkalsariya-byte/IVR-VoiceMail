// tools/import-family-roster.ts — Family rows from career-counselling's real FSK/FWGS roster.
//
// Run: npx tsx tools/import-family-roster.ts             preview
//      npx tsx tools/import-family-roster.ts --apply     writes
//
// PREVIEWS BY DEFAULT, matching career-counselling's own import-roster.ts — the safe mode is the
// one you get by typing less.
//
// WHY THIS EXISTS (VK, 2026-08-12): most real front-desk parent mail arrives from a school-issued
// p.<child-first>.<child-last>@<domain> alias, and career-counselling already imported the real
// FSK (1,212 students) + FWGS (104 students) rosters — including that exact parentEmail — from
// legacy Nucleus, through its own deliberate, VK-reviewed privacy boundary (engine/roster.ts:
// "a school-managed alias is school infrastructure, not personal contact data"). This script
// reuses that already-vetted data rather than re-deriving it: a one-time read of
// career-counselling's own database, writing only Family rows here — no phone number, no
// guardianFields, nothing beyond what that boundary already cleared.
//
// WHAT IT DOES NOT DO: phone matching (no phone number exists anywhere in the estate yet — see
// BACKLOG.md), and it never CREATES a career-counselling Student — this is read-only against that
// database. Campuses are matched by OrgUnit.id and never created here, same reasoning as
// career-counselling's own script: a campus is org structure, not something a roster feed invents.

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { emailVariants } from '../core/senders';

// A standalone PrismaClient, not lib/db's shared one: that file imports 'server-only', which
// throws unconditionally outside Next's server runtime — including under a plain tsx script.
const db = new PrismaClient();

const APPLY = process.argv.includes('--apply');

// The documented local default (career-counselling/.env.example) — override for any other target.
const CC_URL =
  process.env.CAREER_COUNSELLING_DATABASE_URL ??
  'postgresql://nucleus:nucleus@localhost:5442/career_counselling?schema=public';

// FSK/FWGS only: the two campuses career-counselling's roster actually covers (its own README
// restricts to these) and the two front-desk OrgUnit ids happen to equal their lowercase codes.
const CAMPUS_ORG_UNIT: Record<string, string> = { FSK: 'fsk', FWGS: 'fwgs' };

interface RosterRow {
  fskId: string;
  name: string;
  parentEmail: string;
  campusCode: string;
}

async function main() {
  console.log(APPLY ? '— APPLYING —\n' : '— PREVIEW: nothing will be written. Add --apply to write. —\n');

  const orgUnits = new Set((await db.orgUnit.findMany({ where: { type: 'CAMPUS' }, select: { id: true } })).map(o => o.id));
  const missing = Object.values(CAMPUS_ORG_UNIT).filter(id => !orgUnits.has(id));
  if (missing.length) {
    console.error(`REFUSING: front-desk has no campus OrgUnit with id(s): ${missing.join(', ')}`);
    process.exit(1);
  }

  const cc = new PrismaClient({ datasourceUrl: CC_URL });
  let rows: RosterRow[];
  try {
    rows = await cc.$queryRaw<RosterRow[]>`
      SELECT s."fskId", s."name", s."parentEmail", c.code AS "campusCode"
      FROM "Student" s
      JOIN "Campus" c ON c.id = s."campusId"
      WHERE s."parentEmail" IS NOT NULL AND c.code IN ('FSK', 'FWGS')
    `;
  } catch (e) {
    console.error(`REFUSING: could not read career-counselling's database at the configured URL.\n${e instanceof Error ? e.message : e}`);
    process.exit(1);
  } finally {
    await cc.$disconnect();
  }

  console.log(`source: career-counselling (${CC_URL.replace(/:[^:@]+@/, ':***@')})`);
  console.log(`read: ${rows.length} student row(s) with a parent email on FSK/FWGS\n`);
  if (!rows.length) {
    console.error('REFUSING: nothing to import. Nothing to do.');
    process.exit(1);
  }

  // Siblings share a parent email (career-counselling's own CLAUDE.md: "a real, expected shape
  // of the data") — Family.emailKey is unique, so this groups by email BEFORE writing, once,
  // rather than letting the second sibling collide on create.
  const byEmail = new Map<string, RosterRow[]>();
  for (const r of rows) {
    const key = r.parentEmail.trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key)!.push(r);
  }

  const conflicts: string[] = [];
  const wanted = new Map<string, { label: string; campusOrgUnitId: string; children: string[] }>();
  for (const [emailKey, students] of byEmail) {
    const campuses = new Set(students.map(s => s.campusCode));
    if (campuses.size > 1) {
      // Not assumed impossible, just never silently resolved — the same stance as
      // career-counselling's own email-collision guard.
      conflicts.push(`${emailKey}: children split across campuses (${[...campuses].join(', ')}) — skipped`);
      continue;
    }
    const names = students.map(s => s.name).sort();
    wanted.set(emailKey, {
      label: names.length > 1 ? `Parent of ${names.join(' & ')}` : `Parent of ${names[0]}`,
      campusOrgUnitId: CAMPUS_ORG_UNIT[students[0].campusCode],
      children: students.map(s => s.fskId),
    });
  }

  // Both alias domains resolve to the SAME family — matched here the same way lib/ingest/run.ts
  // matches at ingest time, so a re-run never creates a second row for the domain this roster
  // did not happen to record.
  const existingByKey = new Map(
    (await db.family.findMany({ select: { id: true, emailKey: true, label: true, campusOrgUnitId: true } }))
      .map(f => [f.emailKey, f]),
  );

  let created = 0;
  const updated: string[] = [];
  let unchanged = 0;

  for (const [emailKey, want] of wanted) {
    const variants = emailVariants(emailKey);
    const existing = variants.map(v => existingByKey.get(v)).find(Boolean);

    if (!existing) {
      created++;
      if (APPLY) {
        await db.family.create({
          data: { id: randomUUID(), label: want.label, emailKey, campusOrgUnitId: want.campusOrgUnitId },
        });
      }
      continue;
    }
    const changed = existing.label !== want.label || existing.campusOrgUnitId !== want.campusOrgUnitId;
    if (!changed) { unchanged++; continue; }
    updated.push(`${existing.label} -> ${want.label}`);
    if (APPLY) {
      await db.family.update({
        where: { id: existing.id },
        data: { label: want.label, campusOrgUnitId: want.campusOrgUnitId },
      });
    }
  }

  console.log(`families: ${created} to create, ${updated.length} to update, ${unchanged} unchanged`);
  if (updated.length) console.log(updated.slice(0, 12).map(u => `    ~ ${u}`).join('\n'));
  if (conflicts.length) {
    console.log(`\n${conflicts.length} row(s) SKIPPED — same-campus assumption did not hold, fix upstream:`);
    for (const c of conflicts.slice(0, 10)) console.log(`    ${c}`);
  }

  console.log(APPLY ? '\ndone' : '\npreview only — nothing written. Re-run with --apply to write.');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
