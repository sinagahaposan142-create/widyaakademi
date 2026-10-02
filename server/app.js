import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureInit,
  q,
  run,
  one,
  scalar,
  getSetting,
  getSettingInt,
  getAllSettings,
  getPublicSettings,
  setSetting,
  saveFile,
  getFile,
  hasFile,
  deleteFile,
  logActivity,
  isDefaultAdminPassword,
  ROLE_ADMIN,
  ROLE_SUPERADMIN,
} from './db.js';

import {
  ADMIN_COOKIE,
  AFF_COOKIE,
  requireAdmin,
  requireSuperAdmin,
  requireAffiliator,
  verifyAdminCredentials,
  verifyAffiliatorCredentials,
  issueAdminToken,
  issueAffiliatorToken,
  setAuthCookie,
  clearAuthCookie,
} from './auth.js';

import {
  hashPassword,
  verifyPassword,
  randomPassword,
  suggestReferralCode,
} from './password.js';

import {
  STATUS_PENDIDIKAN,
  STATUS_PENDAFTARAN,
  STATUS_AFFILIATOR,
  validateRegistration,
  validateAffiliator,
  validateAffiliatorProfile,
  validateSettings,
  validatePassword,
  SETTINGS_SCHEMA,
  normalizeKode,
  normalizeWa,
  waToIntl,
  str,
} from './validation.js';

import { limiter, clientIp, reset as resetLimit } from './ratelimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.set('trust proxy', 1);
app.set('x-powered-by', false);

/*
 * Di Vercel, runtime Node dapat sudah mengurai body JSON / urlencoded sebelum
 * Express berjalan. Bila itu terjadi, stream request sudah habis dan
 * express.json() akan menunggu event 'data' yang tak pernah datang.
 * Middleware ini menandai body sebagai "sudah diurai" agar body-parser melewatinya.
 * Hanya menyentuh req.body untuk dua content-type yang memang diurai platform —
 * multipart/form-data tidak pernah disentuh supaya multer tetap membaca stream.
 */
app.use((req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (/application\/json|application\/x-www-form-urlencoded/i.test(ct)) {
    try {
      const pre = req.body;
      if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre) && Object.keys(pre).length) {
        req._body = true;
      }
    } catch {
      /* platform tidak menyediakan body pre-parsed — abaikan */
    }
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

/** Bungkus handler async agar error-nya sampai ke error handler Express. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------------ *
 * Header keamanan dasar
 * ------------------------------------------------------------------ */
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (!req.path.startsWith('/api/')) {
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "object-src 'none'",
      ].join('; ')
    );
  }
  next();
});

/* ------------------------------------------------------------------ *
 * Diagnostik ringan — TIDAK butuh database.
 * Didaftarkan sebelum middleware ensureInit agar bisa dipakai memverifikasi
 * routing & konfigurasi meski Turso belum diset. Tidak membocorkan nilai env.
 * ------------------------------------------------------------------ */
function diagHandler(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    method: req.method,
    url: req.url,
    path: req.path,
    matched: 'express',
    node: process.version,
    original_pathname: req.headers['x-vercel-original-pathname'] || null,
    env: {
      // hanya status true/false, bukan nilainya
      turso_url: !!(
        process.env.TURSO_DATABASE_URL ||
        process.env.LIBSQL_URL ||
        process.env.DATABASE_URL
      ),
      turso_token: !!(process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN),
      jwt_secret: !!process.env.JWT_SECRET,
      admin_env: !!(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD),
      vercel: !!process.env.VERCEL,
    },
  });
}
app.get('/api/_diag', diagHandler);
app.get('/api/_diag/auth/login', diagHandler);

/* ------------------------------------------------------------------ *
 * Pastikan database siap sebelum request API diproses
 * ------------------------------------------------------------------ */
app.use(async (req, res, next) => {
  try {
    await ensureInit();
    return next();
  } catch (err) {
    console.error('[db] init gagal:', err?.message);
    // Halaman HTML tetap boleh tampil (JS-nya akan menampilkan pesan error),
    // hanya endpoint API yang dibalas 503 dalam bentuk JSON.
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({
        code: 'DATABASE_INIT_FAILED',
        error:
          'Basis data belum siap / belum dikonfigurasi. Hubungi administrator (cek TURSO_DATABASE_URL & TURSO_AUTH_TOKEN).',
      });
    }
    return next();
  }
});

/* ------------------------------------------------------------------ *
 * Upload gambar (memori) + validasi magic bytes
 * ------------------------------------------------------------------ */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 3 * 1024 * 1024; // 3 MB — aman di bawah batas body Vercel (~4.5 MB)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: 1, fields: 40 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      const err = new Error('Format file harus JPG, PNG, atau WebP.');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err);
    }
    return cb(null, true);
  },
});

/**
 * Tentukan tipe gambar dari byte awal file (bukan dari klaim klien yang bisa
 * dipalsukan). Mengembalikan mime terdeteksi atau null bila bukan gambar.
 */
function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Middleware upload satu file dengan pesan error yang ramah pengguna. */
function handleUpload(field) {
  const mw = upload.single(field);
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'Ukuran file maksimal 3 MB.',
          fields: { [field]: 'Ukuran file maksimal 3 MB.' },
        });
      }
      if (err.code === 'INVALID_FILE_TYPE') {
        return res
          .status(400)
          .json({ error: err.message, fields: { [field]: err.message } });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Field file tidak dikenali.' });
      }
      console.error('[upload] gagal:', err?.message);
      return res.status(400).json({ error: 'Gagal mengunggah file.' });
    });
  };
}

/**
 * Ambil file dari request, verifikasi magic bytes, kembalikan { mime, base64 }.
 * @returns {{ ok: true, mime: string, base64: string } | { ok: false, error: string }}
 */
function readImageUpload(req) {
  if (!req.file) return { ok: false, error: 'Tidak ada file yang diunggah.' };
  const sniffed = sniffImageMime(req.file.buffer);
  if (!sniffed) {
    return {
      ok: false,
      error: 'File yang diunggah bukan gambar JPG/PNG/WebP yang valid.',
    };
  }
  return { ok: true, mime: sniffed, base64: req.file.buffer.toString('base64') };
}

/** Kirim gambar dari DB dengan header anti-sniffing. */
function sendImage(res, file, { cacheSeconds = 0 } = {}) {
  const buf = Buffer.from(file.data, 'base64');
  res.set('Content-Type', ALLOWED_MIME.includes(file.mime) ? file.mime : 'image/png');
  res.set('Content-Disposition', 'inline');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set(
    'Cache-Control',
    cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store'
  );
  res.set('Content-Length', String(buf.length));
  return res.end(buf);
}

/* ------------------------------------------------------------------ *
 * Util
 * ------------------------------------------------------------------ */
const asInt = (v, d = 0) => {
  const n = Number.parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : d;
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Tanggal hari ini (YYYY-MM-DD) menurut zona waktu Asia/Jakarta. */
function todayJakarta() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Jumlah kursi terpakai. Pendaftar DITOLAK tidak menghabiskan kuota. */
function countTerisiSql() {
  return "SELECT COUNT(*) AS c FROM registrations WHERE status <> 'DITOLAK'";
}

async function getKuota(settings) {
  const total = asInt(settings?.kuota_total, 100);
  const terisi = await scalar(countTerisiSql());
  const tersisa = Math.max(0, total - terisi);
  return {
    kuota_total: total,
    kuota_terisi: terisi,
    kuota_tersisa: tersisa,
    persen_terisi: total > 0 ? Math.min(100, Math.round((terisi / total) * 100)) : 0,
  };
}

/**
 * Apakah pendaftaran sedang dibuka? Menggabungkan tombol manual,
 * jendela tanggal, dan ketersediaan kuota.
 */
function evaluasiPendaftaran(settings, kuota) {
  if (String(settings.pendaftaran_aktif ?? '1') !== '1') {
    return { dibuka: false, alasan: 'Pendaftaran sedang ditutup oleh admin.' };
  }
  const hari = todayJakarta();
  const mulai = str(settings.periode_mulai);
  const selesai = str(settings.periode_selesai);
  if (mulai && hari < mulai) {
    return {
      dibuka: false,
      alasan: `Pendaftaran dibuka mulai ${settings.periode_pendaftaran || mulai}.`,
    };
  }
  if (selesai && hari > selesai) {
    return { dibuka: false, alasan: 'Masa pendaftaran sudah berakhir.' };
  }
  if (kuota.kuota_tersisa <= 0) {
    return { dibuka: false, alasan: 'Mohon maaf, kuota pendaftaran sudah penuh.' };
  }
  return { dibuka: true, alasan: null };
}

/** Versi branding untuk cache-busting URL logo/favicon/QRIS. */
async function brandingVersion() {
  const row = await one(
    "SELECT MAX(created_at) AS v FROM files WHERE scope IN ('logo','favicon','qris')"
  );
  const v = row?.v ? String(row.v) : '';
  return v ? Date.parse(v) || 0 : 0;
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function buildCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return '\uFEFF' + lines.join('\r\n');
}

function sendCsv(res, filename, content) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.set('Cache-Control', 'no-store');
  return res.send(content);
}

