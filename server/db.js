import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, randomToken } from './password.js';

/*
 * Data layer berbasis libSQL (SQLite-compatible).
 * - Produksi/Vercel : set TURSO_DATABASE_URL=libsql://... & TURSO_AUTH_TOKEN=...
 *   (memakai @libsql/client/web — murni JS, tanpa native addon, aman di serverless)
 * - Lokal / dev     : jika env kosong, memakai file:data/widya.db (@libsql/client node)
 *
 * Client dibuat SECARA LAZY (bukan saat import) agar modul tidak crash saat
 * dimuat di lingkungan serverless (mis. filesystem read-only).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ *
 * Kredensial admin bawaan
 * ------------------------------------------------------------------ *
 * Password TIDAK disimpan sebagai teks di repo — hanya hash scrypt-nya.
 * Jadi tidak ada kredensial yang bisa dibaca dari kode/website.
 * Override kapan pun dengan environment variable ADMIN_USERNAME +
 * ADMIN_PASSWORD (env selalu menang / authoritative).
 */
const DEFAULT_ADMIN_USERNAME = 'wna.superadmin';
const DEFAULT_ADMIN_HASH =
  'scrypt$16384$8$1$621b2e915c3743105cc1b8bf0b09b1f9$b5698f915cd908aeec2a64d47388692552f2a12c30a12dd93870944fa996170d';

export const ROLE_SUPERADMIN = 'SUPERADMIN';
export const ROLE_ADMIN = 'ADMIN';

function resolveUrl() {
  const envUrl =
    process.env.TURSO_DATABASE_URL ||
    process.env.LIBSQL_URL ||
    process.env.DATABASE_URL;
  if (envUrl) return envUrl.trim();

  // Tidak ada URL Turso -> mode file lokal. Di serverless (Vercel) ini tidak boleh
  // terjadi karena filesystem read-only; beri pesan yang jelas.
  if (process.env.VERCEL || process.env.NOW_REGION) {
    throw new Error(
      'TURSO_DATABASE_URL belum diset. Tambahkan Environment Variables Turso (TURSO_DATABASE_URL & TURSO_AUTH_TOKEN) di dashboard Vercel.'
    );
  }
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return 'file:' + path.join(dataDir, 'widya.db');
}

let _clientPromise = null;

async function getClient() {
  if (!_clientPromise) {
    _clientPromise = createClientLazy().catch((err) => {
      _clientPromise = null; // biar percobaan berikutnya bisa mencoba lagi
      throw err;
    });
  }
  return _clientPromise;
}

async function createClientLazy() {
  const url = resolveUrl();
  const authToken =
    process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || undefined;

  if (url.startsWith('file:')) {
    // build node (mendukung file lokal) — hanya untuk dev
    const mod = await import('@libsql/client');
    return mod.createClient({ url });
  }
  // build web murni-JS untuk remote Turso (aman di serverless)
  const mod = await import('@libsql/client/web');
  return mod.createClient(authToken ? { url, authToken } : { url });
}

/** Jalankan query, kembalikan array baris (objek biasa). */
export async function q(sql, args = []) {
  const client = await getClient();
  const res = await client.execute({ sql, args });
  // libSQL mengembalikan baris dengan prototype null; normalkan ke objek biasa
  // supaya aman dipakai dengan spread/JSON.stringify di seluruh aplikasi.
  return res.rows.map((row) => ({ ...row }));
}

/** Jalankan perintah tulis, kembalikan { id, changes }. */
export async function run(sql, args = []) {
  const client = await getClient();
  const res = await client.execute({ sql, args });
  return {
    id: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : null,
    changes: Number(res.rowsAffected || 0),
  };
}

/** Ambil satu baris atau null. */
export async function one(sql, args = []) {
  const rows = await q(sql, args);
  return rows.length ? rows[0] : null;
}

