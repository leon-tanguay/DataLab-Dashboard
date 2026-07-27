// DataLab dashboard front-end controller.
// Tier 1: Active Projects board — ALL active projects, split into 2 pages sorted
//         by start date, paging (not scrolling) between them.
// Tier 2: Featured project — cycles through strong active projects, with description.
// Tier 3: compact rail — upcoming workshops, else scrolling past work.
// Resilient: never blanks on error — keeps last render, shows a "reconnecting" dot.

import { evaluate, primeAudio, testChime } from './alerts.js';

const $ = (s) => document.querySelector(s);

// Runtime overrides driven by the hidden test menu (and ?demo= on first load).
const override = {
  mode: new URLSearchParams(location.search).get('demo') || 'live', // live|open|closing|closed
  fakeWorkshops: false,
};
const futureISO = (days, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const FAKE_WORKSHOPS = [
  { title: 'Introduction to Python for Data Science', start: futureISO(6, 10), location: 'Shields 360' },
  { title: 'Reproducible Research with R & Quarto', start: futureISO(9, 13), location: 'Online' },
  { title: 'Geospatial Analysis Fundamentals', start: futureISO(13, 10), location: 'DataLab' },
  { title: 'Introduction to Machine Learning', start: futureISO(20, 14), location: 'Online' },
];

const state = {
  config: { projectRotateSec: 15, pollMs: 45000, warnMinutes: [15, 5], locationName: 'Shields Library' },
  active: [],
  completed: [],
  stats: null,
  workshops: [],
  hours: null,
  featIndex: 0,
  boardPage: 0,
  rowsPref: 0, // max active projects per page; 0 = as many as fit
  failures: 0,
  railMode: 'workshops',
};

let featTimer = null;
let railTimer = null;
let boardTimer = null;
let pastTimer = null;
let pastCloseTimer = null;
let cursorTimer = null;

/* ---------------- motion ---------------- */
// Crawl speeds in px/sec. Durations are always derived from measured width so
// the perceived speed never changes with the amount of content.
const SPEED = { reel: 85 };
// This is signage, not a personal browser: the crawls and rotations *are* how the
// board gets through its content, and the people reading it can't opt in. A
// display OS with "reduce animations" switched on would otherwise freeze it, so
// full motion is the default here. ?motion=reduce (or =auto to follow the OS)
// restores the calm version for anyone who wants it.
const motionParam = new URLSearchParams(location.search).get('motion');
const reduceMotion =
  motionParam === 'reduce' ||
  (motionParam === 'auto' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
document.documentElement.dataset.motion = reduceMotion ? 'reduce' : 'full';

// TVs commonly overscan — cropping a few percent of every edge — so the safe area
// has to be tunable on the machine rather than guessed here. ?inset=32 pads all
// four sides by 32px; the default suits a display showing the full frame.
const insetParam = Number(new URLSearchParams(location.search).get('inset'));
if (Number.isFinite(insetParam) && insetParam > 0) {
  document.documentElement.style.setProperty('--safe-inset', `${Math.min(120, insetParam)}px`);
}

// Ease a value toward a target at a rate independent of frame timing.
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// Count a number up to its new value — reads as a board ticking over, not a swap.
function countTo(el, to, ms = 900) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = String(to);
  if (reduceMotion || from === to) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3); // ease-out
    el.textContent = Math.round(from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Restart a one-shot CSS animation driven by a class.
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/* ---------------- utils ---------------- */
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const initials = (name) => {
  const p = (name || '').split(/\s+/).filter(Boolean);
  return p.length ? (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase() : '';
};
// Project keys come from the source sheet as slugs ("arise", "2026_salcedo_water").
// A donor board shouldn't show raw keys.
const prettyName = (s) =>
  String(s || '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// The partner field is free text in the source sheet and carries a fair amount of
// operational residue — email addresses, "internal", pipe-delimited unit paths.
// None of it belongs on a screen meant to impress visitors, and a raw address
// costs more credibility than any amount of polish elsewhere buys.
const PLACEHOLDER = /^(internal|n\/?a|tbd|none|unknown|-+)$/i;
function realName(v) {
  let s = String(v == null ? '' : v).trim();
  if (!s || PLACEHOLDER.test(s)) return '';
  if (s.includes('@')) return '';                       // "pguzmandelgado@ucdavis.edu"
  s = s.split('|').pop().trim();                        // "Library | DataLab" → "DataLab"
  // "internal, UCSB" → "UCSB"; drop placeholder fragments from comma lists.
  s = s.split(',').map((p) => p.trim()).filter((p) => p && !PLACEHOLDER.test(p)).join(', ');
  return PLACEHOLDER.test(s) ? '' : s;
}

// Research domain used to drive a seven-hue palette across every row. With no
// legend on screen it encoded nothing a passer-by could read, so it is plain text
// now; the only colour on the board is gold, and it means external funding.

/* ---------------- fetch ---------------- */
async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}
async function loadConfig() {
  try { state.config = { ...state.config, ...(await getJSON('/api/config')) }; } catch {}
}
async function poll() {
  try {
    const [p, w, h] = await Promise.all([
      getJSON('/api/projects'), getJSON('/api/workshops'), getJSON('/api/hours'),
    ]);
    const active = (p.data && p.data.active) || [];
    const activeChanged =
      active.length !== state.active.length || (active[0] && active[0].name) !== (state.active[0] && state.active[0].name);
    state.active = active;
    state.completed = (p.data && p.data.completed) || [];
    state.stats = (p.data && p.data.stats) || null;
    state._realWs = w.data || [];
    state.workshops = override.fakeWorkshops ? FAKE_WORKSHOPS : state._realWs;
    state.hours = h.data || null;
    state.failures = 0;

    renderStats();
    renderBoard();
    renderRail();
    if (activeChanged || !$('#featured').dataset.rendered) {
      state.featIndex = Math.min(state.featIndex, Math.max(0, featuredList().length - 1));
      renderFeatured(true);
      startFeatureRotation();
    }
    renderHours();
    setConn(true);
  } catch {
    state.failures += 1;
    setConn(false);
  }
}
function setConn(ok) { $('#conn').hidden = ok || state.failures < 2; }

/* ---------------- Header stat strip (slow scroll, ~2 at a time) ---------------- */
// Four figures, chosen for what a donor actually weighs: how much is running now,
// how much has landed, and how far across the university the lab reaches. Held to
// four so each can be large enough to read from across the room.
function statItems() {
  const s = state.stats;
  if (!s) return [];
  return [
    [s.active, 'Active Projects'],
    [s.delivered, 'Projects Delivered'],
    [s.partners, 'Faculty Partners'],
    [s.departments, 'Departments'],
  ].filter(([n]) => n != null && n !== 0);
}
let lastStatSig = '';
function renderStats() {
  const items = statItems();
  const el = $('#stats');
  if (!items.length) { el.innerHTML = ''; lastStatSig = ''; return; }
  const sig = items.map(([, l]) => l).join('|');
  if (sig !== lastStatSig) {
    lastStatSig = sig;
    el.innerHTML = items
      .map(([, l], i) => `<div class="stat" data-k="${i}"><span class="stat-num">0</span>` +
        `<span class="stat-label">${esc(l)}</span></div>`)
      .join('');
  }
  // Counts up on first paint and on any later change; holds still otherwise.
  items.forEach(([n], i) => {
    const num = el.querySelector(`.stat[data-k="${i}"] .stat-num`);
    if (num) countTo(num, Number(n));
  });
}

/* ---------------- Tier 1: Active Projects board (paged) ---------------- */
function sortedActive() {
  // Newest first by start year, then alphabetical.
  return [...state.active].sort(
    (a, b) => (b.startYear || 0) - (a.startYear || 0) || (a.name || '').localeCompare(b.name || '')
  );
}
// The board shows the whole portfolio at once by default — a donor walking past
// should see every active project without waiting for a page turn. Rows compress
// down to MIN_ROW_H to make that happen; past that it falls back to paging.
//
// Staff can override the cap from the test menu (fewer per page = larger type,
// paged), and the choice is remembered on the display across restarts.
const MIN_ROW_H = 26;
const ROWS_KEY = 'datalab.rowsPerPage';
const ROWS_MIN = 4;
const ROWS_MAX = 40;
function loadRowsPref() {
  try {
    const v = Number(localStorage.getItem(ROWS_KEY));
    return Number.isFinite(v) && v >= ROWS_MIN && v <= ROWS_MAX ? v : 0; // 0 = all that fit
  } catch { return 0; } // a locked-down kiosk profile can refuse storage
}
function saveRowsPref(v) {
  try { v ? localStorage.setItem(ROWS_KEY, String(v)) : localStorage.removeItem(ROWS_KEY); } catch {}
}
// How many rows the band can physically hold, before the staff cap is applied.
function boardCapacity() {
  const h = $('#board').clientHeight || 360;
  return Math.max(4, Math.floor(h / MIN_ROW_H));
}
function rowsPerPage() {
  const cap = boardCapacity();
  return state.rowsPref ? Math.min(cap, state.rowsPref) : cap;
}
// Scale the row type to whatever height each row actually got. Fewer rows per
// page therefore means bigger text, with no second setting to keep in sync.
function fitBoard(rowCount) {
  const board = $('#board');
  const h = board.clientHeight / Math.max(1, rowCount);
  board.style.setProperty('--row-font', `${Math.max(11, Math.min(34, h * 0.42)).toFixed(1)}px`);
}
const boardPageCount = () => boardLayout().pages;
const BOARD_PAGE_MS = 12000;
function boardRow(p, i) {
  // The department fallback needs the same cleanup as the partner field — it
  // carries unit paths like "CAES | Plant Sciences" straight from the sheet.
  const partner = realName(p.facultyPartner) || realName(p.department);
  // Themes (the research area) lead, approaches (the method) follow. Only about a
  // third of projects carry either, so fall back to the research domain — that
  // keeps the column meaningful instead of a colonnade of em-dashes.
  let tags = [...(p.themes || []), ...(p.approaches || [])].slice(0, 2);
  if (!tags.length && p.domain) tags = [titleCase(p.domain)];
  const recent = p.startYear && p.startYear >= new Date().getFullYear() - 1;
  return `<div class="board-row${p.funded ? ' funded' : ''}" style="--i:${i}">
    <div class="br-name"><span class="br-swatch"></span><span class="br-title">${esc(prettyName(p.name || p.title))}</span></div>
    <div class="br-lead">${p.lead ? esc(p.lead) : '<span class="br-none">—</span>'}</div>
    <div class="br-partner">${partner ? esc(partner) : '<span class="br-none">—</span>'}</div>
    <div class="br-focus">${tags.map((t) => `<span class="br-tag">${esc(t)}</span>`).join('')}${
      p.funded ? '<span class="br-tag fund">Funded</span>' : ''}</div>
    <div class="br-since${recent ? ' recent' : ''}">${p.startYear || '—'}</div>
  </div>`;
}
// Pages are balanced under the cap rather than filled to it: a cap of 16 against
// 17 projects gives 9 + 8, not 16 + 1. Both the board and the menu read this, so
// the number staff see is always the number actually on screen.
function boardLayout() {
  const total = state.active.length;
  const pages = Math.max(1, Math.ceil(total / rowsPerPage()));
  return { pages, per: Math.max(1, Math.ceil(total / pages)), total };
}
function renderBoardPage() {
  const list = sortedActive();
  const { pages, per } = boardLayout();
  state.boardPage = ((state.boardPage % pages) + pages) % pages;
  const rows = list.slice(state.boardPage * per, state.boardPage * per + per);
  $('#board').innerHTML = rows.map(boardRow).join('');
  fitBoard(rows.length);
  // Rebuilt each turn so the active pill's fill animation restarts in step with
  // the dwell timer — the countdown always matches the real time remaining.
  $('#board-pages').innerHTML =
    pages > 1 ? Array.from({ length: pages }, (_, i) => `<span class="pg ${i === state.boardPage ? 'on' : ''}"></span>`).join('') : '';
  $('#board-pages').style.setProperty('--page-dur', `${BOARD_PAGE_MS}ms`);
}
let lastBoardSig = '';
function renderBoard() {
  $('#board-count').textContent = state.active.length ? `${state.active.length} underway` : '';
  // Re-render only on real change; otherwise a poll would restart the page timer
  // and re-deal rows that are already on screen.
  const sig = sortedActive().map((p) => `${p.name}:${p.startYear}:${p.lead}`).join('|');
  if (sig === lastBoardSig) return;
  lastBoardSig = sig;
  clearInterval(boardTimer);
  if (!state.active.length) { $('#board').innerHTML = ''; $('#board-pages').innerHTML = ''; return; }
  renderBoardPage();
  if (boardPageCount() > 1) {
    boardTimer = setInterval(() => {
      const board = $('#board');
      const rows = board.children.length;
      board.classList.add('flip');
      // Wait out the staggered exit (last row leaves latest) before dealing the next page.
      setTimeout(() => {
        state.boardPage = (state.boardPage + 1) % boardPageCount();
        renderBoardPage();
        board.classList.remove('flip');
      }, reduceMotion ? 0 : 200 + rows * 22);
    }, BOARD_PAGE_MS);
  }
}

/* ---------------- Tier 2: Featured ---------------- */
// Only feature projects with a named lead + a description; fall back gracefully.
function featuredList() {
  const a = state.active;
  const strong = a.filter((p) => p.lead && p.blurb);
  if (strong.length) return strong;
  const led = a.filter((p) => p.lead);
  return led.length ? led : a;
}
function buildFeatured(p) {
  const headline = p.longTitle || p.blurb || p.name;
  const desc = p.blurb && p.blurb !== headline ? p.blurb : '';
  const faculty = realName(p.facultyPartner);
  const chips = [
    ...(p.themes || []).slice(0, 2).map((t) => `<span class="f-chip">${esc(t)}</span>`),
    ...(p.approaches || []).slice(0, 2).map((a) => `<span class="f-chip">${esc(a)}</span>`),
  ].join('');
  return `
    <div class="f-eyebrow">${esc(prettyName(p.name || 'DataLab'))}${p.domain ? `<span class="f-domain">${esc(p.domain)}</span>` : ''}${p.funded ? `<span class="f-fund">Externally Funded</span>` : ''}</div>
    <div class="f-title">${esc(headline)}</div>
    ${desc ? `<div class="f-desc">${esc(desc)}</div>` : ''}
    <div class="f-foot">
      ${p.lead ? `<div class="f-lead"><div class="f-avatar">${esc(initials(p.lead))}</div>
        <div class="f-lead-text"><small>Led by</small><b>${esc(p.lead)}</b></div></div>` : ''}
      ${faculty ? `<div class="f-partner">in partnership with <b>${esc(faculty)}</b></div>` : ''}
      ${chips ? `<div class="f-chips-inline">${chips}</div>` : ''}
    </div>`;
}
// Project blurbs vary wildly in length and nobody is watching the TV to catch a
// half-cut line. Give back lines until the card actually fits: two, then one,
// then drop the blurb and let the headline carry it.
function fitFeatured(el) {
  const desc = el.querySelector('.f-desc');
  if (!desc) return;
  for (const lines of ['2', '1']) {
    desc.style.webkitLineClamp = lines;
    if (el.scrollHeight <= el.clientHeight) return;
  }
  desc.hidden = true;
}
function renderFeatured(immediate) {
  const el = $('#featured');
  const list = featuredList();
  if (!list.length) {
    el.innerHTML = `<div class="f-main"><div class="f-title">Advancing data-driven discovery at UC&nbsp;Davis.</div></div>`;
    el.dataset.rendered = '1';
    return;
  }
  const p = list[state.featIndex % list.length];
  const swap = () => {
    // Dwell bar fills over the rotation minus the fade-out, so it completes at
    // the exact moment the card starts turning rather than after it.
    el.style.setProperty('--rotate-dur', `${rotateMs() - FEAT_FADE_MS}ms`);
    el.innerHTML = buildFeatured(p);
    el.dataset.rendered = '1';
    el.classList.remove('fading');
    fitFeatured(el);
    replay(el, 'enter'); // re-arm the accent wipe and the dwell bar
  };
  if (immediate || !el.dataset.rendered) swap();
  else { el.classList.add('fading'); setTimeout(swap, reduceMotion ? 0 : FEAT_FADE_MS); }
}
const FEAT_FADE_MS = 420; // matches the .featured exit transition in CSS
const rotateMs = () => Math.max(6, state.config.projectRotateSec) * 1000;
function startFeatureRotation() {
  clearInterval(featTimer);
  if (featuredList().length <= 1) return;
  featTimer = setInterval(() => {
    state.featIndex = (state.featIndex + 1) % featuredList().length;
    renderFeatured(false);
  }, rotateMs());
}

/* ---------------- Tier 3: rail (workshops / past work) ---------------- */
let lastWsSig = '';
function renderWorkshops(force) {
  const ws = (state.workshops || []).slice(0, 4);
  // Only rebuild on real change, so the stagger-in plays when the rail turns to
  // workshops rather than every time the poll lands.
  const sig = ws.map((w) => `${w.title}:${w.start}`).join('|');
  if (sig === lastWsSig && !force) return;
  lastWsSig = sig;
  $('#workshop-list').innerHTML = ws
    .map((w, i) => {
      const d = w.start ? new Date(w.start) : null;
      const mon = d ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
      const day = d ? d.getDate() : '';
      const time = d && !w.allDay ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'All day';
      const meta = [time, w.location].filter(Boolean).join(' · ');
      return `<li class="workshop" style="--i:${i}"><div class="ws-date"><span class="ws-mon">${esc(mon)}</span><span class="ws-day">${day}</span></div>
        <div class="ws-body"><b>${esc(w.title)}</b><small>${esc(meta)}</small></div></li>`;
    })
    .join('');
}
// Past projects, newest first, as a broadcast "lower-third": advance to a
// project, wipe it open to fill the band with rich info, hold ~5s, close, repeat.
function pastList() {
  return [...(state.completed || []).filter((c) => c.name)].sort(
    (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name)
  );
}
function pastCardHTML(p) {
  const partner = realName(p.facultyPartner);
  const meta = [p.lead && `Led by ${p.lead}`, partner && `with ${partner}`, p.domain]
    .filter(Boolean)
    .join(' · ');
  return `<span class="ppf-year">${p.year || ''}</span>
    <div class="ppf-body"><b class="ppf-name">${esc(p.name)}</b><span class="ppf-meta">${esc(meta)}</span></div>`;
}
const titleCase = (s) => (s || '').replace(/\b\w/g, (c) => c.toUpperCase());
function pastChipHTML(p, idx) {
  return `<span class="pp-chip" data-i="${idx}"><span class="pp-chip-sw"></span>` +
    `<span class="pp-chip-name">${esc(prettyName(p.name))}</span><span class="pp-chip-yr">${p.year || ''}</span></span>`;
}
function ppOpenHTML(p) {
  const partner = realName(p.facultyPartner);
  const credits = [];
  if (p.lead) credits.push(`<span class="ppf-seg"><i>Lead</i>${esc(p.lead)}</span>`);
  if (partner) credits.push(`<span class="ppf-seg"><i>Partner</i>${esc(partner)}</span>`);
  const chip = p.domain ? `<span class="ppf-chip">${esc(titleCase(p.domain))}</span>` : '';
  return `<span class="ppf-year">${p.year || ''}</span>` +
    `<div class="ppf-body"><b class="ppf-name">${esc(prettyName(p.name))}</b></div>` +
    `<div class="ppf-credits">${credits.join('')}${chip}</div>`;
}
// A continuously-scrolling list of every past project, driven from rAF rather
// than a CSS animation so it has a real velocity — and so it can aim.
//
// The reel picks its next project up front, marks it (the chip brightens, so the
// band telegraphs what's coming), then cruises until that mark is exactly one
// braking distance away and eases onto it. Because the brake begins at the point
// where cruise speed can bleed off naturally, velocity is continuous through the
// hand-off: no lurch into the stop, and the project always lands on its mark
// instead of wherever the clock happened to catch it.
const PAST_HOLD_MS = 5200;   // how long an opened story stays up
const PAST_CLOSE_MS = 340;
const FOCUS_OFFSET = 30;     // where along the band a project comes to rest
const CRUISE_RATE = 3.4;     // how sharply velocity settles back to cruise
const BRAKE_RATE = 3.0;      // how sharply the reel eases onto its mark
const MIN_TRAVEL = 60;       // never aim at a chip already under the focus point

const reel = { x: 0, vel: 0, half: 0, count: 0, raf: null, last: 0, el: null,
  mode: 'cruise', mark: 0, chip: null, still: 0 };

// Offset that puts `chip` at the focus point. offsetLeft is layout position, so
// it is unaffected by the transform we drive the reel with.
const markFor = (chip) => FOCUS_OFFSET - chip.offsetLeft;

// Aim at the nearest chip far enough ahead to be worth travelling to, and light
// it up. Only the first copy is considered — the second is the loop's duplicate,
// and its mark would sit beyond the wrap point.
function aimNext() {
  const chips = reel.el.querySelectorAll('.pp-chip');
  for (let i = 0; i < reel.count && i < chips.length; i++) {
    const mark = markFor(chips[i]);
    if (mark <= reel.x - MIN_TRAVEL) {
      reel.chip = chips[i];
      reel.mark = mark;
      chips[i].classList.add('next');
      return;
    }
  }
}
function reelFrame(t) {
  const dt = Math.min(0.05, (t - reel.last) / 1000) || 0;
  reel.last = t;
  if (reel.mode === 'cruise') {
    reel.vel = approach(reel.vel, SPEED.reel, CRUISE_RATE, dt);
    reel.x -= reel.vel * dt;
    if (reel.half && -reel.x >= reel.half) reel.x += reel.half; // seamless wrap
    if (!reel.chip) aimNext();
    // Brake once the mark is within the distance the current speed bleeds off in.
    else if (reel.x - reel.mark <= reel.vel / BRAKE_RATE) reel.mode = 'land';
  } else if (reel.mode === 'land') {
    reel.x = approach(reel.x, reel.mark, BRAKE_RATE, dt);
    reel.vel = 0;
    if (Math.abs(reel.x - reel.mark) < 0.4) {
      reel.x = reel.mark;
      reel.mode = 'hold';
      openStory();
    }
  }
  reel.el.style.transform = `translate3d(${reel.x.toFixed(2)}px,0,0)`;
  reel.raf = requestAnimationFrame(reelFrame);
}
let lastPastSig = '';
function startPastCycle() {
  const list = pastList();
  const host = $('#pp-feature');
  if (!list.length) { stopPastCycle(); host.innerHTML = ''; lastPastSig = ''; return; }
  // Rebuilding mid-scroll would snap the reel back to the start, so only rebuild
  // when the project list itself changed — not on every 45s poll.
  const sig = list.map((p) => `${p.name}:${p.year}`).join('|');
  if (sig === lastPastSig && reel.el && host.contains(reel.el)) {
    if (!reel.raf && !reduceMotion) { reel.last = performance.now(); reel.raf = requestAnimationFrame(reelFrame); }
    if (reduceMotion && !pastTimer) pastTimer = setInterval(stepStill, PAST_HOLD_MS + 1200);
    return;
  }
  stopPastCycle();
  lastPastSig = sig;

  const chips = list.map((p, i) => pastChipHTML(p, i)).join('');
  host.innerHTML = `<div class="pp-track"><div class="pp-reel" id="pp-reel">${chips}${chips}</div></div>` +
    `<div class="pp-open" id="pp-open" hidden></div>`;
  reel.el = $('#pp-reel');
  reel.x = 0; reel.vel = 0; reel.mode = 'cruise'; reel.chip = null;
  reel.count = list.length;
  requestAnimationFrame(() => {
    reel.half = reel.el.scrollWidth / 2;
    if (!reduceMotion) { reel.last = performance.now(); reel.raf = requestAnimationFrame(reelFrame); }
  });
  // With motion reduced the reel holds still, so step through the projects on a
  // timer instead — the content still cycles, it just doesn't travel.
  if (reduceMotion) { reel.still = 0; pastTimer = setInterval(stepStill, PAST_HOLD_MS + 1200); stepStill(); }
}
// Reduced-motion cycle: advance the marked project without moving the reel.
function stepStill() {
  const chips = reel.el && reel.el.querySelectorAll('.pp-chip');
  if (!chips || !chips.length) return;
  reel.chip = chips[reel.still++ % reel.count];
  openStory();
}
// The reel has come to rest on its marked project — wipe the story open over it.
function openStory() {
  const ov = $('#pp-open');
  const p = reel.chip && pastList()[Number(reel.chip.dataset.i)];
  if (!ov || !p) { resumeReel(); return; }
  ov.innerHTML = ppOpenHTML(p);
  ov.hidden = false;
  ov.classList.remove('closing');
  void ov.offsetWidth;
  ov.classList.add('opening');
  pastCloseTimer = setTimeout(closeStory, PAST_HOLD_MS);
}
function closeStory() {
  const ov = $('#pp-open');
  if (!ov) return;
  ov.classList.remove('opening');
  ov.classList.add('closing');
  setTimeout(() => {
    ov.hidden = true;
    ov.classList.remove('closing');
    resumeReel();
  }, PAST_CLOSE_MS);
}
// Drop the highlight and hand the reel back to cruise; it aims again next frame.
function resumeReel() {
  if (reel.chip) reel.chip.classList.remove('next');
  reel.chip = null;
  if (!reduceMotion) reel.mode = 'cruise';
}
function stopPastCycle() {
  clearInterval(pastTimer);
  clearTimeout(pastCloseTimer);
  pastTimer = null;
  cancelAnimationFrame(reel.raf);
  reel.raf = null;
}
function showRail(mode) {
  const changed = state.railMode !== mode;
  state.railMode = mode;
  const hasWs = (state.workshops || []).length > 0;
  const useWs = mode === 'workshops' && hasWs;
  $('#rail-label').textContent = useWs ? 'Upcoming Workshops' : 'Past Projects';
  $('#workshop-list').hidden = !useWs;
  $('#pastwork').hidden = useWs;
  // `changed` forces a rebuild so the cards animate in when the rail turns over.
  if (useWs) { stopPastCycle(); renderWorkshops(changed); }
  else startPastCycle();
}
function renderRail() {
  const hasWs = (state.workshops || []).length > 0;
  // Don't restart the swap timer on every poll — that would stall the rail's
  // rhythm and re-deal cards that are already on screen.
  if (hasWs && railTimer) { showRail(state.railMode); return; }
  clearInterval(railTimer);
  railTimer = null;
  if (hasWs) {
    showRail(state.railMode === 'past' ? 'past' : 'workshops');
    railTimer = setInterval(() => showRail(state.railMode === 'workshops' ? 'past' : 'workshops'), 18000);
  } else {
    showRail('past');
  }
}

/* ---------------- hours / alerts ---------------- */
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
function fmtDayTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const same = d.toDateString() === new Date().toDateString();
  return `${same ? 'today' : d.toLocaleDateString('en-US', { weekday: 'long' })} at ${fmtTime(iso)}`;
}
function demoHours() {
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  if (override.mode === 'open') return { status: 'open', is24: false, closesAt: iso(3 * 3600e3) };
  if (override.mode === 'closing') return { status: 'open', is24: false, closesAt: iso(8 * 60e3) };
  if (override.mode === 'closed') return { status: 'closed', opensAt: iso(9 * 3600e3) };
  return null;
}
function currentHours() {
  const h = demoHours() || state.hours;
  if (!h) return null;
  const c = { ...h };
  if (h.status === 'open' && !h.is24 && h.closesAt) c.minutesToClose = Math.round((new Date(h.closesAt) - Date.now()) / 60000);
  return c;
}
// Called every second from the clock tick, so status and copy are written only
// when they actually change — otherwise the ping animation on the status dot
// would restart 60 times a minute.
function setStatus(block, status) { if (block.dataset.status !== status) block.dataset.status = status; }
function setMarkup(el, html) { if (el.innerHTML !== html) el.innerHTML = html; }
function renderHours() {
  const h = currentHours();
  const block = $('#hours-block');
  const text = $('#hours-text');
  const loc = esc(state.config.locationName || 'Shields Library');
  if (!h) { setStatus(block, 'unknown'); setMarkup(text, loc); }
  else if (h.status === 'closed') {
    setStatus(block, 'closed');
    setMarkup(text, h.opensAt ? `${loc} opens <b>${esc(fmtDayTime(h.opensAt))}</b>` : `${loc} closed`);
  } else if (h.is24) {
    setStatus(block, 'open');
    setMarkup(text, `${loc} open <b>24 hours</b>`);
  } else {
    const soon = h.minutesToClose != null && h.minutesToClose <= (state.config.warnMinutes[0] || 15);
    setStatus(block, soon ? 'closing' : 'open');
    setMarkup(text, h.closesAt ? `${loc} open until <b>${esc(fmtTime(h.closesAt))}</b>` : `${loc} open`);
  }

  const overlay = $('#closed-overlay');
  const isClosed = h && h.status === 'closed';
  overlay.hidden = !isClosed;
  if (isClosed) {
    $('#closed-sub').textContent = h.opensAt
      ? `reopens ${fmtDayTime(h.opensAt)}`
      : `currently closed`;
  }

  const { banner } = evaluate(h, state.config.warnMinutes, new Date().toISOString().slice(0, 10));
  const bEl = $('#closing-banner');
  const showBanner = Boolean(banner) && !isClosed;
  if (showBanner) {
    $('#closing-banner-text').textContent = banner;
    bEl.hidden = false;
    requestAnimationFrame(() => bEl.classList.add('show'));
  } else if (bEl.classList.contains('show')) {
    bEl.classList.remove('show');
    setTimeout(() => { if (!bEl.classList.contains('show')) bEl.hidden = true; }, 500);
  }
}

/* ---------------- clock ---------------- */
function tick() {
  const now = new Date();
  $('#clock-time').textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  $('#clock-date').textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const cc = $('#closed-clock');
  if (cc) cc.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (state.hours) renderHours();
}

/* ---------------- test menu ---------------- */
function setActive(row, matchAttr, val) {
  [...row.children].forEach((b) => b.classList.toggle('on', b.dataset[matchAttr] === val));
}
// Apply a new per-page cap: persist it, rewind to the first page, and force a
// rebuild (the signature guard would otherwise treat the data as unchanged).
function applyRowsPref(v) {
  state.rowsPref = v;
  saveRowsPref(v);
  state.boardPage = 0;
  lastBoardSig = '';
  renderBoard();
  renderRowsMenu();
}
function renderRowsMenu() {
  const { pages, per, total } = boardLayout();
  $('#tm-rows-val').textContent = state.rowsPref ? String(state.rowsPref) : 'All';
  $('#tm-rows-note').textContent = total
    ? `${total} active · showing ${Math.min(per, total)} · ${pages} page${pages > 1 ? 's' : ''}`
    : 'no active projects';
}
function setupTestMenu() {
  const toggle = $('#test-toggle');
  const menu = $('#test-menu');
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    if (!menu.hidden) renderRowsMenu(); // reflect the live count when it opens
  });
  $('#tm-close').addEventListener('click', () => { menu.hidden = true; });

  $('#tm-rows').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rows === 'all') return applyRowsPref(0);
    // Stepping down from "All" starts at what is currently on screen, so the
    // first press actually changes something instead of counting down from capacity.
    const shown = Math.min(rowsPerPage(), state.active.length || rowsPerPage());
    const cur = state.rowsPref || shown;
    const next = Math.max(ROWS_MIN, Math.min(ROWS_MAX, cur + Number(b.dataset.rows)));
    // Past the point where everything fits, "capped" and "all" are the same thing.
    applyRowsPref(next >= boardCapacity() ? 0 : next);
  });

  $('#tm-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    override.mode = b.dataset.mode;
    setActive(e.currentTarget, 'mode', override.mode);
    renderHours();
  });
  $('#tm-ws').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    override.fakeWorkshops = b.dataset.ws === 'fake';
    setActive(e.currentTarget, 'ws', b.dataset.ws);
    state.workshops = override.fakeWorkshops ? FAKE_WORKSHOPS : (state._realWs || []);
    state.railMode = override.fakeWorkshops ? 'workshops' : 'past'; // show the change immediately
    renderRail();
  });
  $('#tm-chime').addEventListener('click', testChime);

  // Reflect any ?demo= mode already in effect.
  setActive($('#tm-mode'), 'mode', override.mode);
}

// Show the cursor while the mouse is moving; hide it again after a short idle,
// so the hidden hotspot is easy to find without leaving a pointer on the TV.
function setupCursor() {
  const show = () => {
    document.body.classList.add('show-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.remove('show-cursor'), 2500);
  };
  window.addEventListener('mousemove', show, { passive: true });
}

/* ---------------- boot ---------------- */
// A resolution change (or a projector swap) invalidates every measured width and
// the rows-per-page maths, so re-measure from scratch rather than letting the
// marquees run at the wrong speed.
function setupResize() {
  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      lastStatSig = ''; lastBoardSig = ''; lastPastSig = ''; lastWsSig = '';
      renderStats(); renderBoard(); renderRail();
    }, 250);
  });
}

async function boot() {
  primeAudio();
  state.rowsPref = loadRowsPref(); // before the first board render
  setupCursor();
  setupTestMenu();
  setupResize();
  await loadConfig();
  tick();
  setInterval(tick, 1000);
  // Measure marquees against the real webfonts — measuring against the fallback
  // and then reflowing leaves the crawl running at the wrong speed.
  await document.fonts.ready.catch(() => {});
  await poll();
  setInterval(poll, Math.max(10000, state.config.pollMs));
}
boot();
