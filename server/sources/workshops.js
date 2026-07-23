// Workshops source: Localist JSON API. Returns the next few upcoming events,
// normalized. Gracefully returns an empty list when nothing is scheduled (the
// UI folds the panel away in that case).

import { config } from '../config.js';

function normalize(ev) {
  const inst =
    (ev.event_instances && ev.event_instances[0] && ev.event_instances[0].event_instance) || {};
  return {
    id: ev.id,
    title: ev.title || 'Untitled workshop',
    start: inst.start || null,
    end: inst.end || null,
    allDay: !!inst.all_day,
    location: ev.location_name || ev.room_number || '',
    url: ev.localist_url || ev.url_path || '',
    image: ev.photo_url || '',
    description: (ev.description_text || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}

export async function fetchWorkshops() {
  const u = new URL(config.workshops.apiUrl);
  u.searchParams.set('days', String(config.workshops.daysAhead));
  u.searchParams.set('pp', String(Math.max(config.workshops.max * 4, 25)));
  if (config.workshops.groupId) u.searchParams.set('group_id', config.workshops.groupId);
  if (config.workshops.keyword) u.searchParams.set('keyword', config.workshops.keyword);

  const res = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Workshops HTTP ${res.status}`);
  const json = await res.json();

  const cutoff = Date.now() - 60 * 60 * 1000; // keep events that haven't fully ended in the last hour
  const list = (json.events || [])
    .map((w) => normalize(w.event || w))
    .filter((w) => w.start && new Date(w.start).getTime() > cutoff)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, config.workshops.max);

  return list;
}

// CLI: `npm run fetch:workshops`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('workshops.js')) {
  fetchWorkshops()
    .then((d) => {
      console.log(`Upcoming workshops: ${d.length}`);
      console.log(JSON.stringify(d, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
