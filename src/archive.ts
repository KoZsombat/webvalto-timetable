import { isISODate, type ISODate } from './weeks';
import type { Block, DaySchedule, Lesson, Week } from './format';

/** Weeks the bot has seen, keyed by the week's Monday. */
export type WeekArchive = Record<ISODate, Week>;

/**
 * The document only ever holds the current week, so looking back needs a local
 * history: every successful parse is merged in here and persisted.
 */
export function mergeWeeks(archive: WeekArchive, weeks: Week[]): boolean {
  let changed = false;
  for (const week of weeks) {
    const existing = archive[week.start];
    if (!existing || JSON.stringify(existing) !== JSON.stringify(week)) {
      archive[week.start] = week;
      changed = true;
    }
  }
  return changed;
}

export async function loadArchive(file: string | undefined): Promise<WeekArchive> {
  if (!file) return {};
  try {
    const raw: unknown = JSON.parse(await Bun.file(file).text());
    return isWeekArchive(raw) ? raw : {};
  } catch {
    return {};
  }
}

export async function saveArchive(file: string, archive: WeekArchive): Promise<void> {
  const sorted: WeekArchive = {};
  for (const start of Object.keys(archive).sort()) sorted[start] = archive[start]!;
  await Bun.write(file, `${JSON.stringify(sorted)}\n`);
}

function isLesson(value: unknown): value is Lesson {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (
    !('subject' in value) ||
    !('timeLabel' in value) ||
    !('block' in value) ||
    !('details' in value) ||
    !('start' in value) ||
    !('end' in value)
  ) {
    return false;
  }
  return (
    typeof value.subject === 'string' &&
    typeof value.timeLabel === 'string' &&
    typeof value.block === 'string' &&
    (value.start === null || typeof value.start === 'string') &&
    (value.end === null || typeof value.end === 'string') &&
    Array.isArray(value.details) &&
    value.details.every((detail) => typeof detail === 'string')
  );
}

function isDay(value: unknown): value is DaySchedule {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'weekday' in value &&
    'lessons' in value &&
    typeof value.weekday === 'number' &&
    value.weekday >= 0 &&
    value.weekday <= 6 &&
    Array.isArray(value.lessons) &&
    value.lessons.every(isLesson)
  );
}

function isBlock(value: unknown): value is Block {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'id' in value &&
    'label' in value &&
    typeof value.id === 'string' &&
    typeof value.label === 'string'
  );
}

function isWeek(value: unknown): value is Week {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'start' in value &&
    'days' in value &&
    'sheets' in value &&
    'blocks' in value &&
    isISODate(value.start) &&
    Array.isArray(value.days) &&
    value.days.every(isDay) &&
    Array.isArray(value.sheets) &&
    value.sheets.every((sheet) => typeof sheet === 'string') &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isBlock)
  );
}

/** Archive files are ours, but a hand-edited or truncated one must not crash the bot. */
export function isWeekArchive(value: unknown): value is WeekArchive {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([start, week]) => isISODate(start) && isWeek(week));
}