function fmtTanggalId(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

const actorAdmin = (req) => ({
  actorType: 'ADMIN',
  actorId: req.admin?.id,
  actorNama: req.admin?.username,
  ip: clientIp(req),
});

const actorAff = (req) => ({
  actorType: 'AFFILIATOR',
  actorId: req.affiliator?.id,
  actorNama: req.affiliator?.kode_referral,
  ip: clientIp(req),
});

/* ================================================================== *
 *  PUBLIK
 * ================================================================== */

/** Informasi publik untuk landing page (kuota, biaya, kontak, branding). */
app.get(
  '/api/info',
  ah(async (req, res) => {
    const s = await getPublicSettings();
    const kuota = await getKuota(s);
    const pendaftaran = evaluasiPendaftaran(s, kuota);
    const bv = await brandingVersion();

    const [logoAda, faviconAda, qrisAda] = await Promise.all([
      hasFile('logo', 0),
      hasFile('favicon', 0),
      hasFile('qris', 0),
    ]);

    res.set('Cache-Control', 'no-store');
    res.json({
      // Identitas & branding
      nama_situs: s.nama_situs || 'Widya Nusantara Academy',
      tagline: s.tagline || '',
      logo_teks: s.logo_teks || 'W',
      logo_tersedia: logoAda,
      favicon_tersedia: faviconAda,
      logo_url: logoAda ? `/api/logo?v=${bv}` : null,
      favicon_url: faviconAda ? `/api/favicon?v=${bv}` : null,
      branding_v: bv,

      // Kuota
      ...kuota,

      // Program & biaya
      biaya: asInt(s.biaya, 0),
      durasi_program: asInt(s.durasi_program, 5),
      jumlah_tryout: asInt(s.jumlah_tryout, 6),
      kode_unik: s.kode_unik || '',

      // Periode & status
      periode_pendaftaran: s.periode_pendaftaran || '',
      periode_mulai: s.periode_mulai || '',
      periode_selesai: s.periode_selesai || '',
      pendaftaran_dibuka: pendaftaran.dibuka,
      alasan_tutup: pendaftaran.alasan,

      // Pembayaran
      bank_nama: s.bank_nama || '',
      bank_rekening: s.bank_rekening || '',
      bank_atasnama: s.bank_atasnama || '',
      qris_tersedia: qrisAda,
      qris_url: qrisAda ? `/api/qris?v=${bv}` : null,

      // Kontak
      wa_kontak: s.wa_kontak || '',
      wa_intl: waToIntl(s.wa_kontak || ''),
      email_kontak: s.email_kontak || '',
      instagram_kontak: s.instagram_kontak || '',

      // Affiliasi
      affiliate_aktif: String(s.affiliate_aktif ?? '1') === '1',
      komisi_referral: asInt(s.komisi_referral, 0),
      affiliate_syarat: s.affiliate_syarat || '',

      status_pendidikan_opsi: STATUS_PENDIDIKAN,
    });
  })
);

/** Gambar QRIS pembayaran. */
app.get(
  '/api/qris',
  ah(async (req, res) => {
    const f = await getFile('qris', 0);
    if (!f) return res.status(404).json({ error: 'QRIS belum tersedia.' });
    return sendImage(res, f, { cacheSeconds: 300 });
  })
);

/** Logo situs (dikelola dari panel admin). */
app.get(
  '/api/logo',
  ah(async (req, res) => {
    const f = await getFile('logo', 0);
    if (!f) return res.status(404).json({ error: 'Logo belum diunggah.' });
    return sendImage(res, f, { cacheSeconds: 300 });
  })
);

/** Favicon situs (tampil di tab browser). */
app.get(
  '/api/favicon',
  ah(async (req, res) => {
    const f = await getFile('favicon', 0);
    if (!f) return res.status(404).json({ error: 'Favicon belum diunggah.' });
    return sendImage(res, f, { cacheSeconds: 300 });
  })
);

/** Cek keabsahan kode referral dari formulir pendaftaran. */
app.get(
  '/api/referral/check',
  limiter('refcheck', { max: 40, windowMs: 60_000 }),
  ah(async (req, res) => {
    const kode = normalizeKode(req.query.kode);
    res.set('Cache-Control', 'no-store');
    if (!kode) return res.json({ valid: false, error: 'Kode referral kosong.' });

    const aktif = String((await getSetting('affiliate_aktif')) ?? '1') === '1';
    if (!aktif) {
      return res.json({ valid: false, error: 'Program referral sedang tidak aktif.' });
    }

    const aff = await one(
      "SELECT nama_lengkap, kode_referral FROM affiliators WHERE kode_referral = ? AND status = 'AKTIF'",
      [kode]
    );
    if (!aff) {
      return res.json({
        valid: false,
        error: 'Kode referral tidak ditemukan atau belum aktif.',
      });
    }
    // Hanya tampilkan nama depan supaya data affiliator tidak terekspos penuh
    const namaDepan = String(aff.nama_lengkap).split(' ')[0];
    return res.json({ valid: true, kode: aff.kode_referral, nama: namaDepan });
  })
);

/** Kirim pendaftaran murid baru. */
app.post(
  '/api/registrations',
  limiter('daftar', {
    max: 5,
    windowMs: 10 * 60_000,
    message: 'Terlalu banyak percobaan pendaftaran. Silakan coba lagi beberapa menit lagi.',
  }),
  handleUpload('bukti'),
  ah(async (req, res) => {
    const settings = await getPublicSettings();
    const kuota = await getKuota(settings);
    const status = evaluasiPendaftaran(settings, kuota);
    if (!status.dibuka) {
      return res.status(409).json({ error: status.alasan });
    }

    const { valid, errors, data } = validateRegistration(req.body, {
      requireBukti: true,
      hasBukti: !!req.file,
    });
    if (!valid) {
      return res.status(400).json({ error: 'Validasi gagal.', fields: errors });
    }

    const gambar = readImageUpload(req);
    if (!gambar.ok) {
      return res
        .status(400)
        .json({ error: gambar.error, fields: { bukti: gambar.error } });
    }

    // ---- Resolusi kode referral ----
    let affiliatorId = null;
    let kodeTersimpan = null;
    if (data.referral_kode) {
      if (String(settings.affiliate_aktif ?? '1') !== '1') {
        return res.status(400).json({
          error: 'Validasi gagal.',
          fields: { referral: 'Program referral sedang tidak aktif.' },
        });
      }
      const aff = await one(
        "SELECT id, email, nomor_wa FROM affiliators WHERE kode_referral = ? AND status = 'AKTIF'",
        [data.referral_kode]
      );
      if (!aff) {
        return res.status(400).json({
          error: 'Validasi gagal.',
          fields: { referral: 'Kode referral tidak ditemukan atau belum aktif.' },
        });
      }
      if (
        String(aff.email).toLowerCase() === data.gmail ||
        normalizeWa(aff.nomor_wa) === data.nomor_wa
      ) {
        return res.status(400).json({
          error: 'Validasi gagal.',
          fields: { referral: 'Kamu tidak boleh memakai kode referral milikmu sendiri.' },
        });
      }
      affiliatorId = Number(aff.id);
      kodeTersimpan = data.referral_kode;
    }

    const now = new Date().toISOString();

    /*
     * INSERT bersyarat dalam SATU statement -> atomik.
     * Menutup race condition kuota (dua request paralel pada kursi terakhir)
     * sekaligus mencegah pendaftaran ganda (email / nomor WA yang sama),
     * tanpa perlu transaksi eksplisit.
     */
    const result = await run(
      `INSERT INTO registrations
         (nama_lengkap, asal_sekolah, tanggal_lahir, status_pendidikan, nomor_wa,
          instagram, gmail, referral, referral_kode, affiliator_id,
          nominal_transfer, nominal_num, has_bukti, status, created_at, updated_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,0,'MENUNGGU_VERIFIKASI',?,?
        WHERE (SELECT COUNT(*) FROM registrations WHERE status <> 'DITOLAK') < ?
          AND NOT EXISTS (
                SELECT 1 FROM registrations
                 WHERE lower(gmail) = ? AND status <> 'DITOLAK')
          AND NOT EXISTS (
                SELECT 1 FROM registrations
                 WHERE nomor_wa = ? AND status <> 'DITOLAK')`,
      [
        data.nama_lengkap,
        data.asal_sekolah,
        data.tanggal_lahir,
        data.status_pendidikan,
        data.nomor_wa,
        data.instagram || null,
        data.gmail,
        data.referral || null,
        kodeTersimpan,
        affiliatorId,
        data.nominal_transfer || null,
        data.nominal_num,
        now,
        now,
        kuota.kuota_total,
        data.gmail,
        data.nomor_wa,
      ]
    );

    if (result.changes === 0) {
      // Cari tahu penyebabnya untuk pesan yang tepat
      const dupEmail = await one(
        "SELECT 1 AS ada FROM registrations WHERE lower(gmail) = ? AND status <> 'DITOLAK' LIMIT 1",
        [data.gmail]
      );
      if (dupEmail) {
        return res.status(409).json({
          error: 'Email ini sudah terdaftar.',
          fields: {
            gmail: 'Email ini sudah pernah digunakan untuk mendaftar. Hubungi admin bila ini milikmu.',
          },
        });
      }
      const dupWa = await one(
        "SELECT 1 AS ada FROM registrations WHERE nomor_wa = ? AND status <> 'DITOLAK' LIMIT 1",
        [data.nomor_wa]
      );
      if (dupWa) {
        return res.status(409).json({
          error: 'Nomor WhatsApp ini sudah terdaftar.',
          fields: {
            nomor_wa:
              'Nomor WhatsApp ini sudah pernah digunakan untuk mendaftar. Hubungi admin bila ini milikmu.',
          },
        });
      }
      return res
        .status(409)
        .json({ error: 'Mohon maaf, kuota pendaftaran baru saja terisi penuh.' });
    }

    // ---- Simpan bukti pembayaran ----
    try {
      await saveFile('bukti', result.id, gambar.mime, gambar.base64);
      await run('UPDATE registrations SET has_bukti = 1 WHERE id = ?', [result.id]);
    } catch (err) {
      console.error('[daftar] gagal menyimpan bukti:', err?.message);
      // Batalkan pendaftaran agar tidak ada data setengah jadi & kuota tidak terpakai
      await run('DELETE FROM registrations WHERE id = ?', [result.id]).catch(() => {});
      await deleteFile('bukti', result.id).catch(() => {});
      return res.status(500).json({
        error: 'Gagal menyimpan bukti pembayaran. Coba kompres gambarnya lalu kirim ulang.',
      });
    }

    const sisaBaru = Math.max(0, kuota.kuota_total - (kuota.kuota_terisi + 1));

    await logActivity({
      actorType: 'PUBLIC',
      actorNama: data.nama_lengkap,
      aksi: 'PENDAFTARAN_BARU',
      entitas: 'registration',
      entitasId: result.id,
      detail: kodeTersimpan ? `referral: ${kodeTersimpan}` : 'tanpa referral',
      ip: clientIp(req),
    });

    return res.status(201).json({
      ok: true,
      id: result.id,
      kuota_tersisa: sisaBaru,
      message:
        'Terima kasih, data kamu berhasil dikirim. Tim Rubela UTBK Indonesia akan memverifikasi pembayaranmu dan menghubungimu via WhatsApp.',
    });
  })
);

/* ================================================================== *
 *  AFFILIATOR — pendaftaran, sesi, dashboard
 * ================================================================== */

/** Samarkan sebagian nomor WA (privasi pendaftar di dashboard affiliator). */
function maskWa(wa) {
  const s = String(wa || '');
  if (s.length <= 7) return s;
  return s.slice(0, 4) + '*'.repeat(Math.max(3, s.length - 7)) + s.slice(-3);
}

/** Samarkan sebagian email. */
function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return s;
  const local = s.slice(0, at);
  const domain = s.slice(at);
  const shown = local.slice(0, Math.min(2, local.length));
  return shown + '*'.repeat(Math.max(3, local.length - shown.length)) + domain;
}

function publicAffiliator(aff) {
  return {
    id: Number(aff.id),
    nama_lengkap: aff.nama_lengkap,
    email: aff.email,
    nomor_wa: aff.nomor_wa,
    instagram: aff.instagram || '',
    asal_institusi: aff.asal_institusi || '',
    bank_nama: aff.bank_nama || '',
    bank_rekening: aff.bank_rekening || '',
    bank_atasnama: aff.bank_atasnama || '',
    kode_referral: aff.kode_referral,
    status: aff.status,
    catatan_admin: aff.catatan_admin || '',
    created_at: aff.created_at,
    last_login_at: aff.last_login_at || null,
  };
}

