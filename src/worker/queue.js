const db = require('../db');
const config = require('../config');
const { runDownload, runTranscribe } = require('./processor');

let activeDownloads = 0;
let activeTranscriptions = 0;
let pollInterval = null;

// Atomically claim the oldest pending job for downloading. The status flip runs
// synchronously (better-sqlite3), so a job can't be picked twice across ticks.
function claimDownload() {
  const job = db.prepare(`
    SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1
  `).get();
  if (!job) return null;
  db.prepare(`
    UPDATE jobs SET status = 'downloading',
      started_at = COALESCE(started_at, datetime('now')),
      status_message = 'Starting download...',
      updated_at = datetime('now')
    WHERE id = ?
  `).run(job.id);
  return job;
}

function claimTranscription() {
  const job = db.prepare(`
    SELECT * FROM jobs WHERE status = 'transcribe_pending' ORDER BY created_at ASC LIMIT 1
  `).get();
  if (!job) return null;
  db.prepare(`
    UPDATE jobs SET status = 'transcribing',
      status_message = 'Preparing transcription...',
      updated_at = datetime('now')
    WHERE id = ?
  `).run(job.id);
  return job;
}

function tick() {
  // Fill the download pool (network-bound, parallel).
  while (activeDownloads < config.maxConcurrentDownloads) {
    const job = claimDownload();
    if (!job) break;
    activeDownloads++;
    runDownload(job)
      .catch((err) => console.error(`[worker] download crashed for ${job.id}:`, err))
      .finally(() => { activeDownloads--; });
  }

  // Fill the transcription pool (CPU-bound, serial by default).
  while (activeTranscriptions < config.maxConcurrentTranscriptions) {
    const job = claimTranscription();
    if (!job) break;
    activeTranscriptions++;
    runTranscribe(job)
      .catch((err) => console.error(`[worker] transcription crashed for ${job.id}:`, err))
      .finally(() => { activeTranscriptions--; });
  }
}

// Reset any jobs left mid-flight by a previous run (e.g. a crash/restart) so
// they get picked up again instead of being stuck.
function recoverStuckJobs() {
  db.prepare(`UPDATE jobs SET status = 'pending' WHERE status = 'downloading'`).run();
  db.prepare(`UPDATE jobs SET status = 'transcribe_pending' WHERE status = 'transcribing'`).run();
}

function startWorker() {
  recoverStuckJobs();
  console.log(`Worker started (downloads: ${config.maxConcurrentDownloads}, transcriptions: ${config.maxConcurrentTranscriptions})`);
  pollInterval = setInterval(tick, 2000);
}

function stopWorker() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

module.exports = { startWorker, stopWorker };
