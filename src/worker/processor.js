const path = require('path');
const fs = require('fs');
const db = require('../db');
const { download } = require('./downloader');
const { transcribe } = require('./transcriber');
const { getVideoDuration, extractAudio } = require('../utils');
const { sendWebhook } = require('../webhook');
const config = require('../config');

function updateJob(id, fields) {
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const values = Object.values(fields);
  db.prepare(`UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
}

async function processJob(job) {
  const jobDir = path.join(config.storagePath, 'jobs', job.id);

  try {
    // Phase 1: Download
    updateJob(job.id, { status: 'downloading', started_at: new Date().toISOString(), status_message: 'Starting download...' });
    console.log(`[${job.id}] Downloading: ${job.url}`);
    const onStatus = (msg) => updateJob(job.id, { status_message: msg });
    const { path: videoPath, method: downloadMethod } = await download(job.url, jobDir, onStatus);
    console.log(`[${job.id}] Downloaded via: ${downloadMethod}`);
    updateJob(job.id, { output_path: videoPath, progress: 50, download_method: downloadMethod, status_message: `Downloaded via ${downloadMethod}` });

    // Phase 2: Transcribe (if not disabled)
    updateJob(job.id, { status: 'transcribing', status_message: 'Extracting audio...' });
    console.log(`[${job.id}] Extracting audio...`);
    const audioPath = path.join(jobDir, 'audio.wav');
    await extractAudio(videoPath, audioPath);

    updateJob(job.id, { status_message: 'Transcribing with whisper...', progress: 60 });
    console.log(`[${job.id}] Transcribing...`);
    let subtitlePath = await transcribe(audioPath, {
      language: job.language,
      format: job.format,
      outputDir: jobDir,
      jobId: job.id,
    });

    updateJob(job.id, { status_message: 'Finalizing subtitles...', progress: 90 });

    // Rename subtitle to match video filename
    const videoBaseName = path.basename(videoPath, path.extname(videoPath));
    const finalSubPath = path.join(jobDir, `${videoBaseName}.${job.format}`);
    if (subtitlePath !== finalSubPath) {
      fs.renameSync(subtitlePath, finalSubPath);
      subtitlePath = finalSubPath;
    }

    const duration = getVideoDuration(videoPath);

    updateJob(job.id, {
      status: 'completed',
      subtitle_path: subtitlePath,
      progress: 100,
      completed_at: new Date().toISOString(),
      duration,
      status_message: null,
    });

    console.log(`[${job.id}] Completed in ${duration.toFixed(1)}s`);
  } catch (err) {
    console.error(`[${job.id}] Failed: ${err.message}`);
    updateJob(job.id, {
      status: 'failed',
      error: err.message,
      completed_at: new Date().toISOString(),
      status_message: null,
    });
  }

  // Send webhook regardless of success/failure
  const finalJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id);
  await sendWebhook(finalJob);
}

module.exports = { processJob };
