const { spawn } = require('child_process');
const path = require('path');
const binaries = require('../binaries');
const { childEnv } = require('../paths');
const { findVideoCandidates } = require('./scraper-browser');

const DIRECT_MEDIA_PATTERN = /\.(mp4|webm|m3u8|mpd|mov|avi|mkv|m4v|ts)(\?|$)/i;
const FFPROBE_TIMEOUT_MS = 25000;
// yt-dlp probes embeds/pages; non-video iframes just time out, so keep it tight.
const YTDLP_TIMEOUT_MS = 15000;

// Run a child process, collect stdout, and kill it after a timeout. Resolves
// with { code, stdout } — never rejects (a failed probe is just "not a video").
function runWithTimeout(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = '';
    let done = false;
    let proc;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    const timer = setTimeout(() => {
      try { proc && proc.kill('SIGKILL'); } catch {}
      finish(-1);
    }, timeoutMs);
    try {
      proc = spawn(bin, args, { env: childEnv() });
    } catch {
      return finish(-1);
    }
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => finish(code));
    proc.on('error', () => finish(-1));
  });
}

function filenameFromUrl(url) {
  try {
    const base = path.basename(new URL(url).pathname);
    return decodeURIComponent(base) || url;
  } catch {
    return url;
  }
}

async function headSizeMB(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    // With a range request the total size is in Content-Range: "bytes 0-0/12345".
    const cr = res.headers.get('content-range');
    if (cr) {
      const total = parseInt(cr.split('/')[1], 10);
      if (total > 0) return Math.round(total / (1024 * 1024));
    }
    const cl = res.headers.get('content-length');
    if (cl) {
      const n = parseInt(cl, 10);
      if (n > 1) return Math.round(n / (1024 * 1024));
    }
  } catch {}
  return null;
}

// Probe a direct media URL with ffprobe. Returns metadata or null if it isn't
// a readable media file.
async function probeDirect(url, source) {
  const { code, stdout } = await runWithTimeout(
    binaries.ffprobe(),
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', url],
    FFPROBE_TIMEOUT_MS
  );
  if (code !== 0 || !stdout) return null;

  let data;
  try { data = JSON.parse(stdout); } catch { return null; }
  const streams = data.streams || [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  if (!video && !audio) return null;

  const duration = parseFloat((data.format && data.format.duration) || (video && video.duration) || 0) || null;
  let sizeMB = null;
  if (data.format && data.format.size) sizeMB = Math.round(parseInt(data.format.size, 10) / (1024 * 1024));
  if (!sizeMB) sizeMB = await headSizeMB(url);

  return {
    url,
    source,
    kind: video ? 'video' : 'audio',
    label: filenameFromUrl(url),
    width: video ? video.width || null : null,
    height: video ? video.height || null : null,
    durationSec: duration,
    sizeMB,
  };
}

// Probe a page/embed URL with yt-dlp. Returns metadata or null if yt-dlp can't
// extract a playable video (e.g. an interactive graphic iframe).
async function probeYtdlp(url, source) {
  const { code, stdout } = await runWithTimeout(
    binaries.ytdlp(),
    [
      '-J',
      '--no-playlist',
      '--no-warnings',
      '--socket-timeout', '10',
      '--js-runtimes', `node:${process.execPath}`,
      url,
    ],
    YTDLP_TIMEOUT_MS
  );
  if (code !== 0 || !stdout) return null;

  let info;
  try { info = JSON.parse(stdout); } catch { return null; }
  if (info._type === 'playlist' && Array.isArray(info.entries) && info.entries.length) {
    info = info.entries[0];
  }
  const hasVideo = info && (Array.isArray(info.formats) ? info.formats.length : info.url);
  if (!hasVideo) return null;

  const size = info.filesize || info.filesize_approx || null;
  return {
    url,
    source,
    kind: 'embed',
    label: info.title || filenameFromUrl(url),
    width: info.width || null,
    height: info.height || null,
    durationSec: info.duration || null,
    sizeMB: size ? Math.round(size / (1024 * 1024)) : null,
  };
}

function verifyCandidate(c) {
  if (DIRECT_MEDIA_PATTERN.test(c.url)) return probeDirect(c.url, c.source);
  return probeYtdlp(c.url, c.source);
}

/**
 * Scan a page for downloadable videos. Uses the Playwright scraper to gather
 * candidates, verifies each is actually a playable video, and returns their
 * metadata. Falls back to probing the page URL itself if the scraper finds
 * nothing (e.g. a direct video URL was submitted).
 */
async function scanForVideos(pageUrl) {
  let candidates = [];
  try {
    candidates = await findVideoCandidates(pageUrl);
  } catch (err) {
    console.log(`[scan] scraper found no candidates: ${err.message}`);
  }

  let videos = (await Promise.all(candidates.map(verifyCandidate))).filter(Boolean);

  if (videos.length === 0) {
    console.log('[scan] no verified candidates; probing page URL directly');
    const direct = DIRECT_MEDIA_PATTERN.test(pageUrl)
      ? await probeDirect(pageUrl, 'direct-url')
      : await probeYtdlp(pageUrl, 'page');
    if (direct) videos = [direct];
  }

  // Deduplicate by URL (ignoring query string).
  const seen = new Set();
  const unique = videos.filter((v) => {
    const key = v.url.split('?')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[scan] ${unique.length} verified video(s) on ${pageUrl}`);
  return unique;
}

module.exports = { scanForVideos };
