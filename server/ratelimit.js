/*
 * Rate limiter sederhana berbasis memori (sliding window).
 *
 * Catatan penting untuk serverless (Vercel): state ini per-instance lambda,
 * jadi bukan pengaman absolut lintas region. Tujuannya menghentikan brute force
 * & spam burst dari satu sumber pada satu instance — bersama-sama dengan
 * validasi duplikat di level database, ini sudah menutup jalur penyalahgunaan
 * yang realistis untuk skala aplikasi ini.
 */

const buckets = new Map();
const MAX_BUCKETS = 5000;

function pruneIfNeeded(now) {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, hits] of buckets) {
    if (!hits.length || now - hits[hits.length - 1] > 3600_000) buckets.delete(key);
    if (buckets.size <= MAX_BUCKETS * 0.8) break;
  }
}

/** Ambil IP klien dengan menghormati header proxy Vercel. */
export function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (
    req.headers?.['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  );
}

/**
 * @param {string} scope  nama aturan, mis. 'login'
 * @param {string} id     pengenal pemanggil (biasanya IP)
 * @param {{ max: number, windowMs: number }} opts
 * @returns {{ allowed: boolean, retryAfter: number, remaining: number }}
 */
export function hit(scope, id, { max, windowMs }) {
  const now = Date.now();
  const key = `${scope}:${id}`;
  const arr = buckets.get(key) || [];
  // buang jejak di luar jendela waktu
  const fresh = arr.filter((t) => now - t < windowMs);

  if (fresh.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - fresh[0])) / 1000));
    buckets.set(key, fresh);
    return { allowed: false, retryAfter, remaining: 0 };
  }

  fresh.push(now);
  buckets.set(key, fresh);
  pruneIfNeeded(now);
  return { allowed: true, retryAfter: 0, remaining: max - fresh.length };
}

/** Hapus catatan (dipakai setelah login sukses agar tidak menghukum user sah). */
export function reset(scope, id) {
  buckets.delete(`${scope}:${id}`);
}

/**
 * Middleware factory.
 * @param {string} scope
 * @param {{ max: number, windowMs: number, message?: string }} opts
 */
export function limiter(scope, { max, windowMs, message }) {
  return function rateLimitMiddleware(req, res, next) {
    const result = hit(scope, clientIp(req), { max, windowMs });
    if (!result.allowed) {
      res.set('Retry-After', String(result.retryAfter));
      return res.status(429).json({
        error:
          message ||
          `Terlalu banyak permintaan. Coba lagi dalam ${result.retryAfter} detik.`,
      });
    }
    return next();
  };
}
