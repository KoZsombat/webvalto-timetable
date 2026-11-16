import { loadArchive, mergeWeeks, saveArchive, type WeekArchive } from './archive';
import { parseWorkbook, type Timetable } from './format';
import type { GraphCredentials } from './graph';
import { fetchSheet } from './source';

export type SyncResult = 'changed' | 'unchanged' | 'error';

/**
 * Keeps the parsed timetable in memory and polls the document.
 *
 * The school's sheet only holds the current week, so every parse is also merged
 * into a local archive (`archiveFile`); that is what makes "look back" work.
 *
 * A fetch that fails or yields unparseable bytes keeps the previous timetable
 * and records `lastError`; the live message then keeps showing the last good
 * version instead of going blank.
 */
export class TimetableStore {
  readonly sourceUrl: string;
  readonly archiveFile?: string;
  private readonly graph?: GraphCredentials;
  timetable: Timetable | null = null;
  lastError: string | null = null;
  /** Set when the archive could not be written; content still works. */
  archiveError: string | null = null;
  /** Epoch ms of the last successful *content* change. */
  updatedAt: number | null = null;

  private archive: WeekArchive = {};
  private archiveLoaded = false;
  private sha256: string | null = null;
  private etag?: string;
  private lastModified?: string;

  constructor(sourceUrl: string, archiveFile?: string, graph?: GraphCredentials) {
    this.sourceUrl = sourceUrl;
    this.archiveFile = archiveFile;
    this.graph = graph;
  }

  async sync(): Promise<SyncResult> {
    try {
      if (!this.archiveLoaded) {
        this.archive = await loadArchive(this.archiveFile);
        this.archiveLoaded = true;
      }

      const fetched = await fetchSheet(this.sourceUrl, {
        etag: this.etag,
        lastModified: this.lastModified,
        graph: this.graph,
      });
      if (fetched.notModified) {
        this.lastError = null;
        return 'unchanged';
      }
      this.etag = fetched.etag ?? this.etag;
      this.lastModified = fetched.lastModified ?? this.lastModified;
      if (fetched.sha256 === this.sha256) {
        this.lastError = null;
        return 'unchanged';
      }

      const timetable = parseWorkbook(fetched.bytes);
      // Commit the hash only after parsing succeeded, so a broken upload is retried.
      this.sha256 = fetched.sha256;
      this.updatedAt = Date.now();
      this.lastError = null;
      this.timetable = await this.remember(timetable);
      return 'changed';
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return 'error';
    }
  }

  /** Live parsing winner + archive, so past weeks stay browsable. */
  private async remember(timetable: Timetable): Promise<Timetable> {
    const changed = mergeWeeks(this.archive, timetable.weeks);
    if (changed && this.archiveFile) {
      try {
        await saveArchive(this.archiveFile, this.archive);
        this.archiveError = null;
      } catch (error) {
        this.archiveError = error instanceof Error ? error.message : String(error);
      }
    }
    const weeks = Object.values(this.archive).sort((a, b) => a.start.localeCompare(b.start));
    return { ...timetable, weeks };
  }
}
