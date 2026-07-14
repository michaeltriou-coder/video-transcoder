const path = require('path');
const fs = require('fs');

// This file lives at <APP_DIR>/src/paths.js
const appDir = path.resolve(__dirname, '..');

// Portable layout: <ROOT>/app, <ROOT>/bin, <ROOT>/browsers, <ROOT>/models, <ROOT>/data
// The launcher sets KTV_ROOT to the portable root. In dev (no KTV_ROOT) we fall
// back to the repo root so bundled dirs simply don't exist and tools come from PATH.
const portableRoot = process.env.KTV_ROOT
  ? path.resolve(process.env.KTV_ROOT)
  : appDir;

function underRoot(...p) {
  return path.join(portableRoot, ...p);
}

const binDir = process.env.KTV_BIN_DIR || underRoot('bin');
const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH || underRoot('browsers');
const modelsDir = process.env.KTV_MODELS_DIR || underRoot('models');
const dataDir = process.env.STORAGE_PATH || underRoot('data');

// Make Playwright load Chromium from the bundled browsers dir (must be set
// before the `playwright` module is required).
if (fs.existsSync(browsersDir)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;
}

// Child processes (yt-dlp, ffmpeg, whisper) should find sibling bundled tools.
function childEnv(extra = {}) {
  const prefixedPath = fs.existsSync(binDir)
    ? binDir + path.delimiter + (process.env.PATH || '')
    : (process.env.PATH || '');
  return { ...process.env, PATH: prefixedPath, ...extra };
}

module.exports = { appDir, portableRoot, binDir, browsersDir, modelsDir, dataDir, underRoot, childEnv };
