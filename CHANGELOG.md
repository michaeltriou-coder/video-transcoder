# Changelog

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
