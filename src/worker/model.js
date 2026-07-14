const path = require('path');
const fs = require('fs');
const { modelsDir } = require('../paths');

// whisper.cpp ggml models, hosted by the upstream project on Hugging Face.
const BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const KNOWN_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v3'];

function modelPath(model) {
  return path.join(modelsDir, `ggml-${model}.bin`);
}

function isDownloaded(model) {
  const p = modelPath(model);
  return fs.existsSync(p) && fs.statSync(p).size > 0;
}

let active = null; // { model, downloaded, total }

function getStatus() {
  return {
    modelsDir,
    downloading: active,
    installed: KNOWN_MODELS.filter(isDownloaded),
  };
}

// Download ggml-<model>.bin into modelsDir if missing. onProgress(pct, downloaded, total).
async function ensureModel(model, onProgress) {
  const dest = modelPath(model);
  if (isDownloaded(model)) return dest;

  if (!KNOWN_MODELS.includes(model)) {
    // Allow it anyway (custom model name), but the URL may 404.
    console.log(`[model] "${model}" is not a known model name; attempting download regardless`);
  }

  fs.mkdirSync(modelsDir, { recursive: true });
  const url = `${BASE_URL}/ggml-${model}.bin`;
  const tmp = `${dest}.part`;

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to download model "${model}": ${res.status} ${res.statusText}`);
  }

  const total = parseInt(res.headers.get('content-length') || '0', 10);
  let downloaded = 0;
  active = { model, downloaded: 0, total };

  const fileStream = fs.createWriteStream(tmp);
  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(value);
      downloaded += value.length;
      active.downloaded = downloaded;
      if (onProgress && total) onProgress(Math.round((downloaded / total) * 100), downloaded, total);
    }
  } finally {
    fileStream.end();
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });
    active = null;
  }

  fs.renameSync(tmp, dest);
  return dest;
}

module.exports = { ensureModel, isDownloaded, getStatus, modelPath, modelsDir, KNOWN_MODELS };
