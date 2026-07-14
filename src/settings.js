const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

// Tiny JSON-backed settings store persisted under the data dir, so runtime
// choices (e.g. the selected speech model) survive restarts of the portable app.
const file = path.join(dataDir, 'settings.json');

function read() {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function write(obj) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function get(key) {
  return read()[key];
}

function set(key, value) {
  const s = read();
  s[key] = value;
  write(s);
  return value;
}

module.exports = { get, set };
