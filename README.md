# Widya Nusantara Academy — Website Pendaftaran Bimbel

> _"Membuka Jalan Menuju Kampus Impian, Membangun Generasi Nusantara."_

Website pendaftaran bimbingan belajar (bimbel) persiapan **UTBK–SNBT** & seleksi
mandiri PTN untuk **Widya Nusantara Academy** (di bawah naungan Rubela UTBK
Indonesia). Menggantikan pendaftaran manual berbasis Google Sheet dengan formulir
online, unggah bukti pembayaran, gambar QRIS, dan **dashboard admin** terpusat.

**Siap deploy ke Vercel** (serverless) dengan basis data **Turso** (libSQL).

---

## ✨ Fitur

### Halaman Publik (`/`)
- Landing page lengkap: profil, visi & misi, core values, program unggulan,
  biaya, dan program referral "Ajak Teman Dapat Cuan".
- Formulir pendaftaran: Nama Lengkap, Asal Sekolah, Tanggal Lahir, Status
  Pendidikan (_SMA Kelas 12_ · _Gap Year_ · _Semi Gap Year_), Nomor WhatsApp,
  Instagram, Gmail, dan Kode/Nama Referral.
- Instruksi pembayaran (Bank Neo + salin no. rek + kode unik **550**) dan gambar **QRIS**.
- Unggah bukti pembayaran (JPG/PNG/WebP, maks 4 MB) dengan pratinjau.
- Responsif penuh untuk **smartphone, tablet, dan laptop**.

### Dashboard Admin (`/admin`)
- Login aman (bcrypt + JWT via cookie httpOnly **dan** fallback token).
- Statistik, tabel pendaftar (cari/filter/paginasi), detail + lihat bukti.
- Ubah status, catatan admin, hapus data.
- **Export CSV**, kelola gambar **QRIS**, dan pengaturan (biaya/kuota/rekening/kontak).

---

## 🛠️ Teknologi

| Lapisan     | Teknologi                                               |
|-------------|---------------------------------------------------------|
| Backend     | Node.js + Express (berjalan sebagai Serverless Function di Vercel) |
| Basis data  | **libSQL / Turso** (SQLite-compatible, serverless)      |
| Gambar      | Disimpan langsung di basis data (base64) — tanpa disk   |
| Auth        | `bcryptjs` + `jsonwebtoken`                             |
| Upload      | `multer` (memory, validasi tipe & ukuran)               |
| Frontend    | HTML + CSS + JavaScript vanilla (responsif)             |

> **Kenapa Turso?** Vercel bersifat *serverless* — tidak punya penyimpanan file
> permanen. Basis data SQLite lokal akan hilang di setiap request. Turso menyediakan
> database libSQL (SQLite) yang bisa diakses dari serverless, dengan tier gratis.

---

## 🚀 Deploy ke Vercel (langkah demi langkah)

### 1. Siapkan basis data Turso (gratis)
1. Daftar di <https://turso.tech> (bisa login pakai GitHub).
2. Buat database baru (misal nama `widya`).
3. Catat **Database URL** (bentuknya `libsql://widya-xxxx.turso.io`).
4. Buat **auth token** untuk database tersebut, lalu salin token-nya.

> Bisa lewat dashboard web Turso, atau via CLI:
> ```bash
> turso db create widya
> turso db show widya --url          # -> TURSO_DATABASE_URL
> turso db tokens create widya       # -> TURSO_AUTH_TOKEN
> ```

### 2. Deploy ke Vercel
1. Push repo ini ke GitHub (sudah dilakukan).
2. Buka <https://vercel.com> → **Add New… → Project** → pilih repo `widyaakademi`.
3. Framework Preset: **Other** (biarkan default; `vercel.json` sudah mengatur build).
4. Pada bagian **Environment Variables**, tambahkan:

   | Name | Value |
   |------|-------|
   | `TURSO_DATABASE_URL` | `libsql://widya-xxxx.turso.io` |
   | `TURSO_AUTH_TOKEN`   | _(token dari Turso)_ |
   | `JWT_SECRET`         | _(teks acak panjang & rahasia)_ |
   | `ADMIN_USERNAME`     | _(username admin pilihanmu)_ |
   | `ADMIN_PASSWORD`     | _(password admin pilihanmu)_ |

