// current_state browser — app.js

const API = ''; // same origin

let availableDates = new Set();

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(val) {
  return `${Math.round(val * 100)}%`;
}

function pastTense(summary) {
  // Prefix with "It was" — strip leading "A " or "An " to avoid duplication
  const cleaned = summary.replace(/^(A|An) /, '');
  return `It was ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
}

// ── Visualiser ────────────────────────────────────────────────────────────────
// Uses Web Audio API to draw a live frequency bar graph on the canvas.
// AudioContext and source node are created once and reused — browsers disallow
// calling createMediaElementSource() more than once on the same element.

const Visualiser = (() => {
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let animFrameId = null;

  const canvas = document.getElementById('waveform');
  const ctx = canvas ? canvas.getContext('2d') : null;

  function init(audioEl) {
    if (!canvas || !ctx) return false;

    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256; // 128 frequency bins
        sourceNode = audioCtx.createMediaElementSource(audioEl);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
        console.log('[visualiser] AudioContext and analyser created.');
      }
      return true;
    } catch (err) {
      console.warn('[visualiser] Web Audio API init failed (CORS or browser issue):', err);
      return false;
    }
  }

  function draw() {
    if (!analyser || !ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const W = canvas.width;
    const H = canvas.height;
    const barWidth = (W / bufferLength) * 2.0;

    function loop() {
      animFrameId = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, W, H);

      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * H;
        ctx.fillStyle = `rgb(0, 0, 0)`;
        ctx.fillRect(x, H - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    }

    loop();
  }

  function start(audioEl) {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    if (!init(audioEl)) {
      console.warn('[visualiser] Skipping — init failed.');
      return;
    }
    canvas.style.display = 'block';
    console.log('[visualiser] Starting animation.');
    draw();
  }

  function stop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    console.log('[visualiser] Stopped.');
  }

  function hide() {
    stop();
    if (canvas) canvas.style.display = 'none';
  }

  return { start, stop, hide };
})();

// ── On load: fetch available dates, configure calendar ────────────────────────

async function init() {
  document.getElementById('footer-year').textContent = new Date().getFullYear();

  console.log('[init] Fetching available dates...');
  try {
    const resp = await fetch(`${API}/api/dates`);
    const data = await resp.json();
    availableDates = new Set(data.dates);
    console.log(`[init] ${data.count} dates available:`, data.dates);

    const sorted = data.dates.slice().sort();
    const earliest = sorted[0];
    const latest = sorted[sorted.length - 1];

    const input = document.getElementById('date-input');
    input.min = earliest;
    input.max = latest;
    input.value = latest;

    console.log(`[init] Calendar range: ${earliest} → ${latest}`);
    await loadEntry(latest);

  } catch (err) {
    console.error('[init] Failed to fetch dates:', err);
    document.getElementById('date-status').textContent = 'Error loading dates.';
  }
}

// ── Date picker change ────────────────────────────────────────────────────────

document.getElementById('date-input').addEventListener('change', async (e) => {
  const date = e.target.value;
  console.log(`[picker] Date selected: ${date}`);
  await loadEntry(date);
});

// ── Load a date entry ─────────────────────────────────────────────────────────

async function loadEntry(date) {
  console.log(`[loadEntry] Loading: ${date}`);

  document.getElementById('entry-section').style.display = 'none';
  document.getElementById('no-entry-section').style.display = 'none';
  document.getElementById('date-status').textContent = '';

  // Stop and hide visualiser when switching dates
  Visualiser.hide();

  if (!availableDates.has(date)) {
    console.warn(`[loadEntry] ${date} not in available set — no entry.`);
    document.getElementById('no-entry-section').style.display = 'block';
    return;
  }

  // ── Metadata ───────────────────────────────────────────────────────────────
  try {
    console.log(`[loadEntry] Fetching metadata: /api/entry/${date}`);
    const resp = await fetch(`${API}/api/entry/${date}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const meta = await resp.json();
    console.log(`[loadEntry] Metadata received:`, meta);
    renderMetadata(meta);
  } catch (err) {
    console.error(`[loadEntry] Metadata fetch failed:`, err);
    document.getElementById('no-entry-section').style.display = 'block';
    return;
  }

  // ── Audio ──────────────────────────────────────────────────────────────────
  const audioStatus = document.getElementById('audio-status');
  const audioPlayer = document.getElementById('audio-player');
  audioStatus.textContent = 'Loading audio...';
  audioPlayer.style.display = 'none';

  try {
    console.log(`[loadEntry] Fetching audio link: /api/audio/${date}`);
    const resp = await fetch(`${API}/api/audio/${date}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    console.log(`[loadEntry] Audio URL received:`, data.url);

    audioPlayer.src = data.url;
    audioPlayer.style.display = 'block';
    audioStatus.textContent = '';

    // Wire up visualiser events
    audioPlayer.onplay = () => Visualiser.start(audioPlayer);
    audioPlayer.onpause = () => Visualiser.stop();
    audioPlayer.onended = () => Visualiser.hide();

  } catch (err) {
    console.error(`[loadEntry] Audio fetch failed:`, err);
    audioStatus.textContent = 'Audio unavailable for this date.';
  }

  document.getElementById('entry-section').style.display = 'block';
}

// ── Render metadata ───────────────────────────────────────────────────────────

function renderMetadata(meta) {
  document.getElementById('entry-date').textContent = meta.date;
  document.getElementById('entry-summary').textContent = pastTense(meta.summary);
  document.getElementById('entry-archetype').textContent = meta.primary_archetype;
  document.getElementById('entry-energy').textContent = meta.energy_level;
  document.getElementById('entry-tension').textContent = pct(meta.tension_level);
  document.getElementById('entry-hope').textContent = pct(meta.hope_factor);
  document.getElementById('entry-prompt').textContent = meta.prompt_natural;

  const themes = (meta.dominant_themes || []).join(', ');
  document.getElementById('entry-themes').textContent = themes;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
