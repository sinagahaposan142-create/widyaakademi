export const STATUS_PENDIDIKAN = [
  'SMA/sederajat Kelas 12',
  'Gap Year 2025-2026',
  'Semi Gap Year 2025-2026',
];

export const STATUS_PENDAFTARAN = [
  'MENUNGGU_VERIFIKASI',
  'TERVERIFIKASI',
  'DITOLAK',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validasi payload pendaftaran.
 * @returns {{ valid: boolean, errors: Object, data: Object }}
 */
export function validateRegistration(body) {
  const errors = {};
  const data = {};

  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  data.nama_lengkap = str(body.nama_lengkap);
  if (!data.nama_lengkap) errors.nama_lengkap = 'Nama lengkap wajib diisi.';
  else if (data.nama_lengkap.length < 3)
    errors.nama_lengkap = 'Nama lengkap minimal 3 karakter.';

  data.asal_sekolah = str(body.asal_sekolah);
  if (!data.asal_sekolah) errors.asal_sekolah = 'Asal sekolah wajib diisi.';

  data.tanggal_lahir = str(body.tanggal_lahir);
  if (!data.tanggal_lahir) {
    errors.tanggal_lahir = 'Tanggal lahir wajib diisi.';
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.tanggal_lahir)) {
    errors.tanggal_lahir = 'Format tanggal lahir tidak valid.';
  } else {
    const d = new Date(data.tanggal_lahir);
    if (isNaN(d.getTime()) || d > new Date()) {
      errors.tanggal_lahir = 'Tanggal lahir tidak valid.';
    }
  }

  data.status_pendidikan = str(body.status_pendidikan);
  if (!data.status_pendidikan) {
    errors.status_pendidikan = 'Status pendidikan wajib dipilih.';
  } else if (!STATUS_PENDIDIKAN.includes(data.status_pendidikan)) {
    errors.status_pendidikan = 'Status pendidikan tidak valid.';
  }

  data.nomor_wa = str(body.nomor_wa).replace(/[\s-]/g, '');
  if (!data.nomor_wa) {
    errors.nomor_wa = 'Nomor WhatsApp wajib diisi.';
  } else if (!/^\+?\d{8,15}$/.test(data.nomor_wa)) {
    errors.nomor_wa = 'Nomor WhatsApp harus 8-15 digit angka.';
  }

  data.instagram = str(body.instagram).replace(/^@/, '');

  data.gmail = str(body.gmail);
  if (!data.gmail) {
    errors.gmail = 'Gmail aktif wajib diisi.';
  } else if (!EMAIL_RE.test(data.gmail)) {
    errors.gmail = 'Format email tidak valid.';
  }

  data.referral = str(body.referral);
  data.nominal_transfer = str(body.nominal_transfer);

  return { valid: Object.keys(errors).length === 0, errors, data };
}
