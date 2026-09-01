import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { q } from './db.js';

const JWT_SECRET =
  process.env.JWT_SECRET || 'widya-nusantara-academy-secret-key-change-me';
const TOKEN_TTL = '12h';
const COOKIE_NAME = 'widya_admin_token';

export async function verifyCredentials(username, password) {
  const rows = await q('SELECT * FROM admins WHERE username = ?', [username]);
  const admin = rows[0];
  if (!admin) return null;
  if (!bcrypt.compareSync(password, admin.password_hash)) return null;
  return { id: admin.id, username: admin.username, nama: admin.nama };
}

export function issueToken(admin) {
  return jwt.sign(
    { id: admin.id, username: admin.username, nama: admin.nama },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

/** Express middleware: require valid admin session */
export function requireAdmin(req, res, next) {
  const token =
    req.cookies?.[COOKIE_NAME] ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) {
    return res.status(401).json({ error: 'Tidak terautentikasi.' });
  }
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesi tidak valid atau kedaluwarsa.' });
  }
}

export { COOKIE_NAME };
