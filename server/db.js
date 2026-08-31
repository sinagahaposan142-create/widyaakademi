import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'widya.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----
db.exec(`
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
    bukti_filename    TEXT,
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
`);

// ---- Seed default admin + settings ----
export function seedDefaults() {
  const now = new Date().toISOString();

  const adminCount = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
  if (adminCount === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'widya2026';
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      'INSERT INTO admins (username, nama, password_hash, created_at) VALUES (?, ?, ?, ?)'
    ).run(username, 'Administrator', hash, now);
    console.log(`[seed] Admin default dibuat -> username: "${username}" password: "${password}"`);
  }

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
    qris_filename: '',
  };
  const getS = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setS = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    if (!getS.get(k)) setS.run(k, v);
  }
}

// ---- Settings helpers ----
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export default db;
