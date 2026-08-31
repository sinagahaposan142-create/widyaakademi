/**
 * Seed data contoh untuk demo/development.
 * Jalankan: npm run seed
 */
import db, { seedDefaults } from './db.js';

seedDefaults();

const samples = [
  { nama_lengkap: 'Budi Santoso', asal_sekolah: 'SMAN 1 Jakarta', tanggal_lahir: '2007-05-12', status_pendidikan: 'SMA/sederajat Kelas 12', nomor_wa: '081234567890', instagram: 'budi.santoso', gmail: 'budi@gmail.com', referral: 'Andi', nominal_transfer: '160.550', status: 'TERVERIFIKASI' },
  { nama_lengkap: 'Siti Nurhaliza', asal_sekolah: 'SMAN 3 Bandung', tanggal_lahir: '2006-11-02', status_pendidikan: 'Gap Year 2025-2026', nomor_wa: '082198765432', instagram: 'siti.n', gmail: 'siti@gmail.com', referral: null, nominal_transfer: '160.550', status: 'MENUNGGU_VERIFIKASI' },
  { nama_lengkap: 'Rangga Pratama', asal_sekolah: 'SMA Negeri 5 Surabaya', tanggal_lahir: '2007-01-20', status_pendidikan: 'Semi Gap Year 2025-2026', nomor_wa: '083812341234', instagram: 'rangga', gmail: 'rangga@gmail.com', referral: 'Budi Santoso', nominal_transfer: '160.550', status: 'MENUNGGU_VERIFIKASI' },
];

const now = new Date().toISOString();
const stmt = db.prepare(
  `INSERT INTO registrations
    (nama_lengkap, asal_sekolah, tanggal_lahir, status_pendidikan, nomor_wa,
     instagram, gmail, referral, nominal_transfer, bukti_filename, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

let inserted = 0;
for (const s of samples) {
  const exists = db
    .prepare('SELECT id FROM registrations WHERE gmail = ?')
    .get(s.gmail);
  if (exists) continue;
  stmt.run(
    s.nama_lengkap, s.asal_sekolah, s.tanggal_lahir, s.status_pendidikan,
    s.nomor_wa, s.instagram, s.gmail, s.referral, s.nominal_transfer,
    null, s.status, now, now
  );
  inserted++;
}

console.log(`[seed] ${inserted} data contoh ditambahkan.`);
process.exit(0);
