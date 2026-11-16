/**
 * Workbook → timetable.
 *
 * Default document contract (the school's weekly grid):
 *
 *   - **One sheet can hold several weeks side by side** (the school's month
 *     sheets: `November (1.hét)`, `(2.hét)`, … in one row). A *panel* is one
 *     week: its own day headers and its own period/time gutter. The week comes
 *     from the panel's day headers (`Hétfő (11.16.)`), then from a title row
 *     (`11.16 - 11.20`), then from the sheet name (`2026-W47`). Dates without a
 *     year are resolved against a reference date (usually today).
 *   - **Days are columns**, one header cell per weekday (`Monday…Sunday` /
 *     `Hétfő…Vasárnap`, accents and abbreviations tolerated), optionally with
 *     the date in brackets.
 *   - **Periods are rows**: a period label (`1. óra`) and/or a time range
 *     (`8:30 - 9:15`) in columns left of the first day column. Break rows carry
 *     only a time and produce no lessons.
 *   - **Blocks are stacked grids**: when the period number starts over (`1.
 *     óra` again), a new block begins. That is how parallel classrooms/classes
 *     are represented; a row with just a label (`12.A`, `Terem 2`) right above
 *     a block names it, otherwise the defaults are `Nagy terem` / `Kis terem`.
 *   - **Concurrent lessons** are several lines in one cell. A line starting
 *     with a short tag (`(SZ)`, `(U)`) opens a new entry; a line without a tag
 *     continues the previous one (handles cells that hard-wrap a long name).
 *
 * Multiple sheets are still accepted (each parsed as one week) and sheets that
 * resolve to the same week are merged, but the documented layout is one sheet.
 */
import * as XLSX from 'xlsx';
import {
  isoWeekStart,
  mondayOf,
  toDate,
  toISO,
  type ISODate,
  type Weekday,
} from './weeks';

export interface Lesson {
  start: string | null;
  end: string | null;
  /** "08:30–09:15", "08:30", or "" when the row has no time. */
  timeLabel: string;
  /** Cell text without its leading tag, e.g. "Asztali és mobil Mennyi Miklós". */
  subject: string;
  /** Leading group marker, e.g. "(SZ)". */
  tag?: string;
  /** Id of the parallel block (classroom/class) this lesson belongs to. */
  block: string;
  /** Period number inside the block, when the sheet numbers its periods. */
  period?: number;
  details: string[];
}

export interface DaySchedule {
  weekday: Weekday;
  lessons: Lesson[];
}

export interface Block {
  id: string;
  label: string;
}

export interface Break {
  /** Ezen óra után következik a szünet. */
  afterPeriod: number;
  timeLabel: string;
}

export interface Week {
  start: ISODate;
  days: DaySchedule[];
  sheets: string[];
  blocks: Block[];
  breaks?: Break[];
}

export interface SheetReport {
  name: string;
  /** A munkafüzetben talált hetek, növekvő sorrendben. */
  weeks: ISODate[];
  lessons: number;
  blocks: number;
}

export interface Timetable {
  weeks: Week[];
  warnings: string[];
  sheets: SheetReport[];
}

export interface TimeRange {
  start: string | null;
  end: string | null;
  label: string;
}

export interface ParseOptions {
  /** Reference date for year-less dates like `11.16.`; defaults to today. */
  referenceDate?: ISODate;
}

interface Panel {
  /** A hét saját bal oldali sávjának első oszlopa (óraszám/idő). */
  startColumn: number;
  days: Map<number, Weekday>;
  cells: string[];
}

interface HeaderRow {
  row: number;
  panels: Panel[];
}

const DAY_TOKENS: Record<string, Weekday> = {
  monday: 0,
  mon: 0,
  tuesday: 1,
  tue: 1,
  tues: 1,
  wednesday: 2,
  wed: 2,
  thursday: 3,
  thu: 3,
  thur: 3,
  thurs: 3,
  friday: 4,
  fri: 4,
  saturday: 5,
  sat: 5,
  sunday: 6,
  sun: 6,
  // Hungarian
  hetfo: 0,
  kedd: 1,
  szerda: 2,
  csutortok: 3,
  pentek: 4,
  szombat: 5,
  vasarnap: 6,
};