/** Pendaftaran akun affiliator baru. */
app.post(
  '/api/affiliate/register',
  limiter('affdaftar', {
    max: 5,
    windowMs: 15 * 60_000,
    message: 'Terlalu banyak percobaan pendaftaran affiliator. Coba lagi nanti.',
  }),
  ah(async (req, res) => {
    const settings = await getPublicSettings();
    if (String(settings.affiliate_aktif ?? '1') !== '1') {
      return res
        .status(403)
        .json({ error: 'Pendaftaran affiliator sedang ditutup.' });
    }

    const { valid, errors, data } = validateAffiliator(req.body);
    if (!valid) {
      return res.status(400).json({ error: 'Validasi gagal.', fields: errors });
    }

    const autoApprove = String(settings.affiliate_auto_approve ?? '0') === '1';
    const statusAwal = autoApprove ? 'AKTIF' : 'PENDING';
    const now = new Date().toISOString();
    const hash = hashPassword(data.password);

    const insertOne = (kode) =>
      run(
        `INSERT INTO affiliators
           (kode_referral, nama_lengkap, email, nomor_wa, instagram, asal_institusi,
            bank_nama, bank_rekening, bank_atasnama, password_hash, status,
            created_at, updated_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
          WHERE NOT EXISTS (SELECT 1 FROM affiliators WHERE lower(email) = ?)
            AND NOT EXISTS (SELECT 1 FROM affiliators WHERE kode_referral = ?)`,
        [
          kode,
          data.nama_lengkap,
          data.email,
          data.nomor_wa,
          data.instagram || null,
          data.asal_institusi || null,
          data.bank_nama || null,
          data.bank_rekening || null,
          data.bank_atasnama || null,
          hash,
          statusAwal,
          now,
          now,
          data.email,
          kode,
        ]
      );

    const kodeDiminta = data.kode_referral;
    let inserted = null;
    let kodeFinal = null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      kodeFinal = kodeDiminta || suggestReferralCode(data.nama_lengkap);
      const result = await insertOne(kodeFinal);
      if (result.changes === 1) {
        inserted = result;
        break;
      }
      const emailAda = await one(
        'SELECT 1 AS ada FROM affiliators WHERE lower(email) = ? LIMIT 1',
        [data.email]
      );
      if (emailAda) {
        return res.status(409).json({
          error: 'Email sudah terdaftar.',
          fields: { email: 'Email ini sudah dipakai. Silakan masuk atau gunakan email lain.' },
        });
      }
      if (kodeDiminta) {
        return res.status(409).json({
          error: 'Kode referral sudah dipakai.',
          fields: { kode_referral: 'Kode referral ini sudah dipakai. Pilih kode lain.' },
        });
      }
      // kode hasil generate bertabrakan -> coba lagi dengan kode baru
    }

    if (!inserted) {
      return res.status(500).json({
        error: 'Gagal membuat kode referral unik. Silakan coba lagi.',
      });
    }

    await logActivity({
      actorType: 'AFFILIATOR',
      actorId: inserted.id,
      actorNama: kodeFinal,
      aksi: 'AFFILIATOR_MENDAFTAR',
      entitas: 'affiliator',
      entitasId: inserted.id,
      detail: `${data.nama_lengkap} <${data.email}> status ${statusAwal}`,
      ip: clientIp(req),
    });

    const payload = {
      ok: true,
      id: inserted.id,
      kode_referral: kodeFinal,
      status: statusAwal,
      message: autoApprove
        ? 'Akun affiliator kamu aktif. Kode referral siap dibagikan!'
        : 'Pendaftaran terkirim. Akun kamu akan diaktifkan admin setelah diverifikasi (biasanya < 1x24 jam).',
    };

    if (autoApprove) {
      const token = await issueAffiliatorToken({
        id: inserted.id,
        email: data.email,
        nama_lengkap: data.nama_lengkap,
        kode_referral: kodeFinal,
      });
      setAuthCookie(res, AFF_COOKIE, token);
      payload.token = token;
    }

    return res.status(201).json(payload);
  })
);

/** Login affiliator (memakai email ATAU kode referral). */
app.post(
  '/api/affiliate/login',
  limiter('afflogin', {
    max: 10,
    windowMs: 10 * 60_000,
    message: 'Terlalu banyak percobaan masuk. Coba lagi dalam beberapa menit.',
  }),
  ah(async (req, res) => {
    const identifier = str(req.body?.identifier || req.body?.email);
    const password = req.body?.password;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/kode referral dan password wajib diisi.' });
    }

    const aff = await verifyAffiliatorCredentials(identifier, password);
    if (!aff) {
      return res.status(401).json({ error: 'Email/kode referral atau password salah.' });
    }
    if (aff.blocked) {
      const pesan =
        aff.status === 'PENDING'
          ? 'Akun kamu masih menunggu persetujuan admin.'
          : aff.status === 'DITOLAK'
            ? 'Pendaftaran affiliator kamu ditolak.'
            : 'Akun affiliator kamu dinonaktifkan.';
      return res.status(403).json({
        error: aff.catatan_admin ? `${pesan} Catatan admin: ${aff.catatan_admin}` : pesan,
        status: aff.status,
      });
    }

    resetLimit('afflogin', clientIp(req));
    const token = await issueAffiliatorToken(aff);
    setAuthCookie(res, AFF_COOKIE, token);

    await logActivity({
      actorType: 'AFFILIATOR',
      actorId: aff.id,
      actorNama: aff.kode_referral,
      aksi: 'AFFILIATOR_LOGIN',
      entitas: 'affiliator',
      entitasId: aff.id,
      ip: clientIp(req),
    });

    return res.json({
      ok: true,
      token,
      affiliator: {
        nama_lengkap: aff.nama_lengkap,
        email: aff.email,
        kode_referral: aff.kode_referral,
      },
    });
  })
);

app.post('/api/affiliate/logout', (req, res) => {
  clearAuthCookie(res, AFF_COOKIE);
  res.json({ ok: true });
});

app.get(
  '/api/affiliate/me',
  ah(requireAffiliator),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ affiliator: publicAffiliator(req.affiliator) });
  })
);

/** Ringkasan performa affiliator: jumlah referral, komisi, riwayat pembayaran. */
app.get(
  '/api/affiliate/stats',
  ah(requireAffiliator),
  ah(async (req, res) => {
    const affId = req.affiliator.id;
    const komisiPer = await getSettingInt('komisi_referral', 0);

    const byStatus = await q(
      'SELECT status, COUNT(*) AS c FROM registrations WHERE affiliator_id = ? GROUP BY status',
      [affId]
    );
    const counts = { MENUNGGU_VERIFIKASI: 0, TERVERIFIKASI: 0, DITOLAK: 0 };
    let total = 0;
    for (const r of byStatus) {
      const n = Number(r.c) || 0;
      if (r.status in counts) counts[r.status] = n;
      total += n;
    }

    const dibayar = await scalar(
      'SELECT COALESCE(SUM(jumlah), 0) AS s FROM komisi_payouts WHERE affiliator_id = ?',
      [affId]
    );
    const komisiDiperoleh = counts.TERVERIFIKASI * komisiPer;

    const bulanJakarta = todayJakarta().slice(0, 7);
    const bulanIni = await scalar(
      `SELECT COUNT(*) AS c FROM registrations
        WHERE affiliator_id = ?
          AND substr(date(created_at, '+7 hours'), 1, 7) = ?`,
      [affId, bulanJakarta]
    );

    const payouts = await q(
      'SELECT id, jumlah, catatan, created_at FROM komisi_payouts WHERE affiliator_id = ? ORDER BY created_at DESC LIMIT 50',
      [affId]
    );

    // Tren memakai tanggal WIB; created_at tersimpan sebagai ISO UTC.
    const tren = await q(
      `SELECT date(created_at, '+7 hours') AS tanggal, COUNT(*) AS c
         FROM registrations
        WHERE affiliator_id = ?
        GROUP BY tanggal ORDER BY tanggal DESC LIMIT 30`,
      [affId]
    );

    res.set('Cache-Control', 'no-store');
    res.json({
      kode_referral: req.affiliator.kode_referral,
      total_referral: total,
      by_status: counts,
      bulan_ini: bulanIni,
      komisi_per_referral: komisiPer,
      komisi_diperoleh: komisiDiperoleh,
      komisi_dibayar: dibayar,
      komisi_belum_dibayar: Math.max(0, komisiDiperoleh - dibayar),
      payouts: payouts.map((p) => ({
        id: Number(p.id),
        jumlah: Number(p.jumlah) || 0,
        catatan: p.catatan || '',
        created_at: p.created_at,
      })),
      tren: tren.map((t) => ({ tanggal: t.tanggal, jumlah: Number(t.c) || 0 })).reverse(),
    });
  })
);

