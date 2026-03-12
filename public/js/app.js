const API = '/api/jobs';
let pollTimer = null;

// Theme
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
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

// Submit form
document.getElementById('job-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;

  const body = {
    url: document.getElementById('url').value,
    language: document.getElementById('language').value,
    format: document.getElementById('format').value,
    webhook: document.getElementById('webhook').value || undefined,
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
    const isActive = ['pending', 'downloading', 'transcribing'].includes(job.status);
    const timeAgo = formatTime(job.created_at);

    return `
      <div class="job-card" data-id="${job.id}">
        <div class="job-card-header">
          <span class="job-url">${escapeHtml(truncateUrl(job.url))}</span>
          <span class="job-status status-${job.status}">${job.status}</span>
        </div>
        ${isActive && job.progress > 0 ? `
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width: ${job.progress}%"></div>
          </div>
        ` : ''}
        ${job.error ? `<div class="job-error">${escapeHtml(job.error)}</div>` : ''}
        <div class="job-meta">
          ${timeAgo} &middot; ${job.language} &middot; ${job.format}
          ${job.duration ? ` &middot; ${job.duration.toFixed(1)}s` : ''}
        </div>
        <div class="job-actions">
          ${job.status === 'completed' ? `
            <button onclick="downloadFile('${job.id}', 'video')">Download Video</button>
            ${job.subtitle_path ? `<button onclick="downloadFile('${job.id}', 'subtitle')">Download Subtitles</button>` : ''}
          ` : ''}
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

// Init
initTheme();
loadVersion();
loadJobs();
pollTimer = setInterval(loadJobs, 3000);
