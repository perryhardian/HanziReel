# Hasil verifikasi MVP

Dilakukan pada Windows, 20 November 2026 (Asia/Jakarta).

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run build` | Lulus: TypeScript dan build produksi Vite |
| `npm test` | 3 tes lulus: batas `[start,end)`, gap, unit demo |
| `python -m pytest -q` dari `backend` | 16 tes lulus |
| Playwright pada Chrome desktop dan lebar 390 px | 2 tes lulus |
| Audit dependensi npm setelah pembaruan Vitest | 0 kerentanan |
| Pemeriksaan screenshot desktop dan ponsel | Tata letak video/transkrip dan label demo diperiksa |

Pengujian browser memakai server Vite port 5174 dan backend port 8000 karena server di dalam sandbox tidak dapat diakses Chrome. Command yang dijalankan: `$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5174'; npx playwright test`. Tanpa override, konfigurasi pengujian memakai port dev standar 5173.

Yang benar-benar diuji: pemutaran MP4 H.264/AAC demo dengan waktu video yang maju, klik segmen, sorotan batas segmen, putar ulang hingga berhenti pada detik 4, mematikan ikuti dialog, unduhan SRT, dan lebar layar ponsel tanpa horizontal overflow. Screenshot ada di `artifacts/desktop.png` dan `artifacts/mobile.png`.

Backend diuji dengan SQLite sementara: validasi ekstensi/ukuran/audio dan MP4 rusak, FFprobe nyata, ekstraksi WAV dengan FFmpeg nyata, penyimpanan hasil ASR fixture, pinyin konteks frasa, pemetaan ID hasil terjemahan termasuk urutan terbalik/ID invalid, batch gagal yang mempertahankan hasil sebelumnya, edit saat respons model sedang berjalan, koreksi Hanzi yang menandai terjemahan stale, ekspor SRT milidetik, retry aman, restart/inisialisasi ulang database, dan respons byte-range 206 untuk seek. Skenario Ollama mati menggunakan kegagalan koneksi yang disimulasikan, bukan server Ollama nyata.

Batas verifikasi: Python sistem tidak tersedia melalui PATH; pengujian memakai Python 3.12 bawaan runtime Codex dan virtualenv `.venv`. FFmpeg/FFprobe untuk pengujian berasal dari dependensi dev npm. Faster-Whisper/model Whisper dan Ollama/model Qwen belum diinstal atau dijalankan pada sesi ini. Tidak ada klip ucapan Mandarin berlisensi yang tersedia; klip demo dibuat sendiri tanpa ucapan. Karena itu akurasi dan performa ASR, kualitas terjemahan Qwen, unduhan model pertama, serta alur MP4 Mandarin → Whisper nyata → Ollama nyata **belum diverifikasi**. Langkah verifikasi manual dan pemasangan dependensi lengkap tersedia di README.

Satu peringatan deprecation muncul dari adapter TestClient Starlette yang masih memakai httpx; seluruh assertion lulus. Versi frontend terkunci dalam `frontend/package-lock.json`.
