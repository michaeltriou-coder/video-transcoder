# Architecture

## Overview

Video Transcoder is a single-process Node.js service with an embedded SQLite database. There are no external queues, caches, or microservices — everything runs in one process.

```
┌──────────────────────────────────────────────────────┐
│  Express Server (server.js)                          │
│  ├── Static files (public/)                          │
│  ├── REST API (src/routes/jobs.js)                   │
│  └── Worker thread (src/worker/queue.js)             │
│       └── Processor (src/worker/processor.js)        │
│            ├── Downloader (2 tiers)                  │
│            ├── Audio extractor (ffmpeg)              │
│            └── Transcriber (Whisper)                 │
├──────────────────────────────────────────────────────┤
│  SQLite Database (better-sqlite3, WAL mode)          │
└──────────────────────────────────────────────────────┘
```

## Layers

### 1. HTTP Layer

| File | Role |
|------|------|
| `server.js` | Express app, mounts routes, starts worker |
| `src/routes/jobs.js` | CRUD endpoints for jobs |
| `public/` | Static web UI (HTML, CSS, JS) |

### 2. Data Layer

| File | Role |
|------|------|
| `src/db.js` | SQLite connection, schema, migrations |
| `src/config.js` | Environment config from `.env` |

### 3. Worker Layer

| File | Role |
|------|------|
| `src/worker/queue.js` | Polls DB every 2s for pending jobs, respects concurrency limit |
| `src/worker/processor.js` | Orchestrates download → extract → transcribe pipeline |
| `src/worker/downloader.js` | 2-tier download chain, returns `{ path, method }` |
| `src/worker/scraper-browser.js` | Tier 2: Playwright headless browser scraper |
| `src/worker/transcriber.js` | Router — dispatches to Python or C++ backend |
| `src/worker/whisper-python.js` | Spawns `whisper` CLI |
| `src/worker/whisper-cpp.js` | Spawns whisper.cpp binary |
| `src/worker/whisper-state.js` | Tracks active Whisper process for stop functionality |

### 4. Utilities

| File | Role |
|------|------|
| `src/utils.js` | `getVideoDuration()` (ffprobe), `extractAudio()` (ffmpeg) |
| `src/webhook.js` | POST notification to callback URL |

## Data Flow

```
User submits URL (UI or API)
         │
         ▼
    ┌─────────┐    INSERT INTO jobs
    │ REST API │──────────────────────► SQLite
    └─────────┘                           │
                                          │ poll every 2s
                                          ▼
                                    ┌───────────┐
                                    │   Queue    │
                                    └─────┬─────┘
                                          │
                                          ▼
                                    ┌───────────┐
                                    │ Processor  │
                                    └─────┬─────┘
                               ┌──────────┼──────────┐
                               ▼          ▼          ▼
                          Download   Extract    Transcribe
                          (2-tier)   (ffmpeg)   (Whisper)
                               │          │          │
                               └──────────┼──────────┘
                                          │
                                          ▼
                                    UPDATE jobs
                                    SET status='completed'
                                          │
                                          ▼
                                    Webhook POST
                                    (if configured)
```

## Download Chain Detail

```
downloader.download(url)
    │
    ├─ Tier 1: yt-dlp
    │  Spawns yt-dlp process with --playlist-items 1
    │  Works for YouTube, Twitter, Vimeo, TikTok, 1800+ sites
    │  ✓ return { path, method: 'yt-dlp' }
    │  ✗ fall through ──►
    │
    └─ Tier 2: scraper-browser.js (Playwright)
       Launch headless Chromium with stealth plugin
       ├── Network interception (content-type + URL patterns)
       ├── Cookie consent dismissal
       ├── Scroll triggers for lazy-loaded players
       ├── Play button click attempts
       └── DOM inspection (video/source/iframe/og:video)
       Returns ordered URL list: embeds first → manifests → streams
       Each URL tried via yt-dlp, then direct download as fallback
       ✓ return { path, method: 'playwright' }
```

## Database Schema

Single `jobs` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `url` | TEXT | Source video URL |
| `status` | TEXT | `pending` → `downloading` → `transcribing` → `completed` / `failed` |
| `language` | TEXT | Whisper language code (`auto`, `en`, `el`, etc.) |
| `format` | TEXT | `srt` or `vtt` |
| `webhook_url` | TEXT | Optional callback URL |
| `output_path` | TEXT | Path to downloaded video file |
| `subtitle_path` | TEXT | Path to generated subtitle file |
| `download_method` | TEXT | `yt-dlp` or `playwright` |
| `status_message` | TEXT | Detailed phase description (e.g. "Transcribing with whisper...") |
| `error` | TEXT | Error message if failed |
| `progress` | INTEGER | 0–100 |
| `duration` | REAL | Video duration in seconds |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |
| `started_at` | TEXT | ISO timestamp |
| `completed_at` | TEXT | ISO timestamp |

Indexes: `status`, `created_at`

## File Structure

```
video-transcoder/
├── server.js               # Entry point — Express + worker
├── package.json
├── .env.example             # Environment template
├── CHANGELOG.md
├── README.md
├── SETUP.md
├── ARCHITECTURE.md
│
├── src/
│   ├── config.js            # Reads .env into config object
│   ├── db.js                # SQLite setup + schema + migrations
│   ├── utils.js             # ffmpeg/ffprobe helpers
│   ├── webhook.js           # POST webhook on job completion
│   ├── routes/
│   │   └── jobs.js          # REST API endpoints
│   └── worker/
│       ├── queue.js          # Job polling + concurrency
│       ├── processor.js      # Pipeline orchestrator
│       ├── downloader.js     # 2-tier download chain
│       ├── scraper-browser.js# Tier 2: Playwright browser scraper
│       ├── transcriber.js    # Whisper backend router
│       ├── whisper-python.js # Python whisper CLI wrapper
│       ├── whisper-cpp.js    # whisper.cpp binary wrapper
│       └── whisper-state.js  # Active Whisper process tracker
│
├── public/
│   ├── index.html           # Web UI
│   ├── css/app.css          # Styles (light + dark mode)
│   └── js/app.js            # Frontend logic (vanilla JS)
│
└── data/                    # Default STORAGE_PATH
    ├── transcoder.db        # SQLite database
    └── jobs/
        └── {uuid}/          # Per-job directory
            ├── video.mp4
            ├── audio.wav
            └── video.srt
```

## Key Design Decisions

1. **No external queue** — SQLite + polling is simpler to deploy and debug than Redis/RabbitMQ. WAL mode handles concurrent reads/writes.

2. **2-tier download fallback** — yt-dlp covers most sites natively (1800+ extractors). Playwright handles everything else by scraping the page for video URLs, preferring iframe embeds (which yt-dlp can then handle) over raw streams.

3. **Stealth plugin** — Many news sites block headless browsers. The stealth plugin patches navigator properties, WebGL, and other fingerprint vectors.

4. **Job directory isolation** — Each job gets its own directory under `jobs/{uuid}/`. Easy cleanup on delete, no file conflicts.

5. **Pluggable Whisper** — Python backend is easier to install. C++ backend is faster on CPU-only machines. Config switch, same interface.

6. **Single process** — No microservices, no containers required. One `npm start` runs everything. Suitable for self-hosted / single-machine deployment.
