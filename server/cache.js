// Last-good cache: keeps each source's most recent successful result in memory
// and mirrored to disk, so the display keeps working when a source is briefly
// unreachable. `refresh` runs a fetcher and falls back to the cached value on error.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

const memory = Object.create(null); // key -> entry

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function get(key) {
  return memory[key] || null;
}

async function persist(key, entry) {
  try {
    await fs.writeFile(path.join(DATA_DIR, `${key}.json`), JSON.stringify(entry, null, 2));
  } catch {
    /* disk errors are non-fatal; memory cache still serves */
  }
}

export async function loadFromDisk(key) {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, `${key}.json`), 'utf8');
    memory[key] = JSON.parse(raw);
    return memory[key];
  } catch {
    return null;
  }
}

// Run `fetchFn`; on success store fresh data, on failure keep last-good (flagged stale).
export async function refresh(key, fetchFn) {
  try {
    const data = await fetchFn();
    const entry = { data, fetchedAt: new Date().toISOString(), ok: true, stale: false };
    memory[key] = entry;
    await persist(key, entry);
    return entry;
  } catch (err) {
    const existing = memory[key] || (await loadFromDisk(key));
    const message = String((err && err.message) || err);
    if (existing) {
      existing.stale = true;
      existing.lastError = message;
      existing.lastErrorAt = new Date().toISOString();
      return existing;
    }
    const entry = { data: null, fetchedAt: null, ok: false, stale: true, lastError: message };
    memory[key] = entry;
    return entry;
  }
}
