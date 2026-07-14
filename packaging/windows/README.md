# Portable Windows Build

Builds **KTV Downloader** — a 100% portable, zero-install Windows package of
video-transcoder. The end user copies one folder and runs one `.exe`; nothing is
installed and nothing is downloaded by the user (except the whisper speech model, which
the app fetches on demand on first subtitle use).

## Build it

From the repo root, on a Windows machine with Node.js + npm:

```powershell
packaging\windows\build.ps1
```

Optional parameters: `-OutDir`, `-NodeVersion`, `-WhisperTag`.

Output: `dist\KTV Downloader\` (~620 MB).

> The build machine needs Node.js + npm and internet access. It does **not** need the
> .NET SDK — the launcher is compiled with the in-box .NET Framework compiler
> (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`), present on all Windows.

## What the build does

1. Downloads and bundles:
   - **Node.js** (default 24.18.0 — a 24.x LTS at/after the June 2026 security release;
     do not ship older 24.x, they carry known CVEs) → `runtime\node.exe`
   - **yt-dlp** (latest) → `bin\`
   - **ffmpeg + ffprobe** (BtbN shared win64, latest) + their DLLs → `bin\`
   - **whisper.cpp** (`whisper-cli` + ggml/BLAS DLLs) → `bin\`
   - **Chromium** via Playwright → `browsers\` (keeps only `chromium_headless_shell`,
     since the app launches `headless: true`; the full `chromium-*` build is deleted to
     save ~400 MB)
2. Copies the app source into `app\` and runs `npm install` (builds the
   `better-sqlite3` prebuilt for the bundled Node ABI).
3. Compiles the WinForms launcher (`Launcher.cs` + `app.manifest`) to
   `KTV Downloader.exe`.

## Resulting layout

```
KTV Downloader\
├─ KTV Downloader.exe   ← launcher (Start / Stop / Status / Open UI)
├─ ΟΔΗΓΙΕΣ.txt          ← quick start (Greek)
├─ runtime\node.exe     ← bundled Node.js
├─ app\                 ← app source + node_modules
├─ bin\                 ← yt-dlp, ffmpeg, ffprobe, whisper-cli (+ DLLs)
├─ browsers\            ← Chromium (headless shell)
├─ models\              ← whisper model, downloaded on demand
└─ data\                ← jobs + SQLite (created at runtime)
```

## How it runs

The launcher spawns `runtime\node.exe app\server.js` with:

- `KTV_ROOT` = package root → `src/paths.js` resolves `bin/`, `browsers/`, `models/`,
  `data/` from there
- `PLAYWRIGHT_BROWSERS_PATH` = `browsers\`
- `bin\` prepended to `PATH`

The whole child-process tree (node → yt-dlp / ffmpeg / whisper / Chromium) is placed in
a Windows **Job Object** with `KILL_ON_JOB_CLOSE`, so pressing **Stop** or closing the
window reliably terminates everything.

`KTV Downloader.exe --autostart` starts the server immediately on launch.

## Notes

- Requires Windows 10/11 (64-bit) on the target machine. No .NET/Python/Node install
  needed there — the .NET Framework 4.x runtime the launcher uses ships with Windows.
- The `.exe` is unsigned; SmartScreen may warn (*More info → Run anyway*). Code-signing
  is out of scope for this build.
