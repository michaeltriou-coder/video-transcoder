const { execSync } = require('child_process');

function getVideoDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    return parseFloat(result.trim()) || 0;
  } catch {
    return 0;
  }
}

function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const args = ['-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', audioPath];
    const proc = spawn('ffmpeg', args);
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

module.exports = { getVideoDuration, extractAudio };
