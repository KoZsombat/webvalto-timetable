/**
 * Serves the sample workbook over HTTP so the bot can poll it exactly like a
 * real online document — including ETag revalidation.
 *
 *   bun run serve [--file sample/timetable.xlsx] [--port 8787]
 *
 * The file is read on every request, so editing/saving it (or re-running
 * `bun run sample`) is picked up immediately. Ctrl+C to stop.
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    file: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string' },
  },
});

const file = values.file ?? 'sample/timetable.xlsx';
const port = Number(values.port ?? 8787);
const host = values.host ?? '127.0.0.1';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const server = Bun.serve({
  port,
  hostname: host,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/timetable.xlsx') {
      return new Response('Not found. Use /timetable.xlsx', { status: 404 });
    }

    const body = Bun.file(file);
    if (!(await body.exists())) {
      return new Response(`Missing ${file}. Run: bun run sample\n`, { status: 500 });
    }

    const stat = await body.stat();
    const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
    const headers = {
      etag,
      'last-modified': new Date(stat.mtimeMs).toUTCString(),
      'content-type': XLSX_TYPE,
    };

    if (request.headers.get('if-none-match') === etag) {
      console.log(`${stamp()} 304 ${url.pathname} (unchanged)`);
      return new Response(null, { status: 304, headers });
    }

    console.log(`${stamp()} 200 ${url.pathname} (${stat.size} B)`);
    if (request.method === 'HEAD') {
      return new Response(null, { headers: { ...headers, 'content-length': String(stat.size) } });
    }
    return new Response(body, { headers });
  },
});

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

console.log(`Serving ${file}`);
console.log(`SOURCE_URL=http://${host}:${server.port}/timetable.xlsx`);
