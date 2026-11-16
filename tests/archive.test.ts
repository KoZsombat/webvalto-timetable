import { describe, expect, test } from 'bun:test';
import { loadArchive, mergeWeeks, saveArchive, isWeekArchive, type WeekArchive } from '../src/archive';
import type { Week } from '../src/format';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function week(start: string, subject = 'Matematika'): Week {
  return {
    start,
    sheets: ['Órarend'],
    blocks: [{ id: '0', label: 'Blokk 1' }],
    days: [
      {
        weekday: 0,
        lessons: [
          {
            start: '08:30',
            end: '09:15',
            timeLabel: '08:30–09:15',
            subject,
            tag: '(SZ)',
            block: '0',
            period: 1,
            details: [],
          },
        ],
      },
    ],
  };
}

describe('week archive', () => {
  test('merges new weeks and replaces edited ones', () => {
    const archive: WeekArchive = {};
    expect(mergeWeeks(archive, [week('2026-11-09')])).toBe(true);
    expect(Object.keys(archive)).toEqual(['2026-11-09']);

    expect(mergeWeeks(archive, [week('2026-11-09')])).toBe(false);
    expect(mergeWeeks(archive, [week('2026-11-09', 'Fizika')])).toBe(true);
    expect(archive['2026-11-09']?.days[0]?.lessons[0]?.subject).toBe('Fizika');

    expect(mergeWeeks(archive, [week('2026-11-16')])).toBe(true);
    expect(Object.keys(archive).sort()).toEqual(['2026-11-09', '2026-11-16']);
  });

  test('round-trips through disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archive-'));
    const file = join(dir, 'weeks.json');
    try {
      await saveArchive(file, { '2026-11-16': week('2026-11-16') });
      const loaded = await loadArchive(file);
      expect(loaded['2026-11-16']?.days[0]?.lessons[0]?.subject).toBe('Matematika');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('ignores missing or malformed files instead of crashing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archive-'));
    try {
      expect(await loadArchive(join(dir, 'missing.json'))).toEqual({});
      expect(await loadArchive(undefined)).toEqual({});

      const broken = join(dir, 'broken.json');
      await writeFile(broken, '{"2026-11-16": {"start": "nope"}}');
      expect(await loadArchive(broken)).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('validates the shape', () => {
    expect(isWeekArchive({})).toBe(true);
    expect(isWeekArchive({ '2026-11-16': week('2026-11-16') })).toBe(true);
    expect(isWeekArchive({ 'not-a-date': week('2026-11-16') })).toBe(false);
    expect(isWeekArchive({ '2026-11-16': { ...week('2026-11-16'), blocks: 'nope' } })).toBe(false);
    expect(isWeekArchive([])).toBe(false);
  });
});
