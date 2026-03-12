const config = require('../config');

async function transcribe(audioPath, options = {}) {
  const backend = config.whisperBackend;

  if (backend === 'cpp') {
    const { transcribeCpp } = require('./whisper-cpp');
    return transcribeCpp(audioPath, options);
  }

  const { transcribePython } = require('./whisper-python');
  return transcribePython(audioPath, options);
}

module.exports = { transcribe };
