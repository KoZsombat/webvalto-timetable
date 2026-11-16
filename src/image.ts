/**
 * A hét kirajzolása PNG-be, az iskola táblázatának formájában: napok oszlopként,
 * órák soronként, szünetek vékony sorként, a termek egymás alatt.
 *
 * A képet a Discord üzenet mellékleteként küldjük (`attachment://timetable.png`),
 * így a rögzített üzenet egyetlen képen mutatja az egész hetet.
 */
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Block, Lesson, Week } from './format';
import {
  WEEKDAY_NAMES,
  addDays,
  isoWeekNumber,
  mondayOf,
  toDate,
  weekRangeLabel,
  weekdayIndex,
  type ISODate,
} from './weeks';

export const IMAGE_FILE_NAME = 'timetable.png';

export interface ImageOptions {
  today?: ISODate;
  /** A blokkok megjelenített nevei, sorrendben. */
  blockLabels?: string[];
}

const WIDTH = 1520;
const PADDING = 26;
const TITLE_HEIGHT = 62;
const DAY_HEADER_HEIGHT = 64;
const BLOCK_HEIGHT = 42;
const BLOCK_GAP = 14;
const BREAK_HEIGHT = 24;
const LINE_HEIGHT = 22;
const CELL_PADDING = 8;
const MIN_ROW_HEIGHT = 46;
const PERIOD_WIDTH = 112;
const TIME_WIDTH = 154;
const MAX_LINES = 4;

const COLORS = {
  background: '#1e1f22',
  panel: '#2b2d31',
  header: '#313338',
  today: '#353a4d',
  line: '#3f4147',
  text: '#f2f3f5',
  muted: '#b5bac1',
  accent: '#5865f2',
  breakRow: '#232428',
};

interface CellText {
  lines: string[];
}

interface PeriodRow {
  periodLabel: string;
  timeLabel: string;
  start: string | null;
  period: number | null;
  cells: CellText[];
  height: number;
}

interface BlockModel {
  label: string;
  rows: (PeriodRow | { break: true; timeLabel: string })[];
}

