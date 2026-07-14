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

// Send the completion/failure webhook. The job may have been deleted while it
// ran, in which case there is nothing to report.
async function finalizeWebhook(jobId) {
  const finalJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (finalJob) await sendWebhook(finalJob);
}

async function handlePhaseError(jobId, err) {
  if (err instanceof JobCancelledError || jobProcesses.isCancelled(jobId)) {
    // Job was deleted/cancelled mid-run; its row is likely already gone.
    console.log(`[${jobId}] Cancelled`);
  } else {
    console.error(`[${jobId}] Failed: ${err.message}`);
    updateJob(jobId, {
      status: 'failed',
      error: err.message,
      completed_at: new Date().toISOString(),
      status_message: null,
    });
    await finalizeWebhook(jobId);
  }
}

// Phase 1 — Download. The job row has already been claimed (status 'downloading')
// by the queue. On success, either completes the job (no subtitles) or hands it
// off to the transcription queue (status 'transcribe_pending').
async function runDownload(job) {
  let jobDir = path.join(config.storagePath, 'jobs', job.id);

  try {
    console.log(`[${job.id}] Downloading: ${job.url}`);
    const onStatus = (msg) => updateJob(job.id, { status_message: msg });
    const { path: videoPath, method: downloadMethod, moreVideos } = await download(job.url, jobDir, onStatus, job.id, job.quality);
    throwIfCancelled(job.id);
    console.log(`[${job.id}] Downloaded via: ${downloadMethod}`);

    // Rename job directory to video title
    const { newDir, dirName } = renameJobDir(jobDir, videoPath, job.id);
    jobDir = newDir;
    const newVideoPath = path.join(jobDir, path.basename(videoPath));
    const updates = { output_path: newVideoPath, progress: 50, download_method: downloadMethod, status_message: `Downloaded via ${downloadMethod}` };
    if (dirName) updates.job_dir = dirName;
    if (moreVideos) updates.more_videos = 1;

    if (job.extract_subtitles) {
      // Hand off to the (serial) transcription queue.
      updates.status = 'transcribe_pending';
      updates.status_message = 'Queued for transcription...';
      updateJob(job.id, updates);
      console.log(`[${job.id}] Queued for transcription`);
    } else {
      console.log(`[${job.id}] Skipping transcription (extract_subtitles disabled)`);
      const duration = getVideoDuration(newVideoPath);
      updateJob(job.id, {
        ...updates,
        status: 'completed',
        progress: 100,
        completed_at: new Date().toISOString(),
        duration,
        status_message: null,
      });
      console.log(`[${job.id}] Completed in ${duration.toFixed(1)}s`);
      await finalizeWebhook(job.id);
    }
  } catch (err) {
    await handlePhaseError(job.id, err);
  } finally {
    jobProcesses.clearCancelled(job.id);
  }
}

// Phase 2 — Transcribe. Runs serially (one whisper at a time). The job row has
// been claimed (status 'transcribing') by the queue; output_path points at the
// already-downloaded video/audio.
async function runTranscribe(job) {
  const videoPath = job.output_path;
  const jobDir = path.dirname(videoPath);

  try {
    // For audio-only jobs there is no video track to strip, so we go straight
    // to preparing whisper's input. If yt-dlp already handed us a 16 kHz mono
    // WAV we can feed it to whisper untouched and skip ffmpeg entirely;
    // otherwise we transcode just the audio to a 16 kHz WAV (fast — no video
    // demux, and for audio-only jobs no video was ever downloaded).
    const audioOnly = job.quality === 'audio';
    let audioPath;
    if (isWhisperReadyWav(videoPath)) {
      console.log(`[${job.id}] Downloaded audio is already whisper-ready, skipping extraction`);
      updateJob(job.id, { status_message: 'Audio ready, skipping extraction...' });
      audioPath = videoPath;
    } else {
      const msg = audioOnly ? 'Preparing audio...' : 'Extracting audio...';
      console.log(`[${job.id}] ${msg}`);
      updateJob(job.id, { status_message: msg });
      audioPath = path.join(jobDir, 'audio.wav');
      await extractAudio(videoPath, audioPath, job.id);
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
    await finalizeWebhook(job.id);
  } catch (err) {
    await handlePhaseError(job.id, err);
  } finally {
    jobProcesses.clearCancelled(job.id);
  }
}

module.exports = { runDownload, runTranscribe };