/** Daftar orang yang memakai kode referral affiliator ini. */
app.get(
  '/api/affiliate/referrals',
  ah(requireAffiliator),
  ah(async (req, res) => {
    const affId = req.affiliator.id;
    const page = Math.max(1, asInt(req.query.page, 1));
    const pageSize = clamp(asInt(req.query.pageSize, 20), 1, 100);
    const statusFilter = str(req.query.status);
    const cari = str(req.query.q);

    const where = ['affiliator_id = ?'];
    const args = [affId];
    if (statusFilter && STATUS_PENDAFTARAN.includes(statusFilter)) {
      where.push('status = ?');
      args.push(statusFilter);
    }
    if (cari) {
      where.push('(nama_lengkap LIKE ? OR asal_sekolah LIKE ?)');
      args.push(`%${cari}%`, `%${cari}%`);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const total = await scalar(
      `SELECT COUNT(*) AS c FROM registrations ${whereSql}`,
      args
    );
    const rows = await q(
      `SELECT id, nama_lengkap, asal_sekolah, status_pendidikan, nomor_wa, gmail,
              status, created_at
         FROM registrations ${whereSql}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize]
    );

    res.set('Cache-Control', 'no-store');
    res.json({
      data: rows.map((r) => ({
        id: Number(r.id),
        nama_lengkap: r.nama_lengkap,
        asal_sekolah: r.asal_sekolah,
        status_pendidikan: r.status_pendidikan,
        // Kontak disamarkan: affiliator cukup tahu siapa yang memakai kodenya,
        // tidak perlu data kontak lengkap orang lain.
        nomor_wa: maskWa(r.nomor_wa),
        gmail: maskEmail(r.gmail),
        status: r.status,
        created_at: r.created_at,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  })
);

/** Unduh daftar referral sendiri sebagai CSV. */
app.get(
  '/api/affiliate/export',
  ah(requireAffiliator),
  ah(async (req, res) => {
    const rows = await q(
      `SELECT nama_lengkap, asal_sekolah, status_pendidikan, nomor_wa, gmail, status, created_at
         FROM registrations WHERE affiliator_id = ? ORDER BY created_at DESC`,
      [req.affiliator.id]
    );
    const csv = buildCsv(
      ['Nama', 'Asal Sekolah', 'Status Pendidikan', 'WhatsApp', 'Email', 'Status', 'Tanggal Daftar'],
      rows.map((r) => [
        r.nama_lengkap,
        r.asal_sekolah,
        r.status_pendidikan,
        maskWa(r.nomor_wa),
        maskEmail(r.gmail),
        r.status,
        fmtTanggalId(r.created_at),
      ])
    );
    return sendCsv(
      res,
      `referral-${req.affiliator.kode_referral}-${todayJakarta()}.csv`,
      csv
    );
  })
);

/** Ubah data profil sendiri (email & kode referral tidak bisa diubah sendiri). */
app.patch(
  '/api/affiliate/profile',
  ah(requireAffiliator),
  ah(async (req, res) => {
    /*
     * PATCH harus benar-benar partial. Gabungkan body dengan profil yang sudah
     * diverifikasi middleware agar mengubah satu field tidak mengosongkan field
     * lain atau gagal karena nama/WA wajib tidak ikut dikirim.
     */
    const merged = { ...req.affiliator, ...(req.body || {}) };
    const { valid, errors, data } = validateAffiliatorProfile(merged);
    if (!valid) {
      return res.status(400).json({ error: 'Validasi gagal.', fields: errors });
    }
    await run(
      `UPDATE affiliators
          SET nama_lengkap = ?, nomor_wa = ?, instagram = ?, asal_institusi = ?,
              bank_nama = ?, bank_rekening = ?, bank_atasnama = ?, updated_at = ?
        WHERE id = ?`,
      [
        data.nama_lengkap,
        data.nomor_wa,
        data.instagram || null,
        data.asal_institusi || null,
        data.bank_nama || null,
        data.bank_rekening || null,
        data.bank_atasnama || null,
        new Date().toISOString(),
        req.affiliator.id,
      ]
    );
    await logActivity({
      ...actorAff(req),
      aksi: 'AFFILIATOR_UBAH_PROFIL',
      entitas: 'affiliator',
      entitasId: req.affiliator.id,
    });
    const fresh = await one('SELECT * FROM affiliators WHERE id = ?', [req.affiliator.id]);
    return res.json({ ok: true, affiliator: publicAffiliator(fresh) });
  })
);

/** Ganti password sendiri. */
app.post(
  '/api/affiliate/change-password',
  ah(requireAffiliator),
  limiter('affpw', { max: 10, windowMs: 15 * 60_000 }),
  ah(async (req, res) => {
    const lama = req.body?.password_lama;
    const baru = req.body?.password_baru;
    const pwErr = validatePassword(baru, 'Password baru');
    if (!lama) {
      return res
        .status(400)
        .json({ error: 'Validasi gagal.', fields: { password_lama: 'Password lama wajib diisi.' } });
    }
    if (pwErr) {
      return res.status(400).json({ error: 'Validasi gagal.', fields: { password_baru: pwErr } });
    }

    const row = await one('SELECT password_hash FROM affiliators WHERE id = ?', [
      req.affiliator.id,
    ]);
    const ok = await verifyPassword(String(lama), row?.password_hash);
    if (!ok) {
      return res
        .status(400)
        .json({ error: 'Validasi gagal.', fields: { password_lama: 'Password lama salah.' } });
    }

    await run('UPDATE affiliators SET password_hash = ?, updated_at = ? WHERE id = ?', [
      hashPassword(String(baru)),
      new Date().toISOString(),
      req.affiliator.id,
    ]);
    await logActivity({
      ...actorAff(req),
      aksi: 'AFFILIATOR_GANTI_PASSWORD',
      entitas: 'affiliator',
      entitasId: req.affiliator.id,
    });
    return res.json({ ok: true, message: 'Password berhasil diperbarui.' });
  })
);

/* ================================================================== *
 *  SESI ADMIN
 * ================================================================== */

app.post(
  '/api/auth/login',
  limiter('login', {
    max: 8,
    windowMs: 10 * 60_000,
    message: 'Terlalu banyak percobaan masuk. Coba lagi dalam beberapa menit.',
  }),
  ah(async (req, res) => {
    const username = str(req.body?.username);
    const password = req.body?.password;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password wajib diisi.' });
    }

    const admin = await verifyAdminCredentials(username, password);
    if (!admin) {
      await logActivity({
        actorType: 'PUBLIC',
        actorNama: username.slice(0, 40),
        aksi: 'LOGIN_GAGAL',
        entitas: 'admin',
        ip: clientIp(req),
      });
      return res.status(401).json({ error: 'Username atau password salah.' });
    }
    if (admin.blocked) {
      return res.status(403).json({ error: 'Akun admin ini dinonaktifkan.' });
    }

    resetLimit('login', clientIp(req));
    const token = await issueAdminToken(admin);
    setAuthCookie(res, ADMIN_COOKIE, token);

    await logActivity({
      actorType: 'ADMIN',
      actorId: admin.id,
      actorNama: admin.username,
      aksi: 'LOGIN',
      entitas: 'admin',
      entitasId: admin.id,
      ip: clientIp(req),
    });

    return res.json({
      ok: true,
      token,
      admin: {
        username: admin.username,
        nama: admin.nama,
        role: admin.role,
        must_change_password: admin.must_change_password,
      },
    });
  })
);

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res, ADMIN_COOKIE);
  res.json({ ok: true });
});

app.get(
  '/api/auth/me',
  ah(requireAdmin),
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ admin: req.admin });
  })
);

app.post(
  '/api/auth/change-password',
  ah(requireAdmin),
  limiter('adminpw', { max: 10, windowMs: 15 * 60_000 }),
  ah(async (req, res) => {
    const lama = req.body?.password_lama;
    const baru = req.body?.password_baru;
    const pwErr = validatePassword(baru, 'Password baru');
    if (!lama) {
      return res
        .status(400)
        .json({ error: 'Validasi gagal.', fields: { password_lama: 'Password lama wajib diisi.' } });
    }
    if (pwErr) {
      return res.status(400).json({ error: 'Validasi gagal.', fields: { password_baru: pwErr } });
    }

    const row = await one('SELECT password_hash FROM admins WHERE id = ?', [req.admin.id]);
    const ok = await verifyPassword(String(lama), row?.password_hash);
    if (!ok) {
      return res
        .status(400)
        .json({ error: 'Validasi gagal.', fields: { password_lama: 'Password lama salah.' } });
    }

    // "Rotasi" ke password yang sama atau ke password awal bersama tidak sah.
    if (String(baru) === String(lama) || (await verifyPassword(String(baru), row?.password_hash))) {
      return res.status(400).json({
        error: 'Validasi gagal.',
        fields: { password_baru: 'Password baru harus berbeda dari password lama.' },
      });
    }
    if (await isDefaultAdminPassword(String(baru))) {
      return res.status(400).json({
        error: 'Validasi gagal.',
        fields: { password_baru: 'Password awal bawaan tidak boleh dipakai lagi.' },
      });
    }

    const now = new Date().toISOString();
    await run(
      `UPDATE admins
          SET password_hash = ?, must_change_password = 0,
              password_changed_at = ?, updated_at = ?
        WHERE id = ?`,
      [hashPassword(String(baru)), now, now, req.admin.id]
    );

    // Versi password berubah -> semua token lama dicabut. Terbitkan token baru
    // khusus untuk sesi yang sedang dipakai agar pemilik tidak ikut ter-logout.
    const token = await issueAdminToken({ ...req.admin, password_changed_at: now });
    setAuthCookie(res, ADMIN_COOKIE, token);

    await logActivity({
      ...actorAdmin(req),
      aksi: 'GANTI_PASSWORD',
      entitas: 'admin',
      entitasId: req.admin.id,
      detail: 'sesi lain dicabut',
    });
    return res.json({
      ok: true,
      token,
      message:
        'Password berhasil diperbarui. Semua sesi lain telah dikeluarkan. Jika kamu memakai ADMIN_PASSWORD di environment, perbarui juga nilainya.',
    });
  })
);

/* ================================================================== *
 *  ADMIN — semua route di bawah ini wajib sesi admin dan password final
 * ================================================================== */
function requireFinalAdminPassword(req, res, next) {
  if (req.admin?.must_change_password) {
    return res.status(428).json({
      code: 'PASSWORD_CHANGE_REQUIRED',
      error: 'Demi keamanan, ganti password awal sebelum memakai panel admin.',
    });
  }
  return next();
}

app.use('/api/admin', ah(requireAdmin), requireFinalAdminPassword);

/** Ringkasan dashboard: statistik, tren, affiliator teratas, aktivitas. */
app.get(
  '/api/admin/overview',
  ah(async (req, res) => {
    const settings = await getAllSettings();
    const kuota = await getKuota(settings);
    const komisiPer = asInt(settings.komisi_referral, 0);

    const byStatusRows = await q('SELECT status, COUNT(*) AS c FROM registrations GROUP BY status');
    const by_status = { MENUNGGU_VERIFIKASI: 0, TERVERIFIKASI: 0, DITOLAK: 0 };
    let total = 0;
    for (const r of byStatusRows) {
      const n = Number(r.c) || 0;
      if (r.status in by_status) by_status[r.status] = n;
      total += n;
    }

    const hari = todayJakarta();
    const [hariIni, mingguIni, tanpaBukti, denganReferral] = await Promise.all([
      scalar(
        `SELECT COUNT(*) AS c FROM registrations
          WHERE date(created_at, '+7 hours') = ?`,
        [hari]
      ),
      scalar(
        "SELECT COUNT(*) AS c FROM registrations WHERE created_at >= datetime('now','-7 days')"
      ),
      scalar('SELECT COUNT(*) AS c FROM registrations WHERE has_bukti = 0'),
      scalar('SELECT COUNT(*) AS c FROM registrations WHERE affiliator_id IS NOT NULL'),
    ]);

    // Tren 14 hari dalam zona WIB (diisi penuh termasuk hari tanpa pendaftar).
    const trenRows = await q(
      `SELECT date(created_at, '+7 hours') AS tanggal, COUNT(*) AS c
         FROM registrations
        WHERE created_at >= datetime('now','-15 days')
        GROUP BY tanggal`
    );
    const trenMap = new Map(trenRows.map((r) => [String(r.tanggal), Number(r.c) || 0]));
    const tren = [];
    const hariJakarta = new Date(`${hari}T12:00:00Z`);
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(hariJakarta.getTime() - i * 86400000).toISOString().slice(0, 10);
      tren.push({ tanggal: d, jumlah: trenMap.get(d) || 0 });
    }

    // Komposisi status pendidikan
    const pendidikanRows = await q(
      'SELECT status_pendidikan AS nama, COUNT(*) AS c FROM registrations GROUP BY status_pendidikan ORDER BY c DESC'
    );

    // Affiliator
    const affStatusRows = await q('SELECT status, COUNT(*) AS c FROM affiliators GROUP BY status');
    const affiliator_by_status = { PENDING: 0, AKTIF: 0, NONAKTIF: 0, DITOLAK: 0 };
    let affTotal = 0;
    for (const r of affStatusRows) {
      const n = Number(r.c) || 0;
      if (r.status in affiliator_by_status) affiliator_by_status[r.status] = n;
      affTotal += n;
    }

    const topAff = await q(
      `SELECT a.id, a.nama_lengkap, a.kode_referral, a.status,
              COUNT(r.id) AS total,
              SUM(CASE WHEN r.status = 'TERVERIFIKASI' THEN 1 ELSE 0 END) AS terverifikasi
         FROM affiliators a
         LEFT JOIN registrations r ON r.affiliator_id = a.id
        GROUP BY a.id
       HAVING total > 0
        ORDER BY terverifikasi DESC, total DESC
        LIMIT 5`
    );

    const totalKomisiDibayar = await scalar(
      'SELECT COALESCE(SUM(jumlah),0) AS s FROM komisi_payouts'
    );
    const komisiTerutang = by_status.TERVERIFIKASI
      ? (await scalar(
          "SELECT COUNT(*) AS c FROM registrations WHERE affiliator_id IS NOT NULL AND status = 'TERVERIFIKASI'"
        )) * komisiPer
      : 0;

    const aktivitas = await q(
      `SELECT id, actor_type, actor_nama, aksi, entitas, entitas_id, detail, created_at
         FROM activity_log ORDER BY id DESC LIMIT 12`
    );

    res.set('Cache-Control', 'no-store');
    res.json({
      total,
      by_status,
      ...kuota,
      hari_ini: hariIni,
      minggu_ini: mingguIni,
      tanpa_bukti: tanpaBukti,
      dengan_referral: denganReferral,
      pendaftaran_dibuka: evaluasiPendaftaran(settings, kuota).dibuka,
      periode_pendaftaran: settings.periode_pendaftaran || '',
      biaya: asInt(settings.biaya, 0),
      estimasi_pendapatan: by_status.TERVERIFIKASI * asInt(settings.biaya, 0),
      tren,
      komposisi_pendidikan: pendidikanRows.map((r) => ({
        nama: r.nama,
        jumlah: Number(r.c) || 0,
      })),
      affiliator_total: affTotal,
      affiliator_by_status,
      komisi_per_referral: komisiPer,
      komisi_terutang: Math.max(0, komisiTerutang - totalKomisiDibayar),
      komisi_dibayar: totalKomisiDibayar,
      top_affiliator: topAff.map((a) => ({
        id: Number(a.id),
        nama_lengkap: a.nama_lengkap,
        kode_referral: a.kode_referral,
        status: a.status,
        total: Number(a.total) || 0,
        terverifikasi: Number(a.terverifikasi) || 0,
      })),
      aktivitas: aktivitas.map((a) => ({
        id: Number(a.id),
        actor_type: a.actor_type,
        actor_nama: a.actor_nama,
        aksi: a.aksi,
        entitas: a.entitas,
        entitas_id: a.entitas_id == null ? null : Number(a.entitas_id),
        detail: a.detail,
        created_at: a.created_at,
      })),
    });
  })
);

/* ---------------------- Pendaftar ---------------------- */

/**
 * Bangun klausa WHERE dari query filter pendaftar.
 * @param {Object} query  req.query
 * @param {string} [alias] prefix kolom, mis. 'r' untuk query yang memakai JOIN
 */
function buildRegistrationFilter(query, alias = '') {
  const p = alias ? `${alias}.` : '';
  const where = [];
  const args = [];

  const cari = str(query.q);
  if (cari) {
    where.push(
      `(${p}nama_lengkap LIKE ? OR ${p}asal_sekolah LIKE ? OR ${p}nomor_wa LIKE ?` +
        ` OR ${p}gmail LIKE ? OR ${p}instagram LIKE ? OR ${p}referral_kode LIKE ?)`
    );
    const like = `%${cari}%`;
    args.push(like, like, like, like, like, like);
  }

  const status = str(query.status);
  if (status && STATUS_PENDAFTARAN.includes(status)) {
    where.push(`${p}status = ?`);
    args.push(status);
  }

  const pendidikan = str(query.status_pendidikan);
  if (pendidikan && STATUS_PENDIDIKAN.includes(pendidikan)) {
    where.push(`${p}status_pendidikan = ?`);
    args.push(pendidikan);
  }

  const affId = asInt(query.affiliator_id, 0);
  if (affId > 0) {
    where.push(`${p}affiliator_id = ?`);
    args.push(affId);
  }

  const referral = str(query.referral);
  if (referral === 'ada') where.push(`${p}affiliator_id IS NOT NULL`);
  else if (referral === 'tidak') where.push(`${p}affiliator_id IS NULL`);

  const bukti = str(query.bukti);
  if (bukti === 'ada') where.push(`${p}has_bukti = 1`);
  else if (bukti === 'tidak') where.push(`${p}has_bukti = 0`);

  const dari = str(query.dari);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dari)) {
    where.push(`date(${p}created_at, '+7 hours') >= ?`);
    args.push(dari);
  }
  const sampai = str(query.sampai);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sampai)) {
    where.push(`date(${p}created_at, '+7 hours') <= ?`);
    args.push(sampai);
  }

  return {
    whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '',
    args,
  };
}

// Nilai ORDER BY sudah memakai alias `r` (semua query pendaftar admin memakai JOIN).
// Hanya key yang terdaftar di sini yang boleh dipakai -> tidak ada SQL injection.
const SORT_PENDAFTAR = {
  terbaru: 'r.created_at DESC, r.id DESC',
  terlama: 'r.created_at ASC, r.id ASC',
  nama: 'r.nama_lengkap COLLATE NOCASE ASC',
  status: 'r.status ASC, r.created_at DESC',
};

app.get(
  '/api/admin/registrations',
  ah(async (req, res) => {
    const page = Math.max(1, asInt(req.query.page, 1));
    const pageSize = clamp(asInt(req.query.pageSize, 20), 1, 100);
    const orderBy = SORT_PENDAFTAR[str(req.query.sort)] || SORT_PENDAFTAR.terbaru;
    const { whereSql, args } = buildRegistrationFilter(req.query, 'r');

    const total = await scalar(
      `SELECT COUNT(*) AS c FROM registrations r ${whereSql}`,
      args
    );
    const rows = await q(
      `SELECT r.id, r.nama_lengkap, r.asal_sekolah, r.tanggal_lahir, r.status_pendidikan,
              r.nomor_wa, r.instagram, r.gmail, r.referral, r.referral_kode, r.affiliator_id,
              r.nominal_transfer, r.nominal_num, r.has_bukti, r.status, r.catatan_admin,
              r.created_at, r.updated_at, r.verified_at, r.verified_by,
              a.nama_lengkap AS affiliator_nama
         FROM registrations r
         LEFT JOIN affiliators a ON a.id = r.affiliator_id
         ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize]
    );

    res.set('Cache-Control', 'no-store');
    res.json({
      data: rows.map((r) => ({ ...r, id: Number(r.id) })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  })
);

/** Unduh seluruh data pendaftar (mengikuti filter yang aktif) sebagai CSV. */
app.get(
  '/api/admin/registrations/export',
  ah(async (req, res) => {
    const { whereSql, args } = buildRegistrationFilter(req.query, 'r');
    const rows = await q(
      `SELECT r.*, a.nama_lengkap AS affiliator_nama
         FROM registrations r
         LEFT JOIN affiliators a ON a.id = r.affiliator_id
         ${whereSql}
        ORDER BY r.created_at DESC`,
      args
    );

    const csv = buildCsv(
      [
        'ID',
        'Nama Lengkap',
        'Asal Sekolah',
        'Tanggal Lahir',
        'Status Pendidikan',
        'Nomor WA',
        'Instagram',
        'Email',
        'Kode Referral',
        'Nama Affiliator',
        'Nominal Transfer',
        'Bukti',
        'Status',
        'Catatan Admin',
        'Diverifikasi Oleh',
        'Tanggal Verifikasi',
        'Tanggal Daftar',
      ],
      rows.map((r) => [
        r.id,
        r.nama_lengkap,
        r.asal_sekolah,
        r.tanggal_lahir,
        r.status_pendidikan,
        r.nomor_wa,
        r.instagram ? '@' + r.instagram : '',
        r.gmail,
        r.referral_kode || r.referral || '',
        r.affiliator_nama || '',
        r.nominal_transfer || '',
        Number(r.has_bukti) === 1 ? 'Ada' : 'Tidak ada',
        r.status,
        r.catatan_admin || '',
        r.verified_by || '',
        fmtTanggalId(r.verified_at),
        fmtTanggalId(r.created_at),
      ])
    );
    return sendCsv(res, `pendaftar-widya-${todayJakarta()}.csv`, csv);
  })
);

/** Ubah status beberapa pendaftar sekaligus. */
app.post(
  '/api/admin/registrations/bulk-status',
  ah(async (req, res) => {
    const status = str(req.body?.status);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v) => asInt(v, 0)) : [];
    const valid = ids.filter((n) => n > 0);

    if (!STATUS_PENDAFTARAN.includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid.' });
    }
    if (!valid.length) {
      return res.status(400).json({ error: 'Tidak ada data yang dipilih.' });
    }
    if (valid.length > 200) {
      return res.status(400).json({ error: 'Maksimal 200 data per aksi massal.' });
    }

    const now = new Date().toISOString();
    const placeholders = valid.map(() => '?').join(',');
    const verified = status === 'TERVERIFIKASI';
    const result = await run(
      `UPDATE registrations
          SET status = ?, updated_at = ?,
              verified_at = ${verified ? '?' : 'NULL'},
              verified_by = ${verified ? '?' : 'NULL'}
        WHERE id IN (${placeholders})`,
      verified
        ? [status, now, now, req.admin.username, ...valid]
        : [status, now, ...valid]
    );

    await logActivity({
      ...actorAdmin(req),
      aksi: 'UBAH_STATUS_MASSAL',
      entitas: 'registration',
      detail: `${result.changes} data -> ${status}`,
    });

    return res.json({ ok: true, changed: result.changes });
  })
);

app.get(
  '/api/admin/registrations/:id',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const row = await one(
      `SELECT r.*, a.nama_lengkap AS affiliator_nama, a.email AS affiliator_email,
              a.nomor_wa AS affiliator_wa
         FROM registrations r
         LEFT JOIN affiliators a ON a.id = r.affiliator_id
        WHERE r.id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    res.set('Cache-Control', 'no-store');
    res.json({ ...row, id: Number(row.id) });
  })
);

app.get(
  '/api/admin/registrations/:id/bukti',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const f = await getFile('bukti', id);
    if (!f) return res.status(404).json({ error: 'Bukti pembayaran tidak tersedia.' });
    return sendImage(res, f);
  })
);

/** Ubah status satu pendaftar (+ catatan admin). */
app.patch(
  '/api/admin/registrations/:id/status',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const status = str(req.body?.status);
    if (!STATUS_PENDAFTARAN.includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid.' });
    }
    const catatan = str(req.body?.catatan_admin).slice(0, 1000);

    const existing = await one('SELECT id, status FROM registrations WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan.' });

    const now = new Date().toISOString();
    if (status === 'TERVERIFIKASI') {
      await run(
        `UPDATE registrations
            SET status = ?, catatan_admin = ?, updated_at = ?, verified_at = ?, verified_by = ?
          WHERE id = ?`,
        [status, catatan || null, now, now, req.admin.username, id]
      );
    } else {
      await run(
        `UPDATE registrations
            SET status = ?, catatan_admin = ?, updated_at = ?, verified_at = NULL, verified_by = NULL
          WHERE id = ?`,
        [status, catatan || null, now, id]
      );
    }

    await logActivity({
      ...actorAdmin(req),
      aksi: 'UBAH_STATUS',
      entitas: 'registration',
      entitasId: id,
      detail: `${existing.status} -> ${status}`,
    });

    return res.json({ ok: true });
  })
);

/** Perbaiki data pendaftar (mis. typo nomor WA / email). */
app.patch(
  '/api/admin/registrations/:id',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const existing = await one('SELECT * FROM registrations WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan.' });

    const { valid, errors, data } = validateRegistration(
      { ...existing, ...req.body },
      { requireBukti: false }
    );
    if (!valid) {
      return res.status(400).json({ error: 'Validasi gagal.', fields: errors });
    }

    // Pastikan email & WA baru tidak bertabrakan dengan pendaftar lain
    const bentrok = await one(
      `SELECT id FROM registrations
        WHERE id <> ? AND status <> 'DITOLAK' AND (lower(gmail) = ? OR nomor_wa = ?) LIMIT 1`,
      [id, data.gmail, data.nomor_wa]
    );
    if (bentrok) {
      return res.status(409).json({
        error: 'Email atau nomor WhatsApp sudah dipakai pendaftar lain.',
        fields: { gmail: 'Bentrok dengan pendaftar lain.' },
      });
    }

    // Kode referral boleh diubah admin (termasuk dikosongkan)
    let affiliatorId = existing.affiliator_id ?? null;
    let kodeTersimpan = existing.referral_kode ?? null;
    if ('referral' in req.body || 'referral_kode' in req.body) {
      if (!data.referral_kode) {
        affiliatorId = null;
        kodeTersimpan = null;
      } else {
        const aff = await one('SELECT id FROM affiliators WHERE kode_referral = ?', [
          data.referral_kode,
        ]);
        if (!aff) {
          return res.status(400).json({
            error: 'Validasi gagal.',
            fields: { referral: 'Kode referral tidak ditemukan.' },
          });
        }
        affiliatorId = Number(aff.id);
        kodeTersimpan = data.referral_kode;
      }
    }

    await run(
      `UPDATE registrations
          SET nama_lengkap = ?, asal_sekolah = ?, tanggal_lahir = ?, status_pendidikan = ?,
              nomor_wa = ?, instagram = ?, gmail = ?, referral = ?, referral_kode = ?,
              affiliator_id = ?, nominal_transfer = ?, nominal_num = ?,
              catatan_admin = ?, updated_at = ?
        WHERE id = ?`,
      [
        data.nama_lengkap,
        data.asal_sekolah,
        data.tanggal_lahir,
        data.status_pendidikan,
        data.nomor_wa,
        data.instagram || null,
        data.gmail,
        kodeTersimpan || data.referral || null,
        kodeTersimpan,
        affiliatorId,
        data.nominal_transfer || null,
        data.nominal_num,
        str(req.body?.catatan_admin ?? existing.catatan_admin).slice(0, 1000) || null,
        new Date().toISOString(),
        id,
      ]
    );

    await logActivity({
      ...actorAdmin(req),
      aksi: 'UBAH_DATA_PENDAFTAR',
      entitas: 'registration',
      entitasId: id,
    });

    const fresh = await one('SELECT * FROM registrations WHERE id = ?', [id]);
    return res.json({ ok: true, data: fresh });
  })
);

app.delete(
  '/api/admin/registrations/:id',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const existing = await one('SELECT nama_lengkap FROM registrations WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan.' });

    await deleteFile('bukti', id);
    await run('DELETE FROM registrations WHERE id = ?', [id]);

    await logActivity({
      ...actorAdmin(req),
      aksi: 'HAPUS_PENDAFTAR',
      entitas: 'registration',
      entitasId: id,
      detail: existing.nama_lengkap,
    });

    return res.json({ ok: true });
  })
);

/* ---------------------- Affiliator (admin) ---------------------- */

/** Unduh data affiliator sebagai CSV. Harus didaftarkan sebelum route "/:id". */
app.get(
  '/api/admin/affiliators/export',
  ah(async (req, res) => {
    const komisiPer = await getSettingInt('komisi_referral', 0);
    const rows = await q(
      `SELECT a.*,
              COUNT(r.id) AS total_referral,
              SUM(CASE WHEN r.status = 'TERVERIFIKASI' THEN 1 ELSE 0 END) AS terverifikasi,
              (SELECT COALESCE(SUM(p.jumlah),0) FROM komisi_payouts p WHERE p.affiliator_id = a.id) AS dibayar
         FROM affiliators a
         LEFT JOIN registrations r ON r.affiliator_id = a.id
        GROUP BY a.id
        ORDER BY terverifikasi DESC, a.created_at DESC`
    );
    const csv = buildCsv(
      [
        'ID',
        'Kode Referral',
        'Nama Lengkap',
        'Email',
        'WhatsApp',
        'Instagram',
        'Asal Sekolah/Kampus',
        'Bank',
        'No. Rekening',
        'Atas Nama',
        'Status',
        'Total Referral',
        'Terverifikasi',
        'Komisi Diperoleh',
        'Komisi Dibayar',
        'Sisa Komisi',
        'Tanggal Daftar',
      ],
      rows.map((r) => {
        const ver = Number(r.terverifikasi) || 0;
        const diperoleh = ver * komisiPer;
        const dibayar = Number(r.dibayar) || 0;
        return [
          r.id,
          r.kode_referral,
          r.nama_lengkap,
          r.email,
          r.nomor_wa,
          r.instagram ? '@' + r.instagram : '',
          r.asal_institusi || '',
          r.bank_nama || '',
          r.bank_rekening || '',
          r.bank_atasnama || '',
          r.status,
          Number(r.total_referral) || 0,
          ver,
          diperoleh,
          dibayar,
          Math.max(0, diperoleh - dibayar),
          fmtTanggalId(r.created_at),
        ];
      })
    );
    return sendCsv(res, `affiliator-widya-${todayJakarta()}.csv`, csv);
  })
);

app.get(
  '/api/admin/affiliators',
  ah(async (req, res) => {
    const page = Math.max(1, asInt(req.query.page, 1));
    const pageSize = clamp(asInt(req.query.pageSize, 20), 1, 100);
    const komisiPer = await getSettingInt('komisi_referral', 0);

    const where = [];
    const args = [];
    const cari = str(req.query.q);
    if (cari) {
      where.push(
        '(a.nama_lengkap LIKE ? OR a.email LIKE ? OR a.kode_referral LIKE ? OR a.nomor_wa LIKE ?)'
      );
      const like = `%${cari}%`;
      args.push(like, like, like, like);
    }
    const status = str(req.query.status);
    if (status && STATUS_AFFILIATOR.includes(status)) {
      where.push('a.status = ?');
      args.push(status);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = await scalar(`SELECT COUNT(*) AS c FROM affiliators a ${whereSql}`, args);
    const rows = await q(
      `SELECT a.id, a.kode_referral, a.nama_lengkap, a.email, a.nomor_wa, a.instagram,
              a.asal_institusi, a.bank_nama, a.bank_rekening, a.bank_atasnama,
              a.status, a.catatan_admin, a.created_at, a.updated_at, a.last_login_at,
              COUNT(r.id) AS total_referral,
              SUM(CASE WHEN r.status = 'TERVERIFIKASI' THEN 1 ELSE 0 END) AS terverifikasi,
              SUM(CASE WHEN r.status = 'MENUNGGU_VERIFIKASI' THEN 1 ELSE 0 END) AS menunggu,
              (SELECT COALESCE(SUM(p.jumlah),0) FROM komisi_payouts p WHERE p.affiliator_id = a.id) AS komisi_dibayar
         FROM affiliators a
         LEFT JOIN registrations r ON r.affiliator_id = a.id
         ${whereSql}
        GROUP BY a.id
        ORDER BY a.created_at DESC
        LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize]
    );

    res.set('Cache-Control', 'no-store');
    res.json({
      data: rows.map((r) => {
        const ver = Number(r.terverifikasi) || 0;
        const dibayar = Number(r.komisi_dibayar) || 0;
        const diperoleh = ver * komisiPer;
        return {
          ...r,
          id: Number(r.id),
          total_referral: Number(r.total_referral) || 0,
          terverifikasi: ver,
          menunggu: Number(r.menunggu) || 0,
          komisi_diperoleh: diperoleh,
          komisi_dibayar: dibayar,
          komisi_sisa: Math.max(0, diperoleh - dibayar),
        };
      }),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      komisi_per_referral: komisiPer,
    });
  })
);

