import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import db, { seedDefaults, getAllSettings, getSetting, setSetting } from './db.js';
import {
  verifyCredentials,
  issueToken,
  setAuthCookie,
  clearAuthCookie,
  requireAdmin,
} from './auth.js';
import {
  validateRegistration,
  STATUS_PENDIDIKAN,
  STATUS_PENDAFTARAN,
} from './validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

seedDefaults();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---- Multer (image upload) ----
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('INVALID_FILE_TYPE'));
  },
});

// Wrap multer to return JSON errors instead of HTML
function handleUpload(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res
            .status(413)
            .json({ error: 'Ukuran file maksimal 5 MB.' });
        }
        if (err.message === 'INVALID_FILE_TYPE') {
          return res
            .status(400)
            .json({ error: 'Hanya file gambar JPG, PNG, atau WebP yang diperbolehkan.' });
        }
        return res.status(400).json({ error: 'Gagal mengunggah file.' });
      }
      next();
    });
  };
}

// =====================================================================
// PUBLIC API
// =====================================================================

// Info publik (kuota tersisa, biaya, rekening, qris, kontak)
app.get('/api/info', (req, res) => {
  const s = getAllSettings();
  const kuotaTotal = parseInt(s.kuota_total || '100', 10);
  const terisi = db
    .prepare("SELECT COUNT(*) AS c FROM registrations WHERE status != 'DITOLAK'")
    .get().c;
  res.json({
    kuota_total: kuotaTotal,
    kuota_terisi: terisi,
    kuota_tersisa: Math.max(0, kuotaTotal - terisi),
    biaya: parseInt(s.biaya || '160000', 10),
    kode_unik: s.kode_unik || '550',
    bank_nama: s.bank_nama,
    bank_rekening: s.bank_rekening,
    bank_atasnama: s.bank_atasnama,
    wa_kontak: s.wa_kontak,
    email_kontak: s.email_kontak,
    periode_pendaftaran: s.periode_pendaftaran,
    qris_tersedia: !!s.qris_filename,
    status_pendidikan_opsi: STATUS_PENDIDIKAN,
  });
});

// Tampilkan gambar QRIS (publik)
app.get('/api/qris', (req, res) => {
  const filename = getSetting('qris_filename');
  if (!filename) return res.status(404).json({ error: 'QRIS belum tersedia.' });
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: 'QRIS belum tersedia.' });
  res.sendFile(filePath);
});

// Buat pendaftaran (dengan bukti pembayaran opsional dalam 1 langkah)
app.post('/api/registrations', handleUpload('bukti'), (req, res) => {
  const { valid, errors, data } = validateRegistration(req.body);
  if (!valid) {
    // hapus file yang terlanjur terunggah
    if (req.file) fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
    return res.status(400).json({ error: 'Validasi gagal.', fields: errors });
  }

  // Cek kuota
  const kuotaTotal = parseInt(getSetting('kuota_total') || '100', 10);
  const terisi = db
    .prepare("SELECT COUNT(*) AS c FROM registrations WHERE status != 'DITOLAK'")
    .get().c;
  if (terisi >= kuotaTotal) {
    if (req.file) fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
    return res
      .status(409)
      .json({ error: 'Mohon maaf, kuota pendaftaran sudah penuh.' });
  }

  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO registrations
        (nama_lengkap, asal_sekolah, tanggal_lahir, status_pendidikan,
         nomor_wa, instagram, gmail, referral, nominal_transfer,
         bukti_filename, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.nama_lengkap,
      data.asal_sekolah,
      data.tanggal_lahir,
      data.status_pendidikan,
      data.nomor_wa,
      data.instagram || null,
      data.gmail,
      data.referral || null,
      data.nominal_transfer || null,
      req.file ? req.file.filename : null,
      'MENUNGGU_VERIFIKASI',
      now,
      now
    );

  res.status(201).json({
    ok: true,
    id: info.lastInsertRowid,
    message:
      'Terima kasih, data Kamu berhasil dikirim dan akan segera ditindaklanjuti oleh Tim Rubela UTBK Indonesia.',
  });
});

// =====================================================================
// AUTH
// =====================================================================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });

  const admin = verifyCredentials(String(username).trim(), String(password));
  if (!admin)
    return res.status(401).json({ error: 'Username atau password salah.' });

  const token = issueToken(admin);
  setAuthCookie(res, token);
  // Token juga dikembalikan agar dashboard tetap berfungsi bila cookie diblokir
  // oleh browser/hosting (fallback Authorization: Bearer).
  res.json({
    ok: true,
    token,
    admin: { username: admin.username, nama: admin.nama },
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({ admin: { username: req.admin.username, nama: req.admin.nama } });
});

// =====================================================================
// ADMIN API
// =====================================================================

// Statistik ringkas
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM registrations').get().c;
  const byStatus = {};
  for (const st of STATUS_PENDAFTARAN) {
    byStatus[st] = db
      .prepare('SELECT COUNT(*) AS c FROM registrations WHERE status = ?')
      .get(st).c;
  }
  const kuotaTotal = parseInt(getSetting('kuota_total') || '100', 10);
  const terisi = db
    .prepare("SELECT COUNT(*) AS c FROM registrations WHERE status != 'DITOLAK'")
    .get().c;
  res.json({
    total,
    by_status: byStatus,
    kuota_total: kuotaTotal,
    kuota_terisi: terisi,
    kuota_tersisa: Math.max(0, kuotaTotal - terisi),
  });
});

