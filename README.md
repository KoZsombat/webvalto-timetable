# Órarend → Discord

Egy bot, ami egy rögzített üzenetet tart szinkronban az iskola online
táblázatával. Változáskor helyben szerkeszti az üzenetet, percenként
ellenőrzi a forrást, és szombattól magától a következő hetet mutatja —
nincs heti navigáció.

```
┌──────────────────────────────────────────────┐
│ Órarend · 47. hét · 2026. nov. 16–22.        │
│ 51 óra · 2 terem.                            │
│                                              │
│ Hétfő, nov. 16. · ma                         │
│ Nagy terem                                   │
│ • 08:30–09:15  (SZ) István                   │
│ …                                            │
│ Kis terem                                    │
│ • 08:30–09:15  Levente (ü)                   │
│                                              │
│ Forrás: docs.google.com · frissítve           │
└──────────────────────────────────────────────┘
```

## Működés

- **Kép a táblázatról.** A rögzített üzenet a hét egészét egy PNG-n mutatja,
  az iskola táblázatának formájában: napok oszlopként, órák soronként, szünetek
  vékony sorként, a termek (Nagy/Kis terem) egymás alatt. Az embed csak a címet,
  az összegzést és a láblécet tartja — a napi szöveges bontás
  elmarad, hogy ne legyen duplikáció. Ha a rajzolás nem sikerül, visszaesik a
  szöveges mezőkre.
- **Élő frissítés.** A táblázatot `POLL_SECONDS` másodpercenként kérdezi le
  (alap: 60). SHA-256 és `ETag` alapján dönt, csak változáskor dolgozza fel
  újra, és csak akkor szerkeszti az üzenetet, ha a kész tartalom tényleg más.
- **Percenkénti frissítés.** `POLL_SECONDS=60` (a compose és a Dockerfile is
  ezt állítja be): percenként letölti a táblázatot, és csak változáskor
  szerkeszti az üzenetet.
- **Automatikus hétváltás.** A megjelenített hét a mai nap hete, kivéve
  szombattól: akkor már a következő hét (`ROLLOVER_WEEKDAY`). Pénteken még az
  aktuális hét látszik, szombaton és vasárnap a jövő heti, hétfőn ugyanaz, mint
  szombaton — a nézet sosem lép hátra, és nincs hozzá gomb.
- **Hibatűrés.** Sikertelen letöltés vagy értelmezhetetlen fájl esetén marad az
  utolsó jó órarend, egy figyelmeztető sorral — a csatorna nem ürül ki.

## Gyors indítás

1. **Discord alkalmazás** — <https://discord.com/developers/applications> →
   New Application → Bot → Reset Token. Különleges intent nem kell.
   Meghívás `bot` + `applications.commands` scope-pal, engedélyekkel:
   *View Channels, Send Messages, Embed Links, Read Message History, Manage
   Messages* (az utóbbi csak a kitűzéshez).
2. **Beállítás**
   ```bash
   cp .env.example .env   # DISCORD_TOKEN, DISCORD_CHANNEL_ID, SOURCE_URL
   bun install
   ```
3. **Offline kipróbálás** (token és hálózat nélkül):
   ```bash
   bun run demo
   bun run demo --now 2026-11-14   # szombat: látszik a hétváltás
   ```
4. **Valódi HTTP-forrás kipróbálása** a mellékelt mintával:
   ```bash
   bun run sample    # sample/timetable.xlsx — egy hét, két terem
   bun run serve     # http://127.0.0.1:8787/timetable.xlsx
   bun run preview --url http://127.0.0.1:8787/timetable.xlsx
   ```
   A `.env` alapból a fájlra mutat (`sample/timetable.xlsx`), tehát a szerver
   nem kötelező — csak egy valódi online dokumentumot utánoz. Teljesen online
   verzióhoz töltsd fel a `sample/timetable.xlsx`-t Drive-ra, nyisd meg Google
   Sheetsben, oszd meg „bárki a linkkel megtekintheti” módban, és másold az
   `/edit` URL-t a `.env`-be.
5. **Éles ellenőrzés** indítás előtt:
   ```bash
   bun run dump    --url sample/timetable.xlsx
   bun run preview --url sample/timetable.xlsx --json
   ```
6. **Indítás**
   ```bash
   bun start
   ```

## Forrás (`SOURCE_URL`)

Bármelyik linket be lehet írni; a bot a nézegető linket közvetlen letöltéssé
alakítja (`normalizeSourceUrl` a `src/source.ts`-ben):