/** Admin membuat akun affiliator secara manual. */
app.post(
  '/api/admin/affiliators',
  ah(async (req, res) => {
    const passwordDiberikan = typeof req.body?.password === 'string' && req.body.password;
    const passwordFinal = passwordDiberikan ? req.body.password : randomPassword(12);

    const { valid, errors, data } = validateAffiliator(
      { ...req.body, password: passwordFinal, password_confirm: passwordFinal },
      { requirePassword: true }
    );
    if (!valid) {
      return res.status(400).json({ error: 'Validasi gagal.', fields: errors });
    }

    const statusAwal = STATUS_AFFILIATOR.includes(str(req.body?.status))
      ? str(req.body.status)
      : 'AKTIF';
    const now = new Date().toISOString();
    const hash = hashPassword(passwordFinal);

    let inserted = null;
    let kodeFinal = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      kodeFinal = data.kode_referral || suggestReferralCode(data.nama_lengkap);
      const result = await run(
        `INSERT INTO affiliators
           (kode_referral, nama_lengkap, email, nomor_wa, instagram, asal_institusi,
            bank_nama, bank_rekening, bank_atasnama, password_hash, status,
            catatan_admin, created_at, updated_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?
          WHERE NOT EXISTS (SELECT 1 FROM affiliators WHERE lower(email) = ?)
            AND NOT EXISTS (SELECT 1 FROM affiliators WHERE kode_referral = ?)`,
        [
          kodeFinal,
          data.nama_lengkap,
          data.email,
          data.nomor_wa,
          data.instagram || null,
          data.asal_institusi || null,
          data.bank_nama || null,
          data.bank_rekening || null,
          data.bank_atasnama || null,
          hash,
          statusAwal,
          str(req.body?.catatan_admin).slice(0, 500) || null,
          now,
          now,
          data.email,
          kodeFinal,
        ]
      );
      if (result.changes === 1) {
        inserted = result;
        break;
      }
      const emailAda = await one(
        'SELECT 1 AS ada FROM affiliators WHERE lower(email) = ? LIMIT 1',
        [data.email]
      );
      if (emailAda) {
        return res.status(409).json({
          error: 'Email sudah terdaftar.',
          fields: { email: 'Email ini sudah dipakai affiliator lain.' },
        });
      }
      if (data.kode_referral) {
        return res.status(409).json({
          error: 'Kode referral sudah dipakai.',
          fields: { kode_referral: 'Kode referral ini sudah dipakai.' },
        });
      }
    }

    if (!inserted) {
      return res.status(500).json({ error: 'Gagal membuat kode referral unik.' });
    }

    await logActivity({
      ...actorAdmin(req),
      aksi: 'BUAT_AFFILIATOR',
      entitas: 'affiliator',
      entitasId: inserted.id,
      detail: `${data.nama_lengkap} (${kodeFinal})`,
    });

    return res.status(201).json({
      ok: true,
      id: inserted.id,
      kode_referral: kodeFinal,
      // Password ditampilkan SEKALI agar admin bisa menyerahkannya ke affiliator
      password: passwordDiberikan ? null : passwordFinal,
      message: passwordDiberikan
        ? 'Akun affiliator dibuat.'
        : 'Akun affiliator dibuat. Catat password berikut — hanya ditampilkan sekali.',
    });
  })
);

