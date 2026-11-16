import { createHash } from 'node:crypto';
import {
  EmbedBuilder,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type APIEmbed,
} from 'discord.js';
import type { Block, Lesson, Timetable } from './format';
import { IMAGE_FILE_NAME, renderWeekImage } from './image';
import { addDays, dayLabel, isoWeekNumber, mondayOf, weekRangeLabel, type ISODate } from './weeks';

export interface ViewOptions {
  /** `null`, amíg nincs sikeres szinkronizálás. */
  timetable: Timetable | null;
  weekStart: ISODate;
  today: ISODate;
  /** Az aktuális hét; a korábbi hét szürke színt kap. */
  capStart: ISODate;
  /** Az utolsó tartalomváltozás ideje (nem az utolsó lekérdezésé). */
  updatedAt?: number;
  sourceUrl: string;
  lastError?: string | null;
  /** A blokkok megjelenített nevei, felülírva a táblázat saját címkéit. */
  blockLabels?: string[];
  /** Hamis, ha a képes üzenethez nem kell a szöveges napi bontás. */
  includeFields?: boolean;
}

export interface WeekView {
  embeds: EmbedBuilder[];
}

export interface ViewJSON {
  embeds: APIEmbed[];
  /** Mindig üres: a hétváltás a szombati automatikus frissítéssel történik. */
  components: APIActionRowComponent<APIComponentInMessageActionRow>[];
}

const CURRENT_COLOR = 0x5865f2;
const PAST_COLOR = 0x747f8d;
const EMPTY_COLOR = 0x99aab5;

const FIELD_VALUE_LIMIT = 1024;
const FIELD_NAME_LIMIT = 256;
const FIELD_COUNT_LIMIT = 25;
const TITLE_LIMIT = 256;
const DESCRIPTION_LIMIT = 4096;
const FOOTER_LIMIT = 2048;
/** Discordon üzenetenként 6000 karakter lehet; maradjunk alatta. */
const EMBED_BUDGET = 5800;

export function buildWeekView(options: ViewOptions): WeekView {
  const start = mondayOf(options.weekStart);
  const week = options.timetable?.weeks.find((candidate) => candidate.start === start) ?? null;
  const isCurrent = start === options.capStart;
  const missing = !week || week.days.length === 0;

  const embed = new EmbedBuilder()
    .setColor(missing ? EMPTY_COLOR : isCurrent ? CURRENT_COLOR : PAST_COLOR)
    .setTitle(
      truncate(`Órarend · ${isoWeekNumber(start)}. hét · ${weekRangeLabel(start)}`, TITLE_LIMIT),
    );

  const notes: string[] = [];
  if (!options.timetable) {
    notes.push(
      options.lastError
        ? `Az első szinkronizálásra várunk. Az utolsó próba hibája: ${escapeMarkdown(options.lastError)}`
        : 'Az első szinkronizálásra várunk…',
    );
  } else if (missing) {
    notes.push(`Erre a hétre (${isoWeekNumber(start)}. hét) még nincs feltöltött órarend.`);
  } else {
    const total = week.days.reduce((sum, day) => sum + day.lessons.length, 0);
    notes.push(week.blocks.length > 1 ? `${total} óra · ${week.blocks.length} terem.` : `${total} óra.`);
  }
  if (options.timetable && !isCurrent) {
    notes.push('Korábbi hét — az élő üzenet mindig az aktuális hetet mutatja.');
  }
  if (options.timetable && options.lastError) {
    notes.push(
      `⚠️ Az utolsó szinkronizálás nem sikerült, az utolsó jó verzió látható: ${escapeMarkdown(options.lastError)}`,
    );
  }
  embed.setDescription(truncate(notes.join('\n'), DESCRIPTION_LIMIT));

  const fields: { name: string; value: string; inline: boolean }[] = [];
  let used = (embed.data.title?.length ?? 0) + (embed.data.description?.length ?? 0);
  let truncated = false;
  if (week && options.includeFields !== false) {
    search: for (const day of week.days) {
      const date = addDays(start, day.weekday);
      const name = truncate(`${dayLabel(date)}${date === options.today ? ' · ma' : ''}`, FIELD_NAME_LIMIT);
      const lines = linesForDay(day.lessons, week.blocks, options.blockLabels);
      for (const [index, chunk] of chunkLines(lines, FIELD_VALUE_LIMIT).entries()) {
        const fieldName = truncate(index === 0 ? name : `${name} (folyt.)`, FIELD_NAME_LIMIT);
        if (fields.length >= FIELD_COUNT_LIMIT || used + fieldName.length + chunk.length > EMBED_BUDGET) {
          truncated = true;
          break search;
        }
        fields.push({ name: fieldName, value: chunk, inline: false });
        used += fieldName.length + chunk.length;
      }
    }
  }
  if (fields.length > 0) embed.addFields(fields);
  if (truncated) {
    embed.setDescription(
      truncate(
        `${embed.data.description}\n_Több óra van, mint ami egy üzenetbe fér — nézd meg a forrást._`,
        DESCRIPTION_LIMIT,
      ),
    );
  }

  const footer = [`Forrás: ${hostnameOf(options.sourceUrl)}`];
  if (options.updatedAt) footer.push('frissítve');
  embed.setFooter({ text: truncate(footer.join(' · '), FOOTER_LIMIT) });
  // A Discord a saját timestamp mezőt a láblécben jeleníti meg, olvasó szerinti
  // nyelvvel és időzónával; a szöveges <t:…> itt nem renderelődik.
  if (options.updatedAt) embed.setTimestamp(new Date(options.updatedAt));

  return { embeds: [embed] };
}

