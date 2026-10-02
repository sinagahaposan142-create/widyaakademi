# Widya Nusantara Academy — Website Pendaftaran Bimbel

> _"Membuka Jalan Menuju Kampus Impian, Membangun Generasi Nusantara."_

Website pendaftaran bimbingan belajar persiapan **UTBK–SNBT** & seleksi mandiri PTN
untuk **Widya Nusantara Academy** (di bawah naungan Rubela UTBK Indonesia).
Terdiri dari tiga aplikasi dalam satu deployment:

| Halaman      | URL           | Untuk siapa            |
|--------------|---------------|------------------------|
| Landing + formulir pendaftaran | `/`          | Calon murid |
| **Panel Admin** | `/admin`     | Pengelola |
| **Dashboard Affiliator** | `/affiliasi` | Affiliator pemilik kode referral |

**Siap deploy ke Vercel** (serverless) dengan basis data **Turso** (libSQL).

---

## ✨ Fitur

### Halaman publik (`/`)
- Landing page: profil, visi & misi, core values, program unggulan, biaya, program referral.
- **Kuota Tersisa otomatis berkurang** setiap ada pendaftar baru — angkanya dimuat dari
  server, disegarkan tiap 60 detik, saat tab kembali aktif, dan langsung setelah submit.
- Formulir pendaftaran: Nama Lengkap, Asal Sekolah, Tanggal Lahir, Status Pendidikan,
  Nomor WhatsApp, Instagram, Gmail, **Kode Referral** (diperiksa langsung ke server
  saat diketik), Nominal Transfer, dan unggah bukti pembayaran.
- Tautan referral `/?ref=KODE` otomatis mengisi kolom kode referral.
- Semua angka & teks (biaya, kuota, periode, durasi, jumlah try out, rekening,
  kontak, komisi) diambil dari pengaturan admin — **tidak ada lagi angka hardcoded**.
- Pendaftaran otomatis tertutup bila kuota penuh, di luar jendela tanggal,
  atau dimatikan admin — dengan pesan alasan yang jelas.

### Panel Admin (`/admin`)
Sidebar dengan 9 halaman:

1. **Dashboard** — kartu statistik, progres kuota, estimasi pendapatan, grafik
   tren 14 hari, komposisi status pendidikan, affiliator teratas, aktivitas terbaru.
2. **Data Pendaftar** — pencarian + 8 filter (status, pendidikan, referral, bukti,
   rentang tanggal, urutan, ukuran halaman), pilih banyak + **aksi massal**,
   modal detail (lihat bukti pembayaran, ubah status + catatan, **perbaiki data**,
   hapus), **export CSV mengikuti filter aktif**.
3. **Affiliator** — daftar + statistik referral & komisi per affiliator, setujui/tolak,
   tambah manual, ubah data & kode referral, reset password, **catat pembayaran
   komisi**, lihat semua pengguna kode referralnya, export CSV.
4. **Pembayaran & QRIS** — biaya, kode unik, rekening, unggah/hapus gambar QRIS.
5. **Logo & Branding** — nama situs, tagline, teks logo, **unggah logo** (mengganti
   kotak "W" di seluruh situs) dan **unggah favicon** (ikon tab Chrome).
6. **Pengaturan** — kuota, durasi program, jumlah try out, periode pendaftaran
   (teks + rentang tanggal + tombol buka/tutup), kontak (WA/email/Instagram),
   program affiliasi (aktif, auto-approve, komisi, syarat), ganti password sendiri.
7. **Akun Admin** (khusus Super Admin) — tambah/ubah/hapus admin, atur peran,
   aktif/nonaktif, reset password.
8. **Log Aktivitas** — jejak audit semua tindakan (siapa, apa, kapan, IP), dengan
   filter dan pembersihan log lama.
9. **Kesehatan Sistem** — status database, jumlah baris, pemakaian penyimpanan
   gambar, dan status konfigurasi environment (tanpa pernah menampilkan nilainya).

### Dashboard Affiliator (`/affiliasi`)
- Pendaftaran akun affiliator sendiri (boleh mengajukan kode referral pilihan,
  atau dibuat otomatis oleh sistem).
- Kartu **kode referral** + tautan referral siap bagikan + tombol salin & bagikan ke WhatsApp.
- Statistik: total referral, terverifikasi, menunggu, komisi diperoleh/dibayar/sisa,
  grafik tren, riwayat pembayaran komisi.
- **Tabel siapa saja yang memakai kode referralnya** (nama, sekolah, status, tanggal) —
  nomor WA & email disamarkan sebagian demi privasi pendaftar.
- Export CSV, ubah profil & rekening penerimaan komisi, ganti password.

---

## 🔐 Keamanan

- **Password di-hash dengan `scrypt`** (`node:crypto`). Hash `bcrypt` lama tetap bisa
  login dan otomatis dimutakhirkan ke scrypt setelah login sukses.