/** Ambil satu nilai numerik dari query agregat (COUNT/SUM), aman terhadap BigInt. */
export async function scalar(sql, args = [], fallback = 0) {
  const row = await one(sql, args);
  if (!row) return fallback;
  const v = Object.values(row)[0];
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---- Inisialisasi schema + seed (memoized, aman dipanggil tiap request) ----
let initPromise = null;

export function ensureInit() {
  if (!initPromise) {
    initPromise = doInit().catch((err) => {
      // reset agar percobaan berikutnya bisa mencoba lagi (mis. env baru diset)
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama_lengkap      TEXT NOT NULL,
      asal_sekolah      TEXT NOT NULL,
      tanggal_lahir     TEXT NOT NULL,
      status_pendidikan TEXT NOT NULL,
      nomor_wa          TEXT NOT NULL,
      instagram         TEXT,
      gmail             TEXT NOT NULL,
      referral          TEXT,
      nominal_transfer  TEXT,
      has_bukti         INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'MENUNGGU_VERIFIKASI',
      catatan_admin     TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    )`,
  `CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reg_created ON registrations(created_at)`,

  `CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      nama          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    )`,

  `CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )`,

  `CREATE TABLE IF NOT EXISTS files (
      scope      TEXT NOT NULL,
      ref_id     INTEGER NOT NULL DEFAULT 0,
      mime       TEXT NOT NULL,
      data       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (scope, ref_id)
    )`,

  // ---- Affiliator ----
  `CREATE TABLE IF NOT EXISTS affiliators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode_referral  TEXT NOT NULL,
      nama_lengkap   TEXT NOT NULL,
      email          TEXT NOT NULL,
      nomor_wa       TEXT NOT NULL,
      instagram      TEXT,
      asal_institusi TEXT,
      bank_nama      TEXT,
      bank_rekening  TEXT,
      bank_atasnama  TEXT,
      password_hash  TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'PENDING',
      catatan_admin  TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      last_login_at  TEXT
    )`,
  // Kode referral & email wajib unik (case-insensitive) — ditegakkan di level DB
  // supaya dua request paralel tidak bisa membuat duplikat.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_aff_kode ON affiliators(kode_referral)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_aff_email ON affiliators(lower(email))`,
  `CREATE INDEX IF NOT EXISTS idx_aff_status ON affiliators(status)`,

  // ---- Pembayaran komisi affiliator ----
  `CREATE TABLE IF NOT EXISTS komisi_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      affiliator_id INTEGER NOT NULL,
      jumlah        INTEGER NOT NULL DEFAULT 0,
      catatan       TEXT,
      created_by    TEXT,
      created_at    TEXT NOT NULL
    )`,
  `CREATE INDEX IF NOT EXISTS idx_payout_aff ON komisi_payouts(affiliator_id)`,

  // ---- Jejak aktivitas ----
  `CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_type TEXT NOT NULL,
      actor_id   INTEGER,
      actor_nama TEXT,
      aksi       TEXT NOT NULL,
      entitas    TEXT,
      entitas_id INTEGER,
      detail     TEXT,
      ip         TEXT,
      created_at TEXT NOT NULL
    )`,
  `CREATE INDEX IF NOT EXISTS idx_log_created ON activity_log(created_at)`,
];

/*
 * Kolom tambahan untuk tabel yang mungkin SUDAH ADA di database produksi.
 * `CREATE TABLE IF NOT EXISTS` tidak akan menambah kolom pada tabel lama,
 * jadi kolom baru harus ditambahkan lewat ALTER TABLE secara idempoten.
 */
const COLUMN_MIGRATIONS = [
  ['registrations', 'affiliator_id', 'INTEGER'],
  ['registrations', 'referral_kode', 'TEXT'],
  ['registrations', 'nominal_num', 'INTEGER'],
  ['registrations', 'verified_at', 'TEXT'],
  ['registrations', 'verified_by', 'TEXT'],
  ['admins', 'role', `TEXT NOT NULL DEFAULT '${ROLE_ADMIN}'`],
  ['admins', 'email', 'TEXT'],
  ['admins', 'is_active', 'INTEGER NOT NULL DEFAULT 1'],
  ['admins', 'last_login_at', 'TEXT'],
  ['admins', 'updated_at', 'TEXT'],
];

