/**
 * The sample document, modelled on the school's weekly grid:
 *
 *   - one sheet, one week;
 *   - days as columns (`Hétfő (11.16.)` … `Péntek (11.20.)`);
 *   - a period column (`1. óra`) and a time column (`8:30 - 9:15`), with break
 *     rows in between;
 *   - two stacked blocks (parallel classrooms), each with its own period run;
 *   - a cell with two concurrent entries (one per line, each tagged).
 */
import * as XLSX from 'xlsx';
import { addDays, toDate, type ISODate } from '../src/weeks';

export interface SampleWorkbook {
  bytes: Uint8Array;
  weekStart: ISODate;
  weekEnd: ISODate;
  lessons: number;
  blocks: number;
}

const WEEKDAYS = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek'];

const PERIODS: { number: number; time: string; breakAfter?: string }[] = [
  { number: 1, time: '8:30 - 9:15', breakAfter: '9:15 - 9:25' },
  { number: 2, time: '9:25 - 10:10', breakAfter: '10:10 - 10:20' },
  { number: 3, time: '10:20 - 11:05', breakAfter: '11:05 - 11:15' },
  { number: 4, time: '11:15 - 12:00', breakAfter: '12:00 - 12:30' },
  { number: 5, time: '12:30 - 13:15', breakAfter: '13:15 - 13:25' },
  { number: 6, time: '13:25 - 14:10', breakAfter: '14:10 - 14:20' },
  { number: 7, time: '14:20 - 15:05', breakAfter: '15:05 - 15:15' },
  { number: 8, time: '15:15 - 16:00' },
];

const COLUMNS = WEEKDAYS.length + 2; // period, time, five days

function mdot(iso: ISODate, trailingDot = true): string {
  const date = toDate(iso);
  return `${date.getUTCMonth() + 1}.${String(date.getUTCDate()).padStart(2, '0')}${trailingDot ? '.' : ''}`;
}

export function buildSampleWorkbook(weekStart: ISODate): SampleWorkbook {
  const dates = WEEKDAYS.map((_, index) => addDays(weekStart, index));
  const rows: string[][] = [];

  rows.push([`${mdot(weekStart, false)} - ${mdot(dates[4]!, false)}`, ...Array<string>(COLUMNS - 1).fill('')]);
  rows.push(['', '', ...WEEKDAYS.map((day, index) => `${day} (${mdot(dates[index]!)})`)]);

  let lessons = 0;
  const addPeriods = (cells: (day: number, periodIndex: number) => string) => {
    PERIODS.forEach((period, periodIndex) => {
      const row = [`${period.number}. óra`, period.time];
      for (let day = 0; day < WEEKDAYS.length; day++) {
        const cell = cells(day, periodIndex);
        row.push(cell);
        if (cell.trim()) lessons += cell.split(/\r?\n/).filter((line) => line.trim()).length;
      }
      rows.push(row);
      if (period.breakAfter) rows.push(['', period.breakAfter, ...Array<string>(WEEKDAYS.length).fill('')]);
    });
  };

  // Block 1 — the class that has lessons all day.
  addPeriods((day) => {
    if (day < 2) return '(SZ) István';
    if (day === 2) return '(U) Hálózatok program Anna';
    if (day === 3) return '(SZ) Asztali és mobil Mennyi Miklós';
    return '(U) Hálózatok II. Urbán Péter';
  });

  // Block 2 — parallel group: one teacher all Monday, a few scattered lessons.
  rows.push(Array<string>(COLUMNS).fill(''));
  addPeriods((day, periodIndex) => {
    if (day === 0) return 'Levente (ü)';
    if (day === 2 && periodIndex === 5) return '(U) A munka világa Ágota';
    if (day === 3 && periodIndex >= 6) return '(U) Linux Benedek';
    return '';
  });

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Órarend');

  return {
    bytes: new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })),
    weekStart,
    weekEnd: dates[4]!,
    lessons,
    blocks: 2,
  };
}