/** "1. óra", "2.ora", "3." — a period label, not a time. */
const PERIOD_LABEL = /^\s*(\d{1,2})\s*\.?\s*(?:óra|ora|lesson|órája)?\s*$/i;
const TIME_RANGE = /(\d{1,2})[:.](\d{2})(?:\s*[-–—~]\s*(\d{1,2})[:.](\d{2}))?/;
const DAY_DATE = /(\d{1,2})\s*[.\/]\s*(\d{1,2})\.?/;
const TAG_PREFIX = /^\(([^)]{1,12})\)\s*(.*)$/;

/** Lowercase, accents stripped, punctuation collapsed: "Hétfő:(11.16.)" → "hetfo 11 16". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Header cell → weekday. Requires the day name to start the cell. */
export function weekdayFromHeader(value: string): Weekday | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const firstWord = normalized.split(' ')[0] ?? '';
  if (firstWord in DAY_TOKENS) return DAY_TOKENS[firstWord] ?? null;
  for (const [token, weekday] of Object.entries(DAY_TOKENS)) {
    if (token.length >= 3 && normalized.startsWith(token)) return weekday;
  }
  return null;
}

/**
 * Week identity out of unambiguous text: ISO week (`2026-W47`), year-first date
 * (`2026-11-16`), day-first date (`16.11.2026`).
 */
export function parseWeekStart(text: string): ISODate | null {
  const isoWeek = /(?:^|\D)(\d{4})[-_ .]?w(\d{1,2})(?!\d)/i.exec(text);
  if (isoWeek) {
    const year = Number(isoWeek[1]);
    const week = Number(isoWeek[2]);
    if (week >= 1 && week <= 53) return isoWeekStart(year, week);
  }

  const yearFirst = /(?:^|\D)(\d{4})[.\-/ ](\d{1,2})[.\-/ ](\d{1,2})(?!\d)/.exec(text);
  if (yearFirst) {
    const start = validMonday(
      `${yearFirst[1]}-${yearFirst[2]!.padStart(2, '0')}-${yearFirst[3]!.padStart(2, '0')}`,
    );
    if (start) return start;
  }

  const dayFirst = /(?:^|\D)(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{4})(?!\d)/.exec(text);
  if (dayFirst) {
    const start = validMonday(
      `${dayFirst[3]}-${dayFirst[2]!.padStart(2, '0')}-${dayFirst[1]!.padStart(2, '0')}`,
    );
    if (start) return start;
  }
  return null;
}

/**
 * Year-less date (`11.16.`, `11.16`) → ISO date. `11.16.` is month/day, the way
 * Hungarian timetables write it; `16.11.` is accepted when 16 cannot be a month.
 * The year closest to `reference` wins, so a December sheet read in January
 * stays in the previous year.
 */
export function parseLooseDate(text: string, reference: ISODate): ISODate | null {
  const match = DAY_DATE.exec(text);
  if (!match) return null;
  let month = Number(match[1]);
  let day = Number(match[2]);
  if (month > 12 && day <= 12) [month, day] = [day, month];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const referenceDate = toDate(reference);
  let best: ISODate | null = null;
  for (const year of [referenceDate.getUTCFullYear() - 1, referenceDate.getUTCFullYear(), referenceDate.getUTCFullYear() + 1]) {
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    try {
      toDate(candidate);
    } catch {
      continue;
    }
    if (
      best === null ||
      Math.abs(toDate(candidate).getTime() - referenceDate.getTime()) <
        Math.abs(toDate(best).getTime() - referenceDate.getTime())
    ) {
      best = candidate;
    }
  }
  return best;
}

function validMonday(iso: string): ISODate | null {
  try {
    return mondayOf(toISO(toDate(iso)));
  } catch {
    return null;
  }
}

/** Leading time range of a cell or time column; missing parts are null. */
export function parseTimeRange(text: string): TimeRange {
  const m = TIME_RANGE.exec(text.replace(/\u00a0/g, ' '));
  if (!m) return { start: null, end: null, label: '' };
  const start = clock(m[1]!, m[2]!);
  if (!start) return { start: null, end: null, label: '' };
  const end = m[3] && m[4] ? clock(m[3], m[4]) : null;
  return { start, end, label: end ? `${start}–${end}` : start };
}

