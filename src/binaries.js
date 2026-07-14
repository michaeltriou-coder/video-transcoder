const path = require('path');
const fs = require('fs');
const { binDir } = require('./paths');

// Resolve a bundled CLI tool. Priority:
//   1. Explicit env var pointing at an existing file
//   2. Bundled bin/ directory (portable build)
//   3. Bare name, relying on PATH (dev machines)
function resolve(envVar, exeName, bareFallback) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const bundled = path.join(binDir, exeName);
  if (fs.existsSync(bundled)) return bundled;
  return bareFallback;
}

module.exports = {
  binDir,
  ytdlp: () => resolve('YTDLP_PATH', 'yt-dlp.exe', 'yt-dlp'),
  ffmpeg: () => resolve('FFMPEG_PATH', 'ffmpeg.exe', 'ffmpeg'),
  ffprobe: () => resolve('FFPROBE_PATH', 'ffprobe.exe', 'ffprobe'),
  whisperCpp: () => resolve('WHISPER_CPP_PATH', 'whisper-cli.exe', 'whisper-cli'),
};
