# DataLab Dashboard

An always-on, full-screen TV dashboard for the UC Davis DataLab office, built to
be read from across a room by visitors and donors walking past. A top bar plus
three stacked bands:

- **Top bar** — DataLab mark, four static headline figures (active projects,
  projects delivered, faculty partners, departments), Shields Library open/closed
  status, and a clock. The figures count up when the data changes but never
  scroll: a moving ticker only ever gives a passer-by half a number.
- **Featured project** — an auto-cycling highlight (every 12s) with headline,
  blurb, and a credits column for lead, faculty partner and focus. The headline
  is sized to fill the band, so short and long titles both land well.
- **Active Projects** — every active project on screen at once, grouped by focus
  and alphabetical within it: Project · Lead · Partner · Focus · Since. Row type
  scales to fit whatever the count is; staff can cap rows per page from the test
  menu, and a shorter page spends the extra height on wrapped text rather than
  bigger type.
- **Past Projects** — a crawl of completed work that aims: it marks its next
  project (that entry brightens), eases onto it, and opens it as a lower-third
  with year, title and credits.

It also **warns before Shields Library closes** — a banner + chime at 15 and 5
minutes before close, and a full-screen **CLOSED** takeover while the library is
closed.

**Colour means one thing each.** Gold is external funding, and nothing else — a
funded project has a gold spine and a gold pill, so the funded work can be picked
out of the board at a glance. Bright = recent or primary, green = library open,
red = alert. Everything else is a neutral ramp. Five themes are switchable from
the test menu.

## How it works

A small **Node.js/Express** backend fetches and caches the three data sources, and
serves a lightweight **vanilla-JS** front-end. The browser only ever talks to the
local server, so there are no CORS issues, no API keys in the page, and the display
keeps showing the last-good data if a source is briefly unreachable.

| Source | Where from | Refresh |
| --- | --- | --- |
| Projects | Google Sheet published as CSV (no credentials needed) | every 12h |
| Workshops | Localist API (`events.library.ucdavis.edu`) | every 12h |
| Hours | LibCal/Springshare (`reservations.library.ucdavis.edu`, Shields `lid=18170`) | every 15m, and every 30s in the last 30m before close |

```
Chromium (kiosk) ── http://localhost:3000 ──> Express ── caches ──> server/data/*.json
                                                 ├─ Google Sheet CSV
                                                 ├─ Localist events
                                                 └─ LibCal hours
```

## Running it

Requires **Node.js ≥ 20** (`node --version` to check). Two pieces: a server you
start once, and a browser you point at it.

### 1. Start the server

Open a terminal (PowerShell, cmd, Terminal — any) in the project folder:

```bash
npm install     # first time only
npm start
```

You should see `DataLab dashboard running at http://localhost:3000`.

**Leave that window open** — closing it stops the dashboard. Nothing else needs
to happen in this window; the browser is separate.

No `.env` is required. Everything has working defaults, and the server prints
`.env not found. Continuing without it.` which is expected.

### 2. Put it on screen

The quickest way, any OS: open a browser to **`http://localhost:3000`** and press
**F11** for full screen (F11 again to exit).

For true kiosk mode — no tabs, no address bar, nothing to click out of — launch
the browser directly at the URL. `Alt+F4` (or `Cmd+Q`) closes it.

**Windows** — press `Win + R`, paste, Enter:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app="http://localhost:3000/"
```

The Run dialog handles the quoted path, so no terminal is needed. From PowerShell
the same line needs a leading `& ` (the call operator); from cmd it works as-is.

**macOS:**

```bash
open -na "Google Chrome" --args --kiosk --app="http://localhost:3000/"
```

**Linux:** see the systemd kiosk setup further down — that is the real deployment
path for the display machine.

### 3. Stopping it

`Ctrl+C` in the terminal running `npm start`. If that window is gone:

```bash
npx kill-port 3000
```

### Testing outside opening hours

Shields Library is genuinely closed at night, so the plain URL will correctly show
the full-screen **CLOSED** takeover rather than the board. To demo anyway, add
`?demo=open`:

```
http://localhost:3000/?demo=open
```

That is the single most useful thing to know when the board "won't come up".

### URL parameters

All optional, and they combine with `&`:

| Parameter | Does |
| --- | --- |
| `?demo=open` | forces the board on regardless of real hours |
| `?demo=closing` | previews the red closing banner |
| `?demo=closed` | previews the CLOSED takeover |
| `?theme=aggie` | `midnight` · `aggie` · `graphite` · `arboretum` · `daylight` |
| `?inset=32` | pads all four edges, for TVs that overscan (max 120) |
| `?motion=reduce` | the calm version — content still cycles, it just cuts |
| `?motion=auto` | follow the display's own reduce-motion setting |

Example: `http://localhost:3000/?demo=open&theme=aggie&inset=32`