// Daftar pendaftar (filter, cari, paginasi)
app.get('/api/admin/registrations', requireAdmin, (req, res) => {
  const { q, status, page = '1', pageSize = '20' } = req.query;
  const where = [];
  const params = [];

  if (status && STATUS_PENDAFTARAN.includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    where.push(
      '(nama_lengkap LIKE ? OR asal_sekolah LIKE ? OR nomor_wa LIKE ? OR gmail LIKE ? OR instagram LIKE ?)'
    );
    params.push(like, like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM registrations ${whereSql}`)
    .get(...params).c;

  const p = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (p - 1) * size;

  const rows = db
    .prepare(
      `SELECT * FROM registrations ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, size, offset);

  res.json({
    data: rows,
    page: p,
    pageSize: size,
    total,
    totalPages: Math.ceil(total / size),
  });
});

// Detail satu pendaftar
app.get('/api/admin/registrations/:id', requireAdmin, (req, res) => {
  const row = db
    .prepare('SELECT * FROM registrations WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  res.json(row);
});

// Lihat bukti pembayaran (terproteksi)
app.get('/api/admin/registrations/:id/bukti', requireAdmin, (req, res) => {
  const row = db
    .prepare('SELECT bukti_filename FROM registrations WHERE id = ?')
    .get(req.params.id);
  if (!row || !row.bukti_filename)
    return res.status(404).json({ error: 'Bukti tidak tersedia.' });
  const filePath = path.join(UPLOAD_DIR, row.bukti_filename);
  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: 'Bukti tidak tersedia.' });
  res.sendFile(filePath);
});

// Ubah status
app.patch('/api/admin/registrations/:id/status', requireAdmin, (req, res) => {
  const { status, catatan_admin } = req.body || {};
  if (!STATUS_PENDAFTARAN.includes(status))
    return res.status(400).json({ error: 'Status tidak valid.' });
  const row = db
    .prepare('SELECT id FROM registrations WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Data tidak ditemukan.' });

  db.prepare(
    'UPDATE registrations SET status = ?, catatan_admin = ?, updated_at = ? WHERE id = ?'
  ).run(status, catatan_admin || null, new Date().toISOString(), req.params.id);
  res.json({ ok: true });
});

// Hapus pendaftar
app.delete('/api/admin/registrations/:id', requireAdmin, (req, res) => {
  const row = db
    .prepare('SELECT bukti_filename FROM registrations WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  if (row.bukti_filename) {
    fs.unlink(path.join(UPLOAD_DIR, row.bukti_filename), () => {});
  }
  db.prepare('DELETE FROM registrations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Export CSV
app.get('/api/admin/export', requireAdmin, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM registrations ORDER BY created_at DESC')
    .all();

  const headers = [
    'ID',
    'Nama Lengkap',
    'Asal Sekolah',
    'Tanggal Lahir',
    'Status Pendidikan',
    'Nomor WhatsApp',
    'Instagram',
    'Gmail',
    'Referral',
    'Nominal Transfer',
    'Status',
    'Catatan Admin',
    'Tanggal Daftar',
  ];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.nama_lengkap,
        r.asal_sekolah,
        r.tanggal_lahir,
        r.status_pendidikan,
        r.nomor_wa,
        r.instagram || '',
        r.gmail,
        r.referral || '',
        r.nominal_transfer || '',
        r.status,
        r.catatan_admin || '',
        r.created_at,
      ]
        .map(esc)
        .join(',')
    );
  }
  const csv = '\uFEFF' + lines.join('\r\n'); // BOM for Excel

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="pendaftar-widya-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(csv);
});

// Upload / ganti gambar QRIS
app.post(
  '/api/admin/qris',
  requireAdmin,
  handleUpload('qris'),
  (req, res) => {
    if (!req.file)
      return res.status(400).json({ error: 'File QRIS wajib diunggah.' });
    const old = getSetting('qris_filename');
    if (old) fs.unlink(path.join(UPLOAD_DIR, old), () => {});
    setSetting('qris_filename', req.file.filename);
    res.json({ ok: true });
  }
);

// Hapus QRIS
app.delete('/api/admin/qris', requireAdmin, (req, res) => {
  const old = getSetting('qris_filename');
  if (old) fs.unlink(path.join(UPLOAD_DIR, old), () => {});
  setSetting('qris_filename', '');
  res.json({ ok: true });
});

// Pengaturan (get/update)
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json(getAllSettings());
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const editable = [
    'kuota_total',
    'biaya',
    'kode_unik',
    'bank_nama',
    'bank_rekening',
    'bank_atasnama',
    'wa_kontak',
    'email_kontak',
    'periode_pendaftaran',
  ];
  for (const key of editable) {
    if (req.body[key] !== undefined) setSetting(key, String(req.body[key]));
  }
  res.json({ ok: true, settings: getAllSettings() });
});

// =====================================================================
// STATIC + PAGES
// =====================================================================
app.use(express.static(PUBLIC_DIR));

app.get('/admin', (req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'))
);
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Widya Nusantara Academy berjalan di http://localhost:${PORT}`);
});
