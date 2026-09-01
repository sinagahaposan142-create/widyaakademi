import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  q,
  run,
  ensureInit,
  getSetting,
  getAllSettings,
  setSetting,
  saveFile,
  getFile,
  deleteFile,
} from './db.js';
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
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Pastikan schema & seed siap sebelum menangani request (penting untuk serverless)
app.use(async (req, res, next) => {
  try {
    await ensureInit();
    next();
  } catch (err) {
    console.error('DB init error:', err);
    res.status(503).json({ error: 'Basis data belum siap. Coba lagi sesaat lagi.' });
  }
});

// ---- Multer (memory) ----
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 4 * 1024 * 1024; // 4 MB (batas body serverless Vercel ~4.5MB)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('INVALID_FILE_TYPE'));
  },
});

function handleUpload(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE')
          return res.status(413).json({ error: 'Ukuran file maksimal 4 MB.' });
        if (err.message === 'INVALID_FILE_TYPE')
          return res
            .status(400)
            .json({ error: 'Hanya file gambar JPG, PNG, atau WebP yang diperbolehkan.' });
        return res.status(400).json({ error: 'Gagal mengunggah file.' });
      }
      next();
    });
  };
}

const asInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? d : n;
};

async function countTerisi() {
  const rows = await q(
    "SELECT COUNT(*) AS c FROM registrations WHERE status != 'DITOLAK'"
  );
  return Number(rows[0].c);
}

// =====================================================================
// PUBLIC API
// =====================================================================
app.get('/api/info', async (req, res) => {
  const s = await getAllSettings();
  const kuotaTotal = asInt(s.kuota_total, 100);
  const terisi = await countTerisi();
  const qris = await getFile('qris', 0);
  res.json({
    kuota_total: kuotaTotal,
    kuota_terisi: terisi,
    kuota_tersisa: Math.max(0, kuotaTotal - terisi),
    biaya: asInt(s.biaya, 160000),
    kode_unik: s.kode_unik || '550',
    bank_nama: s.bank_nama,
    bank_rekening: s.bank_rekening,
    bank_atasnama: s.bank_atasnama,
    wa_kontak: s.wa_kontak,
    email_kontak: s.email_kontak,
    periode_pendaftaran: s.periode_pendaftaran,
    qris_tersedia: !!qris,
    status_pendidikan_opsi: STATUS_PENDIDIKAN,
  });
});

app.get('/api/qris', async (req, res) => {
  const f = await getFile('qris', 0);
  if (!f) return res.status(404).json({ error: 'QRIS belum tersedia.' });
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(f.data, 'base64'));
});

app.post('/api/registrations', handleUpload('bukti'), async (req, res) => {
  const { valid, errors, data } = validateRegistration(req.body);
  if (!valid) return res.status(400).json({ error: 'Validasi gagal.', fields: errors });

  const kuotaTotal = asInt(await getSetting('kuota_total'), 100);
  const terisi = await countTerisi();
  if (terisi >= kuotaTotal)
    return res.status(409).json({ error: 'Mohon maaf, kuota pendaftaran sudah penuh.' });

  const now = new Date().toISOString();
  const hasBukti = req.file ? 1 : 0;
  const result = await run(
    `INSERT INTO registrations
      (nama_lengkap, asal_sekolah, tanggal_lahir, status_pendidikan,
       nomor_wa, instagram, gmail, referral, nominal_transfer,
       has_bukti, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.nama_lengkap,
      data.asal_sekolah,
      data.tanggal_lahir,
      data.status_pendidikan,
      data.nomor_wa,
      data.instagram || null,
      data.gmail,
      data.referral || null,
      data.nominal_transfer || null,
      hasBukti,
      'MENUNGGU_VERIFIKASI',
      now,
      now,
    ]
  );

  if (req.file) {
    await saveFile('bukti', result.id, req.file.mimetype, req.file.buffer.toString('base64'));
  }

  res.status(201).json({
    ok: true,
    id: result.id,
    message:
      'Terima kasih, data Kamu berhasil dikirim dan akan segera ditindaklanjuti oleh Tim Rubela UTBK Indonesia.',
  });
});

// =====================================================================
// AUTH
// =====================================================================
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });

  const admin = await verifyCredentials(String(username).trim(), String(password));
  if (!admin) return res.status(401).json({ error: 'Username atau password salah.' });

  const token = issueToken(admin);
  setAuthCookie(res, token);
  res.json({ ok: true, token, admin: { username: admin.username, nama: admin.nama } });
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
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const totalRows = await q('SELECT COUNT(*) AS c FROM registrations');
  const total = Number(totalRows[0].c);
  const by_status = {};
  for (const st of STATUS_PENDAFTARAN) {
    const r = await q('SELECT COUNT(*) AS c FROM registrations WHERE status = ?', [st]);
    by_status[st] = Number(r[0].c);
  }
  const kuotaTotal = asInt(await getSetting('kuota_total'), 100);
  const terisi = await countTerisi();
  res.json({
    total,
    by_status,
    kuota_total: kuotaTotal,
    kuota_terisi: terisi,
    kuota_tersisa: Math.max(0, kuotaTotal - terisi),
  });
});

app.get('/api/admin/registrations', requireAdmin, async (req, res) => {
  const { q: search, status, page = '1', pageSize = '20' } = req.query;
  const where = [];
  const params = [];

  if (status && STATUS_PENDAFTARAN.includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (search && String(search).trim()) {
    const like = `%${String(search).trim()}%`;
    where.push(
      '(nama_lengkap LIKE ? OR asal_sekolah LIKE ? OR nomor_wa LIKE ? OR gmail LIKE ? OR instagram LIKE ?)'
    );
    params.push(like, like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRows = await q(`SELECT COUNT(*) AS c FROM registrations ${whereSql}`, params);
  const total = Number(totalRows[0].c);

  const p = Math.max(1, asInt(page, 1));
  const size = Math.min(100, Math.max(1, asInt(pageSize, 20)));
  const offset = (p - 1) * size;

  const rows = await q(
    `SELECT id, nama_lengkap, asal_sekolah, tanggal_lahir, status_pendidikan,
            nomor_wa, instagram, gmail, referral, nominal_transfer,
            has_bukti, status, catatan_admin, created_at, updated_at
     FROM registrations ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );

  res.json({ data: rows, page: p, pageSize: size, total, totalPages: Math.ceil(total / size) });
});

