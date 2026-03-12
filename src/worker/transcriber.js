const config = require('../config');
const whisperState = require('./whisper-state');

async function transcribe(audioPath, options = {}) {
  const backend = config.whisperBackend;

  let result;
  try {
    if (backend === 'cpp') {
      const { transcribeCpp } = require('./whisper-cpp');
      result = await transcribeCpp(audioPath, options, whisperState);
    } else {
      const { transcribePython } = require('./whisper-python');
      result = await transcribePython(audioPath, options, whisperState);
    }
  } finally {
    whisperState.clear();
  }

  return result;
}

module.exports = { transcribe };
