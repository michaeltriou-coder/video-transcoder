# Video Transcoder & Whisper Subtitles

Self-hosted service that downloads videos from any URL, extracts audio, and generates subtitles using OpenAI Whisper. Supports YouTube, news sites, and JS-rendered pages through a 2-tier download fallback system.

## Features

- **Portable Windows build**: self-contained package with a Start/Stop launcher — the end user installs nothing (see below)
- **2-tier video download**: yt-dlp → Playwright headless browser
- **Whisper transcription**: whisper.cpp (default, no Python) or OpenAI Python backend
- **On-demand speech model**: the whisper model downloads automatically on first subtitle use
- **SRT/VTT output**: Subtitle files matched to video filename
- **REST API**: Submit, list, monitor, download, retry, and delete jobs
- **Web UI**: Dark mode, status filters, progress bars, download method badges
- **Webhook notifications**: POST callback on job completion or failure
- **SQLite queue**: Persistent job storage with WAL mode, no external dependencies
- **Bot detection bypass**: Stealth plugin for protected news sites
- **Cookie consent handling**: Auto-dismisses Didomi, OneTrust, and similar popups

## Quick Start

```bash
# Clone and install
git clone <repo-url> && cd video-transcoder
npm install
npx playwright install chromium

# Configure
cp .env.example .env

# Run
npm run dev
```

Open **http://localhost:5000** — paste a video URL, pick language and format, hit Submit.

See [SETUP.md](SETUP.md) for detailed installation instructions and system requirements.

## Portable Windows Build

For a zero-install, fully portable Windows package: a single folder containing a bundled
Node.js runtime, yt-dlp, ffmpeg/ffprobe, whisper.cpp, and Chromium, plus a small
`KTV Downloader.exe` launcher with **Start / Stop / Status** controls. The end user
downloads and installs nothing — they copy the folder and run the `.exe`.

```powershell
# from the repo root, on Windows (PowerShell)
packaging\windows\build.ps1
```

This produces `dist\KTV Downloader\` (~620 MB). See
[packaging/windows/README.md](packaging/windows/README.md) for details. The whisper
speech model is **not** bundled — it downloads on demand (first subtitle job).

## How It Works

```
URL submitted via API/UI
    │
    ▼
┌─────────────────────────────┐
│  Download (2-tier fallback)  │
│  1. yt-dlp (YouTube, etc.)  │
│  2. Playwright (JS/iframes) │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Audio extraction (ffmpeg)   │
│  → 16kHz mono WAV           │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Whisper transcription       │
│  → SRT or VTT subtitles     │
└─────────────┬───────────────┘
              │
              ▼
   Files ready for download
   + optional webhook callback
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/jobs` | Create a new job |
| `GET` | `/api/jobs` | List jobs (paginated, filterable) |
| `GET` | `/api/jobs/:id` | Job detail |
| `DELETE` | `/api/jobs/:id` | Delete job and files |
| `GET` | `/api/jobs/:id/download?type=video\|subtitle` | Download output file |
| `POST` | `/api/jobs/:id/retry` | Retry a failed job |
| `GET` | `/api/version` | App version and changelog |
| `GET` | `/api/model/status` | Installed / downloading whisper models |
| `POST` | `/api/model/download` | Pre-download a whisper model (`{ "model": "base" }`) |

### Create a job

```bash
curl -X POST http://localhost:5000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "language": "en",
    "format": "srt",
    "webhook": "https://example.com/hook"
  }'
```

### Response

```json
{
  "id": "32eaf53c-343a-49e5-8372-2342d43e2fa9",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "status": "pending",
  "language": "en",
  "format": "srt",
  "progress": 0,
  "created_at": "2026-03-12T10:00:00.000Z"
}
```

### Webhook payload

On completion (success or failure), a POST is sent to the `webhook` URL:

```json
{
  "jobId": "32eaf53c-...",
  "status": "completed",
  "videoUrl": "/api/jobs/32eaf53c-.../download?type=video",
  "subtitleUrl": "/api/jobs/32eaf53c-.../download?type=subtitle",
  "duration": 245.3
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `STORAGE_PATH` | `<root>/data` | Directory for jobs and database |
| `WHISPER_BACKEND` | `cpp` | `cpp` (whisper.cpp, no Python) or `python` |
| `WHISPER_MODEL` | `base` | Whisper model: `tiny`, `base`, `small`, `medium`, `large-v3` |
| `WHISPER_CPP_PATH` | bundled | Path to whisper.cpp binary (auto-resolved from `bin/`) |
| `MAX_CONCURRENT_JOBS` | `1` | Max parallel jobs |
| `KTV_ROOT` | — | Portable root; resolves `bin/`, `browsers/`, `models/`, `data/` |
| `YTDLP_PATH` / `FFMPEG_PATH` / `FFPROBE_PATH` | bundled | Override bundled tool paths |

All variables are optional — the portable launcher sets sensible defaults and resolves
bundled binaries automatically.

## Download Tiers

| Tier | Engine | Best for | Speed |
|------|--------|----------|-------|
| 1 | **yt-dlp** | YouTube, Twitter/X, Vimeo, TikTok, 1000+ sites | Fast |
| 2 | **Playwright** | JS-rendered pages, iframe embeds, lazy-loaded players | Slower |

The system tries tier 1 first, falling back to tier 2. The download method is tracked and displayed in the UI.

## Tech Stack

- **Runtime**: Node.js
- **Web framework**: Express 5
- **Database**: SQLite via better-sqlite3 (WAL mode)
- **Video download**: yt-dlp + Playwright
- **Audio processing**: ffmpeg / ffprobe
- **Transcription**: whisper.cpp (default) or OpenAI Whisper (Python)
- **Anti-bot**: playwright-extra + stealth plugin
- **Packaging**: portable Windows bundle + WinForms launcher (`packaging/windows/`)

## License

ISC
