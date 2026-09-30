/*
 * Seed data contoh untuk pengembangan lokal.
 * Jalankan: npm run seed
 *
 * Idempoten: aman dijalankan berulang kali (dedupe berdasarkan email / kode referral).
 * JANGAN dijalankan di database produksi.
 */
import { ensureInit, q, run, one, getSettingInt } from './db.js';
import { hashPassword } from './password.js';

await ensureInit();

const now = new Date().toISOString();

/* ---------------- Affiliator contoh ---------------- */
const affiliators = [
  {
    kode_referral: 'HAPOSAN26',
    nama_lengkap: 'Haposan Sinaga',
    email: 'haposan.demo@gmail.com',
    nomor_wa: '0895360396759',
    instagram: 'haposan.demo',
    asal_institusi: 'Universitas Indonesia',
    bank_nama: 'Bank Neo / Neo Bank',
    bank_rekening: '5859459250325726',
    bank_atasnama: 'Haposan Sinaga',
    status: 'AKTIF',
  },
  {
    kode_referral: 'RUBELA01',
    nama_lengkap: 'Dewi Lestari',
    email: 'dewi.demo@gmail.com',
    nomor_wa: '0812345678901',
    instagram: 'dewi.demo',
    asal_institusi: 'SMAN 3 Bandung',
    status: 'PENDING',
  },
];

const affIdByKode = new Map();
for (const a of affiliators) {
  const existing = await one('SELECT id FROM affiliators WHERE kode_referral = ?', [
    a.kode_referral,
  ]);
  if (existing) {
    affIdByKode.set(a.kode_referral, Number(existing.id));
    continue;
  }
  const res = await run(
    `INSERT INTO affiliators
       (kode_referral, nama_lengkap, email, nomor_wa, instagram, asal_institusi,
        bank_nama, bank_rekening, bank_atasnama, password_hash, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      a.kode_referral,
      a.nama_lengkap,
      a.email,
      a.nomor_wa,
      a.instagram || null,
      a.asal_institusi || null,
      a.bank_nama || null,
      a.bank_rekening || null,
      a.bank_atasnama || null,
      // Password demo: "Demo12345" — hanya untuk data seed lokal.
      hashPassword('Demo12345'),
      a.status,
      now,
      now,
    ]
  );
  affIdByKode.set(a.kode_referral, res.id);
}

/* ---------------- Pendaftar contoh ---------------- */
const biaya = await getSettingInt('biaya', 160000);
const kodeUnik = String(await getSettingInt('kode_unik', 550));
const nominal = Number(String(biaya).slice(0, -kodeUnik.length) + kodeUnik);

const pendaftar = [
  {
    nama_lengkap: 'Budi Santoso',
    asal_sekolah: 'SMAN 1 Jakarta',
    tanggal_lahir: '2007-04-11',
    status_pendidikan: 'SMA/sederajat Kelas 12',
    nomor_wa: '081234000001',
    instagram: 'budi.santoso',
    gmail: 'budi.demo@gmail.com',
    referral_kode: 'HAPOSAN26',
    status: 'TERVERIFIKASI',
  },
  {
    nama_lengkap: 'Siti Nurhaliza',
    asal_sekolah: 'SMAN 2 Bandung',
    tanggal_lahir: '2006-11-02',
    status_pendidikan: 'Gap Year 2025-2026',
    nomor_wa: '081234000002',
    instagram: 'siti.nur',
    gmail: 'siti.demo@gmail.com',
    referral_kode: 'HAPOSAN26',
    status: 'MENUNGGU_VERIFIKASI',
  },
  {
    nama_lengkap: 'Rangga Pratama',
    asal_sekolah: 'SMAS Harapan Bangsa',
    tanggal_lahir: '2007-01-28',
    status_pendidikan: 'Semi Gap Year 2025-2026',
    nomor_wa: '081234000003',
    gmail: 'rangga.demo@gmail.com',
    referral_kode: null,
    status: 'MENUNGGU_VERIFIKASI',
  },
];

let dibuat = 0;
for (const p of pendaftar) {
  const existing = await one('SELECT id FROM registrations WHERE lower(gmail) = ?', [
    p.gmail.toLowerCase(),
  ]);
  if (existing) continue;

  await run(
    `INSERT INTO registrations
       (nama_lengkap, asal_sekolah, tanggal_lahir, status_pendidikan, nomor_wa, instagram,
        gmail, referral, referral_kode, affiliator_id, nominal_transfer, nominal_num,
        has_bukti, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
    [
      p.nama_lengkap,
      p.asal_sekolah,
      p.tanggal_lahir,
      p.status_pendidikan,
      p.nomor_wa,
      p.instagram || null,
      p.gmail,
      p.referral_kode,
      p.referral_kode,
      p.referral_kode ? affIdByKode.get(p.referral_kode) ?? null : null,
      nominal.toLocaleString('id-ID'),
      nominal,
      p.status,
      now,
      now,
    ]
  );
  dibuat += 1;
}

const totalPendaftar = await q('SELECT COUNT(*) AS c FROM registrations');
const totalAff = await q('SELECT COUNT(*) AS c FROM affiliators');

console.log(`[seed] pendaftar baru dibuat : ${dibuat}`);
console.log(`[seed] total pendaftar       : ${Number(totalPendaftar[0].c)}`);
console.log(`[seed] total affiliator      : ${Number(totalAff[0].c)}`);
console.log(`[seed] login affiliator demo : haposan.demo@gmail.com / Demo12345`);
console.log('[seed] Catatan: data ini hanya untuk pengembangan lokal.');
process.exit(0);
