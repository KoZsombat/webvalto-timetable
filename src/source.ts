import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceError } from './errors';
import { fetchGraphSheet, type GraphCredentials } from './graph';

export interface FetchOptions {
  etag?: string;
  lastModified?: string;
  timeoutMs?: number;
  /** Ha be van állítva, a SharePoint/OneDrive linket Graphon keresztül olvassuk. */
  graph?: GraphCredentials;
}

export interface FetchedSheet {
  bytes: Uint8Array;
  sha256: string;
  contentType: string;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
}

const MAX_BYTES = 20 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const REMOTE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_PATH = /^[a-z]:[\\/]/i;

/** Helyi útvonal vagy `file://` URL, szemben egy http(s) forrással. */
export function isLocalSource(source: string): boolean {
  const trimmed = source.trim();
  if (trimmed.startsWith('file:')) return true;
  return WINDOWS_PATH.test(trimmed) || !REMOTE_SCHEME.test(trimmed);
}

/**
 * Megosztási linkből közvetlen letöltés.
 *
 * A Google Sheets, OneDrive/SharePoint és Dropbox nézegető linket ad; a megfelelő
 * paraméterrel a fájlt kapjuk meg.
 */
export function normalizeSourceUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new SourceError(`A SOURCE_URL nem érvényes URL: ${input}`);
  }

  const host = url.hostname.toLowerCase();

  if (host === 'docs.google.com' || host.endsWith('.googleusercontent.com')) {
    const published = /^\/spreadsheets\/d\/e\/([^/]+)\/?/.exec(url.pathname);
    if (published) {
      return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=xlsx`;
    }
    const shared = /^\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)\/?/.exec(url.pathname);
    if (shared) {
      return `https://docs.google.com/spreadsheets/d/${shared[1]}/export?format=xlsx`;
    }
  }

  if (host.endsWith('sharepoint.com') || host === 'onedrive.live.com') {
    url.searchParams.set('download', '1');
    return url.toString();
  }

  if (host.endsWith('dropbox.com')) {
    url.searchParams.set('dl', '1');
    return url.toString();
  }

  return url.toString();
}

/**
 * A táblázat beolvasása helyi fájlból vagy HTTP-ről.
 *
 * A helyi fájlt minden lekérdezéskor újraolvassuk és hash-eljük: lehet, hogy
 * épp írják, vagy Drive/Dropbox szinkronizálja, és nincs ETag, amiben megbízhatnánk.
 */
export async function fetchSheet(rawSource: string, options: FetchOptions = {}): Promise<FetchedSheet> {
  if (isLocalSource(rawSource)) return readLocalSheet(rawSource);
  if (options.graph && isGraphHost(rawSource)) return fetchGraphSheet(rawSource, options.graph);
  return fetchRemoteSheet(normalizeSourceUrl(rawSource), options);
}

/** A Graph csak SharePoint/OneDrive megosztási linkeket tud feloldani. */
function isGraphHost(source: string): boolean {
  try {
    const host = new URL(source.trim()).hostname.toLowerCase();
    return host.endsWith('sharepoint.com') || host.endsWith('onedrive.live.com') || host === '1drv.ms';
  } catch {
    return false;
  }
}

/** `~/…` kifejtése: a Bun.file nem ismeri a shell rövidítést. */
export function resolveLocalPath(source: string): string {
  const trimmed = source.trim();
  if (trimmed.startsWith('file:')) return fileURLToPath(trimmed);
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

async function readLocalSheet(rawSource: string): Promise<FetchedSheet> {
  const path = resolveLocalPath(rawSource);

  let file: Bun.BunFile;
  let size: number;
  try {
    file = Bun.file(path);
    const stat = await file.stat();
    if (!stat.isFile()) throw new SourceError(`Ez nem fájl: ${path}`);
    size = stat.size;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(`A helyi fájl nem található: ${path}`);
  }

  if (size === 0) throw new SourceError(`A helyi fájl üres: ${path}`);
  if (size > MAX_BYTES) throw new SourceError(`A helyi fájl túl nagy (${size} bájt): ${path}`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentType: XLSX_MIME,
    notModified: false,
  };
}

async function fetchRemoteSheet(url: string, options: FetchOptions): Promise<FetchedSheet> {
  const headers: Record<string, string> = { 'user-agent': 'timetable-discord/1.0' };
  if (options.etag) headers['if-none-match'] = options.etag;
  if (options.lastModified) headers['if-modified-since'] = options.lastModified;

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
    });
  } catch (error) {
    throw new SourceError(`A forrás nem érhető el (${url}): ${(error as Error).message}`);
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (response.status === 304) {
    return {
      bytes: new Uint8Array(0),
      sha256: '',
      contentType,
      etag: response.headers.get('etag') ?? options.etag,
      lastModified: response.headers.get('last-modified') ?? options.lastModified,
      notModified: true,
    };
  }

  if (response.status === 401 || response.status === 403) {
    throw new SourceError(
      `A forrás HTTP ${response.status} (${response.statusText}): a SharePoint/OneDrive nem enged névtelen hozzáférést. ` +
        'Két oka lehet: a link engedélye nem „Bárki, aki a linkkel rendelkezik”, vagy a szervezet tiltja a névtelen megosztást. ' +
        'Állítsd a linket „Bárki”-re; ha ez nem választható, töltsd le a fájlt és add meg helyi útvonalként ' +
        '(SOURCE_URL=~/Downloads/ora.xlsx), vagy tedd fel Google Sheetsbe nyilvános linkkel.',
      response.status,
    );
  }

  if (!response.ok) {
    throw new SourceError(`A forrás HTTP ${response.status} ${response.statusText} hibát adott.`, response.status);
  }

  if (contentType.includes('text/html')) {
    throw new SourceError(
      'A forrás weboldalt adott vissza, nem táblázatot. OneDrive/SharePoint esetén megosztási linket használj (Megosztás → „Bárki, aki a linkkel rendelkezik”), ne a Doc.aspx?sourcedoc=… nézegető URL-t; Google Sheetsnél a /export?format=xlsx URL-t.',
      response.status,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new SourceError('A forrás üres fájlt adott vissza.', response.status);
  if (bytes.byteLength > MAX_BYTES) throw new SourceError(`A forrásfájl túl nagy (${bytes.byteLength} bájt).`);

  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentType,
    etag: response.headers.get('etag') ?? undefined,
    lastModified: response.headers.get('last-modified') ?? undefined,
    notModified: false,
  };
}
