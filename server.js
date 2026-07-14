const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./src/config');
const db = require('./src/db');
const jobsRouter = require('./src/routes/jobs');
const { startWorker } = require('./src/worker/queue');
const whisperState = require('./src/worker/whisper-state');
const model = require('./src/worker/model');
const settings = require('./src/settings');
const { scanForVideos } = require('./src/worker/probe');
const { v4: uuidv4 } = require('uuid');

// Safety net: never let a stray error in a background job (worker, webhook,
// child-process callback) take down the whole server. Log and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
});

const app = express();
const pkg = require('./package.json');

const changelog = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf-8');

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/version', (req, res) => {
  res.json({ version: pkg.version, changelog });
});

app.use('/api/jobs', jobsRouter);

// Page scans run in the background so the UI never blocks on the ~30s browser
// crawl. POST starts a scan and returns a scanId; the client polls GET below.
const scans = new Map(); // scanId -> { status: 'running'|'done'|'error', videos, error }

app.post('/api/scan', (req, res) => {
  const url = req.body && req.body.url;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  try {
    new URL(url.trim());
  } catch {
    return res.status(400).json({ error: 'url must be a valid URL' });
  }

  const scanId = uuidv4();
  scans.set(scanId, { status: 'running', videos: null, error: null });
  res.json({ scanId });

  scanForVideos(url.trim())
    .then((videos) => scans.set(scanId, { status: 'done', videos, error: null }))
    .catch((err) => {
      console.error('[scan] failed:', err);
      scans.set(scanId, { status: 'error', videos: null, error: err.message || 'Scan failed' });
    })
    .finally(() => {
      // Drop the result after 5 minutes to avoid unbounded growth.
      setTimeout(() => scans.delete(scanId), 5 * 60 * 1000);
    });
});

app.get('/api/scan/:id', (req, res) => {
  const scan = scans.get(req.params.id);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });
  res.json(scan);
});

app.get('/api/whisper/status', (req, res) => {
  res.json(whisperState.getStatus());
});

app.post('/api/whisper/stop', (req, res) => {
  const stopped = whisperState.stop();
  res.json({ stopped });
});

app.get('/api/model/status', (req, res) => {
  res.json({
    ...model.getStatus(),
    backend: config.whisperBackend,
    default: config.whisperModel,
  });
});

app.post('/api/model/download', async (req, res) => {
  const name = (req.body && req.body.model) || config.whisperModel;
  try {
    const dest = await model.ensureModel(name);
    res.json({ ok: true, model: name, path: dest });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Select the active speech model used for future transcriptions. Persisted so
// it survives restarts; downloads on demand at job time if not yet installed.
app.post('/api/model/select', (req, res) => {
  const name = req.body && req.body.model;
  if (!name || !model.KNOWN_MODELS.includes(name)) {
    return res.status(400).json({ ok: false, error: `Unknown model "${name}"` });
  }
  config.whisperModel = name;
  settings.set('whisperModel', name);
  res.json({ ok: true, model: name });
});

app.post('/api/model/delete', (req, res) => {
  const name = req.body && req.body.model;
  if (!name || !model.KNOWN_MODELS.includes(name)) {
    return res.status(400).json({ ok: false, error: `Unknown model "${name}"` });
  }
  try {
    const removed = model.deleteModel(name);
    res.json({ ok: true, model: name, removed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Video Transcoder running on http://localhost:${config.port}`);
  startWorker();
});
