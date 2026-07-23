// Closing-time alerts: synthesizes chimes with the Web Audio API (no audio files
// needed, works fully offline) and tracks which warning thresholds have already
// fired today so each chime plays once per day.

let audioCtx = null;
const firedToday = new Set(); // keys like "2026-07-23:15"

function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = AC ? new AC() : null;
  }
  // Kiosk autoplay: resume if the context started suspended.
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

// A soft bell: a couple of detuned sine partials with a gentle exponential decay.
function bell(freq, when, dur, gain) {
  const ac = ctx();
  if (!ac) return;
  [1, 2.01, 3.0].forEach((mult, i) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    const peak = gain * (i === 0 ? 1 : 0.28 / i);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  });
}

// Gentle two-note chime for the first (15-min) warning.
function chimeGentle() {
  const ac = ctx();
  if (!ac) return;
  const t = ac.currentTime;
  bell(880, t, 1.4, 0.25); // A5
  bell(1174.7, t + 0.28, 1.6, 0.22); // D6
}

// More insistent triple chime for the final (5-min) warning.
function chimeUrgent() {
  const ac = ctx();
  if (!ac) return;
  const t = ac.currentTime;
  bell(987.8, t, 0.9, 0.3);
  bell(987.8, t + 0.35, 0.9, 0.3);
  bell(1318.5, t + 0.7, 1.4, 0.32);
}

// Attempt to unlock audio on first user gesture (kiosk browsers usually allow
// autoplay, but this is a harmless safety net).
export function primeAudio() {
  const resume = () => ctx();
  window.addEventListener('pointerdown', resume, { once: true });
  window.addEventListener('keydown', resume, { once: true });
}

// Decide banner text + play the right chime once per threshold per day.
// `hours` is the /api/hours payload; `warnMinutes` e.g. [15, 5] (descending).
// Returns { banner: string|null }.
export function evaluate(hours, warnMinutes, todayKey) {
  if (!hours || hours.status !== 'open' || hours.is24 || hours.minutesToClose == null) {
    return { banner: null };
  }
  const mins = hours.minutesToClose;
  const largest = warnMinutes[0];
  if (mins > largest || mins < 0) return { banner: null };

  // Which threshold band are we in? (warnMinutes is descending, e.g. 15,5)
  let crossed = null;
  for (const w of warnMinutes) {
    if (mins <= w) crossed = w;
  }
  if (crossed == null) return { banner: null };

  const key = `${todayKey}:${crossed}`;
  if (!firedToday.has(key)) {
    firedToday.add(key);
    const isFinal = crossed === warnMinutes[warnMinutes.length - 1];
    if (isFinal) chimeUrgent();
    else chimeGentle();
  }

  const label =
    mins <= 1 ? 'is closing now' : `closes in ${mins} minute${mins === 1 ? '' : 's'}`;
  return { banner: `Shields Library ${label} — please wrap up` };
}