- **Tidak ada kredensial maupun secret dalam bentuk teks di repository.**
  Akun Super Admin bawaan hanya menyimpan *hash* scrypt-nya di kode; password
  aslinya tidak bisa direkonstruksi dari kode sumber maupun dari halaman web.
- **`JWT_SECRET` tanpa fallback hardcoded.** Bila env kosong, secret acak dibuat
  sekali lalu dipersist di database (key privat `_jwt_secret`, tidak pernah
  diekspos oleh API pengaturan).
- Sesi admin dan affiliator memakai **cookie httpOnly terpisah** dengan token
  ber-`role`; token admin tidak bisa dipakai di endpoint affiliator dan sebaliknya.
  Setiap request memverifikasi ulang akun ke database, sehingga akun yang
  dinonaktifkan langsung kehilangan akses walau tokennya belum kedaluwarsa.
- **Rate limiting** pada login admin, login & pendaftaran affiliator, pendaftaran
  murid, pemeriksaan kode referral, dan penggantian password.
- Unggahan gambar diverifikasi lewat **magic bytes** (bukan hanya `Content-Type`
  dari klien) dan disajikan kembali dengan `X-Content-Type-Options: nosniff`.
- Header keamanan (**CSP**, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`)
  dipasang di Express *dan* di `vercel.json` (agar berlaku juga untuk aset dari CDN).
- Halaman `/admin` diberi `noindex, nofollow`, dan tautannya **tidak lagi
  dipublikasikan di footer situs utama**.

---

## 🛠️ Teknologi

| Lapisan     | Teknologi                                                          |
|-------------|--------------------------------------------------------------------|
| Backend     | Node.js + Express (Serverless Function di Vercel)                  |
| Basis data  | **libSQL / Turso** (SQLite-compatible, serverless)                 |
| Gambar      | Disimpan di basis data (base64) — tanpa disk, aman di serverless   |
| Auth        | `scrypt` (node:crypto) + `jsonwebtoken`, cookie httpOnly           |
| Upload      | `multer` (memory) + verifikasi magic bytes                         |
| Frontend    | HTML + CSS + JavaScript vanilla, tanpa build step                  |

> **Kenapa Turso?** Vercel bersifat serverless — tidak punya penyimpanan file
> permanen, jadi file SQLite lokal akan hilang setiap request. Turso menyediakan
> database libSQL yang bisa diakses dari serverless, dengan tier gratis.

---

## 🧮 Cara kuota dihitung

```
kuota_tersisa = kuota_total − jumlah pendaftar yang status-nya BUKAN "DITOLAK"
```

- Pendaftar baru langsung mengurangi kuota tersisa.
- Pendaftar yang **Ditolak** mengembalikan kuotanya (kursinya bisa dipakai orang lain).
- Menghapus pendaftar juga mengembalikan kuota.

Penyimpanan pendaftar memakai **satu statement `INSERT … SELECT … WHERE`** yang
sekaligus memeriksa kuota dan duplikat email/WA. Karena pemeriksaan dan penulisan
terjadi dalam satu operasi atomik, dua pendaftar yang menekan "kirim" pada detik
yang sama **tidak mungkin** sama-sama lolos di kursi terakhir (tidak ada overbooking).

---

## 🚀 Deploy ke Vercel

### 1. Import project
1. Push repo ini ke GitHub.
2. Buka <https://vercel.com> → **Add New… → Project** → pilih repo `widyaakademi`.
3. Framework Preset: **Other** (`vercel.json` sudah mengatur routing & header).
4. Siapkan database & env var dulu (langkah 2–3) sebelum deploy.

### 2. Database Turso (gratis)

**Termudah — integrasi Vercel:** halaman project → tab **Storage** →
**Create Database** → **Turso** → ikuti wizard. Env var `TURSO_DATABASE_URL`
dan `TURSO_AUTH_TOKEN` terisi otomatis.

**Manual:**
```bash
turso db create widya
turso db show widya --url      # -> TURSO_DATABASE_URL
turso db tokens create widya   # -> TURSO_AUTH_TOKEN
```
lalu tambahkan keduanya di **Settings → Environment Variables**.

### 3. Env var & deploy

| Name                 | Wajib | Keterangan |
|----------------------|-------|------------|
| `TURSO_DATABASE_URL` | ✅    | URL database Turso |
| `TURSO_AUTH_TOKEN`   | ✅    | Token akses Turso |
| `JWT_SECRET`         | Sangat disarankan | Teks acak panjang. Buat dengan `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ADMIN_USERNAME`     | Opsional | Bila diisi bersama `ADMIN_PASSWORD`, akun ini dibuat/diperbarui sebagai Super Admin |
| `ADMIN_PASSWORD`     | Opsional | Lihat catatan di bawah |
| `NODE_ENV`           | Disarankan | Set `production` agar cookie sesi memakai flag `Secure` |

Klik **Deploy** (atau **Redeploy** bila env var ditambahkan setelah deploy pertama).

> ⚠️ Setiap kali menambah/mengubah Environment Variables, lakukan **Redeploy**.
> Jika `TURSO_DATABASE_URL` belum diset, endpoint API membalas pesan yang jelas
> (bukan crash).

### Tentang kredensial admin

- **Jika `ADMIN_USERNAME` + `ADMIN_PASSWORD` dikosongkan:** aplikasi memastikan
  akun Super Admin bawaan tersedia melalui migrasi satu-kali, termasuk pada
  database Turso lama yang sudah mempunyai akun `admin`. Password-nya **tidak ada
  dalam bentuk teks di repository** — hanya hash scrypt-nya yang tertanam di
  `server/db.js`. Setelah migrasi ditandai selesai, cold start berikutnya tidak
  akan menimpa password yang sudah diganti dari **Pengaturan → Ganti Password**.
  Saat akun bootstrap dipakai pertama kali, seluruh endpoint admin dikunci dan
  panel mewajibkan pembuatan password pribadi sebelum dashboard dapat dibuka.
  Setelah password diganti, semua sesi lain akun itu otomatis dikeluarkan.
- **Catatan upgrade:**
  - Admin lama dari database versi awal (sebelum ada peran) tetap memiliki hak
    penuh (Super Admin) setelah upgrade.
  - Akun `wna.superadmin` yang sudah ada **tidak** diubah peran, status aktif,
    maupun password-nya oleh migrasi. Akun yang pernah dihapus tidak dibuat ulang
    selama catatan penghapusannya masih ada di Log Aktivitas. Jika kamu pernah
    menghapus akun tersebut **lalu** membersihkan log, set `ADMIN_USERNAME` dan
    `ADMIN_PASSWORD` sebelum upgrade agar migrasi akun bawaan tidak dijalankan.
- **Jika `ADMIN_PASSWORD` diisi:** nilainya bersifat *authoritative* dan
  menimpa password di database pada setiap cold start. Kalau kamu mengganti
  password dari panel admin, **perbarui juga nilai env var-nya** agar tidak
  tertimpa balik saat deploy berikutnya. Untuk mengelola password sepenuhnya
  dari panel admin, kosongkan saja kedua env var ini setelah akun pertama ada.

Butuh admin tambahan? Masuk sebagai Super Admin → **Akun Admin → Tambah Admin**.
Password dibuat otomatis dan ditampilkan sekali.

---

## 💻 Menjalankan secara lokal

Prasyarat: **Node.js 20+**. Tanpa env var Turso, aplikasi memakai file lokal
`data/widya.db` (mode dev).

```bash
npm install
cp .env.example .env    # opsional, lalu isi nilainya
npm run dev             # memuat .env, hot reload  (atau: npm run dev:noenv)
npm run seed            # opsional: data contoh untuk dev
```

- Situs publik → <http://localhost:3000>
- Panel admin → <http://localhost:3000/admin>
- Dashboard affiliator → <http://localhost:3000/affiliasi>

Untuk login pertama secara lokal, set `ADMIN_USERNAME` & `ADMIN_PASSWORD` di `.env`
(nilainya bebas) — akun tersebut langsung dibuat sebagai Super Admin.

---

## 📁 Struktur Proyek

```
widyaakademi/
├─ api/
│  └─ [...path].js        # Entry Vercel: semua /api/* -> aplikasi Express
├─ server/
│  ├─ app.js              # Express + seluruh route API
│  ├─ index.js            # Listener lokal (npm run dev / npm start)
│  ├─ db.js               # libSQL/Turso: skema, migrasi, query, penyimpanan gambar
│  ├─ auth.js             # Sesi admin & affiliator, JWT, middleware peran
│  ├─ password.js         # Hash scrypt + verifikasi (kompatibel bcrypt lama)
│  ├─ validation.js       # Validasi pendaftaran, affiliator, dan pengaturan
│  ├─ ratelimit.js        # Rate limiter sliding-window
│  └─ seed.js             # Data contoh (npm run seed)
├─ public/
│  ├─ index.html          # Landing + formulir pendaftaran
│  ├─ admin.html          # Panel admin
│  ├─ affiliasi.html      # Pendaftaran + dashboard affiliator
│  ├─ css/                # style.css · admin.css · affiliate.css
│  └─ js/                 # branding.js (bersama) · main.js · admin.js · affiliate.js
├─ vercel.json            # Routing + header keamanan + konfigurasi function
├─ .env.example
└─ package.json
```

---

## 🗄️ Skema Basis Data

| Tabel            | Isi |
|------------------|-----|
| `registrations`  | Data pendaftar + `affiliator_id`, `referral_kode`, `nominal_num`, `verified_at`, `verified_by` |
| `affiliators`    | Akun affiliator + `kode_referral` (unik), rekening, `status`, `catatan_admin` |
| `komisi_payouts` | Riwayat pembayaran komisi ke affiliator |
| `admins`         | Akun admin + `role` (SUPERADMIN/ADMIN), `is_active`, `last_login_at` |
| `settings`       | Pengaturan situs (key–value). Key berawalan `_` bersifat privat & tidak diekspos API |
| `files`          | Gambar base64: `bukti` (per pendaftar), `logo`, `favicon`, `qris` |
| `activity_log`   | Jejak audit semua tindakan |

Skema dibuat & dimigrasikan otomatis saat request pertama (`ensureInit`), termasuk
`ALTER TABLE ADD COLUMN` yang idempoten untuk database yang sudah berisi data —
jadi **upgrade dari versi sebelumnya tidak menghilangkan data apa pun**.

---

## 🔌 Ringkasan API

### Publik
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET  | `/api/info` | Kuota, biaya, periode, rekening, kontak, branding, status pendaftaran |
| GET  | `/api/qris` · `/api/logo` · `/api/favicon` | Gambar yang dikelola admin |
| GET  | `/api/referral/check?kode=` | Validasi kode referral |
| POST | `/api/registrations` | Kirim pendaftaran + bukti (multipart) |

### Affiliator
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST   | `/api/affiliate/register` · `/login` · `/logout` | Akun & sesi |
| GET    | `/api/affiliate/me` · `/stats` · `/referrals` · `/export` | Data dashboard |
| PATCH  | `/api/affiliate/profile` | Ubah profil & rekening |
| POST   | `/api/affiliate/change-password` | Ganti password |

### Admin (`requireAdmin`)
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST   | `/api/auth/login` · `/logout` · `/change-password` | Sesi admin |
| GET    | `/api/auth/me` | Profil sesi |
| GET    | `/api/admin/overview` | Statistik dashboard |
| GET    | `/api/admin/registrations` · `/:id` · `/:id/bukti` · `/export` | Data pendaftar |
| PATCH  | `/api/admin/registrations/:id` · `/:id/status` | Perbaiki data / ubah status |
| POST   | `/api/admin/registrations/bulk-status` | Aksi massal |
| DELETE | `/api/admin/registrations/:id` | Hapus pendaftar |
| GET    | `/api/admin/affiliators` · `/:id` · `/export` | Data affiliator |
| POST   | `/api/admin/affiliators` · `/:id/reset-password` · `/:id/payouts` | Kelola affiliator |
| PATCH  | `/api/admin/affiliators/:id` | Ubah data / status |
| DELETE | `/api/admin/affiliators/:id` · `/api/admin/payouts/:id` | Hapus |
| GET    | `/api/admin/settings` · `/api/admin/branding` | Baca konfigurasi |
| PATCH  | `/api/admin/settings` | Ubah pengaturan (tervalidasi per tipe) |
| POST   | `/api/admin/branding/:kind` · DELETE | Logo · favicon · QRIS |
| GET    | `/api/admin/admins` *(Super Admin)* | Daftar admin |
| POST   | `/api/admin/admins` · PATCH `/:id` · DELETE `/:id` *(Super Admin)* | Kelola admin |
| GET    | `/api/admin/activity` · DELETE *(Super Admin)* | Log aktivitas |
| GET    | `/api/admin/health` | Kesehatan sistem |

---

## 📝 Catatan operasional

- Batas ukuran gambar **3 MB**, aman di bawah batas body Serverless Function Vercel
  (~4,5 MB) sehingga pesan error selalu berupa JSON yang ramah, bukan HTML platform.
- Satu email dan satu nomor WhatsApp hanya boleh dipakai satu pendaftaran aktif;
  ditegakkan secara atomik di level query.
- Affiliator tidak bisa memakai kode referralnya sendiri untuk mendaftar.
- Menghapus affiliator **tidak** menghapus data pendaftar — hanya melepas tautannya,
  sementara kode referral historis tetap tersimpan.
- Zona waktu yang dipakai untuk perbandingan tanggal adalah **Asia/Jakarta (WIB)**.
- Rate limiter menyimpan state di memori per instance. Di serverless ini menahan
  burst dari satu sumber; perlindungan terhadap duplikasi data tetap dijamin
  oleh constraint & query atomik di database.
- Untuk backup, ekspor CSV secara berkala atau backup database via Turso.

---

## 📞 Kontak

- WhatsApp: **0895360396759**
- Email: **rubelautbk@gmail.com**
- Instagram: **@rubelaindonesia**

Semua kontak di atas bisa diubah kapan saja dari **Panel Admin → Pengaturan → Kontak**.

© Widya Nusantara Academy · Rubela UTBK Indonesia
