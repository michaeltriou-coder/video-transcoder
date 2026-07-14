# Setup Guide

> **On Windows?** The easiest path is the **portable build** — no manual dependency
> installation at all. See [Portable Windows Build](#portable-windows-build) below.
> The sections after it cover a manual/dev install on any OS.

## Portable Windows Build

Produces a single self-contained folder (`dist\KTV Downloader\`, ~620 MB) with a
bundled Node.js runtime, yt-dlp, ffmpeg/ffprobe, whisper.cpp, and Chromium, plus a
`KTV Downloader.exe` launcher (Start / Stop / Status / Open UI). The **end user
installs nothing**.

**To build it** (on a Windows dev machine, from the repo root):

```powershell
packaging\windows\build.ps1
```

Requirements on the *build* machine only: Node.js + npm (to run `npm install` and the
Playwright browser fetch) and internet access. The launcher is compiled with the
in-box .NET Framework C# compiler (`csc.exe`) — no .NET SDK needed.

**To use it:** copy the `KTV Downloader` folder anywhere, run `KTV Downloader.exe`,
press **Start**, then **Open UI**. The whisper speech model downloads automatically on
the first subtitle job (into `models\`); after that it works offline. Requires Windows
10/11 (64-bit).

See [packaging/windows/README.md](packaging/windows/README.md) for the full layout and
internals.

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

**Option B — whisper.cpp (default; faster on CPU, no Python needed)**
```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make
# The app downloads the ggml model on demand, or fetch one manually:
bash models/download-ggml-model.sh base
```
The app looks for the model at `<models dir>/ggml-<model>.bin` and downloads it
automatically on first use if missing (see `src/worker/model.js`). Point
`WHISPER_CPP_PATH` at the built binary (`whisper-cli`, formerly `main`).

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
WHISPER_BACKEND=cpp
WHISPER_MODEL=base
WHISPER_CPP_PATH=
MAX_CONCURRENT_JOBS=1
```

| Variable | Notes |
|----------|-------|
| `STORAGE_PATH` | Where jobs and the database live. Defaults to `<root>/data`. |
| `WHISPER_BACKEND` | `cpp` uses whisper.cpp (default, no Python). `python` uses OpenAI's whisper CLI. |
| `WHISPER_MODEL` | `tiny` is fastest, `large-v3` is most accurate. `base` is a good balance. |
| `WHISPER_CPP_PATH` | Full path to the `whisper-cli` binary. In the portable build this is auto-resolved from `bin/`. |
| `MAX_CONCURRENT_JOBS` | Keep at 1 unless you have >16 GB RAM and a GPU. Whisper is memory-heavy. |
| `YTDLP_PATH` / `FFMPEG_PATH` / `FFPROBE_PATH` | Optional explicit tool paths; otherwise resolved from `bin/` then `PATH`. |

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
