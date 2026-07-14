const path = require('path');
require('dotenv').config();

const paths = require('./paths');
const binaries = require('./binaries');
const settings = require('./settings');

const port = parseInt(process.env.PORT, 10) || 5000;

const config = {
  port,
  storagePath: path.resolve(process.env.STORAGE_PATH || paths.dataDir),
  whisperBackend: process.env.WHISPER_BACKEND || 'cpp',
  // Persisted UI selection wins, then env override, then the built-in default.
  whisperModel: settings.get('whisperModel') || process.env.WHISPER_MODEL || 'base',
  whisperCppPath: process.env.WHISPER_CPP_PATH || binaries.whisperCpp(),
  // Downloads are network-bound and run in parallel; transcription is CPU-bound
  // (whisper.cpp saturates all cores) so it stays serial — one at a time.
  maxConcurrentDownloads: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS, 10) || 3,
  maxConcurrentTranscriptions: parseInt(process.env.MAX_CONCURRENT_TRANSCRIPTIONS, 10) || 1,
  baseUrl: process.env.BASE_URL || `http://localhost:${port}`,
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

module.exports = config;
