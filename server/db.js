import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, randomToken } from './password.js';

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

/** Jalankan statement dengan retry terbatas untuk lock SQLite/libSQL sementara. */
async function execute(sql, args = []) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // getClient() di dalam try: lock saat membuka koneksi juga ikut di-retry.
      const client = await getClient();
      return await client.execute({ sql, args });
    } catch (err) {
      const message = String(err?.message || err);
      const code = String(err?.code || '');
      const busy = /SQLITE_(BUSY|LOCKED)/i.test(code) || /database is (busy|locked)/i.test(message);
      if (!busy || attempt >= 6) throw err;
      // Jitter mengurangi kemungkinan semua cold start mencoba ulang bersamaan.
      const delay = 40 * 2 ** attempt + Math.floor(Math.random() * 35);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Jalankan query, kembalikan array baris (objek biasa). */
export async function q(sql, args = []) {
  const res = await execute(sql, args);
  // libSQL mengembalikan baris dengan prototype null; normalkan ke objek biasa
  // supaya aman dipakai dengan spread/JSON.stringify di seluruh aplikasi.
  return res.rows.map((row) => ({ ...row }));
}

/** Jalankan perintah tulis, kembalikan { id, changes }. */
export async function run(sql, args = []) {
  const res = await execute(sql, args);
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
  ['admins', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0'],
  // Versi password: setiap penggantian password mengubah nilai ini sehingga
  // semua token admin lama (mis. sesi yang dibuka dengan password awal) dicabut.
  ['admins', 'password_changed_at', 'TEXT'],
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

/** @returns {Promise<Set<string>>} kolom yang benar-benar baru ditambahkan ("tabel.kolom") */
async function applyColumnMigrations() {
  const cache = new Map();
  const added = new Set();
  for (const [table, column, ddl] of COLUMN_MIGRATIONS) {
    if (!cache.has(table)) cache.set(table, await tableColumns(table));
    const cols = cache.get(table);
    if (cols.has(column)) continue;

    try {
      await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      cols.add(column);
      added.add(`${table}.${column}`);
      console.log(`[init] kolom ditambahkan: ${table}.${column}`);
    } catch (err) {
      /*
       * Dua cold start dapat mencoba ALTER yang sama. Jangan menebak dari teks
       * error (pesan Turso dapat berbeda): baca ulang skema. Hanya anggap sukses
       * bila kolom memang sudah ada; selain itu hentikan init dengan diagnosis
       * yang jelas agar query berikutnya tidak gagal sebagai "no such column".
       */
      const refreshed = await tableColumns(table);
      cache.set(table, refreshed);
      if (refreshed.has(column)) continue;
      throw new Error(
        `Migrasi basis data gagal pada ${table}.${column}: ${err?.message || 'kesalahan tidak diketahui'}`
      );
    }
  }
  return added;
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
    id: 'kontak-rekening-produksi-v2',
    async run() {
      /*
       * Pulihkan nilai operasional yang diminta pemilik. Migrasi v2 sengaja
       * memakai ID baru agar database produksi yang pernah menjalankan migrasi
       * lama tetap diperbarui. Setelah marker tersimpan, perubahan berikutnya
       * dari panel admin tidak akan ditimpa pada cold start.
       */
      await setSetting('email_kontak', 'rubelautbk@gmail.com');
      await setSetting('wa_kontak', '0895360396759');
      await setSetting('instagram_kontak', 'rubelaindonesia');
      await setSetting('bank_nama', 'Bank Neo / Neo Bank');
      await setSetting('bank_rekening', '5859459250325726');
      await setSetting('bank_atasnama', 'Haposan Sinaga');
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

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Klaim migrasi secara atomik lewat row settings.
 * - INSERT ... DO NOTHING menentukan tepat satu pemilik.
 * - Worker lain menunggu marker menjadi "1", sehingga tidak mulai melayani
 *   request sambil migrasi data masih berjalan.
 * - Lock yang ditinggalkan proses mati dapat diambil alih setelah 45 detik.
 */
async function claimMigration(key) {
  const token = `running:${Date.now()}:${randomToken(8)}`;
  const tryInsert = async () =>
    (
      await run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO NOTHING`,
        [key, token]
      )
    ).changes === 1;

  if (await tryInsert()) return token;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const value = await getSetting(key);
    if (value === '1') return null;

    // Pemilik sebelumnya gagal lalu melepas lock (row dihapus) -> klaim ulang.
    if (value == null) {
      if (await tryInsert()) return token;
      await sleep(150);
      continue;
    }

    // Function Vercel maksimal hidup 30 detik; lock > 45 detik pasti yatim.
    const match = /^running:(\d+):/.exec(String(value));
    const stale = !match || Date.now() - Number(match[1]) > 45_000;
    if (stale) {
      const taken = await run(
        'UPDATE settings SET value = ? WHERE key = ? AND value = ?',
        [token, key, value]
      );
      if (taken.changes === 1) return token;
    }
    await sleep(150);
  }

  throw new Error(`Migrasi "${key}" masih dijalankan instance lain. Silakan coba lagi.`);
}

async function runMigrationOnce(id, migrate) {
  const key = `_migrasi_${id}`;
  const token = await claimMigration(key);
  if (!token) return;

  try {
    await migrate();
    const finished = await run(
      'UPDATE settings SET value = ? WHERE key = ? AND value = ?',
      ['1', key, token]
    );
    if (finished.changes !== 1) {
      throw new Error('kepemilikan lock migrasi berubah sebelum selesai');
    }
    console.log(`[init] migrasi data selesai: ${id}`);
  } catch (err) {
    // Hanya pemilik lock boleh membukanya; instance berikutnya dapat mencoba ulang.
    await run('DELETE FROM settings WHERE key = ? AND value = ?', [key, token]).catch(
      () => {}
    );
    throw new Error(
      `Migrasi data "${id}" gagal: ${err?.message || 'kesalahan tidak diketahui'}`
    );
  }
}

async function runDataMigrations() {
  for (const mig of DATA_MIGRATIONS) {
    await runMigrationOnce(mig.id, mig.run);
  }
}

async function doInit() {
  for (const stmt of SCHEMA_STATEMENTS) {
    await run(stmt);
  }
  const addedColumns = await applyColumnMigrations();
  for (const stmt of POST_MIGRATION_INDEXES) {
    await run(stmt);
  }

  /*
   * Database pra-role (sebelum kolom admins.role ada) hanya mengenal satu
   * tingkat admin dengan hak penuh. Saat kolom role baru saja ditambahkan,
   * pertahankan hak tersebut: semua admin lama menjadi SUPERADMIN. Ini
   * dijalankan SEBELUM bootstrap wna.superadmin, sehingga keberadaan akun
   * bootstrap tidak membuat admin lama kehilangan akses kelola admin/setting.
   */
  if (addedColumns.has('admins.role')) {
    await run('UPDATE admins SET role = ?', [ROLE_SUPERADMIN]);
    console.log('[init] admin lama (skema pra-role) dipertahankan sebagai SUPERADMIN');
  }

  const now = new Date().toISOString();

  /*
   * Admin bootstrap.
   * 1. ADMIN_USERNAME + ADMIN_PASSWORD (bila ada) bersifat authoritative.
   * 2. Tanpa env, migrasi satu-kali memastikan akun wna.superadmin juga dibuat
   *    pada DATABASE LAMA yang sudah mempunyai akun `admin`. Versi sebelumnya
   *    hanya membuat akun baru saat COUNT(admins)=0 sehingga kredensial yang
   *    diberikan ke pemilik tidak pernah berlaku di Turso produksi.
   *
   * Marker disimpan di settings agar password yang kemudian diganti lewat panel
   * tidak di-reset pada setiap cold start.
   */
  const envUser = (process.env.ADMIN_USERNAME || '').trim();
  const envPass = process.env.ADMIN_PASSWORD || '';
  if (envUser && envPass) {
    /*
     * Env authoritative, tetapi:
     * - Hash hanya ditulis ulang bila password env TIDAK cocok dengan hash
     *   tersimpan. Tanpa ini setiap cold start menghasilkan hash (salt) baru,
     *   mengubah versi password, dan mencabut sesi semua admin env.
     * - Insert memakai ON CONFLICT agar cold start serentak tidak gagal UNIQUE.
     */
    const existing = await one(
      `SELECT id, username, password_hash FROM admins
        WHERE lower(username) = lower(?) ORDER BY (username = ?) DESC, id LIMIT 1`,
      [envUser, envUser]
    );

    if (existing) {
      const samePassword = await verifyPassword(envPass, existing.password_hash);
      if (samePassword) {
        await run(
          `UPDATE admins
              SET username = ?, role = ?, is_active = 1, must_change_password = 0
            WHERE id = ?`,
          [envUser, ROLE_SUPERADMIN, existing.id]
        );
      } else {
        await run(
          `UPDATE admins
              SET username = ?, password_hash = ?, role = ?, is_active = 1,
                  must_change_password = 0, password_changed_at = ?, updated_at = ?
            WHERE id = ?`,
          [envUser, hashPassword(envPass), ROLE_SUPERADMIN, now, now, existing.id]
        );
      }
    } else {
      await run(
        `INSERT INTO admins
           (username, nama, password_hash, role, is_active, must_change_password,
            password_changed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET
           role = excluded.role,
           is_active = 1,
           must_change_password = 0`,
        [envUser, 'Administrator', hashPassword(envPass), ROLE_SUPERADMIN, now, now, now]
      );
    }
    console.log(`[init] Admin (dari env) siap -> username: "${envUser}"`);
  } else {
    await runMigrationOnce('admin-wna-superadmin-v2', async () => {
      const target = await one(
        `SELECT id, username, password_hash FROM admins
          WHERE lower(username) = lower(?) ORDER BY (username = ?) DESC, id LIMIT 1`,
        [DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_USERNAME]
      );

      // Pemilik pernah menghapus akun ini dengan sengaja -> jangan dibuat ulang.
      const pernahDihapus = await one(
        `SELECT 1 AS ada FROM activity_log
          WHERE aksi = 'HAPUS_ADMIN' AND lower(detail) = lower(?) LIMIT 1`,
        [DEFAULT_ADMIN_USERNAME]
      );

      if (target) {
        /*
         * Akun sudah ada (dibuat rilis sebelumnya). Hormati keputusan pemilik:
         * - password TIDAK ditimpa,
         * - role & status aktif TIDAK diubah (akun yang sengaja dinonaktifkan /
         *   diturunkan perannya tidak dihidupkan kembali),
         * - hanya wajib-ganti yang diaktifkan bila masih memakai password awal.
         * (Login dengan password awal juga selalu memicu wajib-ganti, lihat
         *  verifyAdminCredentials, untuk kasus hash beda-salt.)
         */
        const stillDefault = target.password_hash === DEFAULT_ADMIN_HASH;
        await run(
          `UPDATE admins
              SET must_change_password = CASE WHEN ? = 1 THEN 1 ELSE must_change_password END,
                  updated_at = ?
            WHERE id = ?`,
          [stillDefault ? 1 : 0, now, target.id]
        );
      } else if (pernahDihapus) {
        console.log(
          `[init] "${DEFAULT_ADMIN_USERNAME}" pernah dihapus pemilik — tidak dibuat ulang.`
        );
      } else {
        await run(
          `INSERT INTO admins
             (username, nama, password_hash, role, is_active, must_change_password,
              password_changed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)
           ON CONFLICT(username) DO NOTHING`,
          [
            DEFAULT_ADMIN_USERNAME,
            'Super Administrator',
            DEFAULT_ADMIN_HASH,
            ROLE_SUPERADMIN,
            now,
            now,
            now,
          ]
        );
      }
      console.log(
        `[init] Migrasi akun admin selesai -> username: "${DEFAULT_ADMIN_USERNAME}"`
      );
    });
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
  await run('UPDATE admins SET must_change_password = 0 WHERE must_change_password IS NULL');

  // Secret JWT tanpa env dibuat secara atomik. INSERT ... DO NOTHING mencegah
  // dua cold start menyimpan secret berbeda dan langsung meng-invalidasi token
  // yang baru diterbitkan instance lain.
  if (!process.env.JWT_SECRET) {
    await run(
      `INSERT INTO settings (key, value) VALUES ('_jwt_secret', ?)
       ON CONFLICT(key) DO NOTHING`,
      [randomToken(48)]
    );
  }

  // Seed default juga atomik/idempoten; tidak ada lagi pola SELECT-lalu-INSERT
  // yang dapat bertabrakan pada cold start serentak.
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO NOTHING`,
      [k, v]
    );
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

/**
 * True bila password sama dengan password awal (bootstrap) yang dibagikan.
 * Dipakai untuk menolak "rotasi" yang sebenarnya tetap memakai password awal.
 */
export async function isDefaultAdminPassword(plain) {
  if (typeof plain !== 'string' || !plain) return false;
  return verifyPassword(plain, DEFAULT_ADMIN_HASH);
}

export { DEFAULT_ADMIN_USERNAME };
