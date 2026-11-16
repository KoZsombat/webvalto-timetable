import type { Weekday } from './weeks';
import { WEEKDAY_NAMES } from './weeks';
import type { GraphCredentials } from './graph';

export interface Config {
  token: string;
  channelId: string;
  guildId?: string;
  sourceUrl: string;
  pollSeconds: number;
  timeZone: string;
  rollover: Weekday;
  stateFile: string;
  archiveFile: string;
  /** Optional display names for the stacked blocks, in order. */
  blockLabels?: string[];
  /** SharePoint/OneDrive bejelentkezéshez, ha a fájl nem nyilvános. */
  graph?: GraphCredentials;
}

const ROLLOVER_NAMES: Record<string, Weekday> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};
WEEKDAY_NAMES.forEach((name, index) => {
  ROLLOVER_NAMES[name.toLowerCase()] = index as Weekday;
});

const MIN_POLL_SECONDS = 15;
const MAX_POLL_SECONDS = 3600;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const problems: string[] = [];

  const token = required(env, 'DISCORD_TOKEN', problems);
  const channelId = required(env, 'DISCORD_CHANNEL_ID', problems);
  const sourceUrl = required(env, 'SOURCE_URL', problems);

  for (const [name, value] of [
    ['DISCORD_CHANNEL_ID', channelId],
    ['GUILD_ID', env.GUILD_ID],
  ] as const) {
    if (value && !/^\d{5,25}$/.test(value)) problems.push(`${name}: csak számokból álló Discord ID lehet.`);
  }

  const timeZone = env.TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat('hu-HU', { timeZone });
  } catch {
    problems.push(`TIMEZONE: "${timeZone}" nem érvényes IANA időzóna (pl. Europe/Budapest).`);
  }

  const rollover = parseRollover(env.ROLLOVER_WEEKDAY, problems);

  let pollSeconds = Number(env.POLL_SECONDS ?? '60');
  if (!Number.isFinite(pollSeconds)) {
    problems.push('POLL_SECONDS: számot kell megadni.');
    pollSeconds = 60;
  }
  if (pollSeconds < MIN_POLL_SECONDS || pollSeconds > MAX_POLL_SECONDS) {
    problems.push(`POLL_SECONDS: ${MIN_POLL_SECONDS} és ${MAX_POLL_SECONDS} közé kell esnie.`);
    pollSeconds = Math.min(Math.max(pollSeconds, MIN_POLL_SECONDS), MAX_POLL_SECONDS);
  }

  const graph = graphFromEnv(env, problems);

  if (problems.length > 0) throw new Error(`Hibás beállítások:\n  - ${problems.join('\n  - ')}`);

  const blockLabels = (env.BLOCK_LABELS ?? '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);

  return {
    token,
    channelId,
    guildId: env.GUILD_ID?.trim() || undefined,
    sourceUrl,
    pollSeconds,
    timeZone,
    rollover,
    stateFile: env.STATE_FILE?.trim() || '.state.json',
    archiveFile: env.ARCHIVE_FILE?.trim() || '.weeks.json',
    ...(blockLabels.length > 0 ? { blockLabels } : {}),
    ...(graph ? { graph } : {}),
  };
}

/** Graph hitelesítő adatok; a részleges beállítás hibának számít. */
export function graphFromEnv(
  env: Record<string, string | undefined> = process.env,
  problems: string[] = [],
): GraphCredentials | undefined {
  const [tenantId, clientId, clientSecret] = ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET'].map((name) =>
    env[name]?.trim(),
  );
  if (!tenantId && !clientId && !clientSecret) return undefined;
  if (!tenantId || !clientId || !clientSecret) {
    problems.push('GRAPH_TENANT_ID, GRAPH_CLIENT_ID és GRAPH_CLIENT_SECRET együtt kell megadni.');
    return undefined;
  }
  return { tenantId, clientId, clientSecret };
}

function required(env: Record<string, string | undefined>, name: string, problems: string[]): string {
  const value = env[name]?.trim();
  if (!value) problems.push(`${name} kötelező.`);
  return value ?? '';
}

function parseRollover(value: string | undefined, problems: string[]): Weekday {
  if (!value?.trim()) return 5; // szombat: hétvégén már a következő hét látszik
  const normalized = value.trim().toLowerCase();
  const named = ROLLOVER_NAMES[normalized];
  if (named !== undefined) return named;
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) return numeric as Weekday;
  problems.push('ROLLOVER_WEEKDAY: napnév (hétfő…vasárnap / monday…sunday) vagy 0–6.');
  return 5;
}
