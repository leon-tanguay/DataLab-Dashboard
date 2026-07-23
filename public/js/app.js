// DataLab dashboard front-end controller.
// Tier 1: Active Projects board — ALL active projects, split into 2 pages sorted
//         by start date, paging (not scrolling) between them.
// Tier 2: Featured project — cycles through strong active projects, with description.
// Tier 3: compact rail — upcoming workshops, else scrolling past work.
// Resilient: never blanks on error — keeps last render, shows a "reconnecting" dot.

import { evaluate, primeAudio } from './alerts.js';

const $ = (s) => document.querySelector(s);

const state = {
  config: { projectRotateSec: 15, pollMs: 45000, warnMinutes: [15, 5], locationName: 'Shields Library' },
  active: [],
  completed: [],
  workshops: [],
  hours: null,
  featIndex: 0,
  boardPage: 0,
  failures: 0,
  railMode: 'workshops',
};

let featTimer = null;
let railTimer = null;
let boardTimer = null;

/* ---------------- utils ---------------- */
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const initials = (name) => {
  const p = (name || '').split(/\s+/).filter(Boolean);
  return p.length ? (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase() : '★';
};
const realName = (v) => {
  const s = (v || '').trim();
  return !s || /^(internal|n\/?a|tbd|none)$/i.test(s) ? '' : s;
};

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
    state.workshops = w.data || [];
    state.hours = h.data || null;
    state.failures = 0;

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

/* ---------------- Tier 1: Active Projects board (paged) ---------------- */
function sortedActive() {
  // Newest first by start year, then alphabetical.
  return [...state.active].sort(
    (a, b) => (b.startYear || 0) - (a.startYear || 0) || (a.name || '').localeCompare(b.name || '')
  );
}
function boardPageCount() {
  return state.active.length > 9 ? 2 : 1;
}
function boardRow(p) {
  const partner = realName(p.facultyPartner) || p.department || '';
  const tags = [...(p.themes || []), ...(p.approaches || [])].slice(0, 2);
  return `<div class="board-row">
    <div class="br-name"><span class="br-title">${esc(p.name || p.title)}</span></div>
    <div class="br-lead">${esc(p.lead || '—')}</div>
    <div class="br-partner">${esc(partner || '—')}</div>
    <div class="br-focus">${tags.map((t) => `<span class="br-tag">${esc(t)}</span>`).join('') || '<span class="br-partner">—</span>'}</div>
    <div class="br-since">${p.startYear || '—'}</div>
  </div>`;
}
function renderBoardPage() {
  const list = sortedActive();
  const pages = boardPageCount();
  const size = Math.ceil(list.length / pages);
  state.boardPage = ((state.boardPage % pages) + pages) % pages;
  const rows = list.slice(state.boardPage * size, (state.boardPage + 1) * size);
  $('#board').innerHTML = rows.map(boardRow).join('');
  $('#board-pages').innerHTML =
    pages > 1 ? Array.from({ length: pages }, (_, i) => `<span class="pg ${i === state.boardPage ? 'on' : ''}"></span>`).join('') : '';
}
function renderBoard() {
  $('#board-count').textContent = state.active.length ? `${state.active.length} underway` : '';
  clearInterval(boardTimer);
  if (!state.active.length) { $('#board').innerHTML = ''; $('#board-pages').innerHTML = ''; return; }
  renderBoardPage();
  if (boardPageCount() > 1) {
    boardTimer = setInterval(() => {
      const board = $('#board');
      board.classList.add('flip');
      setTimeout(() => {
        state.boardPage = (state.boardPage + 1) % boardPageCount();
        renderBoardPage();
        board.classList.remove('flip');
      }, 400);
    }, 12000);
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
    ...(p.themes || []).slice(0, 2).map((t) => `<span class="f-chip theme">${esc(t)}</span>`),
    ...(p.approaches || []).slice(0, 2).map((a) => `<span class="f-chip">${esc(a)}</span>`),
  ].join('');
  return `
    <div class="f-eyebrow">${esc(p.name || 'DataLab')}${p.domain ? `<span class="f-domain">${esc(p.domain)}</span>` : ''}</div>
    <div class="f-title">${esc(headline)}</div>
    ${desc ? `<div class="f-desc">${esc(desc)}</div>` : ''}
    <div class="f-foot">
      ${p.lead ? `<div class="f-lead"><div class="f-avatar">${esc(initials(p.lead))}</div>
        <div class="f-lead-text"><small>Led by</small><b>${esc(p.lead)}</b></div></div>` : ''}
      ${faculty ? `<div class="f-partner">in partnership with <b>${esc(faculty)}</b></div>` : ''}
      ${chips ? `<div class="f-chips-inline">${chips}</div>` : ''}
    </div>`;
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
  const swap = () => { el.innerHTML = buildFeatured(p); el.dataset.rendered = '1'; el.classList.remove('fading'); };
  if (immediate || !el.dataset.rendered) swap();
  else { el.classList.add('fading'); setTimeout(swap, 550); }
}
function startFeatureRotation() {
  clearInterval(featTimer);
  if (featuredList().length <= 1) return;
  featTimer = setInterval(() => {
    state.featIndex = (state.featIndex + 1) % featuredList().length;
    renderFeatured(false);
  }, Math.max(6, state.config.projectRotateSec) * 1000);
}

/* ---------------- Tier 3: rail (workshops / past work) ---------------- */
function renderWorkshops() {
  $('#workshop-list').innerHTML = (state.workshops || [])
    .slice(0, 4)
    .map((w) => {
      const d = w.start ? new Date(w.start) : null;
      const mon = d ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
      const day = d ? d.getDate() : '';
      const time = d && !w.allDay ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'All day';
      const meta = [time, w.location].filter(Boolean).join(' · ');
      return `<li class="workshop"><div class="ws-date"><span class="ws-mon">${esc(mon)}</span><span class="ws-day">${day}</span></div>
        <div class="ws-body"><b>${esc(w.title)}</b><small>${esc(meta)}</small></div></li>`;
    })
    .join('');
}
function renderPastwork() {
  const track = $('#ticker-track');
  const items = (state.completed || []).filter((c) => c.name);
  if (!items.length) { track.innerHTML = ''; return; }
  const one = items
    .map(
      (c) =>
        `<span class="ticker-item"><b>${esc(c.name)}</b>${c.startYear ? `<span class="ty">${c.startYear}</span>` : ''}<span class="ti-sep">✦</span></span>`
    )
    .join('');
  track.innerHTML = one + one;
  requestAnimationFrame(() => {
    const half = track.scrollWidth / 2;
    track.style.setProperty('--ticker-duration', `${Math.max(40, Math.round(half / 80))}s`);
  });
}
function showRail(mode) {
  state.railMode = mode;
  const hasWs = (state.workshops || []).length > 0;
  const useWs = mode === 'workshops' && hasWs;
  $('#rail-label').textContent = useWs ? 'Upcoming Workshops' : 'Selected Past Work';
  $('#workshop-list').hidden = !useWs;
  $('#pastwork').hidden = useWs;
  if (useWs) renderWorkshops();
  else renderPastwork();
}
function renderRail() {
  const hasWs = (state.workshops || []).length > 0;
  clearInterval(railTimer);
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
function currentHours() {
  const h = state.hours;
  if (!h) return null;
  const c = { ...h };
  if (h.status === 'open' && !h.is24 && h.closesAt) c.minutesToClose = Math.round((new Date(h.closesAt) - Date.now()) / 60000);
  return c;
}
function renderHours() {
  const h = currentHours();
  const block = $('#hours-block');
  const text = $('#hours-text');
  const loc = esc(state.config.locationName || 'Shields Library');
  if (!h) { block.dataset.status = 'unknown'; text.textContent = state.config.locationName || 'Shields Library'; }
  else if (h.status === 'closed') {
    block.dataset.status = 'closed';
    text.innerHTML = h.opensAt ? `${loc} opens <b>${esc(fmtDayTime(h.opensAt))}</b>` : `${loc} closed`;
  } else if (h.is24) {
    block.dataset.status = 'open';
    text.innerHTML = `${loc} open <b>24 hours</b>`;
  } else {
    const soon = h.minutesToClose != null && h.minutesToClose <= (state.config.warnMinutes[0] || 15);
    block.dataset.status = soon ? 'closing' : 'open';
    text.innerHTML = h.closesAt ? `${loc} open until <b>${esc(fmtTime(h.closesAt))}</b>` : `${loc} open`;
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
  if (banner && !isClosed) {
    $('#closing-banner-text').textContent = banner;
    bEl.hidden = false;
    requestAnimationFrame(() => bEl.classList.add('show'));
  } else {
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

/* ---------------- boot ---------------- */
async function boot() {
  primeAudio();
  await loadConfig();
  tick();
  setInterval(tick, 1000);
  await poll();
  setInterval(poll, Math.max(10000, state.config.pollMs));
}
boot();
