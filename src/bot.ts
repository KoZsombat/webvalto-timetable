import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
  type SendableChannels,
} from 'discord.js';
import { loadConfig, type Config } from './config';
import { log } from './log';
import { buildImageMessage, type ViewOptions } from './render';
import { IMAGE_FILE_NAME } from './image';
import { TimetableStore } from './store';
import { displayWeek, todayInZone, type ISODate } from './weeks';

interface BotState {
  channelId?: string;
  messageId?: string;
  /** Last published payload; lets a restart skip a needless edit. */
  lastPayload?: string;
}

interface WeekContext {
  today: ISODate;
  /** Az aktuális hét (szombattól a következő). */
  cap: ISODate;
}

const config: Config = (() => {
  try {
    return loadConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();

const store = new TimetableStore(config.sourceUrl, config.archiveFile, config.graph);
const state = await readState(config.stateFile);
if (state.channelId && state.channelId !== config.channelId) {
  log('warn', 'A DISCORD_CHANNEL_ID megváltozott; elfelejtem a korábbi üzenetet.');
  delete state.messageId;
  delete state.lastPayload;
}
state.channelId = config.channelId;

let pinnedMessage: Message | null = null;
let lastPayload = state.lastPayload ?? null;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopping = false;
let lastArchiveError: string | null = null;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (ready) => {
  void boot(ready);
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction);
});

client.login(config.token).catch((error: unknown) => {
  log('error', `Bejelentkezés sikertelen — ellenőrizd a DISCORD_TOKEN-t: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
log('info', `Figyelés: ${config.sourceUrl}, ${config.pollSeconds} mp, időzóna: ${config.timeZone}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
    clearTimeout(timer);
    log('info', 'Leállítás');
    void client.destroy().finally(() => process.exit(0));
  });
}

async function boot(ready: Client<true>): Promise<void> {
  log('info', `Bejelentkezve: ${ready.user.tag}`);
  await registerCommands(ready);
  await tick();
}

/** One poll: sync the sheet, then republish if anything visible changed. */
async function tick(): Promise<void> {
  if (stopping) return;
  await attemptSync();
  try {
    await publish();
  } catch (error) {
    log('error', 'Az órarend-üzenet frissítése nem sikerült', error);
  }
  if (!stopping) timer = setTimeout(() => void tick(), config.pollSeconds * 1000);
}

async function attemptSync(): Promise<void> {
  const result = await store.sync();
  if (result === 'changed') {
    const weeks = store.timetable?.weeks.length ?? 0;
    log('info', `A táblázat megváltozott: ${weeks} hét beolvasva`);
    for (const warning of store.timetable?.warnings ?? []) log('warn', warning);
  } else if (result === 'error') {
    log('warn', `Szinkronizálási hiba: ${store.lastError}`);
  }
  if (store.archiveError && store.archiveError !== lastArchiveError) {
    log('warn', `Nem sikerült az archívum írása: ${store.archiveError}`);
  }
  lastArchiveError = store.archiveError;
}

async function publish(): Promise<void> {
  const context = currentContext();
  const message = buildImageMessage(viewFor(context.cap, context));
  const serialized = message.signature;
  const files = message.png ? [new AttachmentBuilder(Buffer.from(message.png), { name: IMAGE_FILE_NAME })] : [];

  const channel = await sendableChannel();
  let target = pinnedMessage;
  if (!target && state.messageId) {
    target = await channel.messages.fetch(state.messageId).catch((error: unknown) => {
      if (isUnknownMessage(error)) return null;
      throw error;
    });
    if (target) pinnedMessage = target;
    else delete state.messageId;
  }

  if (target && serialized === lastPayload) return;

  if (target) {
    try {
      await target.edit({ ...message.json, files, ...(files.length > 0 ? { attachments: [] } : {}) });
    } catch (error) {
      if (!isUnknownMessage(error)) throw error;
      log('warn', 'A kitűzött üzenet eltűnt; újat küldök.');
      target = null;
      pinnedMessage = null;
      delete state.messageId;
    }
  }

  if (!target) {
    target = await channel.send({ ...message.json, files });
    pinnedMessage = target;
    state.messageId = target.id;
    await target.pin().catch(() => log('warn', 'Az üzenet kitűzése nem sikerült (Manage Messages jogosultság kell hozzá).'));
    log('info', `Órarend-üzenet elküldve ide: #${'name' in channel ? channel.name : config.channelId}`);
  }

  lastPayload = serialized;
  state.lastPayload = serialized;
  await persistState();
}

async function sendableChannel(): Promise<SendableChannels> {
  const channel = await client.channels.fetch(config.channelId);
  if (!channel || !channel.isSendable()) {
    throw new Error(`A(z) ${config.channelId} csatorna nem található, vagy nem lehet bele írni.`);
  }
  return channel;
}

async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'timetable') {
      await replyWithWeek(interaction);
    }
  } catch (error) {
    log('error', `A(z) ${interaction.id} interakció hibára futott`, error);
    if (!interaction.isRepliable()) return;
    const payload = { content: 'Hiba történt. Próbáld újra egy kicsit később.', flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => undefined);
    else await interaction.reply(payload).catch(() => undefined);
  }
}

/**
 * Ideiglenes válasz a /timetable parancsra: a hét képe csak a kérőnek jelenik meg,
 * a rögzített üzenet érintetlen marad.
 */
async function replyWithWeek(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = currentContext();
  const message = buildImageMessage(viewFor(context.cap, context));
  const files = message.png ? [new AttachmentBuilder(Buffer.from(message.png), { name: IMAGE_FILE_NAME })] : [];
  await interaction.reply({ ...message.json, files, flags: MessageFlags.Ephemeral });
}

function currentContext(): WeekContext {
  const today = todayInZone(config.timeZone);
  const cap = displayWeek(today, config.rollover);
  return { today, cap };
}

function viewFor(weekStart: ISODate, context: WeekContext): ViewOptions {
  return {
    timetable: store.timetable,
    weekStart,
    today: context.today,
    capStart: context.cap,
    updatedAt: store.updatedAt ?? undefined,
    sourceUrl: config.sourceUrl,
    lastError: store.lastError,
    blockLabels: config.blockLabels,
  };
}

async function registerCommands(ready: Client<true>): Promise<void> {
  const command = new SlashCommandBuilder().setName('timetable').setDescription('Az aktuális hét órarendje').toJSON();
  try {
    if (config.guildId) {
      const guild = await ready.guilds.fetch(config.guildId);
      await guild.commands.set([command]);
    } else {
      await ready.application.commands.set([command]);
    }
    log('info', '/timetable parancs regisztrálva');
  } catch (error) {
    log('warn', 'A /timetable parancs regisztrálása nem sikerült', error);
  }
}

function isUnknownMessage(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 10008;
}

/** State comes from a file we wrote; still validate before trusting its shape. */
function isBotState(value: unknown): value is BotState {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return ['channelId', 'messageId', 'lastPayload'].every((key) => {
    const field = record[key];
    return field === undefined || typeof field === 'string';
  });
}

async function readState(file: string): Promise<BotState> {
  try {
    const parsed: unknown = JSON.parse(await Bun.file(file).text());
    return isBotState(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function persistState(): Promise<void> {
  try {
    await Bun.write(config.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    log('warn', `Nem sikerült írni: ${config.stateFile}`, error);
  }
}