function clock(hours: string, minutes: string): string | null {
  const h = Number(hours);
  const m = Number(minutes);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function periodNumber(text: string): number | null {
  const m = PERIOD_LABEL.exec(text.replace(/\u00a0/g, ' '));
  if (!m) return null;
  const period = Number(m[1]);
  return period >= 1 && period <= 20 ? period : null;
}

/** Cell → one entry per concurrent lesson. */
export function parseCellEntries(cell: string): { tag?: string; subject: string }[] {
  const lines = cell
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, ' ').trim())
    .filter((line) => line.length > 0);

  const entries: { tag?: string; subject: string }[] = [];
  for (const line of lines) {
    const tagMatch = TAG_PREFIX.exec(line);
    if (tagMatch && tagMatch[2]) {
      entries.push({ tag: `(${tagMatch[1]})`, subject: tagMatch[2].trim() });
    } else if (entries.length === 0) {
      entries.push({ subject: line });
    } else {
      // A hard-wrapped continuation of the previous entry, not a new lesson.
      entries[entries.length - 1]!.subject = `${entries[entries.length - 1]!.subject} ${line}`.trim();
    }
  }
  return entries;
}

export function parseWorkbook(bytes: Uint8Array, options: ParseOptions = {}): Timetable {
  const reference = options.referenceDate ?? toISO(new Date());
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true });
  const warnings: string[] = [];
  const sheets: SheetReport[] = [];
  const byWeek = new Map<ISODate, Week>();

  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    if (!worksheet) continue;
    const grid = sheetGrid(worksheet);
    const headers = findHeaderRows(grid);
    if (headers.length === 0) {
      sheets.push({ name, weeks: [], lessons: 0, blocks: 0 });
      warnings.push(`A(z) "${name}" munkafüzetben nincs nap-fejlécsor (Hétfő…Vasárnap / Monday…Sunday).`);
      continue;
    }

    let sheetLessons = 0;
    let sheetBlocks = 0;
    const sheetWeeks: ISODate[] = [];

    for (let headerIndex = 0; headerIndex < headers.length; headerIndex++) {
      const header = headers[headerIndex]!;
      const sectionEnd = headers[headerIndex + 1]?.row ?? grid.length;

      for (let panelIndex = 0; panelIndex < header.panels.length; panelIndex++) {
        const panel = header.panels[panelIndex]!;
        const start = resolvePanelWeek(grid, panel, header.row, name, reference);
        if (!start) {
          warnings.push(`A(z) "${name}" munkafüzet egyik hétblokkjában nincs hét-dátum.`);
          continue;
        }

        // Ugyanaz a hét egy következő szekcióban = a következő terem.
        const offset = byWeek.get(start)?.blocks.length ?? 0;
        const parsed = parsePanel(grid, panel, header.row + 1, sectionEnd, offset);
        if (parsed.lessons === 0) continue; // még nem kitöltött hétblokk

        sheetLessons += parsed.lessons;
        sheetBlocks += parsed.blocks.length;
        if (!sheetWeeks.includes(start)) sheetWeeks.push(start);

        let week = byWeek.get(start);
        if (!week) {
          week = { start, days: [], sheets: [], blocks: [], breaks: [] };
          byWeek.set(start, week);
        }
        if (!week.sheets.includes(name)) week.sheets.push(name);
        for (const block of parsed.blocks) {
          if (!week.blocks.some((candidate) => candidate.id === block.id)) week.blocks.push(block);
        }
        for (const entry of parsed.breaks) {
          if (!week.breaks!.some((candidate) => candidate.afterPeriod === entry.afterPeriod)) week.breaks!.push(entry);
        }
        week.breaks!.sort((a, b) => a.afterPeriod - b.afterPeriod);
        mergeDays(week.days, parsed.days);
      }
    }

    sheets.push({ name, weeks: sheetWeeks.sort(), lessons: sheetLessons, blocks: sheetBlocks });
  }

  const weeks = [...byWeek.values()]
    .map((week) => ({
      ...week,
      days: week.days
        .map((day) => ({ ...day, lessons: sortLessons(day.lessons) }))
        .sort((a, b) => a.weekday - b.weekday),
    }))
    .sort((a, b) => a.start.localeCompare(b.start));

  return { weeks, warnings, sheets };
}

function sheetGrid(worksheet: XLSX.WorkSheet): string[][] {
  const ref = worksheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      row.push(cellText(cell));
    }
    rows.push(row);
  }
  return rows;
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return '';
  if (cell.t === 'd' && cell.v instanceof Date) {
    const displayed = (cell.w ?? '').trim();
    if (/^\d{1,2}:\d{2}(?::\d{2})?(\s*[ap]m)?$/i.test(displayed)) return displayed;
    return toISO(cell.v);
  }
  const text = typeof cell.w === 'string' ? cell.w : cell.v == null ? '' : String(cell.v);
  return text.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').trim();
}

/** Rows that carry at least two weekday names. */


