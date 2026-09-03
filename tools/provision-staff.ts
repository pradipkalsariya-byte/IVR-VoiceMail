// tools/provision-staff.ts — give a real Google account a Front Desk role (2026-08-24, the
// sign-in port). Sign-in only proves WHO someone is; this is the capability half — being on
// a school domain never implies a role (estate rule).
//
// Run: npx tsx tools/provision-staff.ts --email a@b --name "Full Name" --role frontdesk --campus fsk
//      … --apply to write. Preview by default, like every write path here.
//
// Roles are the seed's own grant templates, so a provisioned person holds exactly what the
// equivalent persona holds:
//   frontdesk — view_queue, file, assign, resolve            (campus required)
//   lead      — the above + triage_approve                   (campus required; QM-D10's second pair of eyes)
//   oversight — the oversight umbrella, group scope          (NOT view_safeguarding — that
//               stays a NAMED grant, R3-4; add it deliberately or not at all)
//
// Upserts by email: re-running with a different role UPDATES the person, so a promotion is
// this same command, not a new row. A NEW Staff row is created rather than mutating the
// seeded personas — the switcher keeps running on those until the pilot ends.

import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const db = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROLES: Record<string, { roleLabel: string; grants: string[]; needsCampus: boolean }> = {
  frontdesk: { roleLabel: 'Front Desk', grants: ['view_queue', 'file', 'assign', 'resolve'], needsCampus: true },
  lead: { roleLabel: 'Campus Lead', grants: ['view_queue', 'file', 'assign', 'resolve', 'triage_approve'], needsCampus: true },
  oversight: { roleLabel: 'Leadership', grants: ['oversight'], needsCampus: false },
};

async function main() {
  const email = arg('email')?.toLowerCase();
  const name = arg('name');
  const role = arg('role');
  const campus = arg('campus');

  if (!email || !name || !role || !ROLES[role]) {
    console.error('Usage: npx tsx tools/provision-staff.ts --email a@school --name "Full Name" --role frontdesk|lead|oversight [--campus fsk|fwgs|fsm|falh] [--apply]');
    process.exit(1);
  }
  const tpl = ROLES[role];
  const scope = tpl.needsCampus ? campus : 'group';
  if (!scope || (tpl.needsCampus && !campus)) {
    console.error(`Role "${role}" needs --campus.`);
    process.exit(1);
  }
  if (tpl.needsCampus) {
    const exists = await db.orgUnit.findUnique({ where: { code: scope } });
    if (!exists || exists.type !== 'CAMPUS') {
      console.error(`No campus with code "${scope}".`);
      process.exit(1);
    }
  }

  const existing = await db.staff.findUnique({ where: { email } });
  console.log(existing
    ? `UPDATE ${email}: ${existing.roleLabel}/${existing.scopeOrgUnitId} -> ${tpl.roleLabel}/${scope} grants=[${tpl.grants.join(', ')}]`
    : `CREATE ${email}: ${name} as ${tpl.roleLabel}/${scope} grants=[${tpl.grants.join(', ')}]`);

  if (!APPLY) {
    console.log('Preview only — run with --apply to write.');
    return;
  }

  const id = existing?.id ?? `staff-${email.replace(/[^a-z0-9]+/g, '-')}`;
  await db.staff.upsert({
    where: { email },
    update: { name, roleLabel: tpl.roleLabel, scopeOrgUnitId: scope, permissions: tpl.grants },
    create: {
      id, email, name,
      roleLabel: tpl.roleLabel, scopeOrgUnitId: scope, permissions: tpl.grants,
    },
  });
  console.log(`Provisioned. ${email} signs in and lands on the queue.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
