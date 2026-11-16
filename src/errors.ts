/** Forrás-hiba: a hibaüzenet közvetlenül a Discord üzenetbe és a CLI-be kerül. */
export class SourceError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SourceError';
    this.status = status;
  }
}
