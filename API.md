# API Reference

Base URL: `http://localhost:5000` (configurable via `PORT`)

All responses are JSON. Errors return `{ "error": "message" }`.

---

## Jobs

### Create Job

```
POST /api/jobs
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | Valid video URL |
| `language` | string | No | `auto` | Whisper language code (`en`, `el`, `fr`, etc.) |
| `format` | string | No | `srt` | Subtitle format: `srt` or `vtt` |
| `webhook` | string | No | `null` | URL to POST when job completes |

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "language": "en",
  "format": "srt",
  "webhook": "https://your-app.com/hook"
}
```

**Response (201):**
```json
{
  "id": "32eaf53c-343a-49e5-8372-2342d43e2fa9",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "status": "pending",
  "language": "en",
  "format": "srt",
  "webhook_url": "https://your-app.com/hook",
  "progress": 0,
  "created_at": "2026-03-12T10:00:00.000Z",
  "updated_at": "2026-03-12T10:00:00.000Z",
  "output_path": null,
  "subtitle_path": null,
  "error": null,
  "duration": null
}
```

**Errors:**
- `400` — Missing/invalid URL, invalid format, invalid language

---

### List Jobs

```
GET /api/jobs?page=1&limit=20&status=completed
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Results per page (max 100) |
| `status` | string | — | Filter: `pending`, `downloading`, `transcribing`, `completed`, `failed` |

**Response (200):**
```json
{
  "jobs": [ ... ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

### Get Job

```
GET /api/jobs/:id
```

**Response (200):** Full job object (same fields as create response).

**Errors:**
- `404` — Job not found

---

### Delete Job

```
DELETE /api/jobs/:id
```

Deletes the job record and all associated files.

**Response (200):**
```json
{ "message": "Job deleted" }
```

**Errors:**
- `404` — Job not found

---

### Retry Failed Job

```
POST /api/jobs/:id/retry
```

Resets a failed job to `pending` so the worker picks it up again.

**Response (200):** Updated job object with `status: "pending"`.

**Errors:**
- `404` — Job not found
- `400` — Job status is not `failed`

---

### Download File

```
GET /api/jobs/:id/download?type=video
GET /api/jobs/:id/download?type=subtitle
```

| Param | Default | Description |
|-------|---------|-------------|
| `type` | `video` | `video` or `subtitle` |

Returns the file as a download stream.

**Errors:**
- `404` — Job not found or file not available

---

## System

### Version

```
GET /api/version
```

**Response (200):**
```json
{
  "version": "0.3.4",
  "changelog": "..."
}
```

---

### Whisper Status

```
GET /api/whisper/status
```

**Response (200):**
```json
{ "running": true, "jobId": "32eaf53c-..." }
```

---

### Stop Whisper

```
POST /api/whisper/stop
```

Kills the active Whisper transcription process.

**Response (200):**
```json
{ "stopped": true }
```

---

## Webhook Payload

When a job completes or fails, a POST is sent to the `webhook` URL:

```json
{
  "jobId": "32eaf53c-...",
  "status": "completed",
  "downloadUrl": "http://your-server/api/jobs/32eaf53c-.../download",
  "subtitleUrl": "http://your-server/api/jobs/32eaf53c-.../download?type=subtitle",
  "duration": 139.0
}
```

The base URL for `downloadUrl`/`subtitleUrl` is configurable via the `BASE_URL` environment variable.

---

## Job Status Flow

```
pending → downloading → transcribing → completed
                                     → failed
```

## Supported Languages

`auto`, `af`, `am`, `ar`, `as`, `az`, `ba`, `be`, `bg`, `bn`, `bo`, `br`, `bs`, `ca`, `cs`, `cy`, `da`, `de`, `el`, `en`, `es`, `et`, `eu`, `fa`, `fi`, `fo`, `fr`, `gl`, `gu`, `ha`, `haw`, `he`, `hi`, `hr`, `ht`, `hu`, `hy`, `id`, `is`, `it`, `ja`, `jw`, `ka`, `kk`, `km`, `kn`, `ko`, `la`, `lb`, `ln`, `lo`, `lt`, `lv`, `mg`, `mi`, `mk`, `ml`, `mn`, `mr`, `ms`, `mt`, `my`, `ne`, `nl`, `nn`, `no`, `oc`, `pa`, `pl`, `ps`, `pt`, `ro`, `ru`, `sa`, `sd`, `si`, `sk`, `sl`, `sn`, `so`, `sq`, `sr`, `su`, `sv`, `sw`, `ta`, `te`, `tg`, `th`, `tk`, `tl`, `tr`, `tt`, `uk`, `ur`, `uz`, `vi`, `yo`, `zh`, `yue`
