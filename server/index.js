// Entry point untuk menjalankan server secara lokal / di server biasa.
// Untuk Vercel serverless, entry-nya ada di api/[...path].js.
//
// Variabel environment: jalankan dengan `npm run dev` (memuat .env lewat
// flag --env-file bawaan Node) atau set variabel secara manual sebelum `npm start`.
import app from './app.js';
import { ensureInit } from './db.js';

const PORT = Number(process.env.PORT) || 3000;

ensureInit()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  Widya Nusantara Academy`);
      console.log(`  Situs           : http://localhost:${PORT}`);
      console.log(`  Panel admin     : http://localhost:${PORT}/admin`);
      console.log(`  Affiliator      : http://localhost:${PORT}/affiliasi\n`);
    });
  })
  .catch((err) => {
    console.error('Gagal inisialisasi basis data:', err.message);
    console.error(
      'Periksa TURSO_DATABASE_URL & TURSO_AUTH_TOKEN, atau jalankan tanpa keduanya untuk memakai file lokal data/widya.db.'
    );
    process.exit(1);
  });