| Amit beírsz | Amit letölt |
|---|---|
| `sample/het.xlsx`, `~/…/het.xlsx`, `file:///…/het.xlsx` | helyi fájl, minden lekérdezéskor újrahashelve |
| `docs.google.com/spreadsheets/d/<id>/edit#gid=0` | `/export?format=xlsx` |
| `docs.google.com/spreadsheets/d/e/<pub>/pubhtml` | `/pub?output=xlsx` |
| OneDrive / SharePoint megosztó link | ugyanaz `download=1`-gyel |
| Dropbox megosztó link | ugyanaz `dl=1`-gyel |
| közvetlen `.xlsx` / `.csv` URL | változatlan |

A fájlnak bejelentkezés nélkül olvashatónak kell lennie. Ha a Google bejelentkező
oldalt ad vissza, a bot ezt írja ki („weboldalt adott vissza, nem táblázatot”),
nem eteti HTML-lel az értelmezőt.

**OneDrive/SharePoint:** a `…/Doc.aspx?sourcedoc=…` alakú URL, amit bejelentkezve
kapsz, *nézegető* link, nem megosztási link — a bot nem tud bejelentkezni, ezért
403-at kap. Használd a **Megosztás → „Bárki, aki a linkkel rendelkezik”** linket.
Ha a szervezet tiltja a nyilvános megosztást, három út marad:

1. **Microsoft Graph** (a fájl online marad): Azure-alkalmazás `Files.Read.All` +
   `Sites.Read.All` **alkalmazás** jogosultsággal, adminisztrátori jóváhagyással,
   majd `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` a `.env`-ben.
   A bot ügyfél-hitelesítő adatokkal kér tokent, és a megosztási link mögötti
   fájlt a Graphon keresztül tölti le.
2. **OneDrive szinkron** a bot gépén: a fájl a felhőből szinkronizálódik, a bot a
   helyi másolatot olvassa (`SOURCE_URL=~/Library/CloudStorage/OneDrive-…/timetable.xlsx`).
   Nem kell admin, és a szerkesztés a felhőben történik. A fájl megkeresése:
   `bun run find-sheet` — kiírja a legfrissebb találatot és a kész `SOURCE_URL` sort.
3. **Google Sheets**: feltöltés, „Bárki a linkkel” megosztás, `/edit` URL.

## A táblázat formátuma

A valódi munkafüzet **havi bontású**: egy munkafüzet = egy hónap, benne egymás
mellett öt hét (`November (1.hét)`, `(2.hét)`, …), és minden héten **két terem**
egymás alatt (Nagy/Kis). A parser ezt hét-panelekre bontja; minden panel a saját
fejléc-dátumaiból kapja a hét hétfőjét.

| Hol | Mi |
|---|---|
| hét-panel | egy hét oszlopai, fejléc: `Hétfő (11.16.)` … `Péntek (11.20.)` |
| bal sáv | `1. óra` + `8:30 - 9:15` |
| szünet-sor | csak idő (`9:15 - 9:25`), gyakran összevont `A:B` cellában |
| terem-blokk | az óraszám újraindulása (ismét `1. óra`) vagy ismételt fejléc-sor = a következő terem; alapból Nagy/Kis terem |
| cella | több sor = párhuzamos órák; a `(SZ)` / `(Ü)` tag megmarad |

Az év nélküli dátumokat (`11.16.`) a mai naphoz legközelebbi évre oldja fel, így
a decemberi táblázat januárban is az előző évben marad. A régi, „egy munkafüzet =
egy hét” forma is működik (a példa ilyen), ha valaki később átszervezné.

**A bot csak olvas:** a Google Sheets linket `export?format=xlsx`-re írja át, és
kizárólag GET kérést küld. Soha nem ír a táblázatba.

## Beállítások

