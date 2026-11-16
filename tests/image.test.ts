import { describe, expect, test } from 'bun:test';
import type { Lesson, Week } from '../src/format';
import { renderWeekImage } from '../src/image';

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    start: '08:30',
    end: '09:15',
    timeLabel: '08:30–09:15',
    subject: 'Matematika',
    block: '0',
    period: 1,
    details: [],
    ...overrides,
  };
}

function week(overrides: Partial<Week> = {}): Week {
  return {
    start: '2026-11-16',
    sheets: ['Órarend'],
    blocks: [
      { id: '0', label: 'Nagy terem' },
      { id: '1', label: 'Kis terem' },
    ],
    breaks: [{ afterPeriod: 1, timeLabel: '09:15–09:25' }],
    days: [
      {
        weekday: 0,
        lessons: [
          lesson({ block: '0', subject: 'István', tag: '(SZ)' }),
          lesson({ block: '1', subject: 'Levente (ü)' }),
        ],
      },
      { weekday: 4, lessons: [lesson({ period: 2, start: '09:25', timeLabel: '09:25–10:10' })] },
    ],
    ...overrides,
  };
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  const buffer = Buffer.from(png);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('week image', () => {
  test('produces a PNG with the expected dimensions', () => {
    const png = renderWeekImage(week());
    expect(png).not.toBeNull();
    expect(Buffer.from(png!).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const size = pngSize(png!);
    expect(size.width).toBe(1520);
    expect(size.height).toBeGreaterThan(300);
  });

  test('a second block makes the image taller', () => {
    const oneBlock = week({
      blocks: [{ id: '0', label: 'Nagy terem' }],
      days: [{ weekday: 0, lessons: [lesson()] }],
    });
    const twoBlocks = week();
    const single = pngSize(renderWeekImage(oneBlock)!);
    const double = pngSize(renderWeekImage(twoBlocks)!);
    expect(double.height).toBeGreaterThan(single.height);
  });

  test('a week without lessons yields no image', () => {
    expect(renderWeekImage(week({ days: [] }))).toBeNull();
  });

  test('breaks add height when present', () => {
    const withBreak = pngSize(renderWeekImage(week())!).height;
    const withoutBreak = pngSize(renderWeekImage(week({ breaks: [] }))!).height;
    expect(withBreak).toBeGreaterThan(withoutBreak);
  });
});
