import type { Lesson, Timetable } from './format';
import { addDays, dayLabel, isoWeekNumber, mondayOf, weekRangeLabel, type ISODate } from './weeks';

/** Egyszerű szöveges hét a CLI-hez és a demóhoz. */
export function formatWeekTable(timetable: Timetable, weekStart: ISODate, today: ISODate): string {
  const start = mondayOf(weekStart);
  const week = timetable.weeks.find((candidate) => candidate.start === start);
  const lines = [`${isoWeekNumber(start)}. hét · ${weekRangeLabel(start)}`];

  if (!week || week.days.length === 0) {
    lines.push('  (nincs feltöltött órarend erre a hétre)');
    return lines.join('\n');
  }

  for (const day of week.days) {
    const date = addDays(start, day.weekday);
    lines.push('', `${dayLabel(date)}${date === today ? '   ← ma' : ''}`);
    if (week.blocks.length <= 1) {
      for (const lesson of day.lessons) lines.push(`  ${lessonText(lesson)}`);
      continue;
    }
    for (const block of week.blocks) {
      const inBlock = day.lessons.filter((lesson) => lesson.block === block.id);
      if (inBlock.length === 0) continue;
      lines.push(`  [${block.label}]`);
      for (const lesson of inBlock) lines.push(`    ${lessonText(lesson)}`);
    }
  }
  return lines.join('\n');
}

function lessonText(lesson: Lesson): string {
  const time = (lesson.timeLabel || '--:--').padEnd(12);
  const tag = lesson.tag ? `${lesson.tag} ` : '';
  const details = lesson.details.length > 0 ? ` · ${lesson.details.join(' · ')}` : '';
  return `${time}${tag}${lesson.subject}${details}`;
}
