# HanziReel

Local MVP for learning Mandarin from MP4 videos: Hanzi with tone-marked pinyin, **English translations**, and saved corrections alongside a video player. Built with React/TypeScript/Vite and FastAPI/SQLite. No API key or per-request fees.

## Windows prerequisites

- Python 3.11 or 3.12 with pip; Node.js 22.12+; PowerShell.
- FFmpeg and FFprobe on PATH. Install a [Windows FFmpeg build](https://ffmpeg.org/download.html#build-windows), extract it, and add its `bin` directory to PATH. Check `ffmpeg -version` and `ffprobe -version`.
- Install and start [Ollama for Windows](https://ollama.com/download/windows), then download the translation model:

```powershell
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama list
```

The model tag was verified against the [official Ollama registry](https://ollama.com/library/qwen3:4b-instruct-2507-q4_K_M) during the original MVP setup on November 20, 2026. The download is approximately 2.5 GB; allow additional memory for inference. If the service is not running, start `ollama serve` in another terminal.

## Running locally

Backend terminal, from the project directory:

```powershell
cd C:\Kuliah\Project\HanziReel\Code
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd backend
Copy-Item .env.example .env
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Frontend terminal:

```powershell
cd C:\Kuliah\Project\HanziReel\Code\frontend
npm ci
npm run dev
```

Open [HanziReel](http://127.0.0.1:5173). To use the previous demo address, run `npm run dev -- --port 5174` and open [port 5174](http://127.0.0.1:5174). Vite proxies `/api` to the backend. API documentation is available in [Swagger](http://127.0.0.1:8000/docs). Run one backend process; do not use multiple workers or reload while processing. This app is intended for localhost. `npm run build` builds the frontend; use the dev server for the local workflow because production preview does not configure the API proxy.

Demo mode works with the frontend alone. `public/demo.mp4` is an original 16-second animation with synthetic tones (CC0), **without Mandarin speech**. The sample transcript contains Hanzi, pinyin, and English translations; it is not evidence of ASR accuracy. The demo supports seek, highlighting, segment replay, and TXT/SRT export. Editing is available for uploaded videos. Rebuild the clip with `node scripts/generate-demo.mjs`.

## Configuration

Edit `backend/.env` (loaded by `--env-file` above), or set `$env:NAME="value"` before starting the backend.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HANZIREEL_DATA` | `Code/data` without env; `../data` in the example | SQLite and MP4 storage, ignored by Git. Relative paths use the backend working directory. |
| `MAX_UPLOAD_MB` | `500` | Upload size limit |
| `MAX_DURATION_SECONDS` | `3600` | Duration limit |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | Executable names on PATH or absolute `.exe` paths |
| `WHISPER_MODEL` | `small` | Faster-Whisper model name or directory |
| `WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` |
| `WHISPER_COMPUTE_TYPE` | `int8` | Match the device, for example `float16` on a supported GPU |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Local Ollama service |
| `OLLAMA_MODEL` | `qwen3:4b-instruct-2507-q4_K_M` | Translation model tag |

Faster-Whisper downloads its model on first transcription; subsequent processing runs locally with the cached model. Set `WHISPER_MODEL=large-v3-turbo` to use that model on a suitable machine; follow the [Faster-Whisper CUDA/CTranslate2 requirements](https://github.com/SYSTRAN/faster-whisper#gpu) for GPU use. H.264/AAC MP4 is recommended for browser playback.

## Workflow and storage

1. Upload an MP4. The backend checks the container, video/audio tracks, size, and duration with FFprobe before running a model. New videos receive the English target (`en`).
2. One worker extracts mono 16 kHz WAV and transcribes Mandarin (`zh`). ASR timestamps remain the source of video timing; there is no word-level synchronization.
3. Segments are saved atomically. Hanzi/pinyin become readable while translation runs. Each batch contains up to eight segments with IDs; the entire response is validated and mapped by ID, regardless of response order. Successful batches are retained if another fails.
4. Click a dialogue line to seek and play. `Replay` plays once from the segment start to its end, then stops. Highlight intervals are `[start, end)`. Turn off `Follow dialogue` to read elsewhere.
5. `Edit` saves Hanzi and translation text. Pinyin uses phrase context and regenerates after Hanzi edits; timestamps stay unchanged. A Hanzi-only edit marks the old translation as stale. Manually edited translations are protected from retries, including in-flight model responses.
6. If Ollama is unavailable, the model is missing, or a response is invalid, Hanzi/pinyin remain accessible. Fix Ollama, then choose `Retry translation`. Only pending/failed/stale segments are retried, using the video's recorded target. Interrupted jobs are marked at startup; retries reuse saved transcripts and corrections. Temporary WAV files are removed.
7. Reopen saved videos using `Your videos` after restarting. Export TXT or SRT from the transcript panel. TXT includes a language header. Translation SRT contains only available translations with their original timestamps. Filenames identify the language: `.en.srt`, `.id.srt`, or `.zh.srt` for Hanzi.

MP4 files and SQLite are stored in `data/`, outside version control. Keep this directory to retain results. Upload validation runs after multipart parsing; there is no pre-parser request-body limit. Timing and segmentation depend on ASR quality. Accounts, YouTube integration, and cloud deployment are out of scope.

## Existing Indonesian translations

Stop the old backend before updating, and make a backup of `data/` with the backend stopped if you need a rollback. Startup automatically migrates the original SQLite schema by adding `videos.translation_language`. Existing videos are marked `id` because the original MVP always targeted Indonesian; new videos default to `en`. Migration is transactional and repeatable. Segment text, manual edits, pinyin, order, revisions, media, and timestamps are preserved. Old saved error messages are replaced with English diagnostics.

The historical `segments.translation_id` field is retained for database/API compatibility; it contains **translation text**, not a segment ID or language code. Language belongs to the video/job. The worker prompt, transcript/editor labels, progress, export options, TXT header, and download filename all follow this metadata. Existing Indonesian content remains labelled **Indonesian**, and its retries continue translating into Indonesian without overwriting edited or completed rows.

There is no language picker or endpoint to create new Indonesian jobs in this release. The small target-name/prompt registry supports legacy Indonesian jobs and can be extended later. No automatic Indonesian-to-English conversion is performed.

For API clients, use `kind=txt`, `kind=srt-hanzi`, or the language-neutral `kind=srt-translation`. The old `kind=srt-id` alias remains valid for Indonesian videos; `kind=srt-en` is valid for English videos. A mismatched alias returns HTTP 400 to prevent an incorrect language label. Responses also include `Content-Language`.

## Tests and verification

```powershell
cd C:\Kuliah\Project\HanziReel\Code\backend
..\.venv\Scripts\python.exe -m pytest -q
cd ..\frontend
npm test
npm run build
# With the dev server running and Google Chrome installed:
npm run test:e2e
# If the frontend is running on port 5174:
$env:PLAYWRIGHT_BASE_URL="http://127.0.0.1:5174"
npm run test:e2e
```

Backend tests cover ID mapping (including reversed/duplicate IDs), phrase pinyin, millisecond SRT timing, edits versus model responses, failed-batch retry, unavailable Ollama, persistence, byte-range video, migration of the original schema, and English upload-to-export processing with **mocked ASR/Ollama**. The real MP4 validation/extraction test requires the npm FFmpeg/FFprobe dev dependencies and bundled demo clip. Frontend tests cover segment boundaries, gaps, and language labels. Browser tests cover playback, demo English TXT/SRT downloads, mobile layout, and English/legacy Indonesian editor/retry labels with API fixtures.

To verify live inference, record your own 10–20 second Mandarin clip saying `你好！今天你想做什么？我想去书店买一本书。` and save it as H.264/AAC MP4. Upload it, wait for ASR and English translation, and compare Hanzi/timestamps. Stop Ollama to verify that Hanzi stays readable; restart it and retry translation. Edit a line, restart the backend, reopen the same video, and check that corrections and TXT/SRT exports persist with the English label. See [VERIFICATION.md](VERIFICATION.md) for the checks actually run and the remaining live-inference limitations.
