# Changelog

## v0.3.5 — 2026-03-13

### Added
- "Extract Subtitles" checkbox in submit form — disabled by default, Whisper only runs when enabled
- Human-readable job directories — folders named after video title (e.g. `Me at the zoo_dc919f`) instead of UUIDs

### Changed
- Jobs without subtitle extraction skip audio extraction and Whisper entirely, completing immediately after download
- `job_dir` column added to database to track renamed folder paths

## v0.3.4 — 2026-03-13

### Removed
- Cheerio HTML scraper (Tier 2) — never succeeded in practice since modern sites load videos via JS. Download chain simplified to 2 tiers: yt-dlp → Playwright

### Fixed
- Non-video iframes (Google IMA ads, consent dialogs, analytics) no longer detected as video embeds — caused HTML files to be downloaded instead of videos (e.g. Sky News)
- `directDownload` now rejects HTML responses, preventing HTML pages from being saved as "video" files

## v0.3.3 — 2026-03-13

### Fixed
- Browser scraper now prefers iframe embed URLs over raw stream URLs (m3u8/mp4), letting yt-dlp handle embedded videos natively (e.g. Dailymotion on Euronews)
- Removed hardcoded platform list from iframe detection — now uses general heuristics (`/embed/`, `/player/`, `/video/` patterns + cross-origin size check)
- Cheerio scraper iframe detection also generalized (same pattern-based approach)

### Changed
- Browser scraper returns ordered list of candidate URLs (embeds first, then manifests, then others)
- Downloader tries each browser-found URL in sequence with automatic fallback

## v0.3.2 — 2026-03-12

### Added
- Detailed job status messages on each card (e.g. "Downloading with yt-dlp...", "Extracting audio...", "Transcribing with whisper...")
- Elapsed time counter on active job cards
- Stop Whisper button during transcription phase
- Download tier fallback reporting in real-time (shows which tier is being tried)
- Whisper process state tracking (`whisper-state.js`) for stop functionality
- `/api/whisper/status` and `/api/whisper/stop` endpoints

### Changed
- Default theme switched to dark mode
- Progress bar now has finer granularity: 0% → 50% (downloaded) → 60% (transcribing) → 90% (finalizing) → 100%

## v0.3.1 — 2026-03-12

### Added
- Playwright headless browser as 3rd-tier fallback scraper (yt-dlp → Cheerio → Playwright)
- Network interception captures video URLs from JS-rendered pages
- DOM inspection for dynamically loaded video elements, iframes, and og:video meta
- Cookie consent auto-dismissal (Didomi, OneTrust, etc.)
- Scroll-to-view and play button click for lazy-loaded video players
- Stealth plugin (`playwright-extra` + `puppeteer-extra-plugin-stealth`) for bot-protected sites
- Download method badge in job UI (yt-dlp / cheerio / playwright)
- `download_method` column in jobs database

### Fixed
- yt-dlp downloading multiple videos on sites with embedded playlists (`--playlist-items 1`)

## v0.2.0 — 2026-03-12
- Video scraper fallback when yt-dlp fails (news sites support)
- Scrapes og:video, video/source tags, JSON-LD, Twitter cards, iframe embeds, inline script URLs
- Direct HTTP download as last resort
- Subtitle files now match video filename (e.g. `video-title.srt` instead of `audio.srt`)
- Tested: Al Jazeera, AP News, YouTube, YouTube Shorts

## v0.1.0 — 2026-03-12
- Initial release
- Video download via yt-dlp
- Audio extraction via ffmpeg
- Whisper transcription (Python + cpp backends, pluggable)
- SRT/VTT subtitle generation
- REST API: submit, list, detail, delete, download, retry jobs
- SQLite-backed persistent job queue
- Web UI with dark mode toggle
- Webhook notifications on job completion/failure
- Configurable storage path and concurrency
