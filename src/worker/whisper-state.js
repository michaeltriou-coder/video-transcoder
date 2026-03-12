let activeProcess = null;
let activeJobId = null;

function setActive(proc, jobId) {
  activeProcess = proc;
  activeJobId = jobId;
}

function clear() {
  activeProcess = null;
  activeJobId = null;
}

function getStatus() {
  return {
    running: activeProcess !== null,
    jobId: activeJobId,
  };
}

function stop() {
  if (!activeProcess) return false;
  activeProcess.kill('SIGTERM');
  return true;
}

module.exports = { setActive, clear, getStatus, stop };
