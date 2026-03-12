const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');

const router = express.Router();

// POST /api/jobs — create new job
router.post('/', (req, res) => {
  const { url, webhook, language, format } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  const id = uuidv4();
  const jobDir = path.join(config.storagePath, 'jobs', id);
  fs.mkdirSync(jobDir, { recursive: true });

  const stmt = db.prepare(`
    INSERT INTO jobs (id, url, language, format, webhook_url)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, url.trim(), language || 'auto', format || 'srt', webhook || null);

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

  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);

  const jobDir = path.join(config.storagePath, 'jobs', req.params.id);
  fs.rmSync(jobDir, { recursive: true, force: true });

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
    started_at = NULL, completed_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.params.id);

  const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  res.json(updated);
});

module.exports = router;