app.get(
  '/api/admin/affiliators/:id',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const aff = await one('SELECT * FROM affiliators WHERE id = ?', [id]);
    if (!aff) return res.status(404).json({ error: 'Affiliator tidak ditemukan.' });

    const komisiPer = await getSettingInt('komisi_referral', 0);
    const byStatus = await q(
      'SELECT status, COUNT(*) AS c FROM registrations WHERE affiliator_id = ? GROUP BY status',
      [id]
    );
    const counts = { MENUNGGU_VERIFIKASI: 0, TERVERIFIKASI: 0, DITOLAK: 0 };
    let total = 0;
    for (const r of byStatus) {
      const n = Number(r.c) || 0;
      if (r.status in counts) counts[r.status] = n;
      total += n;
    }

    const referrals = await q(
      `SELECT id, nama_lengkap, asal_sekolah, nomor_wa, gmail, status, created_at
         FROM registrations WHERE affiliator_id = ?
        ORDER BY created_at DESC LIMIT 200`,
      [id]
    );
    const payouts = await q(
      'SELECT id, jumlah, catatan, created_by, created_at FROM komisi_payouts WHERE affiliator_id = ? ORDER BY created_at DESC',
      [id]
    );
    const dibayar = payouts.reduce((s, p) => s + (Number(p.jumlah) || 0), 0);
    const diperoleh = counts.TERVERIFIKASI * komisiPer;

    res.set('Cache-Control', 'no-store');
    res.json({
      affiliator: publicAffiliator(aff),
      total_referral: total,
      by_status: counts,
      komisi_per_referral: komisiPer,
      komisi_diperoleh: diperoleh,
      komisi_dibayar: dibayar,
      komisi_sisa: Math.max(0, diperoleh - dibayar),
      referrals: referrals.map((r) => ({ ...r, id: Number(r.id) })),
      payouts: payouts.map((p) => ({ ...p, id: Number(p.id), jumlah: Number(p.jumlah) || 0 })),
    });
  })
);

