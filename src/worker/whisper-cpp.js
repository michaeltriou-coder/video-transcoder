const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');

function transcribeCpp(audioPath, options = {}) {
  return new Promise((resolve, reject) => {
    const outputDir = options.outputDir || path.dirname(audioPath);
    const format = options.format || 'srt';
    const language = options.language === 'auto' ? 'en' : options.language;
    const model = config.whisperModel || 'base';

    const binaryPath = config.whisperCppPath;
    if (!binaryPath) {
      return reject(new Error('WHISPER_CPP_PATH not configured in .env'));
    }

    const baseName = path.basename(audioPath, path.extname(audioPath));
    const outputPath = path.join(outputDir, baseName);

    const args = [
      '-m', path.join(path.dirname(binaryPath), '..', 'models', `ggml-${model}.bin`),
      '-f', audioPath,
      '-l', language,
      format === 'vtt' ? '-ovtt' : '-osrt',
      '-of', outputPath,
    ];

    const proc = spawn(binaryPath, args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`whisper.cpp exited with code ${code}: ${stderr}`));
      }

      const subtitlePath = `${outputPath}.${format}`;
      if (!fs.existsSync(subtitlePath)) {
        return reject(new Error(`Subtitle file not found at ${subtitlePath}`));
      }

      resolve(subtitlePath);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start whisper.cpp: ${err.message}. Check WHISPER_CPP_PATH in .env`));
    });
  });
}

module.exports = { transcribeCpp };
