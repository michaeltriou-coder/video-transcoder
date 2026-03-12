# Setup Guide

## System Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 18+ | Runtime |
| **yt-dlp** | latest | Video downloads (tier 1) |
| **ffmpeg** | 4.4+ | Audio extraction |
| **Whisper** | — | Transcription (one of the two below) |

### Whisper Backend (pick one)

**Option A — Python (recommended for most users)**
```bash
pip install openai-whisper
```

**Option B — whisper.cpp (faster on CPU, no Python needed)**
```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make
# Download a model
bash models/download-ggml-model.sh base
```

## Installation

### 1. Clone the repository

```bash
git clone <repo-url>
cd video-transcoder
```

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Install Playwright's Chromium browser

```bash
npx playwright install chromium
```

This downloads a sandboxed Chromium binary (~150 MB). It's used only as the 3rd-tier fallback for JS-rendered pages.

### 4. Install system dependencies

#### macOS (Homebrew)

```bash
brew install yt-dlp ffmpeg
pip install openai-whisper
```

#### Ubuntu / Debian

```bash
# yt-dlp
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# ffmpeg
sudo apt update && sudo apt install ffmpeg

# Whisper (Python)
pip install openai-whisper

# Playwright system deps (headless Chromium)
npx playwright install-deps chromium
```

#### Arch Linux

```bash
sudo pacman -S yt-dlp ffmpeg python-pip
pip install openai-whisper
```

### 5. Configure environment

```bash
cp .env.example .env
```

Edit `.env` to match your setup:

```env
PORT=5000
STORAGE_PATH=./data
WHISPER_BACKEND=python
WHISPER_MODEL=base
WHISPER_CPP_PATH=
MAX_CONCURRENT_JOBS=1
```

| Variable | Notes |
|----------|-------|
| `STORAGE_PATH` | Where jobs and the database live. Use `./data` for development. |
| `WHISPER_BACKEND` | `python` uses OpenAI's whisper CLI. `cpp` uses whisper.cpp (set `WHISPER_CPP_PATH`). |
| `WHISPER_MODEL` | `tiny` is fastest, `large` is most accurate. `base` is a good balance. |
| `WHISPER_CPP_PATH` | Full path to the `main` binary, e.g. `/home/user/whisper.cpp/main` |
| `MAX_CONCURRENT_JOBS` | Keep at 1 unless you have >16 GB RAM and a GPU. Whisper is memory-heavy. |

### 6. Start the server

**Development** (auto-restarts on file changes):
```bash
npm run dev
```

**Production**:
```bash
npm start
```

The server starts at `http://localhost:5000` (or your configured `PORT`).

## Verify Installation

Run these checks to make sure everything works:

```bash
# yt-dlp
yt-dlp --version

# ffmpeg
ffmpeg -version

# whisper (Python backend)
whisper --help

# Playwright browser
npx playwright install chromium --dry-run
```

Then open the web UI and submit a YouTube URL as a test job.

## Whisper Models

| Model | Size | Speed | Accuracy | VRAM |
|-------|------|-------|----------|------|
| `tiny` | 75 MB | ~10x | Decent | ~1 GB |
| `base` | 142 MB | ~7x | Good | ~1 GB |
| `small` | 466 MB | ~4x | Better | ~2 GB |
| `medium` | 1.5 GB | ~2x | Great | ~5 GB |
| `large` | 2.9 GB | 1x | Best | ~10 GB |

Speed is relative to `large`. For most use cases, `base` or `small` gives the best speed/accuracy ratio.

## Storage Structure

```
STORAGE_PATH/
├── transcoder.db          # SQLite database
├── transcoder.db-shm      # WAL shared memory
├── transcoder.db-wal      # Write-ahead log
└── jobs/
    └── {job-id}/
        ├── video-title.mp4       # Downloaded video
        ├── audio.wav              # Extracted audio (16kHz mono)
        ├── video-title.srt        # Subtitle file
        └── ...
```

## Troubleshooting

### "yt-dlp: command not found"
Install yt-dlp: `pip install yt-dlp` or `brew install yt-dlp`

### "ffmpeg: command not found"
Install ffmpeg: `apt install ffmpeg` or `brew install ffmpeg`

### "whisper: command not found"
Install OpenAI Whisper: `pip install openai-whisper`

### "Browser not installed" / Playwright error
Run: `npx playwright install chromium`

On Linux, also run: `npx playwright install-deps chromium`

### Job stuck in "downloading" or "transcribing"
If the server crashed mid-job, the job status won't auto-recover. Reset it manually:
```bash
sqlite3 data/transcoder.db "UPDATE jobs SET status='failed', error='Server restart' WHERE status IN ('downloading','transcribing');"
```
Then retry the job from the UI.

### High memory usage during transcription
- Use a smaller model (`tiny` or `base`)
- Set `MAX_CONCURRENT_JOBS=1`
- Close other memory-heavy applications
- Consider using the `cpp` backend (more memory-efficient)

### Playwright can't find video on a site
Some sites have aggressive bot detection (e.g., Reuters/Akamai) that blocks headless browsers after a few requests. This is a known limitation — there's no reliable workaround for enterprise-grade anti-bot systems.
