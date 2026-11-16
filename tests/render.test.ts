import { describe, expect, test } from 'bun:test';
import type { APIEmbed } from 'discord.js';
import type { Lesson, Timetable, Week } from '../src/format';
import { buildImageMessage, buildWeekView, viewJSON, type ViewOptions } from '../src/render';

const SOURCE = 'https://docs.google.com/spreadsheets/d/ABC123/edit';
const CURRENT = '2026-11-16';

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    start: '08:00',
    end: '09:30',
    timeLabel: '08:00–09:30',
    subject: 'Matematika 1',
    block: '0',
    details: ['B12'],
    ...overrides,
  };
}

function week(start: string, lessons: Lesson[] = [lesson(), lesson({ subject: 'Matematika 2' })]): Week {
  return {
    start,
    sheets: ['Órarend'],
    blocks: [{ id: '0', label: 'Nagy terem' }],
    days: [{ weekday: 0, lessons }],
  };
}

function timetableOf(...weeks: Week[]): Timetable {
  return { weeks, warnings: [], sheets: [] };
}

function view(
  weekStart: string,
  capStart = CURRENT,
  timetable: Timetable | null = timetableOf(week(CURRENT)),
  blockLabels?: string[],
) {
  return buildWeekView({
    timetable,
    weekStart,
    today: CURRENT,
    capStart,
    updatedAt: Date.UTC(2026, 10, 14, 9, 30),
    sourceUrl: SOURCE,
    blockLabels,
  });
}

function embedLength(embed: APIEmbed): number {
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
  );
}

