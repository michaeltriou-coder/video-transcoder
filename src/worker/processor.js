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

function sanitizeDirName(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')  // Remove filesystem-unsafe chars
    .replace(/\s+/g, ' ')                     // Collapse whitespace
    .trim()
    .substring(0, 100);                       // Truncate to 100 chars
}

function renameJobDir(oldDir, videoPath, jobId) {
  const videoTitle = path.basename(videoPath, path.extname(videoPath));
  const sanitized = sanitizeDirName(videoTitle);
  if (!sanitized) return { newDir: oldDir, dirName: null };

  const shortId = jobId.substring(0, 6);
  const dirName = `${sanitized}_${shortId}`;
  const newDir = path.join(path.dirname(oldDir), dirName);

  try {
    fs.renameSync(oldDir, newDir);
    return { newDir, dirName };
  } catch (err) {
    console.log(`[${jobId}] Could not rename job dir: ${err.message}`);
    return { newDir: oldDir, dirName: null };
  }
}

async function processJob(job) {
  let jobDir = path.join(config.storagePath, 'jobs', job.id);

  try {
    // Phase 1: Download
    updateJob(job.id, { status: 'downloading', started_at: new Date().toISOString(), status_message: 'Starting download...' });
    console.log(`[${job.id}] Downloading: ${job.url}`);
    const onStatus = (msg) => updateJob(job.id, { status_message: msg });
    const { path: videoPath, method: downloadMethod } = await download(job.url, jobDir, onStatus);
    console.log(`[${job.id}] Downloaded via: ${downloadMethod}`);

    // Rename job directory to video title
    const { newDir, dirName } = renameJobDir(jobDir, videoPath, job.id);
    jobDir = newDir;
    const newVideoPath = path.join(jobDir, path.basename(videoPath));
    const updates = { output_path: newVideoPath, progress: 50, download_method: downloadMethod, status_message: `Downloaded via ${downloadMethod}` };
    if (dirName) updates.job_dir = dirName;
    updateJob(job.id, updates);

    // Phase 2: Transcribe (only if extract_subtitles is enabled)
    let subtitlePath = null;
    if (job.extract_subtitles) {
      updateJob(job.id, { status: 'transcribing', status_message: 'Extracting audio...' });
      console.log(`[${job.id}] Extracting audio...`);
      const audioPath = path.join(jobDir, 'audio.wav');
      await extractAudio(newVideoPath, audioPath);

      updateJob(job.id, { status_message: 'Transcribing with whisper...', progress: 60 });
      console.log(`[${job.id}] Transcribing...`);
      subtitlePath = await transcribe(audioPath, {
        language: job.language,
        format: job.format,
        outputDir: jobDir,
        jobId: job.id,
      });

      updateJob(job.id, { status_message: 'Finalizing subtitles...', progress: 90 });

      // Rename subtitle to match video filename
      const videoBaseName = path.basename(newVideoPath, path.extname(newVideoPath));
      const finalSubPath = path.join(jobDir, `${videoBaseName}.${job.format}`);
      if (subtitlePath !== finalSubPath) {
        fs.renameSync(subtitlePath, finalSubPath);
        subtitlePath = finalSubPath;
      }
    } else {
      console.log(`[${job.id}] Skipping transcription (extract_subtitles disabled)`);
    }

    const duration = getVideoDuration(newVideoPath);

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
