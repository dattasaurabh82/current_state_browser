// current_state browser — app.js

const API = ''; // same origin

let availableDates = new Set();

// ── Helpers ───────────────────────────────────────────────────────────────────

function pastTense(summary) {
  const cleaned = summary.replace(/^(A|An) /, '');
  return `It was ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

// ── Mood system ───────────────────────────────────────────────────────────────
// Each archetype maps to 4 blob colours.
// setMood() updates blob background-colors (CSS transition handles the fade)
// and updates the --blob-a/b/c CSS vars for the mood-banner inner echo.

const MOODS = {
  gentle_tension:    ['#c9bfb4', '#a8b5c2', '#d4c8b8', '#b8bfc8'],
  deep_sorrow:       ['#8fa0b0', '#7d8fa0', '#b0bdc8', '#8898a8'],
  quiet_hope:        ['#c4ceaa', '#d4c8a8', '#b8cdb8', '#c8d4b0'],
  restless_energy:   ['#c8aa8f', '#d4b898', '#d4c0a0', '#c8b090'],
  fragile_calm:      ['#b8c4c8', '#c8d0d0', '#d0ccc4', '#c0ccd0'],
  collective_grief:  ['#a0a8b8', '#9898a8', '#b8b0c0', '#a8a0b8'],
  cautious_optimism: ['#b8c8b0', '#c8d0b8', '#d0c8a8', '#c0ccb0'],
  raw_uncertainty:   ['#c0b8a8', '#b8b0a0', '#ccc4b8', '#c8c0b0'],
};

const blobs = [
  document.getElementById('blob-a'),
  document.getElementById('blob-b'),
  document.getElementById('blob-c'),
  document.getElementById('blob-d'),
];

function setMood(archetype) {
  const key = archetype ? archetype.toLowerCase().replace(/\s+/g, '_') : 'gentle_tension';
  const p   = MOODS[key] || MOODS['gentle_tension'];
  console.log(`[mood] Setting archetype: ${key}`, p);

  // Update individual blob colours — CSS transition does the fade
  blobs.forEach((b, i) => { if (b) b.style.backgroundColor = p[i]; });

  // Update mood-banner inner echo via CSS vars
  const r = document.documentElement;
  r.style.setProperty('--blob-a', p[0]);
  r.style.setProperty('--blob-b', p[1]);
  r.style.setProperty('--blob-c', p[2]);
}

// ── Blob animation ────────────────────────────────────────────────────────────
// Each blob drifts independently on a sine-wave path.
// Different speed, amplitude, phase per blob — never in sync.

const blobDefs = [
  { bx: 0.18, by: 0.28, ax: 0.12, ay: 0.10, sx: 0.00031, sy: 0.00023, ph: 0.00 },
  { bx: 0.78, by: 0.18, ax: 0.10, ay: 0.13, sx: 0.00027, sy: 0.00037, ph: 1.20 },
  { bx: 0.62, by: 0.76, ax: 0.13, ay: 0.09, sx: 0.00041, sy: 0.00029, ph: 2.40 },
  { bx: 0.12, by: 0.72, ax: 0.09, ay: 0.12, sx: 0.00035, sy: 0.00021, ph: 3.60 },
];

function animateBlobs(t) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const half = W * 0.29;  // approx half of 58vmax

  blobDefs.forEach((d, i) => {
    if (!blobs[i]) return;
    const x = (d.bx + Math.sin(t * d.sx + d.ph) * d.ax) * W - half;
    const y = (d.by + Math.cos(t * d.sy + d.ph) * d.ay) * H - half;
    blobs[i].style.transform = `translate(${x}px, ${y}px)`;
  });
  requestAnimationFrame(animateBlobs);
}
requestAnimationFrame(animateBlobs);

// Init with default palette so blobs aren't invisible before first API call
setMood('gentle_tension');

// ── Visualiser ────────────────────────────────────────────────────────────────

const Visualiser = (() => {
  let audioCtx   = null;
  let analyser   = null;
  let sourceNode = null;
  let animId     = null;

  const canvas = document.getElementById('waveform');
  const ctx    = canvas ? canvas.getContext('2d') : null;

  function init(audioEl) {
    if (!canvas || !ctx) return false;
    try {
      if (!audioCtx) {
        audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
        analyser   = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        sourceNode = audioCtx.createMediaElementSource(audioEl);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
        console.log('[visualiser] AudioContext created.');
      }
      return true;
    } catch (err) {
      console.warn('[visualiser] Web Audio API init failed:', err);
      return false;
    }
  }

  function draw() {
    if (!analyser || !ctx) return;
    const bufLen  = analyser.frequencyBinCount;
    const data    = new Uint8Array(bufLen);
    const W = canvas.width, H = canvas.height;
    const barW = (W / bufLen) * 1.8;

    function loop() {
      animId = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, W, H);
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        // Centred symmetric bars
        const barH = (data[i] / 255) * H * 0.88;
        ctx.fillStyle = 'rgba(26,26,24,0.55)';
        ctx.fillRect(x, (H - barH) / 2, barW - 1, barH);
        x += barW;
      }
    }
    loop();
  }

  function start(audioEl) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (!init(audioEl)) return;
    show('waveform');
    console.log('[visualiser] Starting.');
    draw();
  }

  function stop() {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    console.log('[visualiser] Stopped.');
  }

  function hideVis() {
    stop();
    hide('waveform');
  }

  return { start, stop, hide: hideVis };
})();

// ── On load ───────────────────────────────────────────────────────────────────

async function init() {
  document.getElementById('footer-year').textContent = new Date().getFullYear();
  console.log('[init] Fetching available dates...');

  try {
    const resp = await fetch(`${API}/api/dates`);
    const data = await resp.json();
    availableDates = new Set(data.dates);
    console.log(`[init] ${data.count} dates available.`);

    const sorted   = data.dates.slice().sort();
    const earliest = sorted[0];
    const latest   = sorted[sorted.length - 1];

    const input = document.getElementById('date-input');
    input.min   = earliest;
    input.max   = latest;
    input.value = latest;

    await loadEntry(latest);

  } catch (err) {
    console.error('[init] Failed to fetch dates:', err);
    document.getElementById('date-status').textContent = 'Error loading dates.';
  }
}

// ── Date picker ───────────────────────────────────────────────────────────────

document.getElementById('date-input').addEventListener('change', async (e) => {
  console.log(`[picker] Date selected: ${e.target.value}`);
  await loadEntry(e.target.value);
});

// ── Load entry ────────────────────────────────────────────────────────────────

async function loadEntry(date) {
  console.log(`[loadEntry] Loading: ${date}`);

  // Reset state
  hide('entry-section');
  hide('no-entry-section');
  hide('meta-section');
  hide('music-section');
  document.getElementById('date-status').textContent = '';
  document.getElementById('audio-status').textContent = '';
  hide('audio-player');
  Visualiser.hide();

  if (!availableDates.has(date)) {
    console.warn(`[loadEntry] ${date} not in available set.`);
    show('no-entry-section');
    return;
  }

  // Metadata
  try {
    const resp = await fetch(`${API}/api/entry/${date}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const meta = await resp.json();
    console.log('[loadEntry] Metadata received:', meta);
    renderMetadata(meta);
    show('entry-section');
    show('meta-section');
    show('music-section');
  } catch (err) {
    console.error('[loadEntry] Metadata fetch failed:', err);
    show('no-entry-section');
    return;
  }

  // Audio
  const audioPlayer = document.getElementById('audio-player');
  document.getElementById('audio-status').textContent = 'Loading audio...';

  try {
    const resp = await fetch(`${API}/api/audio/${date}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    console.log('[loadEntry] Audio URL received.');

    audioPlayer.src = data.url;
    show('audio-player');
    document.getElementById('audio-status').textContent = '';

    audioPlayer.onplay  = () => Visualiser.start(audioPlayer);
    audioPlayer.onpause = () => Visualiser.stop();
    audioPlayer.onended = () => Visualiser.hide();

  } catch (err) {
    console.error('[loadEntry] Audio fetch failed:', err);
    document.getElementById('audio-status').textContent = 'Audio unavailable.';
  }
}

// ── Render metadata ───────────────────────────────────────────────────────────

function renderMetadata(meta) {
  // Format date: 2026-03-06 → 2026 — 03 — 06
  document.getElementById('entry-date').textContent =
    meta.date ? meta.date.replace(/-/g, ' — ') : '';

  document.getElementById('entry-summary').textContent =
    pastTense(meta.summary);

  document.getElementById('entry-archetype').textContent =
    meta.primary_archetype || '';

  document.getElementById('entry-energy').textContent =
    meta.energy_level || '';

  // Tension + hope as plain integers (0.7 → 70)
  document.getElementById('entry-tension').textContent =
    Math.round((meta.tension_level || 0) * 100);

  document.getElementById('entry-hope').textContent =
    Math.round((meta.hope_factor || 0) * 100);

  document.getElementById('entry-prompt').textContent =
    meta.prompt_natural || '';

  document.getElementById('entry-themes').textContent =
    (meta.dominant_themes || []).join(', ');

  // Drive mood from archetype — updates blobs + inner echo
  setMood(meta.primary_archetype);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