### The test menu (on-screen settings)

There is an **invisible 70×70px hotspot in the very bottom-right corner** of the
screen. Move the mouse there and the cursor becomes a gold reticle with a corner
bracket — click to open Test Mode. It works even over the CLOSED takeover.

It holds: library status (Live / Open / Closing soon / Closed), theme, active
projects per page, real vs. sample workshops, and a chime test. **Theme and
per-page are remembered on that display** across restarts; the others reset.

Note that **Live** means "show reality" — if the library is actually closed, the
takeover stays up. Use **Open** to force the board on.

### Testing the data adapters individually

```bash
npm run fetch:projects
npm run fetch:workshops
npm run fetch:hours
```

## Configuration

All settings are environment variables (see `.env.example`). The most relevant:

- `PROJECTS_CSV_URL` — the published Google Sheet CSV URL. The sheet must be
  shared **Anyone with the link → Viewer** (or File → Share → Publish to web).
- `PROJECTS_ACTIVE_STATUSES` / `PROJECTS_COMPLETED_STATUSES` — which `Status`
  values map to the spotlight vs. the bottom marquee (default `active` / `completed`).
- `WORKSHOPS_GROUP_ID` / `WORKSHOPS_KEYWORD` — optional Localist filters to narrow
  events to DataLab. Leave blank to pull the whole library calendar. **Note:** at
  the time of setup no upcoming workshops were posted (summer); fill the group id
  once fall workshops appear if you want to filter. See "Narrowing workshops" below.
- `HOURS_LID` — LibCal location id for closing alerts (default `18170` = Shields).
- `HOURS_WARN_MINUTES` — minutes-before-close to chime (default `15,5`).

### Narrowing workshops to DataLab only

The whole-library Localist feed may include non-DataLab events. To filter:

1. Open `https://events.library.ucdavis.edu/datalab` in a browser.
2. In DevTools → Network, find the `api/2/events` request and read its query
   params (a numeric `group_id`, or a `keyword`).
3. Put that value in `WORKSHOPS_GROUP_ID` (or `WORKSHOPS_KEYWORD`) in `.env`.

If a `WORKSHOPS_KEYWORD` is simplest, try `WORKSHOPS_KEYWORD=DataLab`.

## Deploying on the display machine (Linux + Chromium kiosk)

Requires **Node.js ≥ 20** and Chromium. Assumes install at `/opt/datalab-dashboard`
running as a user named `datalab` — adjust the unit files if different.

```bash
sudo mkdir -p /opt/datalab-dashboard
sudo chown datalab:datalab /opt/datalab-dashboard
# copy this repo there, then:
cd /opt/datalab-dashboard
npm ci --omit=dev
cp .env.example .env          # edit as needed

# 1) Backend service
sudo cp deploy/dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dashboard
curl -s localhost:3000/api/health   # sanity check

# 2) Kiosk service (needs a logged-in X session on :0)
chmod +x deploy/kiosk.sh
sudo cp deploy/kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiosk
```

Notes for the kiosk:
- The machine needs to auto-login to an X session (e.g. a minimal desktop or
  `startx`). `kiosk.sh` disables screen blanking and hides the cursor (install
  `unclutter` for the latter).
- `--autoplay-policy=no-user-gesture-required` lets the closing chime play without
  anyone touching the machine.
- Install `curl` (used by `kiosk.sh` to wait for the backend) if missing.
- **If the top or edges look cut off**, the TV is overscanning. Add `?inset=32`
  (any px value up to 120) to pad all four sides inside the visible frame.
- **Motion is on by default**, deliberately: the stat crawl, the past-project reel
  and the featured rotation are how the board cycles through its content, and a
  display with the OS "reduce animations" setting switched on would otherwise
  show a frozen board to people who can't opt in. `?motion=reduce` forces the
  calm version (content still cycles, it just cuts instead of travelling);
  `?motion=auto` follows the display's own setting.
- Parameters combine: `?inset=32&motion=auto`.

### Older Node.js

