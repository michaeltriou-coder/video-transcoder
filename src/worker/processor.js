const path = require('path');
const fs = require('fs');
const db = require('../db');
const { download } = require('./downloader');
const { transcribe } = require('./transcriber');
const { getVideoDuration, extractAudio, isWhisperReadyWav } = require('../utils');
const { sendWebhook } = require('../webhook');
const { ensureModel } = require('./model');
const jobProcesses = require('./job-processes');
const config = require('../config');

class JobCancelledError extends Error {
  constructor() {
    super('Job cancelled');
    this.name = 'JobCancelledError';
  }
}

function throwIfCancelled(jobId) {
  if (jobProcesses.isCancelled(jobId)) throw new JobCancelledError();
}

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
    const { path: videoPath, method: downloadMethod } = await download(job.url, jobDir, onStatus, job.id, job.quality);
    throwIfCancelled(job.id);
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
      updateJob(job.id, { status: 'transcribing' });

      // For audio-only jobs there is no video track to strip, so we go straight
      // to preparing whisper's input. If yt-dlp already handed us a 16 kHz mono
      // WAV we can feed it to whisper untouched and skip ffmpeg entirely;
      // otherwise we transcode just the audio to a 16 kHz WAV (fast — no video
      // demux, and for audio-only jobs no video was ever downloaded).
      const audioOnly = job.quality === 'audio';
      let audioPath;
      if (isWhisperReadyWav(newVideoPath)) {
        console.log(`[${job.id}] Downloaded audio is already whisper-ready, skipping extraction`);
        updateJob(job.id, { status_message: 'Audio ready, skipping extraction...' });
        audioPath = newVideoPath;
      } else {
        const msg = audioOnly ? 'Preparing audio...' : 'Extracting audio...';
        console.log(`[${job.id}] ${msg}`);
        updateJob(job.id, { status_message: msg });
        audioPath = path.join(jobDir, 'audio.wav');
        await extractAudio(newVideoPath, audioPath, job.id);
      }
      throwIfCancelled(job.id);

      // Ensure the speech model is present (downloads on first use).
      if (config.whisperBackend === 'cpp') {
        const model = config.whisperModel || 'base';
        updateJob(job.id, { status_message: `Preparing speech model (${model})...` });
        await ensureModel(model, (pct) => {
          updateJob(job.id, { status_message: `Downloading speech model (${model}) ${pct}%...` });
        });
      }

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
    if (err instanceof JobCancelledError || jobProcesses.isCancelled(job.id)) {
      // Job was deleted/cancelled mid-run; its row is likely already gone.
      console.log(`[${job.id}] Cancelled`);
    } else {
      console.error(`[${job.id}] Failed: ${err.message}`);
      updateJob(job.id, {
        status: 'failed',
        error: err.message,
        completed_at: new Date().toISOString(),
        status_message: null,
      });
    }
  } finally {
    jobProcesses.clearCancelled(job.id);
  }

  // Send webhook regardless of success/failure — but the job may have been
  // deleted while it ran, in which case there is nothing to report.
  const finalJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id);
  if (finalJob) await sendWebhook(finalJob);
}

module.exports = { processJob };
