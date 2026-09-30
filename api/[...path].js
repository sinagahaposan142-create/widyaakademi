/*
 * Vercel Serverless Function (catch-all) untuk semua endpoint /api/*.
 * Seluruh request diteruskan ke aplikasi Express di server/app.js.
 *
 * Catatan: aplikasi Express diekspor langsung sebagai handler (req, res).
 * Inisialisasi database dilakukan lazy per cold start oleh middleware di app.js,
 * sehingga modul ini aman diimpor meski environment belum lengkap.
 */
import app from '../server/app.js';

export default app;
