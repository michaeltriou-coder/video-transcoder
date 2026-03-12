const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');

chromium.use(stealth());

const VIDEO_PATTERN = /\.(mp4|webm|m3u8|mpd|mov|avi|mkv)(\?|$)/i;
const VIDEO_CONTENT_TYPES = [
  'video/',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
  'application/dash+xml',
];

// Common cookie consent button selectors
const CONSENT_SELECTORS = [
  '#didomi-notice-agree-button',
  '#onetrust-accept-btn-handler',
  '.fc-cta-consent',
  'button[id*="accept"]',
  'button[class*="accept"]',
  'button[id*="consent"]',
  'button[id*="agree"]',
  '[data-testid*="accept"]',
];

/**
 * Launch a headless browser, navigate to the page, and intercept
 * network requests to find video URLs. Also inspects the rendered DOM.
 */
async function scrapeWithBrowser(pageUrl, { timeout = 30000 } = {}) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const candidates = [];

    // Intercept network responses for video content
    page.on('response', (response) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      const isVideoType = VIDEO_CONTENT_TYPES.some(t => contentType.startsWith(t));
      const isVideoUrl = VIDEO_PATTERN.test(url);

      if (isVideoType || isVideoUrl) {
        const priority = isVideoType ? 10 : 8;
        candidates.push({ url, priority, source: 'network-intercept' });
      }
    });

    // Intercept requests to catch video fetches even before response
    page.on('request', (request) => {
      const url = request.url();
      if (VIDEO_PATTERN.test(url)) {
        candidates.push({ url, priority: 7, source: 'network-request' });
      }
    });

    console.log(`[browser-scraper] Navigating to ${pageUrl}`);

    // Use networkidle to wait for initial page load
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout }).catch(() => {});

    // Try to dismiss cookie consent dialogs
    const dismissed = await dismissConsent(page);
    if (dismissed) {
      // Wait for page to reload content after consent
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    // Scroll down to trigger lazy-loaded video players
    if (candidates.length === 0) {
      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForTimeout(2000);

      // Try scrolling to any video element
      try {
        await page.locator('video').first().scrollIntoViewIfNeeded({ timeout: 2000 });
      } catch {}

      await tryClickPlay(page);
      await page.waitForTimeout(5000);
    }

    // Inspect rendered DOM for video elements
    const domVideos = await page.evaluate(() => {
      const results = [];

      document.querySelectorAll('video source').forEach(el => {
        if (el.src) results.push({ url: el.src, source: 'dom:video>source' });
      });
      document.querySelectorAll('video').forEach(el => {
        if (el.src) results.push({ url: el.src, source: 'dom:video[src]' });
        if (el.currentSrc) results.push({ url: el.currentSrc, source: 'dom:video.currentSrc' });
      });

      document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]').forEach(el => {
        const url = el.getAttribute('content');
        if (url) results.push({ url, source: 'dom:og:video' });
      });

      // Check iframes for embedded players
      document.querySelectorAll('iframe').forEach(iframe => {
        const src = iframe.src || iframe.dataset?.src;
        if (src && /youtube|vimeo|dailymotion|brightcove|jwplatform/.test(src)) {
          results.push({ url: src, source: 'dom:iframe-embed' });
        }
      });

      return results;
    });

    domVideos.forEach(v => {
      candidates.push({ url: v.url, priority: 9, source: v.source });
    });

    if (candidates.length === 0) {
      throw new Error(`No video found on page via browser: ${pageUrl}`);
    }

    // Deduplicate and sort by priority
    candidates.sort((a, b) => b.priority - a.priority);
    const seen = new Set();
    const unique = candidates.filter(c => {
      const normalized = c.url.split('?')[0];
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

    console.log(`[browser-scraper] Found ${unique.length} video candidates:`);
    unique.forEach(c => console.log(`  [${c.source}] ${c.url}`));

    // Prefer m3u8/mpd manifests over direct mp4 (better quality selection for yt-dlp)
    const manifest = unique.find(c => /\.(m3u8|mpd)(\?|$)/i.test(c.url));
    return manifest ? manifest.url : unique[0].url;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function dismissConsent(page) {
  for (const selector of CONSENT_SELECTORS) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        console.log(`[browser-scraper] Dismissed consent dialog: ${selector}`);
        await page.waitForTimeout(500);
        return true;
      }
    } catch {
      // Selector not found, try next
    }
  }
  return false;
}

async function tryClickPlay(page) {
  const playSelectors = [
    'button[aria-label*="play" i]',
    'button[class*="play" i]',
    '[data-testid*="play" i]',
    '.vjs-big-play-button',
    '.ytp-large-play-button',
  ];

  for (const selector of playSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 300 })) {
        await btn.click();
        console.log(`[browser-scraper] Clicked play button: ${selector}`);
        return;
      }
    } catch {
      // Not found, try next
    }
  }
}

module.exports = { scrapeWithBrowser };
