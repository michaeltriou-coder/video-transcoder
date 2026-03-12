const { load } = require('cheerio');

const VIDEO_EXTENSIONS = /\.(mp4|webm|m3u8|mpd|ogg|mov|avi|mkv)(\?|$)/i;

async function scrapeVideoUrl(pageUrl) {
  const res = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch page: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') || '';

  // If the URL itself is a direct video file, return it
  if (contentType.startsWith('video/') || VIDEO_EXTENSIONS.test(pageUrl)) {
    return pageUrl;
  }

  const html = await res.text();
  const $ = load(html);
  const candidates = [];

  // 1. Open Graph video tags (most reliable for news sites)
  $('meta[property="og:video"]').each((_, el) => {
    const url = $(el).attr('content');
    if (url) candidates.push({ url, priority: 10, source: 'og:video' });
  });
  $('meta[property="og:video:url"]').each((_, el) => {
    const url = $(el).attr('content');
    if (url) candidates.push({ url, priority: 10, source: 'og:video:url' });
  });
  $('meta[property="og:video:secure_url"]').each((_, el) => {
    const url = $(el).attr('content');
    if (url) candidates.push({ url, priority: 11, source: 'og:video:secure_url' });
  });

  // 2. <video> and <source> tags
  $('video source').each((_, el) => {
    const url = $(el).attr('src');
    if (url) candidates.push({ url, priority: 9, source: 'video>source' });
  });
  $('video').each((_, el) => {
    const url = $(el).attr('src');
    if (url) candidates.push({ url, priority: 8, source: 'video[src]' });
  });

  // 3. JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        extractFromJsonLd(item, candidates);
      }
    } catch { /* ignore parse errors */ }
  });

  // 4. Twitter player card
  $('meta[name="twitter:player:stream"]').each((_, el) => {
    const url = $(el).attr('content');
    if (url) candidates.push({ url, priority: 7, source: 'twitter:player:stream' });
  });

  // 5. Iframe embeds (YouTube, Vimeo, etc.)
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src && isEmbedUrl(src)) {
      candidates.push({ url: normalizeEmbedUrl(src), priority: 6, source: 'iframe' });
    }
  });

  // 6. Scan for video URLs in inline scripts
  $('script:not([src])').each((_, el) => {
    const text = $(el).html() || '';
    extractUrlsFromText(text, candidates);
  });

  if (candidates.length === 0) {
    throw new Error(`No video found on page: ${pageUrl}`);
  }

  // Sort by priority (highest first), deduplicate
  candidates.sort((a, b) => b.priority - a.priority);
  const seen = new Set();
  const unique = candidates.filter(c => {
    const normalized = c.url.split('?')[0];
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  console.log(`[scraper] Found ${unique.length} video candidates from ${pageUrl}:`);
  unique.forEach(c => console.log(`  [${c.source}] ${c.url}`));

  return resolveUrl(unique[0].url, pageUrl);
}

function extractFromJsonLd(obj, candidates) {
  if (!obj || typeof obj !== 'object') return;

  if (obj['@type'] === 'VideoObject') {
    if (obj.contentUrl) {
      candidates.push({ url: obj.contentUrl, priority: 10, source: 'jsonld:contentUrl' });
    }
    if (obj.embedUrl) {
      candidates.push({ url: obj.embedUrl, priority: 8, source: 'jsonld:embedUrl' });
    }
  }

  // Recurse into arrays and nested objects
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      value.forEach(v => extractFromJsonLd(v, candidates));
    } else if (typeof value === 'object') {
      extractFromJsonLd(value, candidates);
    }
  }
}

function extractUrlsFromText(text, candidates) {
  // Match common video URL patterns in JS
  const patterns = [
    /["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd|webm)(?:\?[^"'\s]*)?)['"]/gi,
    /["'](https?:\/\/[^"'\s]*\/manifest[^"'\s]*)['"]/gi,
    /["'](https?:\/\/[^"'\s]*\/playlist\.m3u8[^"'\s]*)['"]/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      candidates.push({ url: match[1], priority: 5, source: 'inline-script' });
    }
  }
}

function isEmbedUrl(url) {
  return /youtube\.com\/embed|player\.vimeo\.com|dailymotion\.com\/embed|facebook\.com\/plugins\/video/i.test(url);
}

function normalizeEmbedUrl(url) {
  // Convert YouTube embed to watch URL (yt-dlp handles these)
  const ytMatch = url.match(/youtube\.com\/embed\/([^?&/]+)/);
  if (ytMatch) return `https://www.youtube.com/watch?v=${ytMatch[1]}`;

  const vimeoMatch = url.match(/player\.vimeo\.com\/video\/(\d+)/);
  if (vimeoMatch) return `https://vimeo.com/${vimeoMatch[1]}`;

  return url;
}

function resolveUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

module.exports = { scrapeVideoUrl };
