# Video Transcoder & Whisper Subtitles

Self-hosted service that downloads videos from any URL, extracts audio, and generates subtitles using OpenAI Whisper. Supports YouTube, news sites, and JS-rendered pages through a 3-tier download fallback system.

## Features

- **3-tier video download**: yt-dlp → Cheerio HTML scraper → Playwright headless browser
- **Whisper transcription**: Python (`openai-whisper`) or C++ (`whisper.cpp`) backends
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

## How It Works

```
URL submitted via API/UI
    │
    ▼
┌─────────────────────────────┐
│  Download (3-tier fallback)  │
│  1. yt-dlp (YouTube, etc.)  │
│  2. Cheerio (static HTML)   │
│  3. Playwright (JS/iframes) │
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
| `STORAGE_PATH` | `./data` | Directory for jobs and database |
| `WHISPER_BACKEND` | `python` | `python` or `cpp` |
| `WHISPER_MODEL` | `base` | Whisper model: `tiny`, `base`, `small`, `medium`, `large` |
| `WHISPER_CPP_PATH` | — | Path to whisper.cpp binary (required if backend is `cpp`) |
| `MAX_CONCURRENT_JOBS` | `1` | Max parallel jobs |

## Download Tiers

| Tier | Engine | Best for | Speed |
|------|--------|----------|-------|
| 1 | **yt-dlp** | YouTube, Twitter/X, Vimeo, TikTok, 1000+ sites | Fast |
| 2 | **Cheerio** | News sites with `og:video`, `<video>` tags, JSON-LD | Fast |
| 3 | **Playwright** | JS-rendered pages, iframe embeds, lazy-loaded players | Slower |

The system tries each tier in order. If tier 1 fails, it falls back to tier 2, then tier 3. The download method is tracked and displayed in the UI.

## Tech Stack

- **Runtime**: Node.js
- **Web framework**: Express 5
- **Database**: SQLite via better-sqlite3 (WAL mode)
- **Video download**: yt-dlp + Cheerio + Playwright
- **Audio processing**: ffmpeg / ffprobe
- **Transcription**: OpenAI Whisper (Python) or whisper.cpp
- **Anti-bot**: playwright-extra + stealth plugin

## License

ISC
