const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./src/config');
const db = require('./src/db');
const jobsRouter = require('./src/routes/jobs');
const { startWorker } = require('./src/worker/queue');
const whisperState = require('./src/worker/whisper-state');

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

app.get('/api/whisper/status', (req, res) => {
  res.json(whisperState.getStatus());
});

app.post('/api/whisper/stop', (req, res) => {
  const stopped = whisperState.stop();
  res.json({ stopped });
});

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Video Transcoder running on http://localhost:${config.port}`);
  startWorker();
});
