import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { SourceError } from '../src/errors';
import { encodeSharingUrl, fetchGraphSheet, type GraphCredentials } from '../src/graph';

const SHARE = 'https://contoso.sharepoint.com/:x:/g/personal/user/DOC123?e=abc';
const BODY = new TextEncoder().encode('pretend this is an xlsx file');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let server: ReturnType<typeof Bun.serve>;
let base: string;
let tokenRequests = 0;
let lastTokenBody = '';
let contentRequests = 0;
let denyContent = false;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname.endsWith('/oauth2/v2.0/token')) {
        tokenRequests += 1;
        lastTokenBody = await request.text();
        const body = new URLSearchParams(lastTokenBody);
        denyContent = body.get('client_id') === 'denied-client';
        const tenant = url.pathname.split('/')[1];
        if (tenant === 'badtenant') {
          return Response.json({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }, { status: 400 });
        }
        return Response.json({ access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' });
      }

      if (url.pathname.includes('/driveItem/content')) {
        contentRequests += 1;
        if (denyContent) {
          return new Response('no', { status: 403 });
        }
        if (request.headers.get('authorization') !== 'Bearer tok-1') {
          return Response.json({ error: 'unauthenticated' }, { status: 401 });
        }
        return new Response(BODY, { headers: { 'content-type': XLSX } });
      }

      return new Response('not found', { status: 404 });
    },
  });
  base = server.url.toString().replace(/\/$/, '');
});

afterAll(() => {
  server.stop(true);
});

function credentials(tenantId: string, clientId = 'client-1'): GraphCredentials {
  return { tenantId, clientId, clientSecret: 'secret-1' };
}

describe('sharing url encoding', () => {
  test('base64url without padding, reversible', () => {
    const encoded = encodeSharingUrl(SHARE);
    expect(encoded.startsWith('u!')).toBe(true);
    const raw = encoded.slice(2);
    expect(raw).not.toMatch(/[+/=]/);
    expect(Buffer.from(raw, 'base64url').toString('utf8')).toBe(SHARE);
  });
});

describe('graph fetch', () => {
  test('requests a token, then streams the file', async () => {
    tokenRequests = 0;
    const result = await fetchGraphSheet(SHARE, credentials('tenant-a'), {
      authorityHost: base,
      graphHost: base,
    });

    expect(tokenRequests).toBe(1);
    const body = new URLSearchParams(lastTokenBody);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('https://graph.microsoft.com/.default');
    expect(body.get('client_id')).toBe('client-1');
    expect(body.get('client_secret')).toBe('secret-1');

    expect(result.bytes.byteLength).toBe(BODY.byteLength);
    expect(result.sha256).toBe(createHash('sha256').update(BODY).digest('hex'));
    expect(result.contentType).toBe(XLSX);
  });

  test('caches the token between polls', async () => {
    tokenRequests = 0;
    const options = { authorityHost: base, graphHost: base };
    await fetchGraphSheet(SHARE, credentials('tenant-cache'), options);
    await fetchGraphSheet(SHARE, credentials('tenant-cache'), options);
    expect(tokenRequests).toBe(1);
    expect(contentRequests).toBeGreaterThanOrEqual(2);
  });

  test('explains a missing Graph permission', async () => {
    const failure: unknown = await fetchGraphSheet('https://contoso.sharepoint.com/denied', credentials('tenant-denied', 'denied-client'), {
      authorityHost: base,
      graphHost: base,
    }).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(failure).toBeInstanceOf(SourceError);
    expect(failure instanceof SourceError ? failure.message : '').toContain('Files.Read.All');
  });

  test('explains a rejected client secret', async () => {
    const failure: unknown = await fetchGraphSheet(SHARE, credentials('badtenant'), {
      authorityHost: base,
      graphHost: base,
    }).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(failure).toBeInstanceOf(SourceError);
    const message = failure instanceof SourceError ? failure.message : '';
    expect(message).toContain('GRAPH_TENANT_ID');
    expect(message).toContain('Invalid client secret');
  });
});
