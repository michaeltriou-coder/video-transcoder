const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const jobProcesses = require('../worker/job-processes');

const router = express.Router();

// Remove a directory, tolerating Windows file locks that linger briefly after
// a child process is killed. Retries a few times in the background.
function removeDirWithRetry(dir, attempt = 0) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    if (attempt >= 5) {
      console.error(`[jobs] Could not remove ${dir} after retries: ${err.message}`);
      return;
    }
    setTimeout(() => removeDirWithRetry(dir, attempt + 1), 500);
  }
}

const VALID_FORMATS = ['srt', 'vtt'];
const VALID_QUALITIES = ['best', '1080', '720', '480', 'audio'];
const VALID_LANGUAGES = [
  'auto', 'af', 'am', 'ar', 'as', 'az', 'ba', 'be', 'bg', 'bn', 'bo', 'br',
  'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fa',
  'fi', 'fo', 'fr', 'gl', 'gu', 'ha', 'haw', 'he', 'hi', 'hr', 'ht', 'hu',
  'hy', 'id', 'is', 'it', 'ja', 'jw', 'ka', 'kk', 'km', 'kn', 'ko', 'la',
  'lb', 'ln', 'lo', 'lt', 'lv', 'mg', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms',
  'mt', 'my', 'ne', 'nl', 'nn', 'no', 'oc', 'pa', 'pl', 'ps', 'pt', 'ro',
  'ru', 'sa', 'sd', 'si', 'sk', 'sl', 'sn', 'so', 'sq', 'sr', 'su', 'sv',
  'sw', 'ta', 'te', 'tg', 'th', 'tk', 'tl', 'tr', 'tt', 'uk', 'ur', 'uz',
  'vi', 'yo', 'zh', 'yue',
];

// POST /api/jobs — create new job
router.post('/', (req, res) => {
  const { url, webhook, language, format, quality, extract_subtitles } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    new URL(url.trim());
  } catch {
    return res.status(400).json({ error: 'url must be a valid URL' });
  }

  const fmt = format || 'srt';
  if (!VALID_FORMATS.includes(fmt)) {
    return res.status(400).json({ error: `format must be one of: ${VALID_FORMATS.join(', ')}` });
  }

  const lang = language || 'auto';
  if (!VALID_LANGUAGES.includes(lang)) {
    return res.status(400).json({ error: `language must be one of: auto, en, el, ... (Whisper language codes)` });
  }

  const qual = quality || '1080';
  if (!VALID_QUALITIES.includes(qual)) {
    return res.status(400).json({ error: `quality must be one of: ${VALID_QUALITIES.join(', ')}` });
  }

  const id = uuidv4();
  const jobDir = path.join(config.storagePath, 'jobs', id);
  fs.mkdirSync(jobDir, { recursive: true });

  const extractSubs = extract_subtitles ? 1 : 0;

  const stmt = db.prepare(`
    INSERT INTO jobs (id, url, language, format, quality, webhook_url, extract_subtitles)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, url.trim(), lang, fmt, qual, webhook || null, extractSubs);

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  res.status(201).json(job);
});

// GET /api/jobs — list jobs with pagination & filtering
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const status = req.query.status;

  let where = '';
  const params = [];
  if (status) {
    where = 'WHERE status = ?';
    params.push(status);
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM jobs ${where}`).get(...params).count;
  const jobs = db.prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  res.json({ jobs, total, page, limit });
});

// GET /api/jobs/:id — job detail
router.get('/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// DELETE /api/jobs/:id — cancel/remove job
router.delete('/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // If the job is still running, kill its child processes (yt-dlp / ffmpeg /
  // whisper) first so they stop writing and release their file handles.
  jobProcesses.cancel(req.params.id);

  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);

  const dirName = job.job_dir || req.params.id;
  const jobDir = path.join(config.storagePath, 'jobs', dirName);
  removeDirWithRetry(jobDir);

  res.json({ message: 'Job deleted' });
});

// GET /api/jobs/:id/download — download output file
router.get('/:id/download', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const type = req.query.type || 'video';
  const filePath = type === 'subtitle' ? job.subtitle_path : job.output_path;

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not available' });
  }

  res.download(filePath);
});

// POST /api/jobs/:id/retry — retry failed job
router.post('/:id/retry', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'failed') {
    return res.status(400).json({ error: 'Only failed jobs can be retried' });
  }

  db.prepare(`
    UPDATE jobs SET status = 'pending', error = NULL, progress = 0,
    status_message = NULL, started_at = NULL, completed_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.params.id);

  const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  res.json(updated);
});

module.exports = router;
