<#
.SYNOPSIS
  Build the portable Windows package for video-transcoder ("KTV Downloader").

.DESCRIPTION
  Assembles a fully self-contained folder that requires NO installation by the end
  user: a bundled Node.js runtime, yt-dlp, ffmpeg/ffprobe, whisper.cpp, and Chromium,
  plus a small WinForms launcher (Start / Stop / Status / Open UI).

  The launcher is compiled with the in-box .NET Framework C# compiler (csc.exe) — no
  .NET SDK is required. Node.js + npm ARE required on the build machine.

  Output: dist\KTV Downloader\  (relative to the repo root)

.PARAMETER OutDir
  Output directory. Default: <repo>\dist

.PARAMETER NodeVersion
  Node.js version to bundle (must be a 24.x LTS at or above the latest security release).

.PARAMETER WhisperTag
  whisper.cpp release tag to bundle.
#>
[CmdletBinding()]
param(
  [string]$OutDir,
  [string]$NodeVersion = "24.18.0",
  [string]$WhisperTag  = "v1.9.1"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# --- paths -----------------------------------------------------------------
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $OutDir) { $OutDir = Join-Path $repo "dist" }
$pkg   = Join-Path $OutDir "KTV Downloader"
$work  = Join-Path $OutDir "_build"
$dl    = Join-Path $work "downloads"
$ex    = Join-Path $work "extract"

Write-Host "Repo:    $repo"
Write-Host "Output:  $pkg"

# --- prerequisites ---------------------------------------------------------
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { throw "Node.js + npm are required on the build machine (not found on PATH)." }
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "In-box C# compiler not found: $csc" }

# --- clean + scaffold ------------------------------------------------------
if (Test-Path $pkg) { Remove-Item -Recurse -Force $pkg }
foreach ($d in @($pkg, "$pkg\app", "$pkg\runtime", "$pkg\bin", "$pkg\browsers", "$pkg\models", "$pkg\data", $dl, $ex)) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# --- downloads -------------------------------------------------------------
$nodeZip    = "$dl\node.zip"
$ytdlp      = "$dl\yt-dlp.exe"
$ffmpegZip  = "$dl\ffmpeg.zip"
$whisperZip = "$dl\whisper.zip"

Write-Host "Downloading Node $NodeVersion ..."
Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $nodeZip
Write-Host "Downloading yt-dlp (latest) ..."
Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $ytdlp
Write-Host "Downloading ffmpeg (BtbN shared, latest) ..."
Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip" -OutFile $ffmpegZip
Write-Host "Downloading whisper.cpp $WhisperTag (BLAS x64) ..."
Invoke-WebRequest "https://github.com/ggml-org/whisper.cpp/releases/download/$WhisperTag/whisper-blas-bin-x64.zip" -OutFile $whisperZip

# --- extract + place binaries ---------------------------------------------
Write-Host "Extracting ..."
Expand-Archive -Force -LiteralPath $nodeZip    -DestinationPath "$ex\node"
Expand-Archive -Force -LiteralPath $ffmpegZip  -DestinationPath "$ex\ffmpeg"
Expand-Archive -Force -LiteralPath $whisperZip -DestinationPath "$ex\whisper"

Copy-Item "$ex\node\node-v$NodeVersion-win-x64\node.exe" "$pkg\runtime\node.exe"
Copy-Item $ytdlp "$pkg\bin\yt-dlp.exe"

$ffBin = Join-Path (Get-ChildItem "$ex\ffmpeg" -Directory | Select-Object -First 1).FullName "bin"
Copy-Item "$ffBin\ffmpeg.exe","$ffBin\ffprobe.exe" "$pkg\bin\"
Copy-Item "$ffBin\*.dll" "$pkg\bin\"

$wr = Join-Path "$ex\whisper" "Release"
Copy-Item "$wr\whisper-cli.exe" "$pkg\bin\"
Copy-Item "$wr\whisper.dll" "$pkg\bin\"
Copy-Item "$wr\ggml*.dll" "$pkg\bin\"
Copy-Item "$wr\libopenblas.dll" "$pkg\bin\"

# --- app source ------------------------------------------------------------
Write-Host "Copying app source ..."
$exclude = @("node_modules","data","dist","_build",".git","packaging")
Get-ChildItem $repo -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
  Copy-Item $_.FullName (Join-Path "$pkg\app" $_.Name) -Recurse -Force
}
Remove-Item -Recurse -Force "$pkg\app\node_modules","$pkg\app\data" -ErrorAction SilentlyContinue

# --- npm install (skip browser auto-download; we place Chromium ourselves) --
Write-Host "Running npm install ..."
Push-Location "$pkg\app"
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed" }

# --- Chromium (headless shell only) ---------------------------------------
Write-Host "Installing Chromium into browsers\ ..."
$env:PLAYWRIGHT_BROWSERS_PATH = "$pkg\browsers"
& node node_modules/playwright/cli.js install chromium
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "playwright install failed" }
Pop-Location
# The app launches headless:true, which uses chromium_headless_shell — drop the full
# chromium build to save ~400 MB.
Get-ChildItem "$pkg\browsers" -Directory | Where-Object { $_.Name -like "chromium-*" } |
  Remove-Item -Recurse -Force

# --- compile launcher ------------------------------------------------------
Write-Host "Compiling launcher ..."
$out = "$pkg\KTV Downloader.exe"
& $csc /nologo /target:winexe "/out:$out" "/win32manifest:$PSScriptRoot\app.manifest" `
  /reference:System.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
  "$PSScriptRoot\Launcher.cs"
if ($LASTEXITCODE -ne 0) { throw "launcher compile failed" }

# --- quick-start + cleanup -------------------------------------------------
Copy-Item "$PSScriptRoot\QUICKSTART.txt" "$pkg\ΟΔΗΓΙΕΣ.txt" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $ex -ErrorAction SilentlyContinue

$size = [math]::Round((Get-ChildItem $pkg -Recurse | Measure-Object Length -Sum).Sum / 1MB)
Write-Host ""
Write-Host "Done. Package: $pkg  (~$size MB)"
Write-Host "Run:  `"$out`""
