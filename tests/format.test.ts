import { describe, expect, test } from 'bun:test';
import * as XLSX from 'xlsx';
import {
  parseCellEntries,
  parseLooseDate,
  parseTimeRange,
  parseWeekStart,
  parseWorkbook,
  weekdayFromHeader,
} from '../src/format';

function workbookBytes(sheets: Record<string, string[][]>): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

const REFERENCE = '2026-11-16';

const HEADER = ['', '', 'Hétfő (11.16.)', 'Kedd (11.17.)', 'Szerda (11.18.)', 'Csütörtök (11.19.)', 'Péntek (11.20.)'];

const PERIODS: [period: string, time: string, breakAfter: string][] = [
  ['1. óra', '8:30 - 9:15', '9:15 - 9:25'],
  ['2. óra', '9:25 - 10:10', '10:10 - 10:20'],
  ['3. óra', '10:20 - 11:05', '11:05 - 11:15'],
  ['4. óra', '11:15 - 12:00', '12:00 - 12:30'],
  ['5. óra', '12:30 - 13:15', '13:15 - 13:25'],
  ['6. óra', '13:25 - 14:10', '14:10 - 14:20'],
  ['7. óra', '14:20 - 15:05', '15:05 - 15:15'],
  ['8. óra', '15:15 - 16:00', ''],
];

/** One sheet, days as columns, two stacked blocks — the school's layout. */
function weeklyGrid(options: { label?: string; concurrent?: boolean } = {}): string[][] {
  const rows: string[][] = [['11.16 - 11.20', '', '', '', '', '', ''], HEADER];

  const block = (cells: (day: number, periodIndex: number) => string) => {
    PERIODS.forEach(([period, time, breakAfter], periodIndex) => {
      rows.push([period, time, ...[0, 1, 2, 3, 4].map((day) => cells(day, periodIndex))]);
      if (breakAfter) rows.push(['', breakAfter, '', '', '', '', '']);
    });
  };

  block((day) => {
    if (options.concurrent && day === 4) return '(SZ) Asztali és mobil\n(U) Hálózatok II.';
    if (day < 2) return '(SZ) István';
    if (day === 2) return '(U) Hálózatok program Anna';
    if (day === 3) return '(SZ) Asztali és mobil Mennyi Miklós';
    return '(U) Hálózatok II. Urbán Péter';
  });

  rows.push(['', '', '', '', '', '', '']);
  if (options.label) rows.push([options.label, '', '', '', '', '', '']);

  block((day, periodIndex) => {
    if (day === 0) return 'Levente (ü)';
    if (day === 2 && periodIndex === 5) return '(U) A munka világa Ágota';
    if (day === 3 && periodIndex >= 6) return '(U) Linux Benedek';
    return '';
  });
  return rows;
}

const timetable = parseWorkbook(workbookBytes({ Órarend: weeklyGrid() }), { referenceDate: REFERENCE });
const week = timetable.weeks[0]!;

