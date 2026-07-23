// Periodic refresh of all three sources. Projects and workshops run on a slow
// interval; hours use an adaptive self-scheduling loop that polls much more
// often as closing time approaches (so the warning fires promptly).

import { refresh } from './cache.js';
import { config } from './config.js';
import { fetchProjects } from './sources/projects.js';
import { fetchWorkshops } from './sources/workshops.js';
import { fetchHours } from './sources/hours.js';

async function refreshHoursLoop() {
  const entry = await refresh('hours', fetchHours);
  const data = entry && entry.data;
  let delay = config.hours.refreshMs;
  if (
    data &&
    data.status === 'open' &&
    !data.is24 &&
    data.minutesToClose != null &&
    data.minutesToClose <= config.hours.nearCloseWindowMin
  ) {
    delay = config.hours.refreshMsNearClose;
  }
  setTimeout(refreshHoursLoop, delay).unref?.();
}

export async function startScheduler() {
  await Promise.allSettled([
    refresh('projects', fetchProjects),
    refresh('workshops', fetchWorkshops),
  ]);

  setInterval(() => refresh('projects', fetchProjects), config.projects.refreshMs).unref?.();
  setInterval(() => refresh('workshops', fetchWorkshops), config.workshops.refreshMs).unref?.();
  refreshHoursLoop();
}
