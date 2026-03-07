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

// ── On load: fetch available dates, configure calendar ────────────────────────

async function init() {
  // Dynamic copyright year
  document.getElementById('footer-year').textContent = new Date().getFullYear();

  console.log('[init] Fetching available dates...');
  try {
    const resp = await fetch(`${API}/api/dates`);
    const data = await resp.json();
    availableDates = new Set(data.dates);
    console.log(`[init] ${data.count} dates available:`, data.dates);

    const sorted = data.dates.slice().sort();
    const earliest = sorted[0];
    const latest   = sorted[sorted.length - 1];

    const input = document.getElementById('date-input');
    input.min   = earliest;
    input.max   = latest;
    input.value = latest; // default to most recent

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

  document.getElementById('entry-section').style.display    = 'none';
  document.getElementById('no-entry-section').style.display = 'none';
  document.getElementById('date-status').textContent        = '';

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
  audioStatus.textContent   = 'Loading audio...';
  audioPlayer.style.display = 'none';

  try {
    console.log(`[loadEntry] Fetching audio link: /api/audio/${date}`);
    const resp = await fetch(`${API}/api/audio/${date}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    console.log(`[loadEntry] Audio URL received:`, data.url);
    audioPlayer.src           = data.url;
    audioPlayer.style.display = 'block';
    audioStatus.textContent   = '';
  } catch (err) {
    console.error(`[loadEntry] Audio fetch failed:`, err);
    audioStatus.textContent = 'Audio unavailable for this date.';
  }

  document.getElementById('entry-section').style.display = 'block';
}

// ── Render metadata ───────────────────────────────────────────────────────────

function renderMetadata(meta) {
  document.getElementById('entry-date').textContent      = meta.date;
  document.getElementById('entry-summary').textContent   = pastTense(meta.summary);
  document.getElementById('entry-archetype').textContent = meta.primary_archetype;
  document.getElementById('entry-energy').textContent    = meta.energy_level;
  document.getElementById('entry-tension').textContent   = pct(meta.tension_level);
  document.getElementById('entry-hope').textContent      = pct(meta.hope_factor);
  document.getElementById('entry-prompt').textContent    = meta.prompt_natural;

  const themes = (meta.dominant_themes || []).join(', ');
  document.getElementById('entry-themes').textContent = themes;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
