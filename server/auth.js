import jwt from 'jsonwebtoken';
import {
  one,
  run,
  getSetting,
  setSetting,
  ROLE_ADMIN,
  ROLE_SUPERADMIN,
} from './db.js';
import { hashPassword, verifyPassword, needsRehash, randomToken } from './password.js';

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12 jam
export const ADMIN_COOKIE = 'wna_admin_token';
export const AFF_COOKIE = 'wna_aff_token';

export const STATUS_AFFILIATOR = ['PENDING', 'AKTIF', 'NONAKTIF', 'DITOLAK'];

/* ------------------------------------------------------------------ *
 * Secret JWT
 * ------------------------------------------------------------------ *
 * Prioritas: env JWT_SECRET -> secret acak yang dipersist di tabel settings.
 * TIDAK ADA fallback yang dihardcode di repo (kerentanan lama), sehingga token
 * tidak bisa dipalsukan oleh siapa pun yang membaca kode sumber.
 */
let secretPromise = null;

export function resolveJwtSecret() {
  if (!secretPromise) {
    secretPromise = (async () => {
      const fromEnv = (process.env.JWT_SECRET || '').trim();
      if (fromEnv) return fromEnv;
      let stored = await getSetting('_jwt_secret');
      if (!stored) {
        stored = randomToken(48);
        await setSetting('_jwt_secret', stored);
      }
      return stored;
    })().catch((err) => {
      secretPromise = null;
      throw err;
    });
  }
  return secretPromise;
}

/* ------------------------------------------------------------------ *
 * Helper cookie
 * ------------------------------------------------------------------ */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/',
  };
}

export function setAuthCookie(res, name, token) {
  res.cookie(name, token, cookieOptions());
}

export function clearAuthCookie(res, name) {
  res.clearCookie(name, { path: '/' });
}

function readToken(req, cookieName) {
  const fromCookie = req.cookies?.[cookieName];
  if (fromCookie) return fromCookie;
  const header = req.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim() || null;
  }
  return null;
}

async function signToken(payload) {
  const secret = await resolveJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: TOKEN_TTL_SECONDS });
}

async function readPayload(token) {
  const secret = await resolveJwtSecret();
  return jwt.verify(token, secret);
}

/* ------------------------------------------------------------------ *
 * Admin
 * ------------------------------------------------------------------ */
export async function verifyAdminCredentials(username, password) {
  const uname = String(username || '').trim();
  if (!uname || !password) return null;

  const admin = await one('SELECT * FROM admins WHERE lower(username) = lower(?)', [uname]);
  if (!admin) return null;
  if (Number(admin.is_active ?? 1) !== 1) return { blocked: true };

  const ok = await verifyPassword(String(password), admin.password_hash);
  if (!ok) return null;

  // Upgrade hash bcrypt lama -> scrypt secara transparan setelah login sukses
  if (needsRehash(admin.password_hash)) {
    try {
      await run('UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?', [
        hashPassword(String(password)),
        new Date().toISOString(),
        admin.id,
      ]);
    } catch {
      /* non-fatal */
    }
  }

  await run('UPDATE admins SET last_login_at = ? WHERE id = ?', [
    new Date().toISOString(),
    admin.id,
  ]);

  return {
    id: Number(admin.id),
    username: admin.username,
    nama: admin.nama,
    role: admin.role === ROLE_SUPERADMIN ? ROLE_SUPERADMIN : ROLE_ADMIN,
  };
}

export function issueAdminToken(admin) {
  return signToken({
    sub: admin.id,
    kind: 'admin',
    username: admin.username,
    nama: admin.nama,
    role: admin.role,
  });
}

/**
 * Middleware: wajib sesi admin valid.
 * Token diverifikasi DAN dicek ulang ke database (akun bisa dinonaktifkan /
 * dihapus di tengah masa berlaku token).
 */
