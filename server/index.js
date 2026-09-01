// Entry point untuk menjalankan server secara lokal / di server biasa.
// (Untuk Vercel serverless, entry-nya ada di api/index.js.)
import app from './app.js';
import { ensureInit } from './db.js';

const PORT = process.env.PORT || 3000;

ensureInit()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Widya Nusantara Academy berjalan di http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Gagal inisialisasi basis data:', err);
    process.exit(1);
  });
