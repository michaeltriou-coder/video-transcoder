const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { scrapeVideoUrl } = require('./scraper');

function ytdlp(url, outputDir) {
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

async function download(url, outputDir) {
  // Try yt-dlp first
  try {
    return await ytdlp(url, outputDir);
  } catch (ytdlpError) {
    console.log(`[downloader] yt-dlp failed, trying scraper fallback...`);

    // Fallback: scrape page for video URL
    let scrapedUrl;
    try {
      scrapedUrl = await scrapeVideoUrl(url);
    } catch (scrapeError) {
      throw new Error(`yt-dlp failed: ${ytdlpError.message}\nScraper also failed: ${scrapeError.message}`);
    }

    console.log(`[downloader] Scraped video URL: ${scrapedUrl}`);

    // Try yt-dlp with the scraped URL (handles m3u8, etc.)
    try {
      return await ytdlp(scrapedUrl, outputDir);
    } catch {
      // Last resort: direct HTTP download
      return await directDownload(scrapedUrl, outputDir);
    }
  }
}

async function directDownload(url, outputDir) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(300000),
  });

  if (!res.ok) {
    throw new Error(`Direct download failed: ${res.status} ${res.statusText}`);
  }

  // Determine filename from URL or content-disposition
  const disposition = res.headers.get('content-disposition') || '';
  const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
  let filename = filenameMatch ? filenameMatch[1].replace(/['"]/g, '') : null;

  if (!filename) {
    const urlPath = new URL(url).pathname;
    filename = path.basename(urlPath) || 'video.mp4';
  }

  const outputPath = path.join(outputDir, filename);
  const fileStream = fs.createWriteStream(outputPath);
  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(value);
    }
  } finally {
    fileStream.end();
  }

  await new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });

  return outputPath;
}

module.exports = { download };