/** `null`, ha a héten nincs egyetlen óra sem (ilyenkor marad a szöveges embed). */
export function renderWeekImage(week: Week, options: ImageOptions = {}): Uint8Array | null {
  const dayIndexes = columnsFor(week);
  if (week.days.length === 0 || dayIndexes.length === 0) return null;

  const start = mondayOf(week.start);
  const measure = measuringContext();
  const dayWidth = (WIDTH - PADDING * 2 - PERIOD_WIDTH - TIME_WIDTH) / dayIndexes.length;

  const blocks = buildBlocks(week, dayIndexes, options.blockLabels, measure, dayWidth);
  if (blocks.length === 0) return null;

  const height =
    PADDING * 2 +
    TITLE_HEIGHT +
    DAY_HEADER_HEIGHT +
    blocks.reduce(
      (sum, block) =>
        sum +
        BLOCK_HEIGHT +
        BLOCK_GAP +
        block.rows.reduce((rowSum, row) => rowSum + ('break' in row ? BREAK_HEIGHT : row.height), 0),
      0,
    );

  const canvas = createCanvas(WIDTH, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, WIDTH, height);

  let y = PADDING;

  // Cím
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 30px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Órarend · ${isoWeekNumber(start)}. hét · ${weekRangeLabel(start)}`, PADDING, y + TITLE_HEIGHT / 2);
  y += TITLE_HEIGHT;

  // Nap-fejléc
  const todayIndex = options.today ? weekdayIndex(options.today) : -1;
  ctx.textBaseline = 'middle';
  dayIndexes.forEach((weekday, column) => {
    const x = PADDING + PERIOD_WIDTH + TIME_WIDTH + column * dayWidth;
    const isToday = options.today !== undefined && todayIndex === weekday && sameWeek(options.today, start);
    ctx.fillStyle = isToday ? COLORS.today : COLORS.header;
    ctx.fillRect(x, y, dayWidth, DAY_HEADER_HEIGHT);

    const date = addDays(start, weekday);
    ctx.fillStyle = isToday ? '#ffffff' : COLORS.text;
    ctx.font = 'bold 21px sans-serif';
    ctx.fillText(fit(ctx, WEEKDAY_NAMES[weekday] ?? '', dayWidth - CELL_PADDING * 2), x + CELL_PADDING, y + 24);
    ctx.fillStyle = isToday ? COLORS.accent : COLORS.muted;
    ctx.font = '15px sans-serif';
    ctx.fillText(fit(ctx, `${monthDot(date)}${isToday ? ' · ma' : ''}`, dayWidth - CELL_PADDING * 2), x + CELL_PADDING, y + 46);
  });
  y += DAY_HEADER_HEIGHT;
  line(ctx, PADDING, y, WIDTH - PADDING, y);

  for (const block of blocks) {
    y += BLOCK_GAP;
    // Terem-fejléc
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(PADDING, y, WIDTH - PADDING * 2, BLOCK_HEIGHT);
    ctx.fillStyle = COLORS.accent;
    ctx.font = 'bold 23px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(block.label, PADDING + CELL_PADDING, y + BLOCK_HEIGHT / 2);
    y += BLOCK_HEIGHT;

    for (const row of block.rows) {
      if ('break' in row) {
        ctx.fillStyle = COLORS.breakRow;
        ctx.fillRect(PADDING, y, WIDTH - PADDING * 2, BREAK_HEIGHT);
        ctx.fillStyle = COLORS.muted;
        ctx.font = '14px sans-serif';
        ctx.fillText(row.timeLabel, PADDING + PERIOD_WIDTH + CELL_PADDING, y + BREAK_HEIGHT / 2);
        y += BREAK_HEIGHT;
        continue;
      }

      // sor háttér (váltakozó)
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(PADDING, y, WIDTH - PADDING * 2, row.height);

      // óraszám + idő
      ctx.fillStyle = COLORS.text;
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(row.periodLabel, PADDING + 10, y + CELL_PADDING + 9);
      ctx.fillStyle = COLORS.muted;
      ctx.font = '15px sans-serif';
      ctx.fillText(row.timeLabel, PADDING + PERIOD_WIDTH + 10, y + CELL_PADDING + 9);

      // nap-cellák
      dayIndexes.forEach((weekday, column) => {
        const cell = row.cells[column];
        if (!cell || cell.lines.length === 0) return;
        const x = PADDING + PERIOD_WIDTH + TIME_WIDTH + column * dayWidth;
        const isToday = options.today !== undefined && todayIndex === weekday && sameWeek(options.today, start);
        if (isToday) {
          ctx.fillStyle = COLORS.today;
          ctx.fillRect(x, y, dayWidth, row.height);
        }
        ctx.fillStyle = COLORS.text;
        ctx.font = '17px sans-serif';
        cell.lines.forEach((text, index) => {
          ctx.fillText(text, x + CELL_PADDING, y + CELL_PADDING + 9 + index * LINE_HEIGHT);
        });
      });

      line(ctx, PADDING, y + row.height, WIDTH - PADDING, y + row.height);
      y += row.height;
    }
  }

  // függőleges vonalak
  for (let column = 0; column <= dayIndexes.length; column++) {
    const x = PADDING + PERIOD_WIDTH + TIME_WIDTH + column * dayWidth;
    line(ctx, x, PADDING + TITLE_HEIGHT + DAY_HEADER_HEIGHT, x, height - PADDING);
  }
  line(ctx, PADDING + PERIOD_WIDTH, PADDING, PADDING + PERIOD_WIDTH, height - PADDING);
  line(ctx, PADDING + PERIOD_WIDTH + TIME_WIDTH, PADDING, PADDING + PERIOD_WIDTH + TIME_WIDTH, height - PADDING);

  return new Uint8Array(canvas.toBuffer('image/png'));
}

function buildBlocks(
  week: Week,
  dayIndexes: number[],
  labels: string[] | undefined,
  measure: SKRSContext2D,
  dayWidth: number,
): BlockModel[] {
  const textWidth = dayWidth - CELL_PADDING * 2;

  return week.blocks
    .map((block, blockIndex) => ({
      block,
      label: labels?.[blockIndex] ?? block.label,
    }))
    .filter((entry) => week.days.some((day) => day.lessons.some((lesson) => lesson.block === entry.block.id)))
    .map(({ block, label }) => {
      const rows = buildRows(week, block, dayIndexes, measure, textWidth);
      return { label, rows: insertBreaks(rows, week.breaks ?? []) };
    });
}

function buildRows(
  week: Week,
  block: Block,
  dayIndexes: number[],
  measure: SKRSContext2D,
  textWidth: number,
): PeriodRow[] {
  interface Group {
    period: number | null;
    timeLabel: string;
    start: string | null;
    cells: Map<number, Lesson[]>;
  }

  const groups = new Map<string, Group>();
  for (const day of week.days) {
    for (const lesson of day.lessons) {
      if (lesson.block !== block.id) continue;
      const key = lesson.period !== undefined ? `p${lesson.period}` : `t${lesson.timeLabel}`;
      let group = groups.get(key);
      if (!group) {
        group = { period: lesson.period ?? null, timeLabel: lesson.timeLabel, start: lesson.start, cells: new Map() };
        groups.set(key, group);
      }
      const list = group.cells.get(day.weekday) ?? [];
      list.push(lesson);
      group.cells.set(day.weekday, list);
    }
  }

  const sorted = [...groups.values()].sort((a, b) => {
    if (a.period !== b.period) return (a.period ?? 99) - (b.period ?? 99);
    return (a.start ?? '99:99').localeCompare(b.start ?? '99:99');
  });

  measure.font = '17px sans-serif';
  return sorted.map((group) => {
    const cells = dayIndexes.map((weekday) => {
      const lessons = group.cells.get(weekday) ?? [];
      const lines = lessons.flatMap((lesson) => cellsForLesson(lesson)).flatMap((text) => wrapText(measure, text, textWidth));
      return { lines: capLines(lines, MAX_LINES) };
    });
    const lineCount = Math.max(1, ...cells.map((cell) => cell.lines.length));
    return {
      periodLabel: group.period !== null ? `${group.period}. óra` : '',
      timeLabel: group.timeLabel,
      start: group.start,
      period: group.period,
      cells,
      height: Math.max(MIN_ROW_HEIGHT, lineCount * LINE_HEIGHT + CELL_PADDING * 2 + 8),
    };
  });
}

/** A szüneteket az adott óra után szúrja be; a szünetek nem termenkéntiek. */
function insertBreaks(
  rows: PeriodRow[],
  breaks: { afterPeriod: number; timeLabel: string }[],
): (PeriodRow | { break: true; timeLabel: string })[] {
  if (breaks.length === 0) return rows;
  const byPeriod = new Map(breaks.map((entry) => [entry.afterPeriod, entry.timeLabel]));
  const result: (PeriodRow | { break: true; timeLabel: string })[] = [];
  for (const row of rows) {
    result.push(row);
    const breakLabel = row.period !== null ? byPeriod.get(row.period) : undefined;
    if (breakLabel) result.push({ break: true, timeLabel: breakLabel });
  }
  return result;
}

function cellsForLesson(lesson: Lesson): string[] {
  const text = `${lesson.tag ? `${lesson.tag} ` : ''}${lesson.subject}`.trim();
  if (text.length === 0) return [];
  return lesson.details.length > 0 ? [text, lesson.details.join(' · ')] : [text];
}

function columnsFor(week: Week): number[] {
  const maxWeekday = Math.max(4, ...week.days.map((day) => day.weekday));
  return Array.from({ length: maxWeekday + 1 }, (_, index) => index);
}

function sameWeek(date: ISODate, weekStart: ISODate): boolean {
  return mondayOf(date) === weekStart;
}

function monthDot(iso: ISODate): string {
  const date = toDate(iso);
  return `${date.getUTCMonth() + 1}.${String(date.getUTCDate()).padStart(2, '0')}.`;
}

function measuringContext(): SKRSContext2D {
  return createCanvas(8, 8).getContext('2d');
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.flatMap((line) => hardWrap(ctx, line, maxWidth));
}

function hardWrap(ctx: SKRSContext2D, line: string, maxWidth: number): string[] {
  if (ctx.measureText(line).width <= maxWidth) return [line];
  const parts: string[] = [];
  let current = '';
  for (const character of line) {
    if (ctx.measureText(current + character).width > maxWidth && current) {
      parts.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function capLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]}…`];
}

function fit(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

function line(ctx: SKRSContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