/** Ubah data / status affiliator. */
app.patch(
  '/api/admin/affiliators/:id',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const aff = await one('SELECT * FROM affiliators WHERE id = ?', [id]);
    if (!aff) return res.status(404).json({ error: 'Affiliator tidak ditemukan.' });

    const { valid, errors, data } = validateAffiliator(
      {
        nama_lengkap: req.body?.nama_lengkap ?? aff.nama_lengkap,
        email: req.body?.email ?? aff.email,
        nomor_wa: req.body?.nomor_wa ?? aff.nomor_wa,
        instagram: req.body?.instagram ?? aff.instagram,
        asal_institusi: req.body?.asal_institusi ?? aff.asal_institusi,
        bank_nama: req.body?.bank_nama ?? aff.bank_nama,
        bank_rekening: req.body?.bank_rekening ?? aff.bank_rekening,
        bank_atasnama: req.body?.bank_atasnama ?? aff.bank_atasnama,
        kode_referral: req.body?.kode_referral ?? aff.kode_referral,
      },
      { requirePassword: false }
    );
    if (!valid) {
      return res.status(400).json({ error: 'Validasi gagal.', fields: errors });
    }

    const statusBaru = str(req.body?.status) || aff.status;
    if (!STATUS_AFFILIATOR.includes(statusBaru)) {
      return res.status(400).json({ error: 'Status affiliator tidak valid.' });
    }

    const kodeBaru = data.kode_referral || aff.kode_referral;

    // Email & kode harus tetap unik
    const bentrok = await one(
      'SELECT id FROM affiliators WHERE id <> ? AND (lower(email) = ? OR kode_referral = ?) LIMIT 1',
      [id, data.email, kodeBaru]
    );
    if (bentrok) {
      return res.status(409).json({
        error: 'Email atau kode referral sudah dipakai affiliator lain.',
        fields: { email: 'Cek email & kode referral.' },
      });
    }

    const now = new Date().toISOString();
    await run(
      `UPDATE affiliators
          SET kode_referral = ?, nama_lengkap = ?, email = ?, nomor_wa = ?, instagram = ?,
              asal_institusi = ?, bank_nama = ?, bank_rekening = ?, bank_atasnama = ?,
              status = ?, catatan_admin = ?, updated_at = ?
        WHERE id = ?`,
      [
        kodeBaru,
        data.nama_lengkap,
        data.email,
        data.nomor_wa,
        data.instagram || null,
        data.asal_institusi || null,
        data.bank_nama || null,
        data.bank_rekening || null,
        data.bank_atasnama || null,
        statusBaru,
        str(req.body?.catatan_admin ?? aff.catatan_admin).slice(0, 500) || null,
        now,
        id,
      ]
    );

    // Jika kode berubah, ikut perbarui jejak kode pada data pendaftar
    if (kodeBaru !== aff.kode_referral) {
      await run('UPDATE registrations SET referral_kode = ? WHERE affiliator_id = ?', [
        kodeBaru,
        id,
      ]);
    }

    await logActivity({
      ...actorAdmin(req),
      aksi: 'UBAH_AFFILIATOR',
      entitas: 'affiliator',
      entitasId: id,
      detail:
        statusBaru !== aff.status
          ? `status ${aff.status} -> ${statusBaru}`
          : 'perbarui data',
    });

    const fresh = await one('SELECT * FROM affiliators WHERE id = ?', [id]);
    return res.json({ ok: true, affiliator: publicAffiliator(fresh) });
  })
);

/** Reset password affiliator; password baru ditampilkan sekali. */
app.post(
  '/api/admin/affiliators/:id/reset-password',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const aff = await one('SELECT id, nama_lengkap FROM affiliators WHERE id = ?', [id]);
    if (!aff) return res.status(404).json({ error: 'Affiliator tidak ditemukan.' });

    const baru = randomPassword(12);
    await run('UPDATE affiliators SET password_hash = ?, updated_at = ? WHERE id = ?', [
      hashPassword(baru),
      new Date().toISOString(),
      id,
    ]);

    await logActivity({
      ...actorAdmin(req),
      aksi: 'RESET_PASSWORD_AFFILIATOR',
      entitas: 'affiliator',
      entitasId: id,
      detail: aff.nama_lengkap,
    });

    return res.json({
      ok: true,
      password: baru,
      message: 'Password baru dibuat. Catat & kirimkan ke affiliator — hanya ditampilkan sekali.',
    });
  })
);

/** Catat pembayaran komisi ke affiliator. */
app.post(
  '/api/admin/affiliators/:id/payouts',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const aff = await one('SELECT id, nama_lengkap FROM affiliators WHERE id = ?', [id]);
    if (!aff) return res.status(404).json({ error: 'Affiliator tidak ditemukan.' });

    const jumlah = asInt(req.body?.jumlah, 0);
    if (jumlah <= 0) {
      return res
        .status(400)
        .json({ error: 'Validasi gagal.', fields: { jumlah: 'Jumlah harus lebih dari 0.' } });
    }
    if (jumlah > 1000000000) {
      return res
        .status(400)
        .json({ error: 'Validasi gagal.', fields: { jumlah: 'Jumlah tidak wajar.' } });
    }

    const result = await run(
      'INSERT INTO komisi_payouts (affiliator_id, jumlah, catatan, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
      [
        id,
        jumlah,
        str(req.body?.catatan).slice(0, 300) || null,
        req.admin.username,
        new Date().toISOString(),
      ]
    );

    await logActivity({
      ...actorAdmin(req),
      aksi: 'BAYAR_KOMISI',
      entitas: 'affiliator',
      entitasId: id,
      detail: `Rp${jumlah.toLocaleString('id-ID')} ke ${aff.nama_lengkap}`,
    });

    return res.status(201).json({ ok: true, id: result.id });
  })
);

app.delete(
  '/api/admin/payouts/:id',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const row = await one('SELECT affiliator_id, jumlah FROM komisi_payouts WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Catatan pembayaran tidak ditemukan.' });

    await run('DELETE FROM komisi_payouts WHERE id = ?', [id]);
    await logActivity({
      ...actorAdmin(req),
      aksi: 'HAPUS_PEMBAYARAN_KOMISI',
      entitas: 'affiliator',
      entitasId: Number(row.affiliator_id),
      detail: `Rp${(Number(row.jumlah) || 0).toLocaleString('id-ID')}`,
    });
    return res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/affiliators/:id',
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const aff = await one('SELECT nama_lengkap, kode_referral FROM affiliators WHERE id = ?', [id]);
    if (!aff) return res.status(404).json({ error: 'Affiliator tidak ditemukan.' });

    // Lepaskan tautan dari pendaftar (data pendaftar TIDAK dihapus),
    // kode referral historis tetap tersimpan di kolom referral_kode.
    await run('UPDATE registrations SET affiliator_id = NULL WHERE affiliator_id = ?', [id]);
    await run('DELETE FROM komisi_payouts WHERE affiliator_id = ?', [id]);
    await run('DELETE FROM affiliators WHERE id = ?', [id]);

    await logActivity({
      ...actorAdmin(req),
      aksi: 'HAPUS_AFFILIATOR',
      entitas: 'affiliator',
      entitasId: id,
      detail: `${aff.nama_lengkap} (${aff.kode_referral})`,
    });

    return res.json({ ok: true });
  })
);

/* ---------------------- Pengaturan ---------------------- */

// Metadata ringan agar frontend tahu tipe & label tiap field pengaturan
const SETTINGS_META = Object.fromEntries(
  Object.entries(SETTINGS_SCHEMA).map(([k, v]) => [
    k,
    { type: v.type, label: v.label || k, max: v.max ?? null },
  ])
);

app.get(
  '/api/admin/settings',
  ah(async (req, res) => {
    const settings = await getPublicSettings();
    res.set('Cache-Control', 'no-store');
    res.json({ settings, schema: SETTINGS_META });
  })
);

app.patch(
  '/api/admin/settings',
  ah(async (req, res) => {
    const { valid, errors, data } = validateSettings(req.body);
    if (!valid) {
      return res.status(400).json({ error: 'Validasi gagal.', fields: errors });
    }
    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'Tidak ada pengaturan yang dikirim.' });
    }

    for (const [key, value] of Object.entries(data)) {
      await setSetting(key, value);
    }

    await logActivity({
      ...actorAdmin(req),
      aksi: 'UBAH_PENGATURAN',
      entitas: 'settings',
      detail: Object.keys(data).join(', ').slice(0, 300),
    });

    const settings = await getPublicSettings();
    return res.json({ ok: true, settings });
  })
);

/* ---------------------- Branding: logo, favicon, QRIS ---------------------- */

const BRANDING_SCOPES = {
  logo: 'Logo situs',
  favicon: 'Favicon (ikon tab browser)',
  qris: 'Gambar QRIS',
};

app.post(
  '/api/admin/branding/:kind',
  (req, res, next) => {
    if (!Object.hasOwn(BRANDING_SCOPES, req.params.kind)) {
      return res.status(400).json({ error: 'Jenis gambar tidak dikenal.' });
    }
    return next();
  },
  handleUpload('file'),
  ah(async (req, res) => {
    const kind = req.params.kind;
    const gambar = readImageUpload(req);
    if (!gambar.ok) {
      return res.status(400).json({ error: gambar.error, fields: { file: gambar.error } });
    }

    await saveFile(kind, 0, gambar.mime, gambar.base64);
    await logActivity({
      ...actorAdmin(req),
      aksi: 'UNGGAH_GAMBAR',
      entitas: 'branding',
      detail: BRANDING_SCOPES[kind],
    });

    const bv = await brandingVersion();
    return res.json({
      ok: true,
      kind,
      url: `/api/${kind}?v=${bv}`,
      branding_v: bv,
      message: `${BRANDING_SCOPES[kind]} berhasil diperbarui.`,
    });
  })
);

app.delete(
  '/api/admin/branding/:kind',
  ah(async (req, res) => {
    const kind = req.params.kind;
    if (!Object.hasOwn(BRANDING_SCOPES, kind)) {
      return res.status(400).json({ error: 'Jenis gambar tidak dikenal.' });
    }
    await deleteFile(kind, 0);
    await logActivity({
      ...actorAdmin(req),
      aksi: 'HAPUS_GAMBAR',
      entitas: 'branding',
      detail: BRANDING_SCOPES[kind],
    });
    return res.json({
      ok: true,
      message: `${BRANDING_SCOPES[kind]} dihapus. Situs kembali memakai logo teks bawaan.`,
    });
  })
);

/** Status gambar branding yang tersimpan. */
app.get(
  '/api/admin/branding',
  ah(async (req, res) => {
    const bv = await brandingVersion();
    const out = {};
    for (const kind of Object.keys(BRANDING_SCOPES)) {
      const f = await getFile(kind, 0);
      out[kind] = f
        ? {
            tersedia: true,
            mime: f.mime,
            // ukuran asli ≈ 3/4 panjang base64
            ukuran_kb: Math.round((f.data.length * 0.75) / 1024),
            diperbarui: f.created_at,
            url: `/api/${kind}?v=${bv}`,
          }
        : { tersedia: false };
    }
    res.set('Cache-Control', 'no-store');
    res.json({ branding: out, branding_v: bv });
  })
);

/* ---------------------- Akun admin (khusus SUPERADMIN) ---------------------- */

app.get(
  '/api/admin/admins',
  requireSuperAdmin,
  ah(async (req, res) => {
    const rows = await q(
      `SELECT id, username, nama, email, role, is_active, created_at, updated_at, last_login_at
         FROM admins ORDER BY id ASC`
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      data: rows.map((r) => ({
        ...r,
        id: Number(r.id),
        is_active: Number(r.is_active ?? 1) === 1,
        saya: Number(r.id) === req.admin.id,
      })),
    });
  })
);

