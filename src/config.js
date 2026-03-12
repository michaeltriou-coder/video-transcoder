const path = require('path');
require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  storagePath: path.resolve(process.env.STORAGE_PATH || './data'),
  whisperBackend: process.env.WHISPER_BACKEND || 'python',
  whisperModel: process.env.WHISPER_MODEL || 'base',
  whisperCppPath: process.env.WHISPER_CPP_PATH || '',
  maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS, 10) || 1,
};

module.exports = config;
