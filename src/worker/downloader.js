const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function download(url, outputDir) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');

    const args = [
      '-o', outputTemplate,
      '--no-playlist',
      '--print', 'after_move:filepath',
      url,
    ];

    const proc = spawn('yt-dlp', args);
    let outputPath = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) outputPath = line;
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      const progressMatch = data.toString().match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        proc.emit('progress', parseFloat(progressMatch[1]));
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
      }

      // Find downloaded file if --print didn't capture it
      if (!outputPath || !fs.existsSync(outputPath)) {
        const files = fs.readdirSync(outputDir)
          .filter(f => !f.endsWith('.part') && !f.endsWith('.ytdl'))
          .map(f => path.join(outputDir, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        outputPath = files[0] || '';
      }

      if (!outputPath || !fs.existsSync(outputPath)) {
        return reject(new Error('Download completed but output file not found'));
      }

      resolve(outputPath);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });
  });
}

module.exports = { download };
