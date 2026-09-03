// tools/import-family-phones.ts — real guardian phone numbers, from the school's own export.
//
// Run: npx tsx tools/import-family-phones.ts --file <path.xlsx>             preview
//      npx tsx tools/import-family-phones.ts --file <path.xlsx> --apply     writes
//
// PREVIEWS BY DEFAULT, matching every other write path in this repo family — the safe mode is
// the one you get by typing less.
//
// WHY THIS EXISTS (VK, 2026-08-12): the first real "Pull new mail" proved the pipe works, but
// phone matching (missed calls, QuickLog) had nothing to match against — no phone number exists
// anywhere in the estate yet. VK is sourcing the school's own current student-report export,
// campus by campus (FWGS first, FSK following).
//
// NARROW BY DESIGN: this file has 27 columns — birth date, blood group, address, nationality,
// transport, school timing. Only five are ever read: School ID (logging only), First/Last Name,
// Parent Email (the join key — matches Family.emailKey, same convention core/senders.ts already
// classifies), Father/Mother Mobile. Named-key extraction only, same discipline as
// career-counselling's engine/roster.ts: a column not named here lands nowhere, no matter what
// the export adds later.
//
// ONE Family.phoneKey scalar could not hold what this file actually shows: father's and
// mother's mobiles genuinely differ per family. FamilyPhone (2026-08-12 migration) holds both,
// and a caller matches on EITHER.

import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { emailVariants, campusForAddress } from '../core/senders';
import { normalisePhone } from '../core/phone';

const APPLY = process.argv.includes('--apply');
const fileArg = process.argv.indexOf('--file');
const FILE = fileArg >= 0 ? process.argv[fileArg + 1] : undefined;

// A standalone PrismaClient, not lib/db's shared one: that file imports 'server-only', which
// throws unconditionally outside Next's server runtime — including under a plain tsx script.
const db = new PrismaClient();

interface Row {
  schoolId: string;
  name: string;
  parentEmail: string;
  campusOrgUnitId: string;
  phones: Array<{ label: string; phoneKey: string }>;
}