describe('weekly grid', () => {
  test('takes the week from the header dates, not the sheet name', () => {
    expect(timetable.weeks).toHaveLength(1);
    expect(week.start).toBe('2026-11-16');
    expect(timetable.warnings).toEqual([]);
  });

  test('detects the two stacked blocks', () => {
    expect(week.blocks.map((block) => block.label)).toEqual(['Nagy terem', 'Kis terem']);
    expect(timetable.sheets[0]).toMatchObject({ name: 'Órarend', weeks: ['2026-11-16'], blocks: 2 });
  });

  test('parses periods, times and the weekday columns', () => {
    const monday = week.days.find((day) => day.weekday === 0)!;
    expect(monday.lessons).toHaveLength(16); // 8 in each block

    const first = monday.lessons[0]!;
    expect(first).toMatchObject({ tag: '(SZ)', subject: 'István', timeLabel: '08:30–09:15', period: 1, block: '0' });
    const wednesday = week.days.find((day) => day.weekday === 2)!;
    expect(wednesday.lessons[0]).toMatchObject({ tag: '(U)', subject: 'Hálózatok program Anna' });
  });

  test('keeps both blocks apart: block 2 has its own sparse lessons', () => {
    const mondayBlockTwo = week.days
      .find((day) => day.weekday === 0)!
      .lessons.filter((lesson) => lesson.block === '1');
    expect(mondayBlockTwo).toHaveLength(8);
    expect(mondayBlockTwo.every((lesson) => lesson.subject === 'Levente (ü)')).toBe(true);

    const wednesdayBlockTwo = week.days
      .find((day) => day.weekday === 2)!
      .lessons.filter((lesson) => lesson.block === '1');
    expect(wednesdayBlockTwo.map((lesson) => lesson.subject)).toEqual(['A munka világa Ágota']);

    const thursdayBlockTwo = week.days
      .find((day) => day.weekday === 3)!
      .lessons.filter((lesson) => lesson.block === '1');
    expect(thursdayBlockTwo.map((lesson) => lesson.period)).toEqual([7, 8]);
    expect(thursdayBlockTwo.map((lesson) => lesson.subject)).toEqual(['Linux Benedek', 'Linux Benedek']);
  });

  test('break rows never become lessons', () => {
    const labels = week.days.flatMap((day) => day.lessons.map((lesson) => lesson.timeLabel));
    expect(labels).not.toContain('09:15–09:25');
    expect(labels).not.toContain('12:00–12:30');
    expect(labels).toContain('08:30–09:15');
  });

  test('a cell may hold two concurrent lessons', () => {
    const concurrent = parseWorkbook(
      workbookBytes({ Órarend: weeklyGrid({ concurrent: true }) }),
      { referenceDate: REFERENCE },
    );
    const friday = concurrent.weeks[0]!.days.find((day) => day.weekday === 4)!;
    const fifth = friday.lessons.filter((lesson) => lesson.period === 5);
    expect(fifth.map((lesson) => [lesson.tag, lesson.subject])).toEqual([
      ['(SZ)', 'Asztali és mobil'],
      ['(U)', 'Hálózatok II.'],
    ]);
  });

  test('a label row above a block names it', () => {
    const labelled = parseWorkbook(
      workbookBytes({ Órarend: weeklyGrid({ label: '12.A' }) }),
      { referenceDate: REFERENCE },
    );
    expect(labelled.weeks[0]!.blocks.map((block) => block.label)).toEqual(['Nagy terem', '12.A']);
  });

  test('falls back to the sheet name when neither title nor headers carry dates', () => {
    const plain = parseWorkbook(
      workbookBytes({
        '2026-W47': [['', 'Monday', 'Tuesday'], ['8:00-9:30', 'Math', 'Art']],
      }),
      { referenceDate: REFERENCE },
    );
    expect(plain.weeks[0]?.start).toBe('2026-11-16');
    expect(plain.weeks[0]?.days.find((day) => day.weekday === 0)?.lessons[0]).toMatchObject({
      subject: 'Math',
      timeLabel: '08:00–09:30',
    });
  });

  test('still reads several weekly sheets as several weeks', () => {
    const plain = parseWorkbook(
      workbookBytes({
        '2026-W47': [['', 'Monday', 'Tuesday'], ['8:00-9:30', 'Math', 'Art']],
        '2026-W48': [['', 'Monday', 'Tuesday'], ['8:00-9:30', 'Biology', 'Music']],
      }),
      { referenceDate: REFERENCE },
    );
    expect(plain.weeks.map((entry) => entry.start)).toEqual(['2026-11-16', '2026-11-23']);
  });

  test('reports a sheet without any weekday header', () => {
    const broken = parseWorkbook(workbookBytes({ Notes: [['nothing useful here']] }), { referenceDate: REFERENCE });
    expect(broken.weeks).toEqual([]);
    expect(broken.warnings[0]).toContain('nincs nap-fejlécsor');
  });
});

describe('cell entries', () => {
  test('a tagged line opens a new concurrent entry', () => {
    expect(parseCellEntries('(SZ) István\n(U) Anna')).toEqual([
      { tag: '(SZ)', subject: 'István' },
      { tag: '(U)', subject: 'Anna' },
    ]);
  });

  test('an untagged line continues the previous entry (hard-wrapped names)', () => {
    expect(parseCellEntries('(SZ) Asztali és mobil\nMennyi Miklós')).toEqual([
      { tag: '(SZ)', subject: 'Asztali és mobil Mennyi Miklós' },
    ]);
    expect(parseCellEntries('Levente (ü)')).toEqual([{ subject: 'Levente (ü)' }]);
  });
});

describe('dates and headers', () => {
  test('year-less dates pick the year closest to the reference', () => {
    expect(parseLooseDate('Hétfő (11.16.)', '2026-11-16')).toBe('2026-11-16');
    expect(parseLooseDate('(12.30.)', '2027-01-05')).toBe('2026-12-30');
    expect(parseLooseDate('(1.4.)', '2027-01-05')).toBe('2027-01-04');
    expect(parseLooseDate('(16.11.)', '2026-11-16')).toBe('2026-11-16'); // day-first fallback
    expect(parseLooseDate('no date', '2026-11-16')).toBeNull();
  });

  test('day headers tolerate accents, punctuation and dates', () => {
    expect(weekdayFromHeader('Hétfő')).toBe(0);
    expect(weekdayFromHeader('csütörtök (19.11.)')).toBe(3);
    expect(weekdayFromHeader('Fri.')).toBe(4);
    expect(weekdayFromHeader('Vasárnap')).toBe(6);
    expect(weekdayFromHeader('Week')).toBeNull();
  });

  test('explicit dates and ISO weeks still parse', () => {
    expect(parseWeekStart('2026-W47')).toBe('2026-11-16');
    expect(parseWeekStart('Sheet 2026.11.16.')).toBe('2026-11-16');
    expect(parseWeekStart('16.11.2026')).toBe('2026-11-16');
    expect(parseWeekStart('Notes')).toBeNull();
    expect(parseWeekStart('2026-02-31')).toBeNull();
  });

  test('time ranges accept dots, spaces and missing ends', () => {
    expect(parseTimeRange('8.30 – 9.15')).toMatchObject({ start: '08:30', end: '09:15', label: '08:30–09:15' });
    expect(parseTimeRange('13:15')).toMatchObject({ start: '13:15', end: null, label: '13:15' });
    expect(parseTimeRange('Szünet')).toMatchObject({ start: null });
    expect(parseTimeRange('25:00')).toMatchObject({ start: null });
  });
});
