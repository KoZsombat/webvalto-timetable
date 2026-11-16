/**
 * Előállítja a sample/timetable.xlsx fájlt az iskola heti rácsában: egyetlen
 * munkafüzet, napok oszlopként, óra/idő sorok szünetekkel, két egymás alatti
 * blokk (Nagy terem / Kis terem) és egy cella két párhuzamos órával.
 *
 *   bun run sample [--now 2026-11-16] [--out sample/timetable.xlsx]
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { parseWorkbook } from '../src/format';
import { displayWeek, todayInZone, weekRangeLabel } from '../src/weeks';
import { buildSampleWorkbook } from './sample-data';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { now: { type: 'string' }, out: { type: 'string' } },
});

const today = values.now ?? todayInZone('Europe/Budapest');
const weekStart = displayWeek(today);
const out = values.out ?? 'sample/timetable.xlsx';
const sample = buildSampleWorkbook(weekStart);

await mkdir(dirname(out), { recursive: true });
await Bun.write(out, sample.bytes);

const parsed = parseWorkbook(sample.bytes, { referenceDate: today });
const week = parsed.weeks[0];
const lessons = week?.days.reduce((sum, day) => sum + day.lessons.length, 0) ?? 0;

console.log(`Elkészült: ${out}`);
console.log(`  egy munkafüzet „Órarend” · ${week?.blocks.length ?? 0} terem · ${lessons} óra`);
console.log(`  termek: ${week?.blocks.map((block) => block.label).join(' + ') ?? '—'}`);
console.log(`  hét: ${weekStart} … ${sample.weekEnd} (${weekRangeLabel(weekStart)})`);
for (const warning of parsed.warnings) console.log(`  figyelmeztetés: ${warning}`);

console.log(`\nMa ${today} → alapértelmezett hét: ${weekStart}`);
console.log('\nPróbáld ki:');
console.log('  bun run dump    --url sample/timetable.xlsx');
console.log('  bun run preview --url sample/timetable.xlsx');