app.post(
  '/api/admin/admins',
  requireSuperAdmin,
  ah(async (req, res) => {
    const username = str(req.body?.username).toLowerCase();
    const nama = str(req.body?.nama) || 'Administrator';
    const role = str(req.body?.role) === ROLE_SUPERADMIN ? ROLE_SUPERADMIN : ROLE_ADMIN;
    const fields = {};

    if (!username) fields.username = 'Username wajib diisi.';
    else if (!/^[a-z0-9._-]{4,32}$/.test(username))
      fields.username = 'Username 4–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip.';

    const passwordDiberikan = typeof req.body?.password === 'string' && req.body.password;
    const passwordFinal = passwordDiberikan ? req.body.password : randomPassword(14);
    const pwErr = validatePassword(passwordFinal);
    if (pwErr) fields.password = pwErr;
    else if (await isDefaultAdminPassword(passwordFinal))
      fields.password = 'Password awal bawaan tidak boleh dipakai.';

    if (Object.keys(fields).length) {
      return res.status(400).json({ error: 'Validasi gagal.', fields });
    }

    const now = new Date().toISOString();
    const result = await run(
      `INSERT INTO admins (username, nama, email, password_hash, role, is_active, created_at, updated_at)
       SELECT ?,?,?,?,?,1,?,?
        WHERE NOT EXISTS (SELECT 1 FROM admins WHERE lower(username) = ?)`,
      [
        username,
        nama,
        str(req.body?.email).toLowerCase() || null,
        hashPassword(passwordFinal),
        role,
        now,
        now,
        username,
      ]
    );
    if (result.changes === 0) {
      return res.status(409).json({
        error: 'Username sudah dipakai.',
        fields: { username: 'Username sudah dipakai.' },
      });
    }

    await logActivity({
      ...actorAdmin(req),
      aksi: 'BUAT_ADMIN',
      entitas: 'admin',
      entitasId: result.id,
      detail: `${username} (${role})`,
    });

    return res.status(201).json({
      ok: true,
      id: result.id,
      password: passwordDiberikan ? null : passwordFinal,
      message: passwordDiberikan
        ? 'Akun admin dibuat.'
        : 'Akun admin dibuat. Catat password berikut — hanya ditampilkan sekali.',
    });
  })
);

app.patch(
  '/api/admin/admins/:id',
  requireSuperAdmin,
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    const target = await one('SELECT * FROM admins WHERE id = ?', [id]);
    if (!target) return res.status(404).json({ error: 'Admin tidak ditemukan.' });

    const nama = str(req.body?.nama) || target.nama;
    const email = 'email' in (req.body || {}) ? str(req.body.email).toLowerCase() : target.email;
    const role =
      'role' in (req.body || {})
        ? str(req.body.role) === ROLE_SUPERADMIN
          ? ROLE_SUPERADMIN
          : ROLE_ADMIN
        : target.role;
    const aktif =
      'is_active' in (req.body || {})
        ? ['1', 'true', 'on', 'ya'].includes(str(req.body.is_active).toLowerCase())
        : Number(target.is_active ?? 1) === 1;

    // Jangan sampai sistem kehilangan satu-satunya Super Admin aktif
    if (
      (role !== ROLE_SUPERADMIN || !aktif) &&
      target.role === ROLE_SUPERADMIN &&
      Number(target.is_active ?? 1) === 1
    ) {
      const superAktif = await scalar(
        'SELECT COUNT(*) AS c FROM admins WHERE role = ? AND is_active = 1',
        [ROLE_SUPERADMIN]
      );
      if (superAktif <= 1) {
        return res.status(400).json({
          error: 'Tidak bisa menurunkan/menonaktifkan satu-satunya Super Admin aktif.',
        });
      }
    }
    if (id === req.admin.id && !aktif) {
      return res.status(400).json({ error: 'Kamu tidak bisa menonaktifkan akunmu sendiri.' });
    }

    const perubahan = [];
    if (nama !== target.nama) perubahan.push('nama');
    if (email !== target.email) perubahan.push('email');
    if (role !== target.role) perubahan.push(`role -> ${role}`);
    if (aktif !== (Number(target.is_active ?? 1) === 1))
      perubahan.push(aktif ? 'diaktifkan' : 'dinonaktifkan');

    let passwordBaru = null;
    if (typeof req.body?.password === 'string' && req.body.password) {
      const pwErr = validatePassword(req.body.password);
      if (pwErr) {
        return res.status(400).json({ error: 'Validasi gagal.', fields: { password: pwErr } });
      }
      passwordBaru = req.body.password;
      perubahan.push('password');
    } else if (str(req.body?.reset_password) === '1') {
      passwordBaru = randomPassword(14);
      perubahan.push('password direset');
    }

    if (passwordBaru && (await isDefaultAdminPassword(passwordBaru))) {
      return res.status(400).json({
        error: 'Validasi gagal.',
        fields: { password: 'Password awal bawaan tidak boleh dipakai.' },
      });
    }

    const now = new Date().toISOString();
    if (passwordBaru) {
      // password_changed_at baru -> semua sesi admin target dicabut.
      await run(
        `UPDATE admins SET nama = ?, email = ?, role = ?, is_active = ?, password_hash = ?,
                must_change_password = 0, password_changed_at = ?, updated_at = ?
          WHERE id = ?`,
        [nama, email || null, role, aktif ? 1 : 0, hashPassword(passwordBaru), now, now, id]
      );
    } else {
      await run(
        'UPDATE admins SET nama = ?, email = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?',
        [nama, email || null, role, aktif ? 1 : 0, now, id]
      );
    }

    await logActivity({
      ...actorAdmin(req),
      aksi: 'UBAH_ADMIN',
      entitas: 'admin',
      entitasId: id,
      detail: `${target.username}: ${perubahan.join(', ') || 'tanpa perubahan'}`,
    });

    // Bila superadmin mereset password AKUNNYA SENDIRI, versi password berubah
    // dan token sesinya ikut dicabut. Terbitkan token baru agar ia tidak
    // ter-logout sebelum sempat membaca password sekali-tampil.
    let token = null;
    if (passwordBaru && id === req.admin.id) {
      token = await issueAdminToken({
        ...req.admin,
        nama,
        role,
        password_changed_at: now,
      });
      setAuthCookie(res, ADMIN_COOKIE, token);
    }

    return res.json({
      ok: true,
      token,
      password: str(req.body?.reset_password) === '1' ? passwordBaru : null,
      message:
        str(req.body?.reset_password) === '1'
          ? 'Password baru dibuat — catat, hanya ditampilkan sekali.'
          : 'Data admin diperbarui.',
    });
  })
);

app.delete(
  '/api/admin/admins/:id',
  requireSuperAdmin,
  ah(async (req, res) => {
    const id = asInt(req.params.id, 0);
    if (id === req.admin.id) {
      return res.status(400).json({ error: 'Kamu tidak bisa menghapus akunmu sendiri.' });
    }
    const target = await one('SELECT username, role FROM admins WHERE id = ?', [id]);
    if (!target) return res.status(404).json({ error: 'Admin tidak ditemukan.' });

    if (target.role === ROLE_SUPERADMIN) {
      const jumlahSuper = await scalar('SELECT COUNT(*) AS c FROM admins WHERE role = ?', [
        ROLE_SUPERADMIN,
      ]);
      if (jumlahSuper <= 1) {
        return res.status(400).json({ error: 'Super Admin terakhir tidak boleh dihapus.' });
      }
    }

    await run('DELETE FROM admins WHERE id = ?', [id]);
    await logActivity({
      ...actorAdmin(req),
      aksi: 'HAPUS_ADMIN',
      entitas: 'admin',
      entitasId: id,
      detail: target.username,
    });
    return res.json({ ok: true });
  })
);

/* ---------------------- Jejak aktivitas & kesehatan sistem ---------------------- */

app.get(
  '/api/admin/activity',
  ah(async (req, res) => {
    const page = Math.max(1, asInt(req.query.page, 1));
    const pageSize = clamp(asInt(req.query.pageSize, 30), 1, 100);

    const where = [];
    const args = [];
    const tipe = str(req.query.actor_type).toUpperCase();
    if (['ADMIN', 'AFFILIATOR', 'PUBLIC', 'SYSTEM'].includes(tipe)) {
      where.push('actor_type = ?');
      args.push(tipe);
    }
    const cari = str(req.query.q);
    if (cari) {
      where.push('(aksi LIKE ? OR actor_nama LIKE ? OR detail LIKE ?)');
      const like = `%${cari}%`;
      args.push(like, like, like);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = await scalar(`SELECT COUNT(*) AS c FROM activity_log ${whereSql}`, args);
    const rows = await q(
      `SELECT id, actor_type, actor_id, actor_nama, aksi, entitas, entitas_id, detail, ip, created_at
         FROM activity_log ${whereSql}
        ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize]
    );

    res.set('Cache-Control', 'no-store');
    res.json({
      data: rows.map((r) => ({
        ...r,
        id: Number(r.id),
        entitas_id: r.entitas_id == null ? null : Number(r.entitas_id),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  })
);

/** Bersihkan log lama. */
app.delete(
  '/api/admin/activity',
  requireSuperAdmin,
  ah(async (req, res) => {
    const hari = clamp(asInt(req.query.older_than_days, 30), 1, 3650);
    const result = await run(
      `DELETE FROM activity_log WHERE created_at < datetime('now', ?)`,
      [`-${hari} days`]
    );
    await logActivity({
      ...actorAdmin(req),
      aksi: 'BERSIHKAN_LOG',
      entitas: 'settings',
      detail: `${result.changes} baris (> ${hari} hari)`,
    });
    return res.json({ ok: true, deleted: result.changes });
  })
);

/** Ringkasan kesehatan sistem — membantu diagnosa tanpa membuka log Vercel. */
app.get(
  '/api/admin/health',
  ah(async (req, res) => {
    const [pendaftar, affiliator, adminCount, logCount, fileRows] = await Promise.all([
      scalar('SELECT COUNT(*) AS c FROM registrations'),
      scalar('SELECT COUNT(*) AS c FROM affiliators'),
      scalar('SELECT COUNT(*) AS c FROM admins'),
      scalar('SELECT COUNT(*) AS c FROM activity_log'),
      q('SELECT scope, COUNT(*) AS c, SUM(length(data)) AS bytes FROM files GROUP BY scope'),
    ]);

    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      waktu_server: new Date().toISOString(),
      tanggal_jakarta: todayJakarta(),
      database: {
        terhubung: true,
        mode:
          process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || process.env.DATABASE_URL
            ? 'turso/libsql'
            : 'file lokal',
        pendaftar,
        affiliator,
        admin: adminCount,
        baris_log: logCount,
        penyimpanan_gambar: fileRows.map((f) => ({
          scope: f.scope,
          jumlah: Number(f.c) || 0,
          // base64 -> perkiraan ukuran biner
          ukuran_mb: Math.round(((Number(f.bytes) || 0) * 0.75) / 1048576 * 100) / 100,
        })),
      },
      konfigurasi: {
        // hanya status, tidak pernah nilainya
        jwt_secret_dari_env: !!process.env.JWT_SECRET,
        admin_dari_env: !!(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD),
        node_env: process.env.NODE_ENV || 'development',
        vercel: !!process.env.VERCEL,
      },
    });
  })
);

/* ================================================================== *
 *  STATIC & FALLBACK
 * ================================================================== *
 * Di Vercel, file di /public dilayani CDN sehingga blok ini hanya aktif
 * saat menjalankan server secara lokal (npm start).
 */
app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache');
    },
  })
);

const HTML_ROUTES = [
  ['/', 'index.html'],
  ['/admin', 'admin.html'],
  ['/affiliasi', 'affiliasi.html'],
  ['/affiliator', 'affiliasi.html'],
];
for (const [route, file] of HTML_ROUTES) {
  app.get(route, (req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
}

// 404 khusus API -> selalu JSON (jangan pernah balas HTML ke pemanggil API)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

// 404 halaman
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ------------------------------------------------------------------ *
 * Error handler global
 * ------------------------------------------------------------------ */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Body JSON tidak valid (dikirim express.json)
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Format data yang dikirim tidak valid.' });
  }
  // Body terlalu besar
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Data yang dikirim terlalu besar.' });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Ukuran file maksimal 3 MB.' });
  }

  console.error('[error]', req.method, req.originalUrl, '-', err?.stack || err?.message || err);

  if (req.path.startsWith('/api/')) {
    return res
      .status(500)
      .json({
        code: 'INTERNAL_SERVER_ERROR',
        error: 'Terjadi kesalahan pada server. Silakan coba lagi.',
      });
  }
  return res.status(500).send('Terjadi kesalahan pada server.');
});

export default app;
