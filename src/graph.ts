/**
 * SharePoint/OneDrive olvasása Microsoft Graphszal, alkalmazás-jogosultsággal.
 *
 * Akkor kell, ha a szervezet a „Bárki, aki a linkkel rendelkezik" megosztást nem
 * engedi, és a fájl csak bejelentkezve érhető el. A bot nem tud bejelentkezni,
 * ezért ügyfél-hitelesítő adatokkal (client credentials) kér tokent, és a
 * Graphon keresztül tölti le a megosztási link mögötti fájlt.
 *
 * Szükséges Azure-alkalmazás: `Files.Read.All` (és `Sites.Read.All`)
 * **alkalmazás** jogosultság, adminisztrátori jóváhagyással.
 */
import { createHash } from 'node:crypto';
import { SourceError } from './errors';

export interface GraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface GraphOptions {
  /** Csak a tesztekhez; alapból login.microsoftonline.com. */
  authorityHost?: string;
  /** Csak a tesztekhez; alapból graph.microsoft.com. */
  graphHost?: string;
}

const DEFAULT_AUTHORITY = 'https://login.microsoftonline.com';
const DEFAULT_GRAPH = 'https://graph.microsoft.com';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 20 * 1024 * 1024;

interface CachedToken {
  key: string;
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

/** A megosztási URL `u!<base64url>` alakja, ahogy a Graph `/shares` várja. */
export function encodeSharingUrl(url: string): string {
  return `u!${Buffer.from(url.trim(), 'utf8').toString('base64url')}`;
}

export async function fetchGraphSheet(
  sharingUrl: string,
  credentials: GraphCredentials,
  options: GraphOptions = {},
): Promise<{ bytes: Uint8Array; sha256: string; contentType: string; notModified: false }> {
  const token = await accessToken(credentials, options);
  const graphHost = options.graphHost ?? DEFAULT_GRAPH;
  const encoded = encodeSharingUrl(sharingUrl);

  let response: Response;
  try {
    response = await fetch(`${graphHost}/v1.0/shares/${encoded}/driveItem/content`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new SourceError(`A Graph nem érhető el: ${(error as Error).message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new SourceError(
      `A Graph HTTP ${response.status} választ adott: az alkalmazásnak nincs joga ehhez a fájlhoz. ` +
        'Az Azure-alkalmazásnak `Files.Read.All` (és `Sites.Read.All`) alkalmazás-jogosultság kell, adminisztrátori jóváhagyással.',
      response.status,
    );
  }
  if (response.status === 404) {
    throw new SourceError('A Graph nem találja a megosztott fájlt (404). Ellenőrizd a linket és a jogosultságot.', 404);
  }
  if (!response.ok) {
    throw new SourceError(`A Graph HTTP ${response.status} ${response.statusText} hibát adott.`, response.status);
  }

  const contentType = response.headers.get('content-type') ?? XLSX_MIME;
  if (contentType.includes('text/html')) {
    throw new SourceError('A Graph weboldalt adott vissza a fájl helyett — valószínűleg a link egy nézegető oldalra mutat.');
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new SourceError('A Graph üres fájlt adott vissza.');
  if (bytes.byteLength > MAX_BYTES) throw new SourceError(`A forrásfájl túl nagy (${bytes.byteLength} bájt).`);

  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentType,
    notModified: false,
  };
}

async function accessToken(credentials: GraphCredentials, options: GraphOptions): Promise<string> {
  const key = `${credentials.tenantId}|${credentials.clientId}`;
  if (cachedToken && cachedToken.key === key && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const authority = options.authorityHost ?? DEFAULT_AUTHORITY;
  let response: Response;
  try {
    response = await fetch(`${authority}/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new SourceError(`Graph bejelentkezés nem sikerült: ${(error as Error).message}`);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isRecord(payload) && typeof payload.error_description === 'string' ? ` (${payload.error_description.split('\n')[0]})` : '';
    throw new SourceError(
      `Graph bejelentkezés sikertelen (HTTP ${response.status})${detail}. Ellenőrizd a GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET értékeket.`,
      response.status,
    );
  }

  if (!isRecord(payload) || typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    throw new SourceError('A Graph token-válasz érvénytelen (nincs access_token).');
  }

  const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 120 ? payload.expires_in : 3600;
  cachedToken = { key, token: payload.access_token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  return payload.access_token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
