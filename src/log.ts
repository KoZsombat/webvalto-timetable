export type LogLevel = 'info' | 'warn' | 'error';

/** One-line log with a UTC timestamp; keeps the bot's output greppable. */
export function log(level: LogLevel, message: string, detail?: unknown): void {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${level.toUpperCase()} ${message}`;
  if (level === 'error') console.error(line, detail ?? '');
  else if (level === 'warn') console.warn(line, detail ?? '');
  else console.log(line);
}