async function main() {
  if (!FILE) {
    console.error('REFUSING: no file. Usage: npx tsx tools/import-family-phones.ts --file <path.xlsx> [--apply]');
    process.exit(1);
  }
  console.log(APPLY ? '— APPLYING —\n' : '— PREVIEW: nothing will be written. Add --apply to write. —\n');

  const wb = XLSX.readFile(FILE);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  console.log(`source: ${FILE}`);
  console.log(`read: ${raw.length} row(s) from sheet "${wb.SheetNames[0]}"\n`);

  const str = (v: unknown): string | null => (typeof v === 'string' ? v.trim() || null : typeof v === 'number' ? String(v) : null);

  /**
   * Read a column by any of the names the school's export has actually used.
   *
   * The first version hard-coded the FWGS file's headers. The FSK export (27-Aug-2026)
   * arrived with `Parents Email`, `Father's Mobile` and `Mother's Mobile` — the same data,
   * three different labels — and every one of its 2,629 rows would have been skipped as
   * 'missing school id, name, or parent email'. Silently, and with a plausible-looking
   * summary at the end.
   *
   * The export is the source of truth and it is not ours to standardise, so the reader
   * accepts the variants instead. Still NAMED-KEY ONLY — a column not listed here is not
   * read, whatever the export adds later.
   */
  const pick = (r: Record<string, unknown>, ...names: string[]): string | null => {
    for (const n of names) {
      const v = str(r[n]);
      if (v) return v;
    }
    return null;
  };

  const EMAIL_COLS  = ["Parent Email", "Parents Email", "Parent's Email", "Parents' Email"];
  const FATHER_COLS = ["Father Mobile", "Father's Mobile", "Fathers Mobile"];
  const MOTHER_COLS = ["Mother Mobile", "Mother's Mobile", "Mothers Mobile"];

  const rows: Row[] = [];
  const issues: string[] = [];
  raw.forEach((r, i) => {
    const schoolId = str(r['School ID']);
    const first = str(r['First Name']);
    const last = str(r['Last Name']);
    const parentEmail = pick(r, ...EMAIL_COLS)?.toLowerCase() ?? null;
    if (!schoolId || !first || !last || !parentEmail) {
      issues.push(`row ${i + 2}: missing school id, name, or parent email — skipped`);
      return;
    }
    const campusOrgUnitId = campusForAddress(parentEmail);
    if (!campusOrgUnitId) {
      issues.push(`row ${i + 2} (${schoolId}): parent email domain not recognised — skipped`);
      return;
    }
    const phones: Row['phones'] = [];
    const father = normalisePhone(pick(r, ...FATHER_COLS) ?? '');
    const mother = normalisePhone(pick(r, ...MOTHER_COLS) ?? '');
    if (father) phones.push({ label: 'Father', phoneKey: father });
    if (mother && mother !== father) phones.push({ label: 'Mother', phoneKey: mother });

    rows.push({ schoolId, name: `${first} ${last}`, parentEmail, campusOrgUnitId, phones });
  });

  console.log(`parsed: ${rows.length} usable row(s), ${issues.length} skipped`);
  if (issues.length) {
    console.log(issues.slice(0, 20).map(i => `    ${i}`).join('\n'));
    if (issues.length > 20) console.log(`    … and ${issues.length - 20} more`);
  }
  if (!rows.length) {
    console.error('\nREFUSING: nothing usable. Nothing to do.');
    process.exit(1);
  }

  // Siblings share a parent email (confirmed empirically absent in the career-counselling
  // roster, but this is a different source — grouped defensively, same as import-family-roster.ts.
  const byEmail = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byEmail.has(r.parentEmail)) byEmail.set(r.parentEmail, []);
    byEmail.get(r.parentEmail)!.push(r);
  }

  const conflicts: string[] = [];
  const wanted = new Map<string, { label: string; campusOrgUnitId: string; phones: Row['phones'] }>();
  for (const [email, group] of byEmail) {
    const campuses = new Set(group.map(g => g.campusOrgUnitId));
    if (campuses.size > 1) {
      conflicts.push(`${email}: children split across campuses (${[...campuses].join(', ')}) — skipped`);
      continue;
    }
    const names = group.map(g => g.name).sort();
    // Phones are the same parent's numbers regardless of which child's row carried them —
    // union rather than pick one, deduped by phoneKey.
    const phoneMap = new Map(group.flatMap(g => g.phones).map(p => [p.phoneKey, p]));
    wanted.set(email, {
      label: names.length > 1 ? `Parent of ${names.join(' & ')}` : `Parent of ${names[0]}`,
      campusOrgUnitId: group[0].campusOrgUnitId,
      phones: [...phoneMap.values()],
    });
  }

  const existingFamilies = new Map(
    (await db.family.findMany({ select: { id: true, emailKey: true, label: true, campusOrgUnitId: true } }))
      .map(f => [f.emailKey, f]),
  );
  const existingPhonesByFamily = new Map<string, Set<string>>();
  for (const p of await db.familyPhone.findMany({ select: { familyId: true, phoneKey: true } })) {
    if (!existingPhonesByFamily.has(p.familyId)) existingPhonesByFamily.set(p.familyId, new Set());
    existingPhonesByFamily.get(p.familyId)!.add(p.phoneKey);
  }

  let familiesCreated = 0;
  let familiesUpdated = 0;
  let familiesMatchedUnchanged = 0;
  let phonesAdded = 0;
  let phonesUnchanged = 0;
  const noNumberYet: string[] = [];

  for (const [email, want] of wanted) {
    const variants = emailVariants(email);
    let family = variants.map(v => existingFamilies.get(v)).find(Boolean) ?? null;

    if (!family) {
      familiesCreated++;
      const id = randomUUID();
      if (APPLY) {
        await db.family.create({ data: { id, label: want.label, emailKey: email, campusOrgUnitId: want.campusOrgUnitId } });
      }
      family = { id, emailKey: email, label: want.label, campusOrgUnitId: want.campusOrgUnitId };
    } else if (family.label !== want.label || family.campusOrgUnitId !== want.campusOrgUnitId) {
      familiesUpdated++;
      if (APPLY) {
        await db.family.update({ where: { id: family.id }, data: { label: want.label, campusOrgUnitId: want.campusOrgUnitId } });
      }
    } else {
      // Matched an existing family (often one career-counselling already knew, from its G7-12
      // roster) with nothing to change on the Family row itself — but phones below still apply.
      // Reported as its own count: silently folding this into "0 to update" is exactly what sent
      // the first FWGS run's 292-vs-188 family count chasing a phantom bug that wasn't one.
      familiesMatchedUnchanged++;
    }

    if (!want.phones.length) { noNumberYet.push(email); continue; }
    const have = existingPhonesByFamily.get(family.id) ?? new Set<string>();
    for (const p of want.phones) {
      if (have.has(p.phoneKey)) { phonesUnchanged++; continue; }
      phonesAdded++;
      if (APPLY) {
        await db.familyPhone.create({ data: { id: randomUUID(), familyId: family.id, phoneKey: p.phoneKey, label: p.label } });
      }
    }
  }

  console.log(`\nfamilies: ${familiesCreated} created, ${familiesUpdated} updated, ${familiesMatchedUnchanged} matched an existing family unchanged`);
  console.log(`  (${familiesCreated + familiesUpdated + familiesMatchedUnchanged} total families touched — phones apply to all three groups, not just the created/updated ones)`);
  console.log(`phones: ${phonesAdded} to add, ${phonesUnchanged} already on file`);
  if (noNumberYet.length) console.log(`${noNumberYet.length} matched row(s) had no usable Father/Mother mobile — no phone added, family still processed`);
  if (conflicts.length) {
    console.log(`\n${conflicts.length} row(s) SKIPPED — same-campus assumption did not hold:`);
    for (const c of conflicts.slice(0, 10)) console.log(`    ${c}`);
  }

  // ---------------------------------------------------------------- link existing callbacks
  //
  // Ingest matches a caller's number to a family AT CREATION (lib/ingest/run.ts). Every callback
  // slip taken before these numbers existed therefore has familyId null and stays anonymous for
  // ever, because the Switchboard reads the stored relation rather than re-matching on render.
  //
  // Found the hard way on 27-Aug-2026: the FSK import wrote 5,229 numbers and the Switchboard
  // still showed 147 anonymous callers, because importing phones and USING phones are two
  // different things. Linking belongs HERE rather than in a script somebody has to remember,
  // because this import is the only moment the answer can change.
  const unlinked = await db.request.findMany({
    where: { isSwitchboard: true, familyId: null },
    select: { id: true, subject: true },
  });
  let linked = 0, stillUnknown = 0;
  for (const slip of unlinked) {
    const m = (slip.subject ?? '').match(/(\d{10})\s*$/);
    if (!m) { stillUnknown++; continue; }
    const hit = await db.familyPhone.findFirst({
      where: { phoneKey: m[1] }, select: { familyId: true },
    });
    if (!hit) { stillUnknown++; continue; }
    linked++;
    if (APPLY) await db.request.update({ where: { id: slip.id }, data: { familyId: hit.familyId } });
  }
  if (unlinked.length) {
    console.log(`\ncallback slips: ${linked} now match a family, ${stillUnknown} still show only a number`);
    console.log('  (a number not on file is usually a second phone, a grandparent or a driver '
      + '-- or a caller who is not a parent at all)');
  }

  console.log(APPLY ? '\ndone' : '\npreview only — nothing written. Re-run with --apply to write.');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