const POST_MIGRATION_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_reg_aff ON registrations(affiliator_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reg_kode ON registrations(referral_kode)`,
];

/** Daftar nama kolom sebuah tabel. */
async function tableColumns(table) {
  const rows = await q(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => String(r.name)));
}

async function applyColumnMigrations() {
  const cache = new Map();
  for (const [table, column, ddl] of COLUMN_MIGRATIONS) {
    if (!cache.has(table)) cache.set(table, await tableColumns(table));
    const cols = cache.get(table);
    if (cols.has(column)) continue;
    try {
      await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      cols.add(column);
      console.log(`[init] kolom ditambahkan: ${table}.${column}`);
    } catch (err) {
      // kalau balapan dengan instance lain, kolom mungkin sudah ada -> abaikan
      if (!/duplicate column/i.test(String(err?.message))) {
        console.warn(`[init] gagal menambah kolom ${table}.${column}:`, err?.message);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Pengaturan default
 * ------------------------------------------------------------------ */
export const DEFAULT_SETTINGS = {
  // Identitas
  nama_situs: 'Widya Nusantara Academy',
  tagline: 'Membuka Jalan Menuju Kampus Impian, Membangun Generasi Nusantara.',
  logo_teks: 'W',

  // Program & biaya
  kuota_total: '100',
  biaya: '160000',
  durasi_program: '5',
  jumlah_tryout: '6',
  kode_unik: '550',

  // Periode pendaftaran
  periode_pendaftaran: '28 September – 25 Oktober 2026',
  periode_mulai: '2026-09-28',
  periode_selesai: '2026-10-25',
  pendaftaran_aktif: '1',

  // Pembayaran
  bank_nama: 'Bank Neo / Neo Bank',
  bank_rekening: '5859459250325726',
  bank_atasnama: 'Haposan Sinaga',

  // Kontak
  wa_kontak: '0895360396759',
  email_kontak: 'rubelautbk@gmail.com',
  instagram_kontak: 'rubelaindonesia',

  // Program affiliasi
  affiliate_aktif: '1',
  affiliate_auto_approve: '0',
  komisi_referral: '10000',
  affiliate_syarat:
    'Komisi dibayarkan untuk setiap pendaftar yang memakai kode referral kamu DAN sudah terverifikasi pembayarannya. Tanpa batas jumlah. Kecurangan (mendaftar memakai kode sendiri, data palsu, spam) mengakibatkan akun dinonaktifkan.',
};

/*
 * Migrasi data satu kali. Dipakai untuk memperbarui nilai setting yang sudah
 * tersimpan di database produksi (default hanya berlaku untuk key yang belum ada).
 * Tandai selesai lewat key privat `_migrasi_<id>`.
 */
const DATA_MIGRATIONS = [
  {
    id: 'kontak-periode-okt2026',
    async run() {
      await setSetting('email_kontak', 'rubelautbk@gmail.com');
      await setSetting('wa_kontak', '0895360396759');
      await setSetting('instagram_kontak', 'rubelaindonesia');
      await setSetting('periode_pendaftaran', '28 September – 25 Oktober 2026');
      await setSetting('periode_mulai', '2026-09-28');
      await setSetting('periode_selesai', '2026-10-25');
    },
  },
  {
    id: 'referral-kode-backfill',
    async run() {
      // Data lama menyimpan referral sebagai teks bebas. Cocokkan ke kode
      // referral affiliator bila persis sama (case-insensitive).
      await run(
        `UPDATE registrations
            SET referral_kode = (
                  SELECT a.kode_referral FROM affiliators a
                   WHERE lower(a.kode_referral) = lower(trim(registrations.referral))
                ),
                affiliator_id = (
                  SELECT a.id FROM affiliators a
                   WHERE lower(a.kode_referral) = lower(trim(registrations.referral))
                )
          WHERE affiliator_id IS NULL
            AND referral IS NOT NULL
            AND trim(referral) <> ''`
      );
    },
  },
];

async function runDataMigrations() {
  for (const mig of DATA_MIGRATIONS) {
    const key = `_migrasi_${mig.id}`;
    const done = await getSetting(key);
    if (done === '1') continue;
    try {
      await mig.run();
      await setSetting(key, '1');
      console.log(`[init] migrasi data selesai: ${mig.id}`);
    } catch (err) {
      console.warn(`[init] migrasi data "${mig.id}" gagal:`, err?.message);
    }
  }
}

async function doInit() {
  for (const stmt of SCHEMA_STATEMENTS) {
    await run(stmt);
  }
  await applyColumnMigrations();
  for (const stmt of POST_MIGRATION_INDEXES) {
    await run(stmt);
  }

  const now = new Date().toISOString();

  /*
   * Admin bootstrap.
   * 1. Jika ADMIN_USERNAME + ADMIN_PASSWORD diset -> authoritative:
   *    buat/perbarui akun tersebut sebagai SUPERADMIN.
   * 2. Jika tidak diset dan tabel admins masih kosong -> buat akun bawaan
   *    memakai hash yang tertanam (password tidak ada di repo).
   */
  const envUser = (process.env.ADMIN_USERNAME || '').trim();
  const envPass = process.env.ADMIN_PASSWORD || '';
  if (envUser && envPass) {
    await run(
      `INSERT INTO admins (username, nama, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(username) DO UPDATE SET
         password_hash = excluded.password_hash,
         role          = excluded.role,
         is_active     = 1,
         updated_at    = excluded.updated_at`,
      [envUser, 'Administrator', hashPassword(envPass), ROLE_SUPERADMIN, now, now]
    );
    console.log(`[init] Admin (dari env) siap -> username: "${envUser}"`);
  } else {
    const jumlahAdmin = await scalar('SELECT COUNT(*) AS c FROM admins');
    if (jumlahAdmin === 0) {
      await run(
        `INSERT INTO admins (username, nama, password_hash, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [
          DEFAULT_ADMIN_USERNAME,
          'Super Administrator',
          DEFAULT_ADMIN_HASH,
          ROLE_SUPERADMIN,
          now,
          now,
        ]
      );
      console.log(
        `[init] Admin bawaan dibuat -> username: "${DEFAULT_ADMIN_USERNAME}" (password hanya diketahui pemilik sistem)`
      );
    }
  }

  // Pastikan selalu ada minimal satu SUPERADMIN (DB lama semuanya role kosong/ADMIN)
  const jumlahSuper = await scalar('SELECT COUNT(*) AS c FROM admins WHERE role = ?', [
    ROLE_SUPERADMIN,
  ]);
  if (jumlahSuper === 0) {
    await run(
      'UPDATE admins SET role = ? WHERE id = (SELECT MIN(id) FROM admins)',
      [ROLE_SUPERADMIN]
    );
  }
  // Normalkan kolom hasil ALTER TABLE pada baris lama
  await run("UPDATE admins SET role = ? WHERE role IS NULL OR role = ''", [ROLE_ADMIN]);
  await run('UPDATE admins SET is_active = 1 WHERE is_active IS NULL');

  // Secret JWT: pakai env bila ada; jika tidak, buat sekali lalu simpan di DB
  // supaya konsisten di semua instance serverless (bukan hardcode di repo).
  if (!process.env.JWT_SECRET) {
    const existing = await getSetting('_jwt_secret');
    if (!existing) {
      await setSetting('_jwt_secret', randomToken(48));
      console.warn(
        '[init] JWT_SECRET belum diset — secret acak dibuat & disimpan di DB. Disarankan set JWT_SECRET di environment.'
      );
    }
  }

  // Seed pengaturan default (hanya key yang belum ada)
  const existing = await q('SELECT key FROM settings');
  const have = new Set(existing.map((r) => r.key));
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!have.has(k)) {
      await run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
    }
  }

  await runDataMigrations();
}

