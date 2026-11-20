# English-default update verification

Verified on Windows on November 20, 2026 (Asia/Jakarta). The previous MVP baseline was 16 backend tests, 3 frontend tests, 2 browser tests, and a successful production build.

The verified story is: upload Mandarin MP4 → persist the English target → extract audio → save Hanzi/pinyin/timestamps → translate by segment ID → edit/retry → export with the recorded language. Original Indonesian jobs follow the same path using their migrated `id` target.

| Check | Current result |
| --- | --- |
| `..\.venv\Scripts\python.exe -m pytest -q` from `backend` | 19 passed, no skips |
| `npm test` from `frontend` | 4 passed |
| `npm run test:e2e` on Chrome | 4 passed |
| `npm run build` | TypeScript and Vite production build passed |
| API and frontend proxy `/api/config` | Both returned `default_translation_language: "en"` |
| Desktop and 390 px mobile screenshots | English interface reviewed; no horizontal overflow |

Browser command: `$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5174'; npm run test:e2e`. The existing Vite server was reused on port 5174 and the backend was restarted on port 8000 with the updated code. Browser/server checks ran outside the sandbox to permit localhost access. The default browser-test URL remains port 5173 when no override is set.

## Translation and persistence coverage

- A real MP4 upload is validated by FFprobe and converted to WAV by FFmpeg. ASR returns two deterministic Mandarin segments. A mocked Ollama response returns English translations **in reverse ID order**; the test verifies the English prompt, correct text-to-ID mapping, unchanged timestamps, and exact English SRT output. The TXT header, `.en.srt` filename, response language, and rejection of an Indonesian export alias are checked.
- A temporary database is created with the **original schema without language metadata**. Repeated startup migration marks existing jobs Indonesian, adds an English default for new records, and preserves all segment fields byte-for-byte. Completed Indonesian translations and manually edited content survive migration and retries. Old incomplete/error/interrupted diagnostics become English.
- Retrying the migrated Indonesian job sends an Indonesian prompt and only the failed segment ID. The test checks that successful/manual rows remain unchanged, pinyin and timing survive, TXT identifies `Indonesian (id)`, and SRT uses `.id.srt`. An English export alias is rejected for that job.
- Retrying an English job sends an English prompt for its missing segment and preserves its manually edited translation.
- Existing coverage still checks duplicate/missing/invalid IDs, failed batches retaining earlier results, model-response/edit races, stale translations after Hanzi edits, phrase pinyin, SRT milliseconds, restart persistence, byte-range 206 seek responses, invalid/oversized/no-audio media, and simulated unavailable Ollama.

## Browser and interface coverage

- The page language is `en`; demo headings, translation column, controls, and export labels are English. The demo contains English translations, Hanzi, and pinyin.
- Actual demo playback advances after clicking a line. Boundary highlighting, segment replay stopping at four seconds, and disabling follow mode are verified.
- Demo downloads include Hanzi SRT plus English TXT/SRT. Tests read downloaded English text, check the TXT language header, and verify `.zh.srt`, `.en.txt`, and `.en.srt` filenames.
- English and legacy Indonesian saved-video browser fixtures exercise the transcript language label, translation `lang` attribute, editor value and save, retry request, and corresponding export option. The Indonesian fixture displays the legacy notice and has no English SRT option. These two tests mock API responses; actual SQLite migration/retry/export behavior is tested separately in the backend suite.
- Updated screenshots are saved as `artifacts/desktop.png` and `artifacts/mobile.png`; both were visually inspected. No interface redesign or language picker was added.

## Remaining limits

Faster-Whisper is not installed in the test virtualenv, no cached Whisper model was found in the standard Hugging Face location, the `ollama` command is unavailable on PATH, and `http://127.0.0.1:11434/api/tags` was unreachable. No live inference was run or model downloaded. The bundled CC0 demo has synthetic tones and animation **without speech**; it is not a Mandarin ASR test clip.

Live Mandarin MP4 → Whisper → Qwen English translation → export, model-download behavior, ASR accuracy/timing, and translation quality/performance remain **unverified**. English targeting and segment mapping are verified through mocked Ollama responses, not through a claim of live model output. Follow the live-clip procedure in [README.md](README.md) after installing the models.

Tests used the existing Python 3.12 virtualenv and npm FFmpeg/FFprobe dev dependencies. One existing Starlette TestClient/httpx deprecation warning remains; all assertions pass. No dependency changes were needed, and no fresh dependency audit was performed for this update.
