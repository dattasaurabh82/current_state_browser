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

const MOODS = {
  gentle_tension:    ['#c4b5a5', '#8faab8', '#d4c4a8', '#7a9aaa'],
  deep_sorrow:       ['#607080', '#506070', '#788898', '#506878'],
  quiet_hope:        ['#a8bc90', '#c8c890', '#b8d0a0', '#d0c8a0'],
  restless_energy:   ['#c8824a', '#b89060', '#d4a060', '#c07040'],
  fragile_calm:      ['#a8c4d0', '#c0d4dc', '#b0ccd8', '#d0dce4'],
  collective_grief:  ['#8878a8', '#787098', '#9888b0', '#706888'],
  cautious_optimism: ['#a0b890', '#c8c8a0', '#b8c8a8', '#d4c8b0'],
  cautious_hope:     ['#a0b890', '#c8c8a0', '#b8c8a8', '#d4c8b0'],
  raw_uncertainty:   ['#b8a890', '#a89880', '#c4b8a0', '#b0a888'],
};

const blobs = [
  document.getElementById('blob-a'),
  document.getElementById('blob-b'),
  document.getElementById('blob-c'),
  document.getElementById('blob-d'),
];

function setMood(archetype) {
  const key = archetype ? archetype.toLowerCase().replace(/[\s-]+/g, '_') : 'gentle_tension';
  const p   = MOODS[key] || MOODS['gentle_tension'];
  if (!MOODS[key]) console.warn(`[mood] Unknown archetype "${archetype}", falling back to gentle_tension`);
  console.log(`[mood] ${key}`, p);
  blobs.forEach((b, i) => { if (b) b.style.backgroundColor = p[i]; });
  const r = document.documentElement;
  r.style.setProperty('--blob-a', p[0]);
  r.style.setProperty('--blob-b', p[1]);
  r.style.setProperty('--blob-c', p[2]);
}

// ── Blob animation ────────────────────────────────────────────────────────────

const blobDefs = [
  { bx: 0.18, by: 0.28, ax: 0.12, ay: 0.10, sx: 0.00031, sy: 0.00023, ph: 0.00 },
  { bx: 0.78, by: 0.18, ax: 0.10, ay: 0.13, sx: 0.00027, sy: 0.00037, ph: 1.20 },
  { bx: 0.62, by: 0.76, ax: 0.13, ay: 0.09, sx: 0.00041, sy: 0.00029, ph: 2.40 },
  { bx: 0.12, by: 0.72, ax: 0.09, ay: 0.12, sx: 0.00035, sy: 0.00021, ph: 3.60 },
];

function animateBlobs(t) {
  const W = window.innerWidth, H = window.innerHeight, half = W * 0.29;
  blobDefs.forEach((d, i) => {
    if (!blobs[i]) return;
    const x = (d.bx + Math.sin(t * d.sx + d.ph) * d.ax) * W - half;
    const y = (d.by + Math.cos(t * d.sy + d.ph) * d.ay) * H - half;
    blobs[i].style.transform = `translate(${x}px, ${y}px)`;
  });
  requestAnimationFrame(animateBlobs);
}
requestAnimationFrame(animateBlobs);
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
      }
      return true;
    } catch (err) {
      console.warn('[visualiser] init failed:', err);
      return false;
    }
  }

  function draw() {
    if (!analyser || !ctx) return;
    const bufLen = analyser.frequencyBinCount;  // 128 bins (fftSize/2)
    const raw    = new Uint8Array(bufLen);
    const W = canvas.width, H = canvas.height;

    // We draw bufLen bars across the full width
    const gap  = 1.5;
    const barW = (W - bufLen * gap) / bufLen;

    function loop() {
      animId = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(raw);

      // ── Sausage / lens envelope ───────────────────────────────
      // Frequency data: index 0 = bass (loud), last = treble (quiet).
      // We rearrange into a palindrome so the loud bass sits centre,
      // quiet treble at both edges → low–high–low envelope shape.
      //
      // Arrangement: [raw[half]...raw[1], raw[0], raw[1]...raw[half]]
      // Left half descends from mid-freq to bass (getting louder).
      // Right half mirrors: bass back up to mid-freq (getting quieter).
      // Result: a symmetric sausage/lens that peaks in the middle.

      const half = Math.floor(bufLen / 2);
      const sausage = new Uint8Array(bufLen);
      for (let i = 0; i <= half; i++) {
        sausage[half - i] = raw[i];  // left side: count down toward centre
        sausage[half + i] = raw[i];  // right side: mirror
      }

      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < bufLen; i++) {
        const barH = (sausage[i] / 255) * H * 0.90;
        const x    = i * (barW + gap);
        const y    = (H - barH) / 2;          // centred vertically
        ctx.fillStyle = 'rgba(26,26,24,0.50)';
        ctx.fillRect(x, y, barW, barH);
      }
    }
    loop();
  }

  function start(audioEl) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (!init(audioEl)) return;
    show('waveform');
    draw();
  }

  function stop() {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function hideVis() { stop(); hide('waveform'); }

  return { start, stop, hide: hideVis };
})();

// ── On load ───────────────────────────────────────────────────────────────────

async function init() {
  document.getElementById('footer-year').textContent = new Date().getFullYear();
  try {
    const resp = await fetch(`${API}/api/dates`);
    const data = await resp.json();
    availableDates = new Set(data.dates);

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
  await loadEntry(e.target.value);
});

// ── Load entry ────────────────────────────────────────────────────────────────

async function loadEntry(date) {
  hide('entry-section');
  hide('no-entry-section');
  hide('meta-section');
  hide('music-section');
  document.getElementById('date-status').textContent = '';
  document.getElementById('audio-status').textContent = '';
  hide('audio-player');
  Visualiser.hide();

  if (!availableDates.has(date)) {
    show('no-entry-section');
    return;
  }

  try {
    const resp = await fetch(`${API}/api/entry/${date}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const meta = await resp.json();
    renderMetadata(meta);
    show('entry-section');
    show('meta-section');
    show('music-section');
  } catch (err) {
    console.error('[loadEntry] Metadata fetch failed:', err);
    show('no-entry-section');
    return;
  }

  const audioPlayer = document.getElementById('audio-player');
  document.getElementById('audio-status').textContent = 'Loading audio...';

  try {
    const resp = await fetch(`${API}/api/audio/${date}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

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
  document.getElementById('entry-date').textContent =
    meta.date ? meta.date.replace(/-/g, ' — ') : '';
  document.getElementById('entry-summary').textContent =
    pastTense(meta.summary);
  document.getElementById('entry-archetype').textContent =
    meta.primary_archetype || '';
  document.getElementById('entry-energy').textContent =
    meta.energy_level || '';
  document.getElementById('entry-tension').textContent =
    Math.round((meta.tension_level || 0) * 100);
  document.getElementById('entry-hope').textContent =
    Math.round((meta.hope_factor || 0) * 100);
  document.getElementById('entry-prompt').textContent =
    meta.prompt_natural || '';
  document.getElementById('entry-themes').textContent =
    (meta.dominant_themes || []).join(', ');
  setMood(meta.primary_archetype);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
