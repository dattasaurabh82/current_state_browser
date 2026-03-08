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

// ── Date-seeded colour system ─────────────────────────────────────────────────
//
// Each date gets 4 unique blob colours derived deterministically from the date
// string itself. Same date → same colours, always. No predefined palette map,
// no archetype lookup. Every day is its own atmosphere.
//
// Algorithm:
//   1. Hash the date string (djb2-style) → 32-bit unsigned seed
//   2. Feed seed into xorshift32 PRNG
//   3. Pull 4 × (hue, saturation, lightness) from the PRNG
//   4. Constrain to editorial range: sat 15–40%, lightness 45–70%
//
// Why these ranges?
//   Saturation 15–40%: desaturated enough to feel editorial, varied enough to
//   be perceptually distinct across days. Higher than ~45% starts to look like
//   a consumer app rather than a journal.
//   Lightness 45–70%: visible against the card's frosted glass, never too dark
//   to transmit through the backdrop-filter, never washed out to near-white.

function _hashDate(dateStr) {
  // djb2 hash: simple, well-distributed for short strings like YYYY-MM-DD
  let h = 5381;
  for (let i = 0; i < dateStr.length; i++) {
    h = (Math.imul(h, 33) ^ dateStr.charCodeAt(i)) >>> 0;
  }
  return h === 0 ? 1 : h; // xorshift can't start at 0
}

function _makeRng(seed) {
  // xorshift32 — fast, good distribution, reproducible
  let s = seed;
  return function () {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    s = s >>> 0;
    return s / 0xFFFFFFFF;
  };
}

function dateToColors(dateStr) {
  const rng = _makeRng(_hashDate(dateStr));
  const colors = [];
  for (let i = 0; i < 4; i++) {
    const hue = Math.floor(rng() * 360);          // full spectrum
    const sat = Math.floor(15 + rng() * 25);      // 15–40%
    const lit = Math.floor(45 + rng() * 25);      // 45–70%
    colors.push(`hsl(${hue}, ${sat}%, ${lit}%)`);
  }
  return colors;
}

// ── Apply colours to blobs ────────────────────────────────────────────────────

const blobs = [
  document.getElementById('blob-a'),
  document.getElementById('blob-b'),
  document.getElementById('blob-c'),
  document.getElementById('blob-d'),
];

function setMood(dateStr) {
  // Fallback: if no date yet, use a neutral slate
  const colors = dateStr ? dateToColors(dateStr) : [
    'hsl(210, 18%, 55%)',
    'hsl(30,  16%, 60%)',
    'hsl(180, 14%, 58%)',
    'hsl(60,  12%, 62%)',
  ];

  blobs.forEach((b, i) => { if (b) b.style.backgroundColor = colors[i]; });

  const r = document.documentElement;
  r.style.setProperty('--blob-a', colors[0]);
  r.style.setProperty('--blob-b', colors[1]);
  r.style.setProperty('--blob-c', colors[2]);
}

// ── Blob animation ────────────────────────────────────────────────────────────
// Each blob drifts on an independent sine-wave path.
// Different speed, amplitude, phase per blob — never in sync.

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

// Neutral default until first date loads
setMood(null);

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
    const bufLen = analyser.frequencyBinCount; // 128
    const raw    = new Uint8Array(bufLen);
    const W = canvas.width, H = canvas.height;
    const gap  = 1.5;
    const barW = (W - bufLen * gap) / bufLen;

    function loop() {
      animId = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(raw);

      // Sausage/lens envelope: rearrange FFT bins into a palindrome so bass
      // (loudest, index 0) sits in the centre and treble at both edges.
      const half = Math.floor(bufLen / 2);
      const sausage = new Uint8Array(bufLen);
      for (let i = 0; i <= half; i++) {
        sausage[half - i] = raw[i];
        sausage[half + i] = raw[i];
      }

      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < bufLen; i++) {
        const barH = (sausage[i] / 255) * H * 0.90;
        const x    = i * (barW + gap);
        const y    = (H - barH) / 2; // centred vertically
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

  // Colour atmosphere is driven by the date, not the archetype name.
  // Same date always produces the same 4 colours.
  setMood(meta.date);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
