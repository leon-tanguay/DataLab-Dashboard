# DataLab Dashboard

An always-on, full-screen TV dashboard for the UC Davis DataLab office, styled
like a busy "trading floor" board so visitors and donors immediately see how much
is going on. Three stacked tiers plus a top ticker bar:

- **Top bar** — DataLab logo, a live "market" ticker (active-project counts by
  domain + totals delivered), the **UC Davis Library logo** with Shields open/closed
  status, and a clock.
- **Tier 1 — Featured project** — a large, auto-cycling highlight of a strong active
  project *with its description*, primary **lead**, faculty partner, and theme tags.
- **Tier 2 — Active Portfolio** — a dense, auto-scrolling board of **every** active
  project: Project · Lead · Partner · Focus · Since.
- **Tier 3 — Workshops / Past work** — shows upcoming DataLab workshops when
  scheduled; otherwise scrolls a marquee of completed projects. When both are
  available it alternates between them.

It also **warns before Shields Library closes** — a banner + chime at 15 and 5
minutes before close, and a full-screen **CLOSED** takeover while the library is
closed.

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

## Quick start (development)

```bash
npm install
npm start           # serves http://localhost:3000
```

Optionally copy `.env.example` to `.env` and tweak values — everything has working
defaults, so it runs with no `.env` at all.

Test the data adapters individually:

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
  index.html        3-tier layout (featured / board / rail)
  css/style.css     DataLab-branded theme + bundled fonts
  js/app.js         fetch loop, featured cycle, board, rail, hours
  js/alerts.js      Web Audio chimes + banner logic
  assets/           datalab-logo.png, ucd-library-logo.png, aggie-logo-white.svg
    fonts/          Montserrat woff2 (400–800)
deploy/
  dashboard.service, kiosk.service, kiosk.sh
```

## Branding & fonts

- **Logos**: `assets/datalab-logo.png` (top-left) and `assets/ucd-library-logo.png`
  (the white UC Davis Library signature, used top-right and on the CLOSED screen).
  `assets/aggie-logo-white.svg` (the campus Aggie mark) is included as an option.
- **Fonts**: UC Davis's official brand typeface is **Proxima Nova** (licensed). The
  CSS prefers it, so if you install Proxima Nova on the display machine (UC Davis
  staff can get it from the campus software site) it is used automatically. As an
  offline, license-safe fallback the repo bundles **Montserrat** (a close geometric
  match) in `assets/fonts/`. To swap in a different font, edit the `@font-face`
  rules and the `--font` variable at the top of `public/css/style.css`.
- **Colors**: UC Davis Aggie navy + gold with a teal accent (CSS variables in
  `:root`).

## Troubleshooting

- **Spotlight empty / "Advancing data-driven discovery…"** — the sheet isn't
  public or has no `active` rows. Check `curl localhost:3000/api/projects` and the
  sheet's sharing settings.
- **Hours pill says "unknown"** — LibCal unreachable; `curl localhost:3000/api/health`
  shows the last error. The display keeps last-good data meanwhile.
- **No chime** — the kiosk must run Chromium with `--autoplay-policy=no-user-gesture-required`
  (already in `kiosk.sh`); in a normal browser, click once to unlock audio.
