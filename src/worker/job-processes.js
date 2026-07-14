// Tracks the live child processes (yt-dlp / ffmpeg / whisper) spawned for each
// job, so a job can be cancelled cleanly — e.g. when it is deleted while still
// running. Without this, deleting an active job left orphaned processes holding
// file locks and could crash the worker.
const { execFile } = require('child_process');

const registry = new Map();   // jobId -> Set<ChildProcess>
const cancelled = new Set();  // jobIds that were explicitly cancelled

function killTree(proc) {
  if (!proc || proc.pid == null || proc.exitCode !== null || proc.signalCode) return;
  if (process.platform === 'win32') {
    // proc.kill() only terminates the direct process; yt-dlp spawns ffmpeg for
    // muxing, so kill the whole tree to release file handles.
    execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], () => {});
  } else {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

function register(jobId, proc) {
  if (!jobId || !proc) return;
  let set = registry.get(jobId);
  if (!set) { set = new Set(); registry.set(jobId, set); }
  set.add(proc);
  proc.on('close', () => {
    const s = registry.get(jobId);
    if (!s) return;
    s.delete(proc);
    if (s.size === 0) registry.delete(jobId);
  });
}

// Kill any running processes for a job and mark it cancelled so the worker
// stops advancing it through further phases.
function cancel(jobId) {
  if (!jobId) return;
  cancelled.add(jobId);
  const set = registry.get(jobId);
  if (set) for (const proc of set) killTree(proc);
}

function isCancelled(jobId) {
  return cancelled.has(jobId);
}

function clearCancelled(jobId) {
  cancelled.delete(jobId);
}

module.exports = { register, cancel, isCancelled, clearCancelled };