describe('week view', () => {
  test('shows the default week with today marked', () => {
    const json = viewJSON(view(CURRENT));
    const [embed] = json.embeds;
    expect(embed?.title).toBe('Órarend · 47. hét · 2026. nov. 16–22.');
    expect(embed?.fields?.[0]?.name).toBe('Hétfő, nov. 16. · ma');
    expect(embed?.fields?.[0]?.value).toBe('• **08:00–09:30**  Matematika 1 — B12\n• **08:00–09:30**  Matematika 2 — B12');
    expect(embed?.footer?.text).toContain('docs.google.com');
    expect(json.components).toEqual([]);
    // A láblécben a <t:…> nem renderelődik: natív embed-timestamp kell.
    expect(embed?.footer?.text).not.toContain('<t:');
    expect(embed?.timestamp).toBe(new Date(Date.UTC(2026, 10, 14, 9, 30)).toISOString());
  });

  test('groups stacked blocks under their labels', () => {
    const blocks = [
      { id: '0', label: 'Nagy terem' },
      { id: '1', label: 'Kis terem' },
    ];
    const both = week(CURRENT, [
      lesson({ block: '0', tag: '(SZ)', subject: 'István' }),
      lesson({ block: '1', subject: 'Levente (ü)' }),
    ]);
    both.blocks = blocks;

    const value = viewJSON(view(CURRENT, CURRENT, timetableOf(both))).embeds[0]?.fields?.[0]?.value ?? '';
    expect(value).toBe('**Nagy terem**\n• **08:00–09:30**  (SZ) István — B12\n**Kis terem**\n• **08:00–09:30**  Levente (ü) — B12');

    expect(viewJSON(view(CURRENT, CURRENT, timetableOf(both))).embeds[0]?.description).toContain('2 terem');

    const relabelled = viewJSON(view(CURRENT, CURRENT, timetableOf(both), ['Terem 1', 'Terem 2'])).embeds[0];
    expect(relabelled?.fields?.[0]?.value).toContain('**Terem 1**');
    expect(relabelled?.fields?.[0]?.value).toContain('**Terem 2**');
  });

  test('keeps concurrent lessons of the same slot apart', () => {
    const concurrent = week(CURRENT, [
      lesson({ tag: '(SZ)', subject: 'Asztali és mobil' }),
      lesson({ tag: '(U)', subject: 'Hálózatok II.' }),
    ]);
    const value = viewJSON(view(CURRENT, CURRENT, timetableOf(concurrent))).embeds[0]?.fields?.[0]?.value ?? '';
    expect(value.split('\n')).toHaveLength(2);
    expect(value).toContain('(SZ) Asztali és mobil');
    expect(value).toContain('(U) Hálózatok II.');
  });

  test('every embed stays inside Discord limits', () => {
    const crowded = Array.from({ length: 120 }, (_, index) => lesson({ subject: `Nagyon hosszú tantárgynév ${index}` }));
    const json = viewJSON(view(CURRENT, CURRENT, timetableOf(week(CURRENT, crowded))));
    const [embed] = json.embeds;
    expect(embed?.fields?.length ?? 0).toBeLessThanOrEqual(25);
    for (const field of embed?.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
      expect(field.name.length).toBeLessThanOrEqual(256);
    }
    expect(embedLength(embed ?? {})).toBeLessThanOrEqual(6000);
    expect(embed?.description).toContain('Több óra');
  });

  test('escapes markdown in subjects and tags', () => {
    const tricky = week(CURRENT, [lesson({ subject: '*not bold*', tag: '(X_Y)', details: [] })]);
    expect(viewJSON(view(CURRENT, CURRENT, timetableOf(tricky))).embeds[0]?.fields?.[0]?.value).toBe(
      '• **08:00–09:30**  (X\\_Y) \\*not bold\\*',
    );
  });

  test('says so when the week has no published timetable', () => {
    const json = viewJSON(view('2026-12-07'));
    expect(json.embeds[0]?.description).toContain('Erre a hétre (50. hét) még nincs feltöltött órarend.');
    expect(json.embeds[0]?.fields ?? []).toEqual([]);
  });

  test('waits for the first sync without buttons', () => {
    const json = viewJSON(view(CURRENT, CURRENT, null));
    expect(json.components).toEqual([]);
    expect(json.embeds[0]?.description).toContain('első szinkronizálásra várunk');
  });

  test('surfaces a sync failure next to the last good data', () => {
    const failing = buildWeekView({
      timetable: timetableOf(week(CURRENT)),
      weekStart: CURRENT,
      today: CURRENT,
      capStart: CURRENT,
        sourceUrl: SOURCE,
      lastError: 'Source returned HTTP 404 Not Found',
    });
    expect(viewJSON(failing).embeds[0]?.description).toContain('nem sikerült');
  });

  test('names a local file as the source', () => {
    const local = buildWeekView({
      timetable: timetableOf(week(CURRENT)),
      weekStart: CURRENT,
      today: CURRENT,
      capStart: CURRENT,
        sourceUrl: 'sample/timetable.xlsx',
    });
    expect(viewJSON(local).embeds[0]?.footer?.text).toContain('helyi fájl');
  });
});

describe('image message', () => {
  function options(overrides: Partial<ViewOptions> = {}): ViewOptions {
    return {
      timetable: timetableOf(week(CURRENT)),
      weekStart: CURRENT,
      today: CURRENT,
      capStart: CURRENT,
        updatedAt: Date.UTC(2026, 10, 14, 9, 30),
      sourceUrl: SOURCE,
      ...overrides,
    };
  }

  test('attaches the week image instead of text fields', () => {
    const message = buildImageMessage(options());
    expect(message.png?.byteLength ?? 0).toBeGreaterThan(0);
    const embed = message.json.embeds[0]!;
    expect(embed.image?.url).toBe('attachment://timetable.png');
    expect(embed.fields ?? []).toEqual([]);
    expect(message.signature).toContain('|');
  });

  test('signature changes when the timetable changes', () => {
    const before = buildImageMessage(options());
    const after = buildImageMessage(
      options({ timetable: timetableOf(week(CURRENT, [lesson({ subject: 'Fizika' })])) }),
    );
    expect(after.signature).not.toBe(before.signature);
  });

  test('falls back to the text embed when the week is missing', () => {
    const message = buildImageMessage(options({ timetable: timetableOf() }));
    expect(message.png).toBeNull();
    expect(message.json.embeds[0]?.image).toBeUndefined();
  });
});
