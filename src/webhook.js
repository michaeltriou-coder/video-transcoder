const config = require('./config');

async function sendWebhook(job) {
  if (!job.webhook_url) return;

  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const payload = {
    jobId: job.id,
    status: job.status,
    downloadUrl: `${baseUrl}/api/jobs/${job.id}/download`,
    duration: job.duration,
    subtitleUrl: job.subtitle_path
      ? `${baseUrl}/api/jobs/${job.id}/download?type=subtitle`
      : null,
  };

  try {
    const response = await fetch(job.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    console.log(`Webhook sent to ${job.webhook_url}: ${response.status}`);
  } catch (err) {
    console.error(`Webhook failed for job ${job.id}: ${err.message}`);
  }
}

module.exports = { sendWebhook };