`npm start` and the service use `--env-file-if-exists=.env` (Node ≥ 20.6). On an
older Node, either upgrade, or drop that flag from `package.json`/`dashboard.service`
and uncomment the `EnvironmentFile=` line in `dashboard.service`.

## Endpoints

- `GET /` — the dashboard UI
- `GET /api/projects` — `{ active[], completed[] }`
- `GET /api/workshops` — upcoming events
- `GET /api/hours` — Shields open/closed status, close/reopen times
- `GET /api/config` — UI settings (rotation, poll interval, warn minutes)
- `GET /api/health` — per-source freshness/last-error (handy for debugging)

## Layout / files

```
server/
  index.js          Express app + /api routes
  config.js         env-driven configuration
  cache.js          last-good in-memory + disk cache
  scheduler.js      periodic refresh (adaptive hours polling)
  sources/
    projects.js     Google Sheet CSV -> active + completed
    workshops.js    Localist API -> upcoming events
    hours.js        LibCal grid -> open/closed state (timezone-aware)
public/
  index.html        top bar + 3 bands (featured / board / rail) + test menu
  css/style.css     theme tokens (5 palettes), layout, motion
  js/app.js         fetch loop, featured cycle, board fitting, reel, hours
  js/alerts.js      Web Audio chimes + banner logic
  assets/           datalab-logo.png, ucd-library-logo.png, aggie-logo-white.svg
    fonts/          Montserrat woff2 (400–800)
deploy/
  dashboard.service, kiosk.service, kiosk.sh
```

## Branding & fonts

- **Logos**: `assets/datalab-logo.png` is the only one currently on screen
  (top-left). `assets/ucd-library-logo.png` and `assets/aggie-logo-white.svg` are
  kept in the repo as options but are not referenced by the page — the top-right
  is given to the headline figures and the clock instead.
- **Fonts**: UC Davis's official brand typeface is **Proxima Nova** (licensed). The
  CSS prefers it, so if you install Proxima Nova on the display machine (UC Davis
  staff can get it from the campus software site) it is used automatically. As an
  offline, license-safe fallback the repo bundles **Montserrat** (a close geometric
  match) in `assets/fonts/`. To swap in a different font, edit the `@font-face`
  rules and the `--font` variable at the top of `public/css/style.css`.
- **Themes**: five palettes, switchable from the test menu and remembered per
  display — **Midnight** (default navy), **Aggie** (UC Davis official `#022851` /
  `#FFBF00`), **Graphite** (space grey), **Arboretum** (olive and oak),
  **Daylight** (off-white). Pin one on a kiosk with `?theme=`.
- **Adding a theme**: copy a `:root[data-theme="…"]` block at the top of
  `public/css/style.css`, restate the tokens, and add the name to `THEMES` in
  `public/js/app.js` plus a button in the test menu in `index.html`. Every rule
  downstream reads those tokens, so no component needs touching.

## Troubleshooting

- **Spotlight empty / "Advancing data-driven discovery…"** — the sheet isn't
  public or has no `active` rows. Check `curl localhost:3000/api/projects` and the
  sheet's sharing settings.
- **Hours pill says "unknown"** — LibCal unreachable; `curl localhost:3000/api/health`
  shows the last error. The display keeps last-good data meanwhile.
- **No chime** — the kiosk must run Chromium with `--autoplay-policy=no-user-gesture-required`
  (already in `kiosk.sh`); in a normal browser, click once to unlock audio.
- **Screen shows CLOSED instead of the board** — usually correct: Shields is shut.
  Add `?demo=open`, or pick **Open** in the test menu. It clears itself when the
  library reopens.
- **Board looks frozen — nothing crawls or rotates** — the display has "reduce
  animations" switched on at the OS level. Motion is forced on by default now, so
  this should not happen; if it does, check the URL does not carry `?motion=reduce`
  or `?motion=auto`.
- **Top or edges cut off** — the TV is overscanning. Add `?inset=32` and adjust
  until nothing is clipped.
- **Text truncating with `…` on a short page** — expected only when a single
  value is genuinely wider than its column. A capped page gives rows two or three
  lines to wrap into first; if everything is truncating, the page cap is probably
  set so low the type hit its 24px ceiling.
- **Nothing on port 3000 / "site can't be reached"** — the `npm start` window was
  closed. Restart it; the browser can stay open and will reconnect on its own
  (a "reconnecting" dot appears bottom-left while the server is away).
