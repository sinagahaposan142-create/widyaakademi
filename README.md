# Widya Nusantara Academy — Website Pendaftaran Bimbel

> _"Membuka Jalan Menuju Kampus Impian, Membangun Generasi Nusantara."_

Website pendaftaran bimbingan belajar (bimbel) persiapan **UTBK–SNBT** & seleksi
mandiri PTN untuk **Widya Nusantara Academy** (di bawah naungan Rubela UTBK
Indonesia). Aplikasi ini menggantikan alur pendaftaran manual berbasis Google
Sheet dengan formulir online, unggah bukti pembayaran, gambar QRIS, dan
**dashboard admin** terpusat.

Full-stack, ringan, tanpa langkah build — cukup `npm install` lalu `npm start`.

---

## ✨ Fitur

### Halaman Publik (`/`)
- **Landing page** lengkap: profil, visi & misi, core values, program unggulan,
  keunggulan, rincian biaya, dan program referral "Ajak Teman Dapat Cuan".
- **Formulir pendaftaran** sesuai kebutuhan:
  Nama Lengkap, Asal Sekolah, Tanggal Lahir, Status Pendidikan
  (_SMA/sederajat Kelas 12_ · _Gap Year 2025-2026_ · _Semi Gap Year 2025-2026_),
  Nomor WhatsApp, Username Instagram, Gmail Aktif, dan Kode/Nama Referral.
- **Instruksi pembayaran**: rekening Bank Neo + tombol salin, catatan **kode unik
  (550)**, dan **gambar QRIS** (jika diunggah admin).
- **Unggah bukti pembayaran** (JPG/PNG/WebP, maks 5 MB) dengan pratinjau &
  drag-and-drop.
- Validasi real-time, indikator kuota, dan layar konfirmasi sukses.
- Responsif penuh untuk **smartphone, tablet, dan laptop**.

### Dashboard Admin (`/admin`)
- **Login** aman (password di-hash bcrypt, sesi JWT via cookie httpOnly **+ fallback
  token** di `localStorage`/`Authorization: Bearer` agar dashboard tetap berfungsi
  walau cookie diblokir browser/hosting).
- **Statistik**: total pendaftar, menunggu verifikasi, terverifikasi, kuota terisi.
- **Tabel pendaftar** dengan pencarian, filter status, dan paginasi.
- **Detail pendaftar** + melihat gambar bukti pembayaran.
- **Ubah status** (Menunggu Verifikasi → Terverifikasi / Ditolak) + catatan admin.
- **Export CSV** (kompatibel Excel) — pengganti Google Sheet.
- **Kelola gambar QRIS** (unggah / hapus).
- **Pengaturan** biaya, kuota, kode unik, rekening, dan kontak — tampil otomatis
  di halaman publik.

---

## 🛠️ Teknologi

| Lapisan       | Teknologi                                   |
|---------------|---------------------------------------------|
| Backend       | Node.js + Express                           |
| Basis data    | SQLite (`better-sqlite3`) — file `data/`    |
| Penyimpanan   | Berkas gambar di folder `uploads/`          |
| Autentikasi   | `bcryptjs` + `jsonwebtoken` (cookie sesi)   |
| Unggah berkas | `multer` (validasi tipe & ukuran)           |
| Frontend      | HTML + CSS + JavaScript vanilla (responsif) |

---

## 🚀 Menjalankan

Prasyarat: **Node.js 18+**.

```bash
# 1. Install dependency
npm install

# 2. (Opsional) salin konfigurasi
cp .env.example .env

# 3. (Opsional) isi data contoh untuk demo
npm run seed

# 4. Jalankan server
npm start
```

Buka:
- Situs publik → <http://localhost:3000>
- Dashboard admin → <http://localhost:3000/admin>

### Kredensial admin default
| Username | Password    |
|----------|-------------|
| `admin`  | `widya2026` |

> Kredensial hanya dibuat saat database pertama kali diinisialisasi. Ganti lewat
> variabel `ADMIN_USERNAME` / `ADMIN_PASSWORD` sebelum menjalankan pertama kali,
> dan **selalu ganti `JWT_SECRET`** di produksi.

---

## 📁 Struktur Proyek

```
widyaakademi/
├─ server/
│  ├─ index.js        # Express app + semua route API
│  ├─ db.js           # Setup SQLite, schema, seed default
│  ├─ auth.js         # Login, JWT, middleware requireAdmin
│  ├─ validation.js   # Validasi field pendaftaran (server-side)
│  └─ seed.js         # Data contoh (npm run seed)
├─ public/
│  ├─ index.html      # Landing page + formulir pendaftaran
│  ├─ admin.html      # Dashboard admin
│  ├─ css/            # style.css (publik) & admin.css
│  └─ js/             # main.js (publik) & admin.js
├─ data/              # Basis data SQLite (dibuat otomatis, gitignored)
├─ uploads/           # Bukti pembayaran & QRIS (gitignored)
├─ .env.example
└─ package.json
```

---

## 🔌 Ringkasan API

| Method | Endpoint                                   | Akses  | Deskripsi                        |
|--------|--------------------------------------------|--------|----------------------------------|
| GET    | `/api/info`                                | Publik | Info kuota, biaya, rekening, QRIS|
| GET    | `/api/qris`                                | Publik | Gambar QRIS                      |
| POST   | `/api/registrations`                       | Publik | Kirim pendaftaran + bukti bayar  |
| POST   | `/api/auth/login` · `/logout`              | –      | Autentikasi admin                |
| GET    | `/api/admin/stats`                         | Admin  | Statistik ringkas                |
| GET    | `/api/admin/registrations`                 | Admin  | Daftar (cari/filter/paginasi)    |
| GET    | `/api/admin/registrations/:id`             | Admin  | Detail pendaftar                 |
| GET    | `/api/admin/registrations/:id/bukti`       | Admin  | Lihat bukti pembayaran           |
| PATCH  | `/api/admin/registrations/:id/status`      | Admin  | Ubah status                      |
| DELETE | `/api/admin/registrations/:id`             | Admin  | Hapus pendaftar                  |
| GET    | `/api/admin/export`                        | Admin  | Export CSV                       |
| POST   | `/api/admin/qris` · DELETE                 | Admin  | Kelola gambar QRIS               |
| GET    | `/api/admin/settings` · PATCH              | Admin  | Baca/ubah pengaturan             |

---

## 📝 Catatan

- **Backend wajib berjalan.** Dashboard admin dan pendaftaran membutuhkan server
  Node.js aktif (`npm start`). Meng-host hanya folder `public/` sebagai situs statis
  (tanpa server) akan membuat form & dashboard tidak berfungsi karena tidak ada API.
- Data pendaftar & berkas tersimpan lokal (`data/` & `uploads/`). Untuk produksi,
  pertimbangkan backup berkala atau object storage terpisah.
- Semua endpoint `/api/admin/*` diproteksi dan menolak akses tanpa sesi valid.
- Autentikasi memakai cookie httpOnly **dan** fallback token (`Authorization: Bearer`),
  sehingga tetap bekerja di berbagai konfigurasi hosting (mis. di balik proxy HTTPS).
- Validasi dilakukan di sisi klien **dan** server.

© Widya Nusantara Academy · Rubela UTBK Indonesia