/** Nap-fejlécsorok; egy soron belül több hét-panel is lehet egymás mellett. */
function findHeaderRows(grid: string[][]): HeaderRow[] {
  const headers: HeaderRow[] = [];
  for (let row = 0; row < grid.length; row++) {
    const panels = splitPanels(grid[row]!);
    if (panels.length > 0) headers.push({ row, panels });
  }
  return headers;
}

function splitPanels(cells: string[]): Panel[] {
  const hits: { column: number; weekday: Weekday }[] = [];
  cells.forEach((cell, column) => {
    const weekday = weekdayFromHeader(cell);
    if (weekday !== null) hits.push({ column, weekday });
  });
  if (hits.length < 2) return [];

  const panels: Panel[] = [];
  let current: Panel | null = null;
  let lastDayColumn = -1;

  for (const hit of hits) {
    if (current === null) {
      current = { startColumn: 0, days: new Map(), cells };
    } else if ([...current.days.values()].includes(hit.weekday)) {
      // Új hét-panel: a napok újraindulnak (hétfő jön péntek után).
      panels.push(current);
      current = { startColumn: lastDayColumn + 1, days: new Map(), cells };
    }
    current.days.set(hit.column, hit.weekday);
    lastDayColumn = hit.column;
  }
  if (current) panels.push(current);

  return panels.filter((panel) => panel.days.size >= 2);
}

/** A panel hete: fejléc-dátumok, majd a fölötte lévő cím-sorok, végül a munkafüzet neve. */
function resolvePanelWeek(
  grid: string[][],
  panel: Panel,
  headerRow: number,
  sheetName: string,
  reference: ISODate,
): ISODate | null {
  const headerCells = [...panel.days.keys()].sort((a, b) => a - b).map((column) => panel.cells[column] ?? '');

  for (const cell of headerCells) {
    const exact = parseWeekStart(cell);
    if (exact) return exact;
  }
  for (const cell of headerCells) {
    const loose = parseLooseDate(cell, reference);
    if (loose) return mondayOf(loose);
  }

  const titleCells: string[] = [];
  for (let row = 0; row < headerRow; row++) {
    for (const cell of grid[row]!) if (cell.trim()) titleCells.push(cell);
  }
  for (const cell of titleCells) {
    const exact = parseWeekStart(cell);
    if (exact) return exact;
  }
  for (const cell of titleCells) {
    const loose = parseLooseDate(cell, reference);
    if (loose) return mondayOf(loose);
  }

  return parseWeekStart(sheetName);
}

interface PanelResult {
  days: DaySchedule[];
  blocks: Block[];
  breaks: Break[];
  lessons: number;
}

function parsePanel(
  grid: string[][],
  panel: Panel,
  startRow: number,
  endRow: number,
  blockOffset: number,
): PanelResult {
  const dayColumns = [...panel.days.keys()].sort((a, b) => a - b);
  const firstDayColumn = dayColumns[0]!;
  const { periodColumn, timeColumn } = findLabelColumns(grid, startRow, endRow, panel.startColumn, firstDayColumn);

  const days = new Map<Weekday, Lesson[]>();
  const blocks: Block[] = [];
  const breaks: Break[] = [];
  const defaultLabels = ['Nagy terem', 'Kis terem'];
  let blockIndex = -1;
  let currentPeriod = Number.POSITIVE_INFINITY;
  let pendingLabel: string | null = null;

  const beginBlock = (label: string | null) => {
    blockIndex += 1;
    const absolute = blockOffset + blockIndex;
    blocks.push({
      id: `${absolute}`,
      label: label ?? defaultLabels[absolute] ?? `${absolute + 1}. terem`,
    });
  };

  for (let rowIndex = startRow; rowIndex < endRow; rowIndex++) {
    const row = grid[rowIndex]!;
    const period = periodColumn >= 0 ? periodNumber(row[periodColumn] ?? '') : null;
    const time = parseTimeRange(timeColumn >= 0 ? (row[timeColumn] ?? '') : '');
    const hasContent = dayColumns.some((column) => (row[column] ?? '').trim() !== '');

    if (!hasContent) {
      // A szünet-sor időpontja gyakran összevont A:B cellában van (a 2. oszlop üres),
      // ezért a panel teljes bal sávjában keresünk időt.
      const breakTime = time.start ? time : timeFromGutter(row, panel.startColumn, firstDayColumn);
      if (breakTime.label && currentPeriod !== Number.POSITIVE_INFINITY) {
        if (!breaks.some((entry) => entry.afterPeriod === currentPeriod)) {
          breaks.push({ afterPeriod: currentPeriod, timeLabel: breakTime.label });
        }
      }
      const label = rowLabel(row, panel.startColumn, firstDayColumn);
      if (label && period === null && !breakTime.start) pendingLabel = label;
      continue;
    }

    if (period !== null && period <= currentPeriod) {
      beginBlock(pendingLabel);
      pendingLabel = null;
      currentPeriod = period;
    } else if (blockIndex < 0) {
      beginBlock(pendingLabel);
      pendingLabel = null;
    }
    if (period !== null) currentPeriod = period;

    if (blockIndex < 0) continue;
    const block = blocks[blockIndex]!;

    for (const column of dayColumns) {
      const cell = row[column] ?? '';
      if (!cell.trim()) continue;
      const weekday = panel.days.get(column) as Weekday;
      const lessons = days.get(weekday) ?? [];
      for (const entry of parseCellEntries(cell)) {
        const subject = entry.subject.replace(/\s+/g, ' ').trim();
        if (!subject || /^[-–—]+$/.test(subject)) continue;
        lessons.push({
          start: time.start,
          end: time.end,
          timeLabel: time.label,
          subject,
          ...(entry.tag ? { tag: entry.tag } : {}),
          block: block.id,
          ...(period !== null ? { period } : {}),
          details: [],
        });
      }
      days.set(weekday, lessons);
    }
  }

  return {
    days: [...days.entries()]
      .map(([weekday, lessons]) => ({ weekday, lessons: dedupe(lessons) }))
      .filter((day) => day.lessons.length > 0),
    blocks,
    breaks,
    lessons: [...days.values()].reduce((sum, lessons) => sum + lessons.length, 0),
  };
}

