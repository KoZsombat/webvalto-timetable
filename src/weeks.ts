/**
 * Pure calendar math on plain `YYYY-MM-DD` strings.
 *
 * Everything is UTC-anchored so a week always starts on Monday and never drifts
 * with DST. "Which date is today" is resolved separately, in the configured
 * timezone, at the edge (`todayInZone`).
 */

export const DAY_MS = 86_400_000;

/** Calendar date without time, `YYYY-MM-DD`. */
export type ISODate = string;

/** 0 = Monday … 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_NAMES = [
  'Hétfő',
  'Kedd',
  'Szerda',
  'Csütörtök',
  'Péntek',
  'Szombat',
  'Vasárnap',
] as const;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  return toISO(toDate(value)) === value;
}

/** UTC midnight of the given calendar date. Throws on malformed input. */
export function toDate(iso: ISODate): Date {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${String(iso)}`);
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Date.UTC silently rolls 2026-02-31 over into March; reject that.
  if (toISO(date) !== iso) throw new Error(`Not a real calendar date: ${iso}`);
  return date;
}

export function toISO(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, days: number): ISODate {
  return toISO(new Date(toDate(iso).getTime() + days * DAY_MS));
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(iso: ISODate): Weekday {
  return ((toDate(iso).getUTCDay() + 6) % 7) as Weekday;
}

export function mondayOf(iso: ISODate): ISODate {
  return addDays(iso, -weekdayIndex(iso));
}

/**
 * Start (Monday) of the week the timetable should show by default.
 *
 * The week rolls over early: from `rollover` (default Saturday) onward the
 * *next* week is the default view, so the weekend is spent looking at the week
 * that is about to start. Friday still shows the current week; Saturday and
 * Sunday show the next one; Monday agrees with Saturday's answer.
 */
export function displayWeek(now: ISODate, rollover: Weekday = 5): ISODate {
  const base = mondayOf(now);
  return weekdayIndex(now) >= rollover ? addDays(base, 7) : base;
}

/** ISO-8601 week number (1–53) of the week containing `iso`. */
export function isoWeekNumber(iso: ISODate): number {
  const monday = mondayOf(iso);
  const thursday = addDays(monday, 3);
  const firstThursday = isoWeek1Thursday(Number(thursday.slice(0, 4)));
  return 1 + Math.round((toDate(thursday).getTime() - toDate(firstThursday).getTime()) / (7 * DAY_MS));
}

/** Monday of ISO week `week` in `year`. */
export function isoWeekStart(year: number, week: number): ISODate {
  const firstMonday = addDays(isoWeek1Thursday(year), -3);
  return addDays(firstMonday, (week - 1) * 7);
}

/** The Thursday that defines ISO week 1: the Thursday of the week containing Jan 4. */
function isoWeek1Thursday(year: number): ISODate {
  return addDays(mondayOf(`${year}-01-04`), 3);
}

const LOCALE = 'hu-HU';
const WEEKDAY_LONG = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', weekday: 'long' });
const DAY_MONTH = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', day: 'numeric', month: 'short' });
const MONTH_SHORT = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', month: 'short' });

/** "Hétfő, nov. 16." */
export function dayLabel(iso: ISODate): string {
  const weekday = WEEKDAY_LONG.format(toDate(iso));
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${DAY_MONTH.format(toDate(iso))}`;
}

/** "2026. nov. 16–22.", "2026. nov. 30. – dec. 6.", "2025. dec. 29. – 2026. jan. 4." */
export function weekRangeLabel(weekStart: ISODate): string {
  const start = toDate(weekStart);
  const end = toDate(addDays(weekStart, 6));
  const month = (date: Date) => MONTH_SHORT.format(date);
  const day = (date: Date) => date.getUTCDate();

  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    if (start.getUTCMonth() === end.getUTCMonth()) {
      return `${start.getUTCFullYear()}. ${month(start)} ${day(start)}–${day(end)}.`;
    }
    return `${start.getUTCFullYear()}. ${month(start)} ${day(start)}. – ${month(end)} ${day(end)}.`;
  }
  return `${start.getUTCFullYear()}. ${month(start)} ${day(start)}. – ${end.getUTCFullYear()}. ${month(end)} ${day(end)}.`;
}

/** Today's calendar date in `timeZone` (IANA name), independent of host timezone. */
export function todayInZone(timeZone: string, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const iso = `${get('year')}-${get('month')}-${get('day')}`;
  toDate(iso); // validates the zone produced a real date
  return iso;
}
