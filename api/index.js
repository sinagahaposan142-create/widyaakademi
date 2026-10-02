/*
 * Vercel Serverless Function tunggal untuk SELURUH request /api/*.
 *
 * Rewrite di vercel.json mengalihkan semua path /api/* (termasuk path
 * multi-segmen seperti /api/auth/login) ke fungsi ini, sehingga tidak ada
 * endpoint yang 404 di layer platform. Rewrite Vercel bersifat internal:
 * req.url yang diterima fungsi tetap path ASLI yang diminta pengguna, jadi
 * Express mencocokkan route-nya seperti biasa.
 *
 * Express app diekspor langsung sebagai handler (req, res). Inisialisasi
 * database dilakukan lazy per cold start oleh middleware di app.js.
 */
import app from '../server/app.js';

export default app;
