/**
 * Offline eszközök, Discord token nélkül.
 *
 *   bun run preview --file het.xlsx [--week prev|current|next|ÉÉÉÉ-HH-NN] [--json]
 *   bun run preview --url https://docs.google.com/spreadsheets/d/…/edit
 *   bun run dump --file het.xlsx
 */
import { parseArgs } from 'node:util';
import { loadArchive, mergeWeeks } from './archive';
import { graphFromEnv } from './config';
import { parseWorkbook, type Timetable } from './format';
import { buildWeekView, viewJSON } from './render';
import { renderWeekImage } from './image';
import { fetchSheet } from './source';
import { formatWeekTable } from './terminal';
import {
  WEEKDAY_NAMES,
  addDays,
  displayWeek,
  isoWeekNumber,
  mondayOf,
  todayInZone,
  weekRangeLabel,
  type ISODate,
  type Weekday,
} from './weeks';

const USAGE = `Használat:
  bun run preview (--file <útvonal> | --url <url>) [opciók]
  bun run dump    (--file <útvonal> | --url <url>) [opciók]

Opciók:
  --week <érték>     prev | current | next | ÉÉÉÉ-HH-NN   (alap: current)
  --now <dátum>      "Ma" felülírása (ÉÉÉÉ-HH-NN)
  --tz <zóna>        IANA időzóna (alap: rendszer)
  --rollover <nap>   A hétváltás napja (alap: szombat)
  --archive <útvonal> Múlt heti archívum (alap: .weeks.json)
  --json             A Discord üzenet kiírása JSON-ban
  --png <útvonal>    A hét kirajzolása PNG-be (a Discordhoz hasonló formában)
  --help             Súgó`;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    file: { type: 'string' },
    url: { type: 'string' },
    week: { type: 'string' },
    now: { type: 'string' },
    tz: { type: 'string' },
    rollover: { type: 'string' },
    archive: { type: 'string' },
    png: { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});

const command = positionals[0] ?? 'preview';
if (values.help || command === 'help') {
  console.log(USAGE);
  process.exit(0);
}
if (command !== 'preview' && command !== 'dump') {
  fail(`Ismeretlen parancs: "${command}".\n\n${USAGE}`);
}

const timeZone = values.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
const rollover = parseRollover(values.rollover);
const today = values.now ?? todayInZone(timeZone);
const cap = displayWeek(today, rollover);
const timetable = await loadTimetable();

if (command === 'dump') {
  printDump(timetable);
} else {
  const requested = resolveWeek(values.week, cap);
  const week = requested > cap ? cap : requested;
  if (week !== requested) console.log(`A következő hét még nem érhető el; helyette a ${isoWeekNumber(cap)}. hét.\n`);

  const archivePath = values.archive ?? '.weeks.json';
  const archive = await loadArchive(archivePath);
  mergeWeeks(archive, timetable.weeks);
  const weeks = Object.values(archive).sort((a, b) => a.start.localeCompare(b.start));
  const merged: Timetable = { ...timetable, weeks };
  const archivedCount = weeks.length - timetable.weeks.length;

  console.log(
    `Alapértelmezett hét: ${today} (${timeZone}) → ${isoWeekNumber(cap)}. hét, váltás: ${WEEKDAY_NAMES[rollover].toLowerCase()}.`,
  );
  if (archivedCount > 0) console.log(`+ ${archivedCount} archivált hét innen: ${archivePath}.`);
  console.log('');
  console.log(formatWeekTable(merged, week, today));

  const view = buildWeekView({
    timetable: merged,
    weekStart: week,
    today,
    capStart: cap,
    sourceUrl: values.url ?? values.file ?? 'ismeretlen forrás',
  });
  const json = viewJSON(view);
  const embed = json.embeds[0] ?? {};
  const size =
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);

  console.log('');
  console.log(`Discord üzenet: ${size} karakter, ${embed.fields?.length ?? 0} mező, gomb nélkül.`);
  if (values.json) console.log(JSON.stringify(json, null, 2));

  if (values.png) {
    const selected = merged.weeks.find((candidate) => candidate.start === week);
    const png = selected ? renderWeekImage(selected, { today }) : null;
    if (!png) {
      console.log('\nNincs órarend ehhez a hétre, nincs mit kirajzolni.');
    } else {
      await Bun.write(values.png, png);
      console.log(`\nKép: ${values.png} (${png.byteLength} bájt)`);
    }
  }
}

async function loadTimetable(): Promise<Timetable> {
  try {
    if (values.file) {
      const bytes = new Uint8Array(await Bun.file(values.file).arrayBuffer());
      return parseWorkbook(bytes);
    }
    if (values.url) {
      const fetched = await fetchSheet(values.url, { graph: graphFromEnv() });
      return parseWorkbook(fetched.bytes);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  fail(`Adj meg --file <útvonal> vagy --url <url> értéket.\n\n${USAGE}`);
}

function printDump(timetable: Timetable): void {
  console.log(`Munkafüzetek: ${timetable.sheets.length}`);
  for (const sheet of timetable.sheets) {
    const weeks = sheet.weeks.length > 0 ? sheet.weeks.join(' ') : '—';
    console.log(
      `  ${sheet.name.padEnd(12)} ${String(sheet.lessons).padStart(3)} óra · ${sheet.blocks} terem · ${weeks}`,
    );
  }
  console.log(`\nHetek (${timetable.weeks.length}):`);
  for (const week of timetable.weeks) {
    const lessons = week.days.reduce((sum, day) => sum + day.lessons.length, 0);
    const blocks = week.blocks.map((block) => block.label).join(' + ');
    console.log(
      `  ${week.start}  ${isoWeekNumber(week.start)}. hét  ${weekRangeLabel(week.start).padEnd(24)} ${lessons} óra, ${week.days.length} nap, ${blocks}`,
    );
  }
  if (timetable.warnings.length > 0) {
    console.log('\nFigyelmeztetések:');
    for (const warning of timetable.warnings) console.log(`  - ${warning}`);
  }
}

function resolveWeek(value: string | undefined, defaultWeek: ISODate): ISODate {
  if (!value || value === 'current') return defaultWeek;
  if (value === 'prev' || value === 'previous') return addDays(defaultWeek, -7);
  if (value === 'next') return addDays(defaultWeek, 7);
  try {
    return mondayOf(value);
  } catch {
    fail(`--week értéke legyen prev, current, next vagy ÉÉÉÉ-HH-NN (kapott: "${value}").`);
  }
}

function parseRollover(value: string | undefined): Weekday {
  if (!value) return 5;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) return numeric as Weekday;
  const index = WEEKDAY_NAMES.findIndex((name) => name.toLowerCase() === value.trim().toLowerCase());
  if (index >= 0) return index as Weekday;
  fail(`--rollover legyen hétfő…vasárnap vagy 0–6 (kapott: "${value}").`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
