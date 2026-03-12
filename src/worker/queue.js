const db = require('../db');
const config = require('../config');
const { processJob } = require('./processor');

let activeJobs = 0;
let pollInterval = null;

function pickNextJob() {
  return db.prepare(`
    SELECT * FROM jobs WHERE status = 'pending'
    ORDER BY created_at ASC LIMIT 1
  `).get();
}

async function tick() {
  if (activeJobs >= config.maxConcurrentJobs) return;

  const job = pickNextJob();
  if (!job) return;

  activeJobs++;
  try {
    await processJob(job);
  } finally {
    activeJobs--;
  }
}

function startWorker() {
  console.log(`Worker started (max concurrency: ${config.maxConcurrentJobs})`);
  pollInterval = setInterval(tick, 2000);
}

function stopWorker() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

module.exports = { startWorker, stopWorker };
