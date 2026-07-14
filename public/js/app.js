const API = '/api/jobs';
let pollTimer = null;

// Theme
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeButton(saved);
}

function updateThemeButton(theme) {
  document.getElementById('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeButton(next);
});

// Speech model modal
const modelModal = document.getElementById('model-modal');
document.getElementById('models-btn').addEventListener('click', () => {
  modelModal.hidden = false;
  loadModelStatus();
});
document.getElementById('model-modal-close').addEventListener('click', () => {
  modelModal.hidden = true;
});
modelModal.addEventListener('click', (e) => {
  if (e.target === modelModal) modelModal.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modelModal.hidden) modelModal.hidden = true;
});

// Scan page for videos
const scanModal = document.getElementById('scan-modal');
let scanResults = [];

document.getElementById('scan-btn').addEventListener('click', scanPage);
document.getElementById('scan-modal-close').addEventListener('click', () => { scanModal.hidden = true; });
scanModal.addEventListener('click', (e) => { if (e.target === scanModal) scanModal.hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !scanModal.hidden) scanModal.hidden = true;
});

let scanning = false;

async function scanPage() {
  if (scanning) { alert('A scan is already running.'); return; }
  const url = document.getElementById('url').value.trim();
  if (!url) { alert('Enter a page URL first.'); return; }

  const btn = document.getElementById('scan-btn');
  const originalText = btn.textContent;
  const statusEl = document.getElementById('scan-status');
  scanning = true;
  btn.disabled = true;
  btn.textContent = '🔍 Scanning…';
  statusEl.querySelector('.scan-status-text').textContent = `Scanning for videos: ${shortUrl(url)}`;
  statusEl.hidden = false;

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');

    const result = await pollScan(data.scanId);
    scanResults = result.videos || [];
    document.getElementById('scan-footer').hidden = true;
    scanModal.hidden = false;
    renderScanResults();
  } catch (err) {
    alert(`Scan failed: ${err.message}`);
  } finally {
    scanning = false;
    btn.disabled = false;
    btn.textContent = originalText;
    statusEl.hidden = true;
  }
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname.length > 30 ? u.pathname.slice(0, 27) + '…' : u.pathname;
    return u.hostname + p;
  } catch {
    return url.length > 40 ? url.slice(0, 37) + '…' : url;
  }
}