5. Klik **Deploy**. Selesai — situs publik di domain Vercel, dan dashboard di `/admin`.

> Akun admin dibuat otomatis saat pertama kali database diakses, memakai
> `ADMIN_USERNAME` / `ADMIN_PASSWORD`. **Ganti nilai default sebelum deploy.**
> Jika ingin mengganti password admin setelah deploy, ubah data pada tabel
> `admins` di Turso, atau kosongkan tabel `admins` agar dibuat ulang dari env var.

---

## 💻 Menjalankan secara lokal

Prasyarat: **Node.js 18+**. Tanpa env var, aplikasi memakai file lokal
`data/widya.db` (mode dev — tidak perlu Turso).

```bash
npm install
npm run seed     # (opsional) isi data contoh
npm start
```
- Situs publik → <http://localhost:3000>
- Dashboard admin → <http://localhost:3000/admin>

### Kredensial admin default (lokal)
| Username | Password    |
|----------|-------------|
| `admin`  | `widya2026` |

---

## 📁 Struktur Proyek

```
widyaakademi/
├─ api/
│  └─ index.js       # Entry Vercel (export aplikasi Express)
├─ server/
│  ├─ app.js         # Aplikasi Express + seluruh route API
│  ├─ index.js       # Listener lokal (npm start)
│  ├─ db.js          # libSQL/Turso: schema, query, penyimpanan gambar
│  ├─ auth.js        # Login, JWT, middleware requireAdmin
│  ├─ validation.js  # Validasi field pendaftaran (server-side)
│  └─ seed.js        # Data contoh (npm run seed)
├─ public/           # Frontend statis (index.html, admin.html, css, js)
├─ vercel.json       # Konfigurasi build & routing Vercel
├─ .env.example
└─ package.json
```

---

## 🔌 Ringkasan API

| Method | Endpoint                               | Akses  | Deskripsi                     |
|--------|----------------------------------------|--------|-------------------------------|
| GET    | `/api/info`                            | Publik | Kuota, biaya, rekening, QRIS  |
| GET    | `/api/qris`                            | Publik | Gambar QRIS                   |
| POST   | `/api/registrations`                   | Publik | Kirim pendaftaran + bukti     |
| POST   | `/api/auth/login` · `/logout`          | –      | Autentikasi admin             |
| GET    | `/api/admin/stats`                     | Admin  | Statistik ringkas             |
| GET    | `/api/admin/registrations`             | Admin  | Daftar (cari/filter/paginasi) |
| GET    | `/api/admin/registrations/:id`         | Admin  | Detail pendaftar              |
| GET    | `/api/admin/registrations/:id/bukti`   | Admin  | Lihat bukti pembayaran        |
| PATCH  | `/api/admin/registrations/:id/status`  | Admin  | Ubah status                   |
| DELETE | `/api/admin/registrations/:id`         | Admin  | Hapus pendaftar               |
| GET    | `/api/admin/export`                    | Admin  | Export CSV                    |
| POST   | `/api/admin/qris` · DELETE             | Admin  | Kelola gambar QRIS            |
| GET    | `/api/admin/settings` · PATCH          | Admin  | Baca/ubah pengaturan          |

---

## 📝 Catatan
- Batas ukuran gambar **4 MB** (menyesuaikan batas body Serverless Function Vercel).
- Semua endpoint `/api/admin/*` diproteksi; menolak akses tanpa sesi valid.
- Validasi dilakukan di sisi klien **dan** server.
- Untuk backup, ekspor CSV secara berkala atau backup database via Turso.

© Widya Nusantara Academy · Rubela UTBK Indonesia