app.get('/api/admin/registrations/:id', requireAdmin, async (req, res) => {
  const rows = await q('SELECT * FROM registrations WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  res.json(rows[0]);
});

app.get('/api/admin/registrations/:id/bukti', requireAdmin, async (req, res) => {
  const f = await getFile('bukti', asInt(req.params.id));
  if (!f) return res.status(404).json({ error: 'Bukti tidak tersedia.' });
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(f.data, 'base64'));
});

app.patch('/api/admin/registrations/:id/status', requireAdmin, async (req, res) => {
  const { status, catatan_admin } = req.body || {};
  if (!STATUS_PENDAFTARAN.includes(status))
    return res.status(400).json({ error: 'Status tidak valid.' });
  const rows = await q('SELECT id FROM registrations WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Data tidak ditemukan.' });

  await run('UPDATE registrations SET status = ?, catatan_admin = ?, updated_at = ? WHERE id = ?', [
    status,
    catatan_admin || null,
    new Date().toISOString(),
    req.params.id,
  ]);
  res.json({ ok: true });
});

app.delete('/api/admin/registrations/:id', requireAdmin, async (req, res) => {
  const rows = await q('SELECT id FROM registrations WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  await deleteFile('bukti', asInt(req.params.id));
  await run('DELETE FROM registrations WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/export', requireAdmin, async (req, res) => {
  const rows = await q('SELECT * FROM registrations ORDER BY created_at DESC');
  const headers = [
    'ID', 'Nama Lengkap', 'Asal Sekolah', 'Tanggal Lahir', 'Status Pendidikan',
    'Nomor WhatsApp', 'Instagram', 'Gmail', 'Referral', 'Nominal Transfer',
    'Status', 'Catatan Admin', 'Tanggal Daftar',
  ];
  const esc = (v) => `"${(v === null || v === undefined ? '' : String(v)).replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id, r.nama_lengkap, r.asal_sekolah, r.tanggal_lahir, r.status_pendidikan,
        r.nomor_wa, r.instagram || '', r.gmail, r.referral || '', r.nominal_transfer || '',
        r.status, r.catatan_admin || '', r.created_at,
      ].map(esc).join(',')
    );
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="pendaftar-widya-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(csv);
});

app.post('/api/admin/qris', requireAdmin, handleUpload('qris'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File QRIS wajib diunggah.' });
  await saveFile('qris', 0, req.file.mimetype, req.file.buffer.toString('base64'));
  res.json({ ok: true });
});

app.delete('/api/admin/qris', requireAdmin, async (req, res) => {
  await deleteFile('qris', 0);
  res.json({ ok: true });
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  res.json(await getAllSettings());
});

app.patch('/api/admin/settings', requireAdmin, async (req, res) => {
  const editable = [
    'kuota_total', 'biaya', 'kode_unik', 'bank_nama', 'bank_rekening',
    'bank_atasnama', 'wa_kontak', 'email_kontak', 'periode_pendaftaran',
  ];
  for (const key of editable) {
    if (req.body[key] !== undefined) await setSetting(key, String(req.body[key]));
  }
  res.json({ ok: true, settings: await getAllSettings() });
});

// =====================================================================
// STATIC + PAGES
// =====================================================================
app.use(express.static(PUBLIC_DIR));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

export default app;
