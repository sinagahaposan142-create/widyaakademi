import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Data layer berbasis libSQL (SQLite-compatible).
 * - Lokal / dev  : file database (TURSO_DATABASE_URL kosong -> file:data/widya.db)
 * - Produksi/Vercel: set TURSO_DATABASE_URL=libsql://... & TURSO_AUTH_TOKEN=...
 *   (Vercel serverless tidak punya disk permanen, jadi WAJIB pakai Turso.)
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveUrl() {
  const envUrl =
    process.env.TURSO_DATABASE_URL ||
    process.env.LIBSQL_URL ||
    process.env.DATABASE_URL;
  if (envUrl) return envUrl;
  // fallback file lokal
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return 'file:' + path.join(dataDir, 'widya.db');
}

const url = resolveUrl();
const authToken =
  process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || undefined;

const client = createClient(authToken ? { url, authToken } : { url });

/** Jalankan query, kembalikan array baris (objek). */
export async function q(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows;
}

/** Jalankan perintah tulis, kembalikan { id, changes }. */
export async function run(sql, args = []) {
  const res = await client.execute({ sql, args });
  return {
    id: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : null,
    changes: res.rowsAffected,
  };
}

// ---- Inisialisasi schema + seed (memoized, aman dipanggil tiap request) ----
let initPromise = null;

export function ensureInit() {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS registrations (
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
    );
    CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);
    CREATE INDEX IF NOT EXISTS idx_reg_created ON registrations(created_at);

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      nama          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      scope      TEXT NOT NULL,
      ref_id     INTEGER NOT NULL DEFAULT 0,
      mime       TEXT NOT NULL,
      data       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (scope, ref_id)
    );
  `);

  const now = new Date().toISOString();

  // seed admin default
  const adminRows = await q('SELECT COUNT(*) AS c FROM admins');
  if (Number(adminRows[0].c) === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'widya2026';
    const hash = bcrypt.hashSync(password, 10);
    await run(
      'INSERT INTO admins (username, nama, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [username, 'Administrator', hash, now]
    );
    console.log(`[init] Admin default dibuat -> username: "${username}"`);
  }

  // seed settings default
  const defaults = {
    kuota_total: '100',
    biaya: '160000',
    kode_unik: '550',
    bank_nama: 'Bank Neo / Neo Bank',
    bank_rekening: '5859459250325726',
    bank_atasnama: 'Haposan Sinaga',
    wa_kontak: '0895360396759',
    email_kontak: 'widyaakademi@gmail.com',
    periode_pendaftaran: '6 April - 27 September 2026',
  };
  const existing = await q('SELECT key FROM settings');
  const have = new Set(existing.map((r) => r.key));
  for (const [k, v] of Object.entries(defaults)) {
    if (!have.has(k)) {
      await run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
    }
  }
}

// ---- Settings helpers ----
export async function getSetting(key) {
  const rows = await q('SELECT value FROM settings WHERE key = ?', [key]);
  return rows.length ? rows[0].value : null;
}

export async function getAllSettings() {
  const rows = await q('SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(key, value) {
  await run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
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
  const rows = await q(
    'SELECT mime, data FROM files WHERE scope = ? AND ref_id = ?',
    [scope, refId]
  );
  return rows.length ? rows[0] : null;
}

export async function deleteFile(scope, refId) {
  await run('DELETE FROM files WHERE scope = ? AND ref_id = ?', [scope, refId]);
}

export async function fileExists(scope, refId) {
  const rows = await q(
    'SELECT 1 AS x FROM files WHERE scope = ? AND ref_id = ? LIMIT 1',
    [scope, refId]
  );
  return rows.length > 0;
}

export default client;
