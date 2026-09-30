import crypto from 'node:crypto';

/*
 * Hashing password memakai scrypt bawaan Node (node:crypto).
 *
 * Alasan tidak memakai bcryptjs untuk hash baru:
 *  - bcryptjs adalah implementasi JS murni yang sinkron & lambat; di serverless
 *    hal itu memblokir event loop pada setiap login.
 *  - scrypt tersedia native di Node >= 18, lebih cepat, dan memory-hard.
 *
 * Hash lama (format bcrypt "$2a$/$2b$/$2y$") tetap DIDUKUNG untuk login agar
 * database yang sudah ada tidak rusak. Saat pemilik hash lama berhasil login,
 * pemanggil dapat memakai needsRehash() untuk memutakhirkan hash-nya.
 */

const SCRYPT_N = 16384; // 2^14
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;
const PREFIX = 'scrypt';

/** @param {string} plain @returns {string} hash siap disimpan */
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAXMEM,
  });
  return [PREFIX, SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('hex'), dk.toString('hex')].join('$');
}

/** True bila hash memakai format bcrypt lama. */
export function isLegacyHash(stored) {
  return typeof stored === 'string' && /^\$2[aby]?\$/.test(stored);
}

/** Alias semantik: hash lama sebaiknya di-upgrade setelah login sukses. */
export function needsRehash(stored) {
  return isLegacyHash(stored);
}

/**
 * Verifikasi password terhadap hash tersimpan.
 * Mendukung scrypt (baru) dan bcrypt (lama).
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || !plain || typeof stored !== 'string' || !stored) {
    return false;
  }

  if (isLegacyHash(stored)) {
    try {
      const mod = await import('bcryptjs');
      const bcrypt = mod.default || mod;
      return bcrypt.compareSync(plain, stored);
    } catch {
      // bcryptjs tidak tersedia -> hash lama tidak dapat diverifikasi
      return false;
    }
  }

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'hex');
    expected = Buffer.from(parts[5], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual;
  try {
    actual = crypto.scryptSync(plain, salt, expected.length, { N, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** Token acak URL-safe (untuk secret / password sementara). */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Password acak yang mudah dibacakan (tanpa karakter ambigu),
 * dipakai saat admin mereset password affiliator.
 */
export function randomPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Bagian acak kode referral (tanpa 0/O/1/I agar tidak ambigu saat dibacakan). */
export function randomCodeSuffix(length = 4) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/**
 * Susun kandidat kode referral dari nama: 3-6 huruf pertama nama + 4 karakter acak.
 * Contoh: "Haposan Sinaga" -> "HAPOSA-K7QD" (tanpa tanda hubung: HAPOSAK7QD)
 */
export function suggestReferralCode(nama) {
  const base = String(nama || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 6);
  const prefix = base.length >= 3 ? base : (base + 'WNA').slice(0, 3);
  return prefix + randomCodeSuffix(4);
}
