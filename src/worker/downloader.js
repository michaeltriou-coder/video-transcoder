const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { scrapeWithBrowser } = require('./scraper-browser');
const binaries = require('../binaries');
const { childEnv, binDir } = require('../paths');
const jobProcesses = require('./job-processes');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// --- Site-specific source resolvers ---------------------------------------
// Some sites (e.g. euronews) host several fixed-resolution mp4 renditions but
// only advertise the lowest one to yt-dlp's generic extractor. These resolvers
// inspect the page and return a direct URL for the best tier <= the requested
// quality, so the quality selector is actually honoured.

async function urlExists(u) {
  try {
    const res = await fetch(u, {
      headers: { 'User-Agent': UA, Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

// euronews.com: renditions live at /mp4/<TIER>/<dirs>/<TIER>_<id>.mp4 where
// TIER is SHD (~404p), HD (720p) or FHD (1080p). Heights are the tier ceilings.
const EURONEWS_TIERS = [['FHD', 1080], ['HD', 720], ['SHD', 404]];

function euronewsTierOrder(quality) {
  if (quality === 'audio') return ['SHD', 'HD', 'FHD'];
  const h = { '480': 480, '720': 720, '1080': 1080 }[quality];
  if (!h) return ['FHD', 'HD', 'SHD']; // 'best' or unknown
  const atOrBelow = EURONEWS_TIERS.filter(([, hh]) => hh <= h).map(([t]) => t);
  const above = EURONEWS_TIERS.filter(([, hh]) => hh > h).map(([t]) => t).reverse();
  return atOrBelow.length ? [...atOrBelow, ...above] : ['SHD'];
}

async function resolveEuronews(url, quality, report) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (!/(^|\.)euronews\.com$/i.test(host)) return null;

  report('Euronews: resolving best available quality...');
  let html;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    html = (await res.text()).replace(/\\\//g, '/'); // undo JSON-escaped slashes
  } catch {
    return null;
  }

  const m = html.match(
    /https?:\/\/video\.euronews\.com\/mp4\/(?:FHD|HD|SHD)\/([\d/]+)\/(?:FHD|HD|SHD)(_[^"'\s\\]+?\.mp4)/i
  );
  if (!m) return null;

  const dirs = m[1];        // e.g. 49/69/34/01
  const tail = m[2];        // e.g. _PYR_4969341_20260714151525.mp4
  const buildUrl = (tier) => `https://video.euronews.com/mp4/${tier}/${dirs}/${tier}${tail}`;

  for (const tier of euronewsTierOrder(quality)) {
    const candidate = buildUrl(tier);
    if (await urlExists(candidate)) return candidate;
  }
  return null;
}

// Map a quality selection to a yt-dlp -f format string. Returns null for
// "best" (let yt-dlp pick its default best merge).
function formatSelector(quality) {
  // Audio only: grab the best audio-only stream (no video download, no muxing).
  // Falls back to "best" if the site has no audio-only format.
  if (quality === 'audio') return 'bestaudio/best';

  const heights = { '1080': 1080, '720': 720, '480': 480 };
  const h = heights[quality];
  if (!h) return null; // 'best' or unknown
  return `bv*[height<=${h}]+ba/b[height<=${h}]/b`;
}

function ytdlp(url, outputDir, jobId, quality) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');

    const args = [
      '-o', outputTemplate,
      '--no-playlist',
      '--playlist-items', '1',
      '--ffmpeg-location', binDir,
      // YouTube (and other sites) now require a JS runtime to solve the player
      // challenge. Reuse the Node.js that is already running this app — in the
      // portable build that's the bundled runtime/node.exe (>= v22, as required).
      '--js-runtimes', `node:${process.execPath}`,
      '--print', 'after_move:filepath',
    ];

    const fmt = formatSelector(quality);
    if (fmt) args.push('-f', fmt);

    args.push(url);

    const proc = spawn(binaries.ytdlp(), args, { env: childEnv() });
    jobProcesses.register(jobId, proc);
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

async function downloadWithUrl(scrapedUrl, outputDir, jobId, quality) {
  // Try yt-dlp with the scraped URL (handles m3u8, etc.)
  try {
    return await ytdlp(scrapedUrl, outputDir, jobId, quality);
  } catch {
    // Last resort: direct HTTP download
    return await directDownload(scrapedUrl, outputDir);
  }
}

async function download(url, outputDir, onStatus, jobId, quality) {
  const report = onStatus || (() => {});

  // Tier 0: site-specific resolvers. yt-dlp's generic extractor would otherwise
  // grab a low-res rendition on some sites; resolve the best tier ourselves and
  // hand the direct URL to yt-dlp so quality selection is respected.
  try {
    const resolvedUrl = await resolveEuronews(url, quality, report);
    if (resolvedUrl) {
      report('Downloading best-quality source...');
      const filePath = await ytdlp(resolvedUrl, outputDir, jobId, 'best');
      return { path: filePath, method: 'yt-dlp' };
    }
  } catch (resolverErr) {
    console.log(`[downloader] Site resolver failed, falling back: ${resolverErr.message}`);
  }

  // Tier 1: yt-dlp (handles YouTube, Twitter, Vimeo, etc.)
  report('Downloading with yt-dlp...');
  try {
    const filePath = await ytdlp(url, outputDir, jobId, quality);
    return { path: filePath, method: 'yt-dlp' };
  } catch (ytdlpError) {
    console.log(`[downloader] yt-dlp failed, trying Playwright...`);
    report('yt-dlp failed, trying Playwright browser...');

    // Tier 2: Playwright headless browser (JS-rendered / bot-protected sites)
    let browserUrls;
    try {
      browserUrls = await scrapeWithBrowser(url);
    } catch (browserError) {
      throw new Error(
        `All download methods failed:\n` +
        `  yt-dlp: ${ytdlpError.message}\n` +
        `  Browser: ${browserError.message}`
      );
    }

    // Try each browser-found URL in order (embeds first, then streams)
    let lastBrowserError;
    for (const browserUrl of browserUrls) {
      try {
        console.log(`[downloader] Trying browser URL: ${browserUrl}`);
        report(`Trying browser URL...`);
        const filePath = await downloadWithUrl(browserUrl, outputDir, jobId, quality);
        // If the page exposed more than one candidate, hint that a Scan could
        // surface additional videos (accurate list comes from /api/scan).
        return { path: filePath, method: 'playwright', moreVideos: browserUrls.length > 1 };
      } catch (err) {
        lastBrowserError = err;
        console.log(`[downloader] Browser URL failed: ${err.message}`);
      }
    }

    throw new Error(
      `All download methods failed:\n` +
      `  yt-dlp: ${ytdlpError.message}\n` +
      `  Browser: ${lastBrowserError?.message || 'No URLs found'}`
    );
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

  // Reject HTML responses — we want video, not web pages
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('Direct download returned HTML, not video');
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
