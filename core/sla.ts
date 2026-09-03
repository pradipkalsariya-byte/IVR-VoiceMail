// core/sla.ts — the response clock.
//
// PURE. Two findings from the mail analysis shape this:
//
//  1. A quarter of parent mail arrives 06:00-09:00 IST, before the desk is staffed, and 13%
//     lands between 21:00 and 06:00. A clock that starts on arrival would mark the desk late
//     for messages nobody could have seen. So the clock starts at DESK OPEN.
//  2. Weekend traffic is real (17% of parent mail), so Saturday counts as a working day.
//
// Targets here are seed values. In the real module they are CONFIG per campus, set by the
// desk and agreed with leadership — never hardcoded, never handed down.

import type { Urgency } from './taxonomy';

export interface DeskHours {
  /** Minutes from midnight, in the desk's local timezone. */
  openMin: number;
  closeMin: number;
  /** 0 = Sunday. Days the desk is staffed. */
  workingDays: number[];
  /** Offset from UTC in minutes. IST = +330. */
  tzOffsetMin: number;
}

export const DEFAULT_DESK: DeskHours = {
  openMin: 8 * 60,
  closeMin: 17 * 60,
  workingDays: [1, 2, 3, 4, 5, 6], // Mon-Sat; Indian school week
  tzOffsetMin: 330,
};

/** Working hours allowed for a first reply, by urgency. Seed values; CONFIG in production. */
export const TARGET_WORKING_HOURS: Record<Urgency, number> = {
  critical: 1,
  high: 4,
  normal: 9, // one working day
  low: 18, // two working days
};

/**
 * Working hours allowed for a human ACKNOWLEDGEMENT, by urgency — the second clock (QM-D12,
 * 2026-08-07). Deliberately much tighter than the reply targets: acknowledging is "a human has
 * looked at this", not "a human has answered it", and the family's experience being measured
 * is the silence before anyone looks. Seed values; CONFIG per campus in production, same as
 * the reply targets above.
 */
export const ACK_TARGET_WORKING_HOURS: Record<Urgency, number> = {
  critical: 0.5, // 30 minutes
  high: 1,
  normal: 4,
  low: 9, // one working day, matching the 08:00-17:00 desk above
};

const MIN = 60_000;

const toLocal = (d: Date, tz: number) => new Date(+d + tz * MIN);
const toUtc = (d: Date, tz: number) => new Date(+d - tz * MIN);

/**
 * When the response clock starts: the moment of arrival if the desk is open, otherwise the
 * next desk-open moment.
 */
export function clockStart(arrivedAt: Date, desk: DeskHours = DEFAULT_DESK): Date {
  const local = toLocal(arrivedAt, desk.tzOffsetMin);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const day = local.getUTCDay();

  const isWorkingDay = desk.workingDays.includes(day);
  if (isWorkingDay && minutes >= desk.openMin && minutes < desk.closeMin) return arrivedAt;

  // Advance to the next working day's opening bell.
  const cursor = new Date(local);
  if (!(isWorkingDay && minutes < desk.openMin)) {
    cursor.setUTCDate(cursor.getUTCDate() + 1); // after close, or a closed day
  }
  for (let i = 0; i < 14; i++) {
    if (desk.workingDays.includes(cursor.getUTCDay())) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  cursor.setUTCHours(Math.floor(desk.openMin / 60), desk.openMin % 60, 0, 0);
  return toUtc(cursor, desk.tzOffsetMin);
}

/** Add working hours to a start instant, skipping closed hours and closed days. */
export function addWorkingHours(from: Date, hours: number, desk: DeskHours = DEFAULT_DESK): Date {
  let remaining = Math.max(0, hours) * 60;
  let cursor = clockStart(from, desk);

  for (let guard = 0; guard < 400 && remaining > 0; guard++) {
    const local = toLocal(cursor, desk.tzOffsetMin);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    const leftToday = desk.closeMin - minutes;

    if (leftToday >= remaining) return new Date(+cursor + remaining * MIN);

    remaining -= leftToday;
    // Jump to the next working day's open.
    const next = new Date(local);
    next.setUTCDate(next.getUTCDate() + 1);
    for (let i = 0; i < 14; i++) {
      if (desk.workingDays.includes(next.getUTCDay())) break;
      next.setUTCDate(next.getUTCDate() + 1);
    }
    next.setUTCHours(Math.floor(desk.openMin / 60), desk.openMin % 60, 0, 0);
    cursor = toUtc(next, desk.tzOffsetMin);
  }
  return cursor;
}

export function slaDue(arrivedAt: Date, urgency: Urgency, desk: DeskHours = DEFAULT_DESK): Date {
  return addWorkingHours(arrivedAt, TARGET_WORKING_HOURS[urgency], desk);
}

/**
 * The acknowledgement target (QM-D12): by when must a human have LOOKED at this request.
 *
 * Anchored on `filedAt` — the FILING moment, not capture/arrival. That is the ruling's core:
 * an unfiled item is not yet anyone's to acknowledge, and the response clock (slaDue, anchored
 * on arrival per SD-COM-11) already covers the pre-filing wait. On the `app` channel submission
 * IS filing (QM-D34(5)), so there `filedAt` equals the submission instant.
 *
 * Same desk-hours walk as the reply arithmetic — one walker, two clocks. A request filed after
 * close starts its acknowledgement clock at the next opening bell, exactly like a reply.
 */
export function ackDueFrom(filedAt: Date, desk: DeskHours, urgency: Urgency): Date {
  return addWorkingHours(filedAt, ACK_TARGET_WORKING_HOURS[urgency], desk);
}

export type SlaState = 'on-track' | 'due-soon' | 'breached' | 'met';

/** Where a request stands. `met` once a first reply has gone out, on time or not. */
export function slaState(args: {
  dueAt: Date | null | undefined;
  firstReplyAt?: Date | null;
  now: Date;
}): SlaState {
  const { dueAt, firstReplyAt, now } = args;
  if (firstReplyAt) return 'met';
  if (!dueAt) return 'on-track';
  const msLeft = +dueAt - +now;
  if (msLeft < 0) return 'breached';
  if (msLeft <= 60 * MIN) return 'due-soon';
  return 'on-track';
}

/** "3h 20m late" / "in 45m" — for the queue. */
export function humanGap(from: Date, to: Date): string {
  const mins = Math.round(Math.abs(+to - +from) / MIN);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