export async function requireAdmin(req, res, next) {
  const token = readToken(req, ADMIN_COOKIE);
  if (!token) {
    return res.status(401).json({ error: 'Tidak terautentikasi.' });
  }

  let payload;
  try {
    payload = await readPayload(token);
  } catch {
    return res.status(401).json({ error: 'Sesi tidak valid atau kedaluwarsa.' });
  }
  if (payload.kind !== 'admin') {
    return res.status(403).json({ error: 'Token ini bukan untuk panel admin.' });
  }

  const admin = await one(
    'SELECT id, username, nama, role, is_active FROM admins WHERE id = ?',
    [payload.sub]
  );
  if (!admin || Number(admin.is_active ?? 1) !== 1) {
    clearAuthCookie(res, ADMIN_COOKIE);
    return res.status(401).json({ error: 'Akun admin tidak aktif. Silakan masuk kembali.' });
  }

  req.admin = {
    id: Number(admin.id),
    username: admin.username,
    nama: admin.nama,
    role: admin.role === ROLE_SUPERADMIN ? ROLE_SUPERADMIN : ROLE_ADMIN,
  };
  return next();
}

/** Middleware: hanya SUPERADMIN (dipakai untuk kelola akun admin). */
export function requireSuperAdmin(req, res, next) {
  if (req.admin?.role !== ROLE_SUPERADMIN) {
    return res
      .status(403)
      .json({ error: 'Hanya Super Admin yang boleh melakukan tindakan ini.' });
  }
  return next();
}

/* ------------------------------------------------------------------ *
 * Affiliator
 * ------------------------------------------------------------------ */
export async function verifyAffiliatorCredentials(identifier, password) {
  const id = String(identifier || '').trim();
  if (!id || !password) return null;

  // Boleh login memakai email ATAU kode referral
  const aff = await one(
    'SELECT * FROM affiliators WHERE lower(email) = lower(?) OR lower(kode_referral) = lower(?)',
    [id, id]
  );
  if (!aff) return null;

  const ok = await verifyPassword(String(password), aff.password_hash);
  if (!ok) return null;

  if (needsRehash(aff.password_hash)) {
    try {
      await run('UPDATE affiliators SET password_hash = ?, updated_at = ? WHERE id = ?', [
        hashPassword(String(password)),
        new Date().toISOString(),
        aff.id,
      ]);
    } catch {
      /* non-fatal */
    }
  }

  if (aff.status !== 'AKTIF') {
    return { blocked: true, status: aff.status, catatan_admin: aff.catatan_admin || null };
  }

  await run('UPDATE affiliators SET last_login_at = ? WHERE id = ?', [
    new Date().toISOString(),
    aff.id,
  ]);

  return {
    id: Number(aff.id),
    nama_lengkap: aff.nama_lengkap,
    email: aff.email,
    kode_referral: aff.kode_referral,
    status: aff.status,
  };
}

export function issueAffiliatorToken(aff) {
  return signToken({
    sub: aff.id,
    kind: 'affiliator',
    email: aff.email,
    nama: aff.nama_lengkap,
    kode: aff.kode_referral,
  });
}

/** Middleware: wajib sesi affiliator valid & status AKTIF. */
export async function requireAffiliator(req, res, next) {
  const token = readToken(req, AFF_COOKIE);
  if (!token) {
    return res.status(401).json({ error: 'Tidak terautentikasi.' });
  }

  let payload;
  try {
    payload = await readPayload(token);
  } catch {
    return res.status(401).json({ error: 'Sesi tidak valid atau kedaluwarsa.' });
  }
  if (payload.kind !== 'affiliator') {
    return res.status(403).json({ error: 'Token ini bukan untuk dashboard affiliator.' });
  }

  const aff = await one(
    `SELECT id, nama_lengkap, email, nomor_wa, instagram, asal_institusi,
            bank_nama, bank_rekening, bank_atasnama, kode_referral, status,
            catatan_admin, created_at, last_login_at
       FROM affiliators WHERE id = ?`,
    [payload.sub]
  );
  if (!aff) {
    clearAuthCookie(res, AFF_COOKIE);
    return res.status(401).json({ error: 'Akun tidak ditemukan. Silakan masuk kembali.' });
  }
  if (aff.status !== 'AKTIF') {
    clearAuthCookie(res, AFF_COOKIE);
    return res.status(403).json({
      error:
        aff.status === 'PENDING'
          ? 'Akun kamu masih menunggu persetujuan admin.'
          : 'Akun affiliator kamu tidak aktif. Hubungi admin.',
      status: aff.status,
    });
  }

  req.affiliator = aff;
  return next();
}

export { ROLE_ADMIN, ROLE_SUPERADMIN, TOKEN_TTL_SECONDS };
