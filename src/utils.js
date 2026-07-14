const { execFileSync, spawn } = require('child_process');
const path = require('path');
const binaries = require('./binaries');
const { childEnv } = require('./paths');
const jobProcesses = require('./worker/job-processes');

function getVideoDuration(filePath) {
  try {
    const result = execFileSync(
      binaries.ffprobe(),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { encoding: 'utf-8', timeout: 10000, env: childEnv() }
    );
    return parseFloat(result.trim()) || 0;
  } catch {
    return 0;
  }
}

// Probe a media file's first audio stream. Returns null if ffprobe fails.
function probeAudioStream(filePath) {
  try {
    const result = execFileSync(
      binaries.ffprobe(),
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries',
       'stream=codec_name,sample_rate,channels', '-of', 'json', filePath],
      { encoding: 'utf-8', timeout: 10000, env: childEnv() }
    );
    const stream = (JSON.parse(result).streams || [])[0];
    if (!stream) return null;
    return {
      codec: stream.codec_name,
      sampleRate: parseInt(stream.sample_rate, 10) || 0,
      channels: stream.channels || 0,
    };
  } catch {
    return null;
  }
}

// True when the file is already exactly what whisper.cpp wants (16 kHz mono
// 16-bit PCM WAV), so the separate ffmpeg extract-audio step can be skipped.
function isWhisperReadyWav(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.wav') return false;
  const info = probeAudioStream(filePath);
  return !!info && info.codec === 'pcm_s16le' && info.sampleRate === 16000 && info.channels === 1;
}

function extractAudio(videoPath, audioPath, jobId) {
  return new Promise((resolve, reject) => {
    const args = ['-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', audioPath];
    const proc = spawn(binaries.ffmpeg(), args, { env: childEnv() });
    jobProcesses.register(jobId, proc);
    let stderr = '';

    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      resolve(audioPath);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });
  });
}

module.exports = { getVideoDuration, extractAudio, isWhisperReadyWav };
