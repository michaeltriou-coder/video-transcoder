const path = require('path');
require('dotenv').config();

const port = parseInt(process.env.PORT, 10) || 5000;

const config = {
  port,
  storagePath: path.resolve(process.env.STORAGE_PATH || './data'),
  whisperBackend: process.env.WHISPER_BACKEND || 'python',
  whisperModel: process.env.WHISPER_MODEL || 'base',
  whisperCppPath: process.env.WHISPER_CPP_PATH || '',
  maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS, 10) || 1,
  baseUrl: process.env.BASE_URL || `http://localhost:${port}`,
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

module.exports = config;
