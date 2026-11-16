import { describe, expect, test } from 'bun:test';
import {
  addDays,
  displayWeek,
  isoWeekNumber,
  isoWeekStart,
  mondayOf,
  todayInZone,
  toDate,
  weekRangeLabel,
} from '../src/weeks';

describe('calendar math', () => {
  test('mondayOf snaps any day to its Monday', () => {
    expect(mondayOf('2026-11-16')).toBe('2026-11-16'); // Monday
    expect(mondayOf('2026-11-19')).toBe('2026-11-16'); // Thursday
    expect(mondayOf('2026-11-22')).toBe('2026-11-16'); // Sunday
  });

  test('rejects impossible dates instead of rolling them over', () => {
    expect(() => toDate('2026-02-31')).toThrow();
    expect(() => toDate('16.11.2026')).toThrow();
  });

  test('ISO week numbers and week starts', () => {
    expect(isoWeekNumber('2026-01-01')).toBe(1);
    expect(isoWeekNumber('2026-11-16')).toBe(47);
    expect(isoWeekNumber('2025-12-29')).toBe(1); // belongs to 2026-W01
    expect(isoWeekStart(2026, 47)).toBe('2026-11-16');
    expect(isoWeekStart(2026, 1)).toBe('2025-12-29');
  });

  test('labels range across months and years', () => {
    expect(weekRangeLabel('2026-11-16')).toBe('2026. nov. 16–22.');
    expect(weekRangeLabel('2026-11-30')).toBe('2026. nov. 30. – dec. 6.');
    expect(weekRangeLabel('2025-12-29')).toBe('2025. dec. 29. – 2026. jan. 4.');
  });
});

describe('displayWeek (default view with Saturday rollover)', () => {
  test('Friday still shows the running week, the weekend shows the next one', () => {
    expect(displayWeek('2026-11-13')).toBe('2026-11-09'); // Friday
    expect(displayWeek('2026-11-14')).toBe('2026-11-16'); // Saturday
    expect(displayWeek('2026-11-15')).toBe('2026-11-16'); // Sunday
    expect(displayWeek('2026-11-16')).toBe('2026-11-16'); // Monday agrees
    expect(displayWeek('2026-11-20')).toBe('2026-11-16'); // next Friday
    expect(displayWeek('2026-11-21')).toBe('2026-11-23'); // next Saturday
  });

  test('never moves backwards, over a whole year', () => {
    let day = '2026-01-01';
    let previous = displayWeek(day);
    for (let index = 0; index < 365; index++) {
      day = addDays(day, 1);
      const current = displayWeek(day);
      expect(current >= previous).toBe(true);
      previous = current;
    }
  });

  test('a custom rollover weekday shifts only the weekend behaviour', () => {
    expect(displayWeek('2026-11-15', 6)).toBe('2026-11-16'); // Sunday rolls over on Sunday
    expect(displayWeek('2026-11-14', 6)).toBe('2026-11-09'); // Saturday does not
    expect(displayWeek('2026-11-12', 3)).toBe('2026-11-16'); // Thursday already jumps
  });
});

describe('todayInZone', () => {
  test('follows the zone, not the host clock', () => {
    const instant = new Date('2026-11-16T23:30:00Z');
    expect(todayInZone('UTC', instant)).toBe('2026-11-16');
    expect(todayInZone('Europe/Budapest', instant)).toBe('2026-11-17');
    expect(todayInZone('America/New_York', instant)).toBe('2026-11-16');
  });
});