| Változó | Alap | Jelentés |
|---|---|---|
| `DISCORD_TOKEN` | — | bot token |
| `DISCORD_CHANNEL_ID` | — | a rögzített üzenet csatornája |
| `GUILD_ID` | globális | `/timetable` regisztrálása egy szerverbe (azonnal megjelenik) |
| `SOURCE_URL` | — | táblázat link **vagy** helyi `.xlsx` útvonal |
| `POLL_SECONDS` | `60` | lekérdezési idő, 15–3600 |
| `ROLLOVER_WEEKDAY` | `szombat` | ettől a naptól a következő hét az alapnézet |
| `TIMEZONE` | gép zónája | IANA zóna az „ma” naphoz |
| `STATE_FILE` | `.state.json` | a rögzített üzenet azonosítója |
| `ARCHIVE_FILE` | `.weeks.json` | az eddig látott hetek (CLI-előnézethez) |
| `BLOCK_LABELS` | `Nagy terem,Kis terem` | a blokkok megjelenített nevei |
| `GRAPH_TENANT_ID` | — | Azure tenant a Graph-hozváféréshez |
| `GRAPH_CLIENT_ID` | — | Azure alkalmazás (client) ID |
| `GRAPH_CLIENT_SECRET` | — | Azure client secret |

A bot a `STATE_FILE`-ban jegyzi meg az üzenet azonosítóját, így újraindítás után
ugyanazt szerkeszti, nem küld újat. Töröld a fájlt, ha friss üzenetet akarsz.

## Parancsok

| Parancs | Cél |
|---|---|
| `bun start` | a bot futtatása |
| `docker compose up -d --build` | a bot futtatása konténerben |
| `docker compose logs -f` | konténer naplói |
| `bun run demo [--now DÁTUM]` | offline demó: hétváltás, blokkok, üzenetméret |
| `bun run sample [--now DÁTUM]` | `sample/timetable.xlsx` előállítása (heti rács, két terem) |
| `bun run serve [--port 8787]` | a minta kiszolgálása HTTP-n, ETag-gel |
| `bun run find-sheet` | megkeresi a szinkronizált/megnyitott órarend-fájlt és a `SOURCE_URL` sort |
| `bun run preview --file X \| --url U [--week …] [--json] [--png kép.png]` | a hét szöveges/JSON nézete, illetve PNG-be rajzolva |
| `bun run dump --file X \| --url U` | feloldott hetek, munkafüzetek, figyelmeztetések |
| `bun test` | hétmatek, táblázat-értelmezés, limitek, HTTP, archívum |
| `bun run typecheck` | `tsc --noEmit` |

## Futtatás Dockerrel

```bash
docker compose up -d --build
docker compose logs -f
```

- A `.env`-t a compose `env_file`-ként olvassa be (token, csatorna, `SOURCE_URL`).
- `POLL_SECONDS` alapból **60**, tehát percenként frissül.
- A `timetable-data` kötet őrzi a `state.json`-t (rögzített üzenet) és a
  `weeks.json`-t, így újraindítás után ugyanazt az üzenetet szerkeszti.
- A konténer nem nyit portot: kifelé kapcsolódik a Discord gatewayhez és a
  Google-hoz.
- Alapkép `oven/bun:1-debian`, benne `fontconfig` + DejaVu — a magyar ékezetek
  a képen is helyesen jelennek meg.
- `restart: unless-stopped`, `init: true`.
- **Csak egy példány fusson ugyanazzal a tokennel.** Ha eddig `bun start`-tal
  futtattad, állítsd le, különben ketten szerkesztik ugyanazt az üzenetet.

Ha meg akarod tartani a már kiposztolt üzenetet, másold be a state fájlt a
kötetbe (a kötet alapból üres, tehát nélküle **új** üzenetet küld):

```bash
docker compose up -d
docker compose cp .state.json timetable:/data/state.json
docker compose restart timetable
```

## Folyamatos futtatás (systemd)

```ini
# /etc/systemd/system/timetable-bot.service
[Unit]
Description=Órarend Discord bot
After=network-online.target

[Service]
WorkingDirectory=/opt/timetable-discord
ExecStart=/usr/local/bin/bun start
Restart=always
EnvironmentFile=/opt/timetable-discord/.env

[Install]
WantedBy=multi-user.target
```

## Ismert korlátok

- A Discord a kirajzolt üzenetet cache-eli; az „élő” azt jelenti, hogy a
  rögzített üzenet egy lekérdezési cikluson belül frissül, nem azonnali push.
- A `/timetable` parancs ideiglenes választ ad az aktuális hétről; a rögzített
  üzenet ettől függetlenül mindig a default hetet mutatja.
- Az értelmező napokat vár oszlopként, órákat soronként. A vízszintesen
  összevont cellákat nem bontja ki, és a cellán belüli sortörést az előző
  bejegyzés folytatásának veszi, kivéve ha `(TAG)`-gel kezdődik.
- Mivel nincs heti navigáció, a régebbi hetek csak a CLI-ből
  (`bun run preview --week prev`) nézhetők meg.
