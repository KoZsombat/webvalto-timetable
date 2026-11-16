/**
 * Megkeresi a szinkronizált/megnyitott órarend-fájlt, hogy ne kelljen
 * kézzel böngészni a OneDrive mappákban.
 *
 *   bun run find-sheet            # 5 legfrissebb találat + kész SOURCE_URL sor
 *   bun run find-sheet --all      # minden találat
 *
 * OneDrive/SharePoint szinkron, iCloud Drive, Google Drive, Dropbox és a
 * ~/Downloads mappa jön szóba. A temp `~$` fájlokat kihagyja.
 */
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { all: { type: 'boolean' } },
});

interface Candidate {
  path: string;
  size: number;
  mtime: number;
}

const HOME = homedir();
const ROOTS = [
  join(HOME, 'Library/CloudStorage'),
  join(HOME, 'OneDrive'),
  join(HOME, 'OneDrive - Personal'),
  join(HOME, 'Dropbox'),
  join(HOME, 'Downloads'),
];
const MAX_DEPTH = 7;
const NAME_HINTS = ['timetable', 'orarend', 'órarend'];

function looksLikeTimetable(name: string): boolean {
  const lower = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return NAME_HINTS.some((hint) => lower.includes(hint));
}

async function walk(directory: string, depth: number, found: Candidate[]): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path, depth + 1, found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(xlsx|xls|csv)$/i.test(entry.name)) continue;
    if (entry.name.startsWith('~$')) continue;
    if (!looksLikeTimetable(entry.name)) continue;
    try {
      const info = await stat(path);
      found.push({ path, size: info.size, mtime: info.mtimeMs });
    } catch {
      // eltűnt közben, nem gond
    }
  }
}

const found: Candidate[] = [];
for (const root of ROOTS) await walk(root, 0, found);

found.sort((a, b) => b.mtime - a.mtime);
const shown = values.all ? found : found.slice(0, 5);

if (found.length === 0) {
  console.log('Nem találtam órarend-fájlt a szinkronizált mappákban.');
  console.log('Nézett helyek:');
  for (const root of ROOTS) console.log(`  ${root}`);
  console.log('\nHa a fájl máshol van, add meg közvetlenül:');
  console.log('  SOURCE_URL=/teljes/útvonal/timetable.xlsx');
} else {
  console.log(`${found.length} találat (a legfrissebb elöl):\n`);
  for (const candidate of shown) {
    const when = new Date(candidate.mtime).toISOString().slice(0, 16).replace('T', ' ');
    const size = `${Math.round(candidate.size / 1024)} kB`;
    console.log(`  ${candidate.path}`);
    console.log(`    ${when} · ${size}`);
  }
  const newest = found[0]!;
  const home = HOME.endsWith('/') ? HOME.slice(0, -1) : HOME;
  const short = newest.path.startsWith(`${home}/`) ? `~/${newest.path.slice(home.length + 1)}` : newest.path;
  console.log('\nÍrd ezt a .env-be:');
  console.log(`  SOURCE_URL=${short}`);
  console.log('\nEllenőrzés:');
  console.log(`  bun run dump --url '${short}'`);
}

if (found.length > shown.length) {
  console.log(`\n(${found.length - shown.length} további találat: bun run find-sheet --all)`);
}
