// Shields Library hours source (LibCal / Springshare weekly grid).
// Computes the current open/closed state, when it closes today, and when it next
// opens — all in the library's timezone — so the front-end just renders.

import { DateTime } from 'luxon';
import { config } from '../config.js';

const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Parse "8pm" / "7:30am" / "12:00am" into a DateTime on the given day (midnight base).
function parseClock(str, dayStart) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(String(str).trim());
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') hour += 12;
  return dayStart.set({ hour, minute: Number(m[2] || 0), second: 0, millisecond: 0 });
}

// Flatten the LibCal grid into concrete, timezone-aware open intervals.
function buildIntervals(location, tz) {
  const intervals = []; // { from, to } DateTimes; to may be null for 24hours
  const weeks = location.weeks || [];
  for (const week of weeks) {
    for (const dayName of DAY_ORDER) {
      const day = week[dayName];
      if (!day || !day.date) continue;
      const dayStart = DateTime.fromISO(day.date, { zone: tz }).startOf('day');
      const times = day.times || {};
      if (times.status === '24hours') {
        intervals.push({ from: dayStart, to: dayStart.plus({ days: 1 }), all: true });
      } else if (Array.isArray(times.hours)) {
        for (const h of times.hours) {
          const from = parseClock(h.from, dayStart);
          let to = parseClock(h.to, dayStart);
          if (!from || !to) continue;
          if (to <= from) to = to.plus({ days: 1 }); // crosses midnight
          intervals.push({ from, to });
        }
      }
    }
  }
  intervals.sort((a, b) => a.from - b.from);
  // Merge contiguous/overlapping intervals (e.g. consecutive 24h days).
  const merged = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.from <= last.to.plus({ minutes: 1 })) {
      if (iv.to > last.to) last.to = iv.to;
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

export async function fetchHours() {
  const tz = config.timezone;
  const u = new URL(config.hours.gridUrl);
  u.searchParams.set('format', 'json');
  u.searchParams.set('lid', config.hours.lid);
  u.searchParams.set('weeks', '2');

  const res = await fetch(u);
  if (!res.ok) throw new Error(`Hours HTTP ${res.status}`);
  const json = await res.json();

  // LibCal grid returns an object keyed by `loc_<lid>`, each holding a `weeks` array.
  const loc =
    json[`loc_${config.hours.lid}`] ||
    Object.values(json).find((v) => v && Array.isArray(v.weeks)) ||
    {};

  const now = DateTime.now().setZone(tz);
  return computeHoursState(loc, now, tz);
}

// Pure state computation (exported for testing). Given a LibCal location object,
// the current time, and a timezone, returns the normalized dashboard payload.
export function computeHoursState(loc, now, tz) {
  const intervals = buildIntervals(loc, tz);

  let status = 'closed';
  let closesAt = null;
  let opensAt = null;
  let minutesToClose = null;
  let is24 = false;

  const current = intervals.find((iv) => now >= iv.from && now < iv.to);
  if (current) {
    status = 'open';
    is24 = !!current.all && current.to.diff(current.from, 'hours').hours >= 24;
    // If the open block effectively spans a full-day boundary of 24h coverage,
    // there's no meaningful "closes at" to warn about.
    if (!is24) {
      closesAt = current.to;
      minutesToClose = Math.round(current.to.diff(now, 'minutes').minutes);
    }
  } else {
    const next = intervals.find((iv) => iv.from > now);
    if (next) opensAt = next.from;
  }

  return {
    status, // "open" | "closed"
    is24,
    locationName: loc.name || config.hours.locationName,
    todayRendered: renderToday(loc, now, tz),
    closesAt: closesAt ? closesAt.toISO() : null,
    opensAt: opensAt ? opensAt.toISO() : null,
    minutesToClose,
    warnMinutes: config.hours.warnMinutes,
    now: now.toISO(),
  };
}

function renderToday(loc, now, tz) {
  for (const week of loc.weeks || []) {
    for (const dayName of DAY_ORDER) {
      const day = week[dayName];
      if (day && day.date === now.toFormat('yyyy-LL-dd')) return day.rendered || '';
    }
  }
  return '';
}

// CLI: `npm run fetch:hours`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('hours.js')) {
  fetchHours()
    .then((d) => console.log(JSON.stringify(d, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
