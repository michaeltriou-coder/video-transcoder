const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const binaries = require('../binaries');
const { childEnv } = require('../paths');
const { modelPath } = require('./model');
const jobProcesses = require('./job-processes');

function transcribeCpp(audioPath, options = {}, whisperState = null) {
  return new Promise((resolve, reject) => {
    const outputDir = options.outputDir || path.dirname(audioPath);
    const format = options.format || 'srt';
    const language = options.language === 'auto' ? 'auto' : options.language;
    const model = config.whisperModel || 'base';

    const binaryPath = config.whisperCppPath || binaries.whisperCpp();
    if (!binaryPath) {
      return reject(new Error('whisper.cpp binary not found (WHISPER_CPP_PATH / bundled bin)'));
    }

    const modelBin = modelPath(model);
    if (!fs.existsSync(modelBin)) {
      return reject(new Error(`Speech model not found: ${modelBin}. Enable subtitles to trigger the model download.`));
    }

    const baseName = path.basename(audioPath, path.extname(audioPath));
    const outputPath = path.join(outputDir, baseName);

    const args = [
      '-m', modelBin,
      '-f', audioPath,
      '-l', language,
      format === 'vtt' ? '-ovtt' : '-osrt',
      '-of', outputPath,
    ];

    const proc = spawn(binaryPath, args, { env: childEnv() });
    jobProcesses.register(options.jobId, proc);
    if (whisperState) whisperState.setActive(proc, options.jobId);
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
