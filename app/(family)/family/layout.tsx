import Link from 'next/link';
import { db } from '@/lib/db';
import { currentFamily } from '@/lib/family-session';
import { FamilySwitcher } from '@/components/FamilySwitcher';
import { ThemeToggle } from '../../_ThemeToggle';

// The PARENT face (QM-D34(1)): one item, two faces — this chrome is the thread's face, so it
// carries NOTHING of the staff face. No queue, no nav to it, no owner names anywhere below
// this layout: threads belong to a role/office (SD-COM-2), so the school always appears as
// "Front Office", never as a person. Deliberately a plain navbar, not the staff sidebar rail —
// a parent is here to say one thing and see where it stands, not to operate a desk.
export default async function FamilyLayout({ children }: { children: React.ReactNode }) {
  const family = await currentFamily();
  const families = await db.family.findMany({
    orderBy: { label: 'asc' },
    select: { id: true, label: true },
  });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="fh-navbar">
        <Link href="/family" className="flex items-center gap-2 font-heading text-base font-bold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm text-primary-foreground">F</span>
        </Link>
        <span className="text-sm text-muted">Fountainhead Schools</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs uppercase tracking-widest text-subtle sm:inline">
            Prototype · synthetic data
          </span>
          <FamilySwitcher
            familyId={family.id}
            families={families.map(f => ({ id: f.id, label: f.label }))}
          />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[880px] flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
