// Central configuration. Reads from environment (optionally a .env file loaded
// via `node --env-file-if-exists=.env`) and falls back to working defaults so
// the dashboard runs with zero setup.

const num = (v, d) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
const list = (v, d) =>
  (v != null && v !== '' ? String(v) : d)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  port: num(process.env.PORT, 3000),
  timezone: process.env.TZ_NAME || 'America/Los_Angeles',

  projects: {
    csvUrl:
      process.env.PROJECTS_CSV_URL ||
      'https://docs.google.com/spreadsheets/d/1XdF1epRZ9bVu8WYqGl3qZxPNS8Hnl1bk-RCAVCKYmFE/gviz/tq?tqx=out:csv&gid=0',
    activeStatuses: list(process.env.PROJECTS_ACTIVE_STATUSES, 'active').map((s) => s.toLowerCase()),
    completedStatuses: list(process.env.PROJECTS_COMPLETED_STATUSES, 'completed').map((s) =>
      s.toLowerCase()
    ),
    refreshMs: num(process.env.PROJECTS_REFRESH_MS, 12 * 60 * 60 * 1000),
  },

  workshops: {
    apiUrl: process.env.WORKSHOPS_API_URL || 'https://events.library.ucdavis.edu/api/2/events',
    groupId: process.env.WORKSHOPS_GROUP_ID || '',
    keyword: process.env.WORKSHOPS_KEYWORD || '',
    daysAhead: num(process.env.WORKSHOPS_DAYS_AHEAD, 120),
    max: num(process.env.WORKSHOPS_MAX, 5),
    refreshMs: num(process.env.WORKSHOPS_REFRESH_MS, 12 * 60 * 60 * 1000),
  },

  hours: {
    gridUrl:
      process.env.HOURS_GRID_URL || 'https://reservations.library.ucdavis.edu/api_hours_grid.php',
    lid: process.env.HOURS_LID || '18170', // Shields Library
    locationName: process.env.HOURS_LOCATION_NAME || 'Shields Library',
    warnMinutes: list(process.env.HOURS_WARN_MINUTES, '15,5')
      .map(Number)
      .filter((n) => n > 0)
      .sort((a, b) => b - a),
    refreshMs: num(process.env.HOURS_REFRESH_MS, 15 * 60 * 1000),
    refreshMsNearClose: num(process.env.HOURS_REFRESH_MS_NEAR_CLOSE, 30 * 1000),
    nearCloseWindowMin: num(process.env.HOURS_NEAR_CLOSE_WINDOW_MIN, 30),
  },

  ui: {
    projectRotateSec: num(process.env.UI_PROJECT_ROTATE_SEC, 12),
    pollMs: num(process.env.UI_POLL_MS, 45 * 1000),
  },
};
