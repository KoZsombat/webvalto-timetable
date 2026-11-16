# Timetable → Discord

A bot that keeps one pinned Discord message in sync with the school's online
spreadsheet. It polls every minute, edits the message in place when the sheet
changes, renders the week as a PNG in the school's own layout, and rolls over to
the next week every Saturday. No week-navigation buttons: the current week is
always what you see.

## Behaviour

- **Polling:** every `POLL_SECONDS` (default 60). Downloads the sheet, hashes it,
  and only edits Discord when the rendered payload or image actually changed.
- **Rollover:** the displayed week is the week containing today, except from
  Saturday onward it is the next week (`ROLLOVER_WEEKDAY`). Friday shows the
  running week; Sat/Sun show the upcoming one; Monday agrees with Saturday.
- **Rendering:** a PNG attachment (`attachment://timetable.png`): days as
  columns, periods as rows, break rows, both rooms (Nagy/Kis terem), today's
  column highlighted. Text fields are omitted to avoid duplication; if rendering
  fails, a text embed is used instead.
- **Hungarian UI:** titles, dates, buttons-free footer, errors and `/timetable`.
- **Fail-soft:** a failed fetch or parse keeps the last good timetable and shows
  the error in the message.

## Quick start

```bash
bun install
cp .env.example .env      # DISCORD_TOKEN, DISCORD_CHANNEL_ID, SOURCE_URL
bun start
```

`/timetable` shows an ephemeral image of the current week. Offline checks:

```bash
bun run dump    --url '<link or path>'
bun run preview --url '<link or path>' --png /tmp/week.png
bun run demo
```

## Docker

```bash
docker compose up -d --build
docker compose logs -f
```

- `env_file: .env` **and** every variable listed under `environment` — the app
  reads all of them from `.env`; compose only provides defaults if one is missing.
- Container cwd is `/data`, so the relative `STATE_FILE`/`ARCHIVE_FILE` from
  `.env` land on the `timetable-data` volume and survive restarts.
- No ports; the bot connects out to Discord and Google.
- Image: `oven/bun:1-debian` + Fontconfig/DejaVu so Hungarian accents render in
  the PNG.
- Run **one** instance per token. If you previously ran `bun start`, stop it, and
  to keep the already-posted message copy its state into the volume:

```bash
docker compose up -d
docker compose cp .state.json timetable:/data/.state.json
docker compose restart timetable
```

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DISCORD_TOKEN` | — | bot token |
| `DISCORD_CHANNEL_ID` | — | channel with the pinned message |
| `GUILD_ID` | global | register `/timetable` in one guild (instant) |
| `SOURCE_URL` | — | Google Sheets / OneDrive / Dropbox link **or** local `.xlsx` path |
| `POLL_SECONDS` | `60` | poll interval (15–3600) |
| `ROLLOVER_WEEKDAY` | `szombat` | weekday that switches to the next week |
| `TIMEZONE` | host zone | IANA zone defining "today" |
| `STATE_FILE` | `.state.json` | pinned message id + last payload |
| `ARCHIVE_FILE` | `.weeks.json` | weeks seen so far (CLI previews) |
| `BLOCK_LABELS` | `Nagy terem,Kis terem` | room names, in order |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | — | optional Microsoft Graph access (needs admin consent) |

## Source

- **Google Sheets:** share as *Anyone with the link → Viewer*; `/edit` links are
  rewritten to `export?format=xlsx`. The bot only ever sends GET.
- **SharePoint/OneDrive:** must be an anonymous "Anyone" share link. A
  `Doc.aspx?sourcedoc=…` viewer URL requires sign-in and returns 403. School
  tenants often block anonymous links; then use a local file, Google Sheets, or
  Graph (above).
- **Local file:** `SOURCE_URL=~/Downloads/timetable.xlsx` (re-read every poll).

## Sheet layout

One sheet per month, several weeks side by side (`November (1.hét)` …), each week
with day headers (`Hétfő (11.16.)`), a `1. óra` + `8:30 - 9:15` gutter, break
rows, and two stacked room blocks (a repeated period run or a repeated header row
starts the next room). A single-week-per-sheet workbook also works.

## Commands

| Command | Purpose |
|---|---|
| `bun start` | run the bot |
| `docker compose up -d --build` | run in Docker |
| `bun run preview --file X \| --url U [--week …] [--json] [--png out.png]` | render one week |
| `bun run dump --file X \| --url U` | parsed sheets/weeks + warnings |
| `bun run demo` | offline demo |
| `bun run sample` / `bun run serve` | generate / serve a sample workbook |
| `bun run find-sheet` | locate a synced timetable file |
| `bun test`, `bun run typecheck` | tests, types |

## Limits

- Discord caches messages; "live" means updated within one poll.
- Embeds are capped at 25 fields / 6000 characters; an oversized week is
  truncated with a note pointing at the source.
- Older weeks are inspectable only from the CLI (`preview --week prev`).
