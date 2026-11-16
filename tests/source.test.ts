import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SourceError } from '../src/errors';
import { fetchSheet, isLocalSource, normalizeSourceUrl, resolveLocalPath } from '../src/source';

const BODY = new TextEncoder().encode('pretend this is an xlsx file');
const SHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const etag = '"week-47"';
      if (url.pathname === '/html') {
        return new Response('<!doctype html><html><body>Sign in</body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (url.pathname === '/missing') return new Response('nope', { status: 404 });
      if (url.pathname === '/forbidden') return new Response('denied', { status: 403 });
      if (url.pathname === '/empty') return new Response(new Uint8Array(0), { headers: { 'content-type': SHEET_TYPE } });
      if (request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: { etag } });
      }
      return new Response(BODY, { headers: { 'content-type': SHEET_TYPE, etag } });
    },
  });
  base = server.url.toString().replace(/\/$/, '');
});

afterAll(() => {
  server.stop(true);
});

describe('normalizeSourceUrl', () => {
  test('rewrites Google Sheets links to a direct xlsx export', () => {
    expect(normalizeSourceUrl('https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0')).toBe(
      'https://docs.google.com/spreadsheets/d/ABC123/export?format=xlsx',
    );
    expect(normalizeSourceUrl('https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pubhtml')).toBe(
      'https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pub?output=xlsx',
    );
  });

  test('adds download flags for OneDrive/SharePoint and Dropbox', () => {
    expect(normalizeSourceUrl('https://contoso.sharepoint.com/:x:/g/abc')).toContain('download=1');
    expect(normalizeSourceUrl('https://www.dropbox.com/s/abc/week.xlsx?raw=0')).toContain('dl=1');
  });

  test('leaves direct file URLs alone', () => {
    expect(normalizeSourceUrl('https://example.com/week.xlsx')).toBe('https://example.com/week.xlsx');
  });

  test('rejects non-URLs', () => {
    expect(() => normalizeSourceUrl('not a url')).toThrow(SourceError);
  });
});

describe('fetchSheet', () => {
  test('downloads, hashes, and revalidates with the ETag', async () => {
    const first = await fetchSheet(`${base}/sheet.xlsx`);
    expect(first.notModified).toBe(false);
    expect(first.bytes.byteLength).toBe(BODY.byteLength);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.contentType).toBe(SHEET_TYPE);
    expect(first.etag).toBe('"week-47"');

    const second = await fetchSheet(`${base}/sheet.xlsx`, { etag: first.etag });
    expect(second.notModified).toBe(true);
    expect(second.bytes.byteLength).toBe(0);
  });

  test('explains an HTML login page instead of feeding it to the parser', async () => {
    await expect(fetchSheet(`${base}/html`)).rejects.toThrow(/weboldalt adott vissza/);
  });

  test('surfaces HTTP failures with their status', async () => {
    const failure: unknown = await fetchSheet(`${base}/missing`).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(failure).toBeInstanceOf(SourceError);
    expect(failure instanceof SourceError ? failure.status : null).toBe(404);
  });

  test('explains a 403 as a missing public share', async () => {
    const failure: unknown = await fetchSheet(`${base}/forbidden`).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(failure).toBeInstanceOf(SourceError);
    expect(failure instanceof SourceError ? failure.message : '').toContain('nem enged névtelen hozzáférést');
  });

  test('rejects an empty body', async () => {
    await expect(fetchSheet(`${base}/empty`)).rejects.toThrow(/üres fájlt/);
  });
});

describe('local files', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'timetable-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('reads a path and a file:// URL with the same hash', async () => {
    const path = join(dir, 'week 47.xlsx');
    await writeFile(path, BODY);
    const fromPath = await fetchSheet(path);
    const fromUrl = await fetchSheet(pathToFileURL(path).toString());
    expect(fromPath.sha256).toBe(fromUrl.sha256);
    expect(fromPath.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fromPath.bytes.byteLength).toBe(BODY.byteLength);
    expect(fromPath.notModified).toBe(false);
  });

  test('detects content changes regardless of timestamps', async () => {
    const path = join(dir, 'changing.xlsx');
    await writeFile(path, 'first');
    const before = await fetchSheet(path);
    await writeFile(path, 'second');
    const after = await fetchSheet(path);
    expect(after.sha256).not.toBe(before.sha256);
  });

  test('explains missing, empty and non-file sources', async () => {
    await expect(fetchSheet(join(dir, 'nope.xlsx'))).rejects.toThrow(/nem található/);
    await writeFile(join(dir, 'empty.xlsx'), '');
    await expect(fetchSheet(join(dir, 'empty.xlsx'))).rejects.toThrow(/üres/);
    await expect(fetchSheet(dir)).rejects.toThrow(/Ez nem fájl/);
  });

  test('distinguishes paths from URLs', () => {
    expect(isLocalSource('sample/timetable.xlsx')).toBe(true);
    expect(isLocalSource('./sample/timetable.xlsx')).toBe(true);
    expect(isLocalSource('/absolute/path.xlsx')).toBe(true);
    expect(isLocalSource('file:///absolute/path.xlsx')).toBe(true);
    expect(isLocalSource('https://example.com/week.xlsx')).toBe(false);
    expect(isLocalSource('HTTP://example.com/week.xlsx')).toBe(false);
  });

  test('expands ~ because Bun.file does not', () => {
    expect(resolveLocalPath('~/Downloads/ora.xlsx')).toBe(join(homedir(), 'Downloads/ora.xlsx'));
    expect(resolveLocalPath('sample/ora.xlsx')).toBe('sample/ora.xlsx');
    expect(resolveLocalPath('file:///tmp/ora.xlsx')).toBe('/tmp/ora.xlsx');
  });
});
