// Express app: serves the static dashboard and exposes cached JSON for the three
// sources. All heavy lifting (fetching, parsing, timezone math) happens in the
// scheduler/sources; these routes just hand back the last-good cache.

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { ensureDataDir, get, loadFromDisk } from './cache.js';
import { startScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');

function serveCache(key, res, emptyShape) {
  const entry = get(key);
  if (!entry) {
    return res.json({ ok: false, stale: true, fetchedAt: null, data: emptyShape });
  }
  res.json({
    ok: entry.ok !== false,
    stale: !!entry.stale,
    fetchedAt: entry.fetchedAt || null,
    data: entry.data == null ? emptyShape : entry.data,
  });
}

app.get('/api/projects', (_req, res) =>
  serveCache('projects', res, { active: [], completed: [], counts: { active: 0, completed: 0 } })
);
app.get('/api/workshops', (_req, res) => serveCache('workshops', res, []));
app.get('/api/hours', (_req, res) => serveCache('hours', res, null));

app.get('/api/config', (_req, res) => {
  res.json({
    projectRotateSec: config.ui.projectRotateSec,
    pollMs: config.ui.pollMs,
    warnMinutes: config.hours.warnMinutes,
    locationName: config.hours.locationName,
    timezone: config.timezone,
  });
});

app.get('/api/health', (_req, res) => {
  const sources = {};
  for (const key of ['projects', 'workshops', 'hours']) {
    const e = get(key);
    sources[key] = e
      ? {
          fetchedAt: e.fetchedAt || null,
          stale: !!e.stale,
          ok: e.ok !== false,
          lastError: e.lastError || null,
        }
      : null;
  }
  res.json({ now: new Date().toISOString(), sources });
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

async function main() {
  await ensureDataDir();
  await Promise.all(['projects', 'workshops', 'hours'].map(loadFromDisk)); // warm from last run
  await startScheduler();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`DataLab dashboard running at http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