/** Egy nap sorai, blokk-címkékkel tagolva, ha a táblázatban egymás alatt több blokk van. */
function linesForDay(lessons: Lesson[], blocks: Block[], labels?: string[]): string[] {
  if (blocks.length <= 1) return lessons.map(lessonLine);

  const lines: string[] = [];
  for (const [index, block] of blocks.entries()) {
    const inBlock = lessons.filter((lesson) => lesson.block === block.id);
    if (inBlock.length === 0) continue;
    lines.push(`**${escapeMarkdown(labels?.[index] ?? block.label)}**`);
    lines.push(...inBlock.map(lessonLine));
  }
  return lines;
}

function lessonLine(lesson: Lesson): string {
  const time = lesson.timeLabel ? `**${lesson.timeLabel}**  ` : '';
  const tag = lesson.tag ? `${escapeMarkdown(lesson.tag)} ` : '';
  const details = lesson.details.length > 0 ? ` — ${lesson.details.map(escapeMarkdown).join(' · ')}` : '';
  return `• ${time}${tag}${escapeMarkdown(lesson.subject)}${details}`;
}

/**
 * A hét képe + a hozzá tartozó embed (napi szöveges bontás nélkül).
 *
 * A kép a Discord üzenet melléklete (`attachment://timetable.png`), így a
 * rögzített üzenet az iskola táblázatának formáját mutatja. Ha a hét üres vagy
 * a rajzolás nem sikerül, visszaesünk a szöveges mezőkre.
 */
export interface ImageMessage {
  json: ViewJSON;
  png: Uint8Array | null;
  /** Tartalom-ujjlenyomat: embed JSON + kép hash. */
  signature: string;
}

export function buildImageMessage(options: ViewOptions): ImageMessage {
  const week = options.timetable?.weeks.find((candidate) => candidate.start === mondayOf(options.weekStart)) ?? null;
  let png: Uint8Array | null = null;
  if (week && week.days.length > 0) {
    try {
      png = renderWeekImage(week, { today: options.today, blockLabels: options.blockLabels });
    } catch {
      png = null;
    }
  }

  if (!png) {
    const text = viewJSON(buildWeekView(options));
    return { json: text, png: null, signature: JSON.stringify(text) };
  }

  const json = viewJSON(buildWeekView({ ...options, includeFields: false }));
  const embed = json.embeds[0];
  if (embed) embed.image = { url: `attachment://${IMAGE_FILE_NAME}` };
  const signature = `${JSON.stringify(json)}|${createHash('sha256').update(png).digest('hex')}`;
  return { json, png, signature };
}

export function viewJSON(view: WeekView): ViewJSON {
  return {
    embeds: view.embeds.map((embed) => embed.toJSON()),
    components: [],
  };
}

function chunkLines(lines: string[], limit: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit) {
      if (current) chunks.push(current);
      current = line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>])/g, '\\$1');
}

function hostnameOf(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url.trim())) return 'helyi fájl';
  try {
    return new URL(url).hostname;
  } catch {
    return 'táblázat';
  }
}