// Poll a background scan until it finishes. The UI stays fully usable meanwhile.
function pollScan(scanId) {
  return new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/scan/${scanId}`);
        const s = await res.json();
        if (!res.ok) throw new Error(s.error || 'Scan lookup failed');
        if (s.status === 'done') { clearInterval(iv); resolve(s); }
        else if (s.status === 'error') { clearInterval(iv); reject(new Error(s.error || 'Scan failed')); }
        // 'running' → keep waiting
      } catch (err) {
        clearInterval(iv);
        reject(err);
      }
    }, 1500);
  });
}

function renderScanResults() {
  const body = document.getElementById('scan-body');
  const footer = document.getElementById('scan-footer');

  if (scanResults.length === 0) {
    body.innerHTML = `<div class="scan-loading">No downloadable videos found on this page.</div>`;
    footer.hidden = true;
    return;
  }

  body.innerHTML = `
    <div class="scan-count">Found ${scanResults.length} video${scanResults.length > 1 ? 's' : ''}:</div>
    <div class="scan-list">
      ${scanResults.map((v, i) => {
        const dims = v.width && v.height ? `${v.width}×${v.height}` : (v.kind === 'embed' ? 'embed' : '');
        const dur = v.durationSec ? formatDuration(v.durationSec) : '';
        const size = v.sizeMB ? `${v.sizeMB} MB` : '';
        const meta = [dims, dur, size].filter(Boolean).join(' · ');
        return `
          <label class="scan-row">
            <input type="checkbox" class="scan-check" data-index="${i}" checked>
            <span class="scan-info">
              <span class="scan-label">${escapeHtml(v.label)}</span>
              <span class="scan-meta">${escapeHtml(meta)}</span>
            </span>
          </label>`;
      }).join('')}
    </div>`;

  footer.hidden = false;
  document.getElementById('scan-select-all').checked = true;
  updateScanDownloadLabel();

  body.querySelectorAll('.scan-check').forEach((cb) => {
    cb.addEventListener('change', updateScanDownloadLabel);
  });
}

function updateScanDownloadLabel() {
  const n = document.querySelectorAll('.scan-check:checked').length;
  const btn = document.getElementById('scan-download-btn');
  btn.textContent = n ? `Download selected (${n})` : 'Download selected';
  btn.disabled = n === 0;
}

document.getElementById('scan-select-all').addEventListener('change', (e) => {
  document.querySelectorAll('.scan-check').forEach((cb) => { cb.checked = e.target.checked; });
  updateScanDownloadLabel();
});

document.getElementById('scan-download-btn').addEventListener('click', async () => {
  const checked = [...document.querySelectorAll('.scan-check:checked')].map((cb) => scanResults[+cb.dataset.index]);
  if (checked.length === 0) return;

  const base = {
    language: document.getElementById('language').value,
    format: document.getElementById('format').value,
    quality: document.getElementById('quality').value,
    extract_subtitles: document.getElementById('extract-subtitles').checked,
  };

  const btn = document.getElementById('scan-download-btn');
  btn.disabled = true;
  try {
    for (const v of checked) {
      await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, url: v.url }),
      });
    }
    scanModal.hidden = true;
    loadJobs();
  } catch (err) {
    alert(`Failed to queue downloads: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

function scanFromJob(encodedUrl) {
  document.getElementById('url').value = decodeURIComponent(encodedUrl);
  scanPage();
}

function formatDuration(sec) {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

// Submit form
document.getElementById('job-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;

  const body = {
    url: document.getElementById('url').value,
    language: document.getElementById('language').value,
    format: document.getElementById('format').value,
    quality: document.getElementById('quality').value,
    webhook: document.getElementById('webhook').value || undefined,
    extract_subtitles: document.getElementById('extract-subtitles').checked,
  };

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to submit job');
    }
    document.getElementById('job-form').reset();
    loadJobs();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

// Load jobs
async function loadJobs() {
  const status = document.getElementById('status-filter').value;
  const query = status ? `?status=${status}` : '';

  try {
    const res = await fetch(`${API}${query}`);
    const data = await res.json();
    renderJobs(data.jobs);
  } catch (err) {
    console.error('Failed to load jobs:', err);
  }
}

function renderJobs(jobs) {
  const container = document.getElementById('jobs-list');

  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<div class="empty-state">No jobs yet. Submit a URL above to get started.</div>';
    return;
  }

  container.innerHTML = jobs.map(job => {
    const isActive = ['pending', 'downloading', 'transcribe_pending', 'transcribing'].includes(job.status);
    const statusLabel = job.status === 'transcribe_pending' ? 'queued' : job.status;
    const timeAgo = formatTime(job.created_at);
    const audioOnly = job.quality === 'audio';
    const qualityLabel = audioOnly ? 'audio' : (job.quality === 'best' ? 'best' : `${job.quality}p`);

    return `
      <div class="job-card" data-id="${job.id}">
        <div class="job-card-header">
          <span class="job-url">${escapeHtml(truncateUrl(job.url))}</span>
          <span class="job-status status-${job.status}">${statusLabel}</span>
        </div>
        ${isActive && job.status_message ? `
          <div class="job-status-message">${escapeHtml(job.status_message)}</div>
        ` : ''}
        ${isActive && job.progress > 0 ? `
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width: ${job.progress}%"></div>
          </div>
        ` : ''}
        ${job.error ? `<div class="job-error">${escapeHtml(job.error)}</div>` : ''}
        ${job.more_videos && job.status === 'completed' ? `
          <div class="job-hint">🔍 This page may have more videos — <button type="button" class="link-btn" onclick="scanFromJob('${encodeURIComponent(job.url)}')">Scan to pick the others</button></div>
        ` : ''}
        <div class="job-meta">
          ${timeAgo} &middot; ${job.language} &middot; ${job.format}
          ${job.quality ? ` &middot; ${qualityLabel}` : ''}
          ${job.duration ? ` &middot; ${job.duration.toFixed(1)}s` : ''}
          ${isActive && job.started_at ? ` &middot; elapsed ${formatElapsed(job.started_at)}` : ''}
          ${job.download_method ? ` &middot; <span class="download-method method-${job.download_method}">${job.download_method}</span>` : ''}
        </div>
        <div class="job-actions">
          ${job.status === 'completed' ? `
            <button onclick="downloadFile('${job.id}', 'video')">${audioOnly ? 'Download Audio' : 'Download Video'}</button>
            ${job.subtitle_path ? `<button onclick="downloadFile('${job.id}', 'subtitle')">Download Subtitles</button>` : ''}
          ` : ''}
          ${job.status === 'transcribing' ? `<button class="btn-stop" onclick="stopWhisper()">Stop Whisper</button>` : ''}
          ${job.status === 'failed' ? `<button onclick="retryJob('${job.id}')">Retry</button>` : ''}
          <button class="btn-danger" onclick="deleteJob('${job.id}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteJob(id) {
  if (!confirm('Delete this job?')) return;
  await fetch(`${API}/${id}`, { method: 'DELETE' });
  loadJobs();
}

async function retryJob(id) {
  await fetch(`${API}/${id}/retry`, { method: 'POST' });
  loadJobs();
}

function downloadFile(id, type) {
  window.open(`${API}/${id}/download?type=${type}`, '_blank');
}

// Helpers
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncateUrl(url) {
  return url.length > 80 ? url.substring(0, 77) + '...' : url;
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  return date.toLocaleString();
}

function formatElapsed(isoStr) {
  if (!isoStr) return '';
  const seconds = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

// Filter change
document.getElementById('status-filter').addEventListener('change', loadJobs);

// Version badge
async function loadVersion() {
  try {
    const res = await fetch('/api/version');
    const data = await res.json();
    document.getElementById('version-badge').textContent = `v${data.version}`;
    document.getElementById('version-tooltip').textContent = data.changelog;
  } catch (err) {
    console.error('Failed to load version:', err);
  }
}

// Speech model status
async function loadModelStatus() {
  try {
    const res = await fetch('/api/model/status');
    const data = await res.json();
    renderModelStatus(data);
  } catch (err) {
    console.error('Failed to load model status:', err);
  }
}

function renderModelStatus(data) {
  const backendEl = document.getElementById('model-backend');
  const listEl = document.getElementById('model-list');
  const progressEl = document.getElementById('model-progress');

  const backendLabel = data.backend === 'cpp' ? 'whisper.cpp' : data.backend;
  backendEl.textContent = backendLabel;

  listEl.innerHTML = (data.models || []).map((m) => {
    const isSelected = m.name === data.default;
    const size = m.sizeMB ? `${m.sizeMB} MB` : '';
    const sizeNote = size ? `<span class="model-size">${size}</span>` : '';
    const actions = m.installed
      ? `<span class="model-badge installed">✓ installed</span>
         <button type="button" class="model-delete-btn" data-model="${m.name}" title="Delete model from disk">Delete</button>`
      : `<button type="button" class="model-download-btn" data-model="${m.name}">Download${size ? ` (${size})` : ''}</button>`;
    return `
      <label class="model-row${isSelected ? ' is-default' : ''}">
        <span class="model-select">
          <input type="radio" name="active-model" value="${m.name}"${isSelected ? ' checked' : ''}>
          <span class="model-name">${m.name}${isSelected ? ' <span class="model-default-tag">selected</span>' : ''}</span>
        </span>
        <span class="model-row-right">${m.installed ? sizeNote : ''}${actions}</span>
      </label>`;
  }).join('');

  listEl.querySelectorAll('input[name="active-model"]').forEach((radio) => {
    radio.addEventListener('change', () => selectModel(radio.value));
  });
  listEl.querySelectorAll('.model-download-btn').forEach((btn) => {
    btn.addEventListener('click', () => downloadModel(btn.dataset.model));
  });
  listEl.querySelectorAll('.model-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteModelFile(btn.dataset.model));
  });

  const dl = data.downloading;
  document.getElementById('models-btn').classList.toggle('downloading', !!dl);
  if (dl) {
    progressEl.hidden = false;
    const pct = dl.total ? Math.round((dl.downloaded / dl.total) * 100) : 0;
    const mb = (n) => (n / (1024 * 1024)).toFixed(0);
    progressEl.querySelector('.model-progress-label').textContent =
      `Downloading ${dl.model}… ${mb(dl.downloaded)}${dl.total ? ` / ${mb(dl.total)}` : ''} MB`;
    progressEl.querySelector('.progress-bar-fill').style.width = `${pct}%`;
  } else {
    progressEl.hidden = true;
  }
}

async function selectModel(name) {
  try {
    const res = await fetch('/api/model/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Selection failed');
  } catch (err) {
    alert(`Failed to select "${name}": ${err.message}`);
  } finally {
    loadModelStatus();
  }
}

async function deleteModelFile(name) {
  if (!confirm(`Delete the "${name}" model from disk? It will re-download on demand next time it's needed.`)) return;
  try {
    const res = await fetch('/api/model/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Delete failed');
  } catch (err) {
    alert(`Failed to delete "${name}": ${err.message}`);
  } finally {
    loadModelStatus();
  }
}

async function downloadModel(name) {
  const btn = document.querySelector(`.model-download-btn[data-model="${name}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  try {
    const res = await fetch('/api/model/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Download failed');
  } catch (err) {
    alert(`Failed to download "${name}": ${err.message}`);
  } finally {
    loadModelStatus();
  }
}

// Stop whisper
async function stopWhisper() {
  if (!confirm('Stop Whisper transcription?')) return;
  try {
    await fetch('/api/whisper/stop', { method: 'POST' });
    loadJobs();
  } catch (err) {
    alert('Failed to stop Whisper');
  }
}

// Init
initTheme();
loadVersion();
loadJobs();
loadModelStatus();
pollTimer = setInterval(() => {
  loadJobs();
  loadModelStatus();
}, 3000);
