const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');

function transcribePython(audioPath, options = {}) {
  return new Promise((resolve, reject) => {
    const outputDir = options.outputDir || path.dirname(audioPath);
    const format = options.format || 'srt';
    const language = options.language === 'auto' ? [] : ['--language', options.language];
    const model = config.whisperModel || 'base';

    const args = [
      audioPath,
      '--model', model,
      '--output_dir', outputDir,
      '--output_format', format,
      ...language,
    ];

    const whisperBin = process.env.WHISPER_BIN || 'whisper';
    const proc = spawn(whisperBin, args, {
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
    });
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`whisper exited with code ${code}: ${stderr}`));
      }

      // whisper outputs: audio.srt (or .vtt) in the output dir
      const baseName = path.basename(audioPath, path.extname(audioPath));
      const subtitlePath = path.join(outputDir, `${baseName}.${format}`);

      if (!fs.existsSync(subtitlePath)) {
        return reject(new Error(`Subtitle file not found at ${subtitlePath}`));
      }

      resolve(subtitlePath);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start whisper: ${err.message}. Is openai-whisper installed? (pip install openai-whisper)`));
    });
  });
}

module.exports = { transcribePython };