/** A panel saját bal sávjában keresi az óraszám- és idő-oszlopot. */
function findLabelColumns(
  grid: string[][],
  startRow: number,
  endRow: number,
  fromColumn: number,
  firstDayColumn: number,
): { periodColumn: number; timeColumn: number } {
  let periodColumn = -1;
  let periodCount = 0;
  let timeColumn = -1;
  let timeCount = 0;

  for (let column = fromColumn; column < firstDayColumn; column++) {
    let periods = 0;
    let times = 0;
    for (let rowIndex = startRow; rowIndex < endRow; rowIndex++) {
      const cell = grid[rowIndex]![column] ?? '';
      if (periodNumber(cell) !== null) periods++;
      else if (parseTimeRange(cell).start) times++;
    }
    if (periods > periodCount) {
      periodColumn = column;
      periodCount = periods;
    }
    if (times > timeCount) {
      timeColumn = column;
      timeCount = times;
    }
  }

  if (timeColumn === periodColumn) timeColumn = -1;
  return { periodColumn, timeColumn };
}

/** Bármelyik bal oldali cellában lévő idő (összevont szünet-cellákhoz). */
function timeFromGutter(row: string[], fromColumn: number, beforeColumn: number): TimeRange {
  for (let column = fromColumn; column < beforeColumn; column++) {
    const parsed = parseTimeRange(row[column] ?? '');
    if (parsed.start) return parsed;
  }
  return { start: null, end: null, label: '' };
}

/** Címke a nap-oszlopok előtti sávban (pl. "12.A" egy blokk fölött). */
function rowLabel(row: string[], fromColumn: number, beforeColumn: number): string | null {
  for (let column = beforeColumn - 1; column >= fromColumn; column--) {
    const text = (row[column] ?? '').trim();
    if (text) return text;
  }
  return null;
}

function sortLessons(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort((a, b) => {
    if (a.block !== b.block) return Number(a.block) - Number(b.block);
    if (a.period !== b.period) return (a.period ?? 99) - (b.period ?? 99);
    return (a.start ?? '99:99').localeCompare(b.start ?? '99:99');
  });
}

function dedupe(lessons: Lesson[]): Lesson[] {
  const seen = new Set<string>();
  return lessons.filter((lesson) => {
    const key = `${lesson.block}|${lesson.timeLabel}|${lesson.tag ?? ''}|${lesson.subject}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeDays(target: DaySchedule[], incoming: DaySchedule[]): void {
  for (const day of incoming) {
    const existing = target.find((candidate) => candidate.weekday === day.weekday);
    if (existing) {
      existing.lessons = sortLessons(dedupe([...existing.lessons, ...day.lessons]));
    } else {
      target.push({ weekday: day.weekday, lessons: [...day.lessons] });
    }
  }
}
