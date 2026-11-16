/**
 * Offline demó: előállítja az egy munkafüzetes heti órát két egymást követő
 * hétre, összefésüli úgy, ahogy a bot archívuma teszi, majd kiírja, mit
 * mutatna a rögzített üzenet és a felhasználónkénti heti nézet.
 *
 *   bun run demo [--now 2026-11-14] [--tz Europe/Budapest]
 */
import { parseArgs } from 'node:util';
import { mergeWeeks, type WeekArchive } from '../src/archive';
import { parseWorkbook, type Timetable } from '../src/format';
import { buildWeekView, viewJSON, type ViewJSON } from '../src/render';
import { formatWeekTable } from '../src/terminal';
import {
  WEEKDAY_NAMES,
  addDays,
  displayWeek,
  isoWeekNumber,
  mondayOf,
  todayInZone,
  weekRangeLabel,
  weekdayIndex,
} from '../src/weeks';
import { buildSampleWorkbook } from './sample-data';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { now: { type: 'string' }, tz: { type: 'string' } },
});

const timeZone = values.tz ?? 'Europe/Budapest';
const today = values.now ?? todayInZone(timeZone);
const cap = displayWeek(today);

// A dokumentum csak egy hetet tartalmaz; az archívum teszi böngészhetővé a múltat.
const archive: WeekArchive = {};
for (const weekStart of [addDays(cap, -7), cap]) {
  const parsed = parseWorkbook(buildSampleWorkbook(weekStart).bytes, { referenceDate: today });
  mergeWeeks(archive, parsed.weeks);
}
const timetable: Timetable = {
  weeks: Object.values(archive).sort((a, b) => a.start.localeCompare(b.start)),
  warnings: [],
  sheets: [],
};

function view(weekStart: string): ViewJSON {
  return viewJSON(
    buildWeekView({
      timetable,
      weekStart,
      today,
      capStart: cap,
      updatedAt: Date.now(),
      sourceUrl: 'sample/timetable.xlsx',
    }),
  );
}

console.log(`Demo · ma ${today} (${timeZone}) · alapértelmezett hét: ${cap}\n`);

console.log('Hétváltás (alapértelmezett nézet):');
for (const offset of [-3, -2, -1, 0]) {
  const day = addDays(cap, offset);
  const shown = displayWeek(day);
  console.log(
    `  ${day} ${WEEKDAY_NAMES[weekdayIndex(day)].padEnd(9)} → ${isoWeekNumber(shown)}. hét (${weekRangeLabel(shown)})${day === today ? '  ← ma' : ''}`,
  );
}

console.log('\nRögzített üzenet, alapértelmezett hét:');
console.log(formatWeekTable(timetable, cap, today));

const current = view(mondayOf(cap));
console.log('\nNincs gomb: a hét szombatonként automatikusan vált.');

console.log('\nKorábbi hét (csak a CLI-ben; az üzenetben nem látszik):');
console.log(formatWeekTable(timetable, addDays(cap, -7), today));

const size = current.embeds.reduce((sum, embed) => {
  const fields = (embed.fields ?? []).reduce((fieldSum, field) => fieldSum + field.name.length + field.value.length, 0);
  return sum + (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + fields;
}, 0);
console.log(`\nÜzenet: ${current.embeds.length} embed, ${size}/6000 karakter, gomb nélkül.`);
if (size > 6000) throw new Error('Az üzenet túllépi a Discord 6000 karakteres limitjét.');
