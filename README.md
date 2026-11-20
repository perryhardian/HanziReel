# HanziReel

MVP lokal untuk belajar Mandarin dari MP4: video, Hanzi dengan pinyin bertanda nada, terjemahan Indonesia, dan koreksi tersimpan. React/TypeScript/Vite + FastAPI/SQLite. Tidak membutuhkan API key.

## Prasyarat Windows

- Python 3.11 atau 3.12 dengan pip; Node.js 22.12+; PowerShell.
- FFmpeg dan FFprobe pada PATH. Instal dari [tautan build Windows FFmpeg](https://ffmpeg.org/download.html#build-windows), ekstrak, lalu tambahkan direktori `bin` ke PATH. Uji `ffmpeg -version` dan `ffprobe -version`.
- [Ollama untuk Windows](https://ollama.com/download/windows), jalankan aplikasinya, lalu:

```powershell
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama list
```

Tag 4-bit tersebut diverifikasi pada [registry resmi Ollama](https://ollama.com/library/qwen3:4b-instruct-2507-q4_K_M) pada 20 November 2026. Unduhan model sekitar 2,5 GB; sediakan memori tambahan untuk konteks dan inference. Jika layanan belum aktif, jalankan `ollama serve` di terminal lain.

## Menjalankan

Terminal backend, dari folder proyek:

```powershell
cd C:\Kuliah\Project\HanziReel\Code
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd backend
Copy-Item .env.example .env
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Terminal frontend:

```powershell
cd C:\Kuliah\Project\HanziReel\Code\frontend
npm ci
npm run dev
```

Buka [HanziReel](http://127.0.0.1:5173). Proxy Vite meneruskan `/api` ke backend. API tersedia di [Swagger](http://127.0.0.1:8000/docs). Gunakan satu proses backend, tanpa `--workers` dan tanpa reload saat pemrosesan. Aplikasi ditujukan untuk localhost, bukan server publik. Untuk build frontend: `npm run build`; preview harus tetap memakai proxy API (gunakan dev server untuk alur lokal).

Mode demo langsung berjalan dengan frontend saja. `public/demo.mp4` merupakan klip grafis 16 detik dan nada sintetis buatan proyek (CC0), **tanpa ucapan Mandarin**. Transkrip contoh ditandai jelas dan tidak dipakai sebagai bukti akurasi transkripsi. Demo mendukung seek, sorotan, ulang segmen, dan ekspor; koreksi tersimpan tersedia pada video unggahan. Bangun ulang klip dengan `node scripts/generate-demo.mjs`.

## Konfigurasi

Edit `backend/.env` (dimuat oleh perintah `--env-file` di atas), atau gunakan `$env:NAMA="nilai"` sebelum menjalankan backend.

| Variabel | Default | Fungsi |
| --- | --- | --- |
| `HANZIREEL_DATA` | `Code/data` tanpa env; `../data` di contoh | SQLite dan MP4, diabaikan Git. Path relatif terhadap working directory backend. |
| `MAX_UPLOAD_MB` | `500` | Batas ukuran unggahan |
| `MAX_DURATION_SECONDS` | `3600` | Batas durasi |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | Nama pada PATH atau path absolut `.exe` |
| `WHISPER_MODEL` | `small` | Ukuran/nama atau direktori model Faster-Whisper |
| `WHISPER_DEVICE` | `cpu` | `cpu` atau `cuda` |
| `WHISPER_COMPUTE_TYPE` | `int8` | Sesuaikan perangkat, misalnya `float16` untuk GPU |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Layanan Ollama |
| `OLLAMA_MODEL` | `qwen3:4b-instruct-2507-q4_K_M` | Tag model terjemahan |

Faster-Whisper mengunduh model saat transkripsi pertama; setelah model terunduh, pemrosesan berjalan lokal. `large-v3-turbo` dapat dipakai lewat `WHISPER_MODEL`; ikuti [prasyarat CUDA/CTranslate2 Faster-Whisper](https://github.com/SYSTRAN/faster-whisper#gpu) jika menggunakan GPU. Klip sebaiknya memakai H.264/AAC agar browser dapat memutarnya.

## Alur dan penyimpanan

1. Pilih MP4. Backend memvalidasi kontainer, trek video/audio, ukuran, serta durasi melalui FFprobe sebelum menjalankan model.
2. Satu worker mengekstrak WAV mono 16 kHz dan mentranskripsi dengan bahasa `zh`. Timestamp dari ASR menjadi waktu video, tanpa sinkronisasi per kata.
3. Segmen disimpan atomik; Hanzi/pinyin langsung tersedia saat terjemahan batch berjalan. Terjemahan delapan segmen per batch dikirim dengan ID dan divalidasi lengkap sebelum disimpan. Batch yang berhasil dipertahankan jika batch lain gagal.
4. Klik dialog untuk seek/play. `Ulangi` memutar satu kali dari awal hingga akhir segmen lalu berhenti. Batas segmen adalah `[start, end)`. Nonaktifkan `Ikuti dialog` untuk membaca bagian lain.
5. `Edit` menyimpan Hanzi dan terjemahan. Pinyin dikonversi dengan konteks frasa; timestamp tetap. Perubahan Hanzi menandai terjemahan lama untuk diperbarui. Terjemahan yang diedit manual dilindungi dari retry, termasuk respons model yang datang setelah edit.
6. Jika Ollama mati/model tidak tersedia/respons invalid, Hanzi dan pinyin tetap dapat dibaca. Perbaiki Ollama lalu `Coba ulang terjemahan`. Retry memproses status pending/failed/stale saja. Jika aplikasi berhenti, pekerjaan aktif ditandai terputus pada startup; retry melanjutkan dari transkrip tersimpan. WAV sementara dibersihkan.
7. Buka ulang video melalui pilihan `Video Anda` setelah restart. Ekspor TXT atau SRT Hanzi/Indonesia melalui panel transkrip. SRT Indonesia hanya mencakup segmen dengan terjemahan tersedia, mempertahankan timestamp asli; selesaikan terjemahan dahulu untuk ekspor lengkap.

MP4/SQLite berada dalam `data/`, bukan version control. Jangan menghapus folder ini jika ingin menyimpan hasil. Validasi berlangsung setelah file diterima; penggunaan lokal tidak membatasi total ukuran request multipart sebelum parsing. Timestamp dan pemisahan kalimat bergantung kualitas ASR; tidak ada akun, YouTube, atau cloud.

## Pengujian

```powershell
cd C:\Kuliah\Project\HanziReel\Code\backend
..\.venv\Scripts\python.exe -m pytest -q
cd ..\frontend
npm test
npm run build
# Dengan npm run dev aktif dan Google Chrome terinstal:
npm run test:e2e
```

Uji backend memeriksa pemetaan ID (termasuk respons urutan terbalik/duplikat), pinyin frasa, SRT milidetik, edit vs respons model, retry, Ollama tidak tersedia, data setelah inisialisasi ulang, byte-range video, serta upload/ekstraksi media sungguhan dengan **ASR fixture**, bukan model. Uji upload media membutuhkan dependensi npm FFmpeg/FFprobe dan klip demo. Uji frontend memeriksa batas segmen dan gap.

Verifikasi Mandarin nyata: rekam sendiri klip 10–20 detik berisi `你好！今天你想做什么？我想去书店买一本书。`, simpan sebagai MP4 H.264/AAC, unggah, tunggu ASR, dan cocokkan Hanzi/waktu. Matikan Ollama untuk memastikan Hanzi tetap muncul, hidupkan lagi dan retry terjemahan. Edit satu baris, restart backend, buka kembali video yang sama, lalu cocokkan koreksi dan unduhan SRT/TXT. Model Whisper dan Ollama belum diverifikasi jika belum tersedia; lihat `VERIFICATION.md` untuk pemeriksaan yang benar-benar dijalankan pada implementasi ini.