// ---- Settings helpers ----
export async function getSetting(key) {
  const row = await one('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function getAllSettings() {
  const rows = await q('SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** Semua setting kecuali key privat (berawalan "_"). */
export async function getPublicSettings() {
  const all = await getAllSettings();
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('_')) out[k] = v;
  }
  return out;
}

export async function setSetting(key, value) {
  await run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value == null ? null : String(value)]
  );
}

/** Ambil setting sebagai integer dengan fallback. */
export async function getSettingInt(key, fallback = 0) {
  const raw = await getSetting(key);
  const n = Number.parseInt(String(raw ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

// ---- File helpers (gambar disimpan base64 di DB) ----
export async function saveFile(scope, refId, mime, base64) {
  await run(
    `INSERT INTO files (scope, ref_id, mime, data, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(scope, ref_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, created_at = excluded.created_at`,
    [scope, refId, mime, base64, new Date().toISOString()]
  );
}

export async function getFile(scope, refId) {
  return one('SELECT mime, data, created_at FROM files WHERE scope = ? AND ref_id = ?', [
    scope,
    refId,
  ]);
}

/** Cek keberadaan file tanpa menarik blob base64-nya ke memori. */
export async function hasFile(scope, refId) {
  const row = await one(
    'SELECT 1 AS ada FROM files WHERE scope = ? AND ref_id = ? LIMIT 1',
    [scope, refId]
  );
  return !!row;
}

export async function deleteFile(scope, refId) {
  await run('DELETE FROM files WHERE scope = ? AND ref_id = ?', [scope, refId]);
}

// ---- Jejak aktivitas ----
/**
 * Catat aktivitas. Sengaja "best effort": kegagalan logging tidak boleh
 * menggagalkan request utama.
 */
export async function logActivity({
  actorType = 'SYSTEM',
  actorId = null,
  actorNama = null,
  aksi,
  entitas = null,
  entitasId = null,
  detail = null,
  ip = null,
} = {}) {
  try {
    await run(
      `INSERT INTO activity_log
         (actor_type, actor_id, actor_nama, aksi, entitas, entitas_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(actorType).slice(0, 32),
        actorId == null ? null : Number(actorId),
        actorNama == null ? null : String(actorNama).slice(0, 120),
        String(aksi).slice(0, 80),
        entitas == null ? null : String(entitas).slice(0, 40),
        entitasId == null ? null : Number(entitasId),
        detail == null ? null : String(detail).slice(0, 500),
        ip == null ? null : String(ip).slice(0, 64),
        new Date().toISOString(),
      ]
    );
  } catch (err) {
    console.warn('[log] gagal mencatat aktivitas:', err?.message);
  }
}

export { DEFAULT_ADMIN_USERNAME };
