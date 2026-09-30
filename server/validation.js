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

export const STATUS_AFFILIATOR = ['PENDING', 'AKTIF', 'NONAKTIF', 'DITOLAK'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const KODE_REFERRAL_RE = /^[A-Z0-9]{4,20}$/;

/* ------------------------------------------------------------------ *
 * Helper umum
 * ------------------------------------------------------------------ */
export const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Normalkan nomor WA: buang spasi/tanda hubung/tanda kurung, +62 -> 0. */
export function normalizeWa(input) {
  let s = str(input).replace(/[\s\-().]/g, '');
  if (s.startsWith('+62')) s = '0' + s.slice(3);
  else if (s.startsWith('62') && s.length > 10) s = '0' + s.slice(2);
  return s;
}

/** Nomor WA format internasional untuk tautan wa.me (62xxxx). */
export function waToIntl(input) {
  const s = normalizeWa(input).replace(/\D/g, '');
  if (!s) return '';
  return s.startsWith('0') ? '62' + s.slice(1) : s;
}

/** Normalkan username Instagram: buang @, URL, dan spasi. */
export function normalizeInstagram(input) {
  let s = str(input);
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
  s = s.replace(/[/?].*$/, '');
  s = s.replace(/^@+/, '');
  return s.trim();
}

/** Normalkan kode referral -> HURUF BESAR tanpa karakter aneh. */
export function normalizeKode(input) {
  return str(input).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Ambil angka dari string rupiah ("Rp160.550" / "160,550" -> 160550). */
export function parseRupiah(input) {
  const digits = str(input).replace(/\D/g, '');
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function validTanggal(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  // pastikan tanggal benar-benar ada (mis. 2026-02-31 ditolak)
  return d.toISOString().slice(0, 10) === value;
}

/* ------------------------------------------------------------------ *
 * Pendaftaran murid
 * ------------------------------------------------------------------ */
/**
 * Validasi payload pendaftaran.
 * @param {Object} body
 * @param {{ requireBukti?: boolean, hasBukti?: boolean }} [opts]
 * @returns {{ valid: boolean, errors: Object, data: Object }}
 */
export function validateRegistration(body, opts = {}) {
  const errors = {};
  const data = {};
  const b = body || {};

  data.nama_lengkap = str(b.nama_lengkap).replace(/\s+/g, ' ');
  if (!data.nama_lengkap) errors.nama_lengkap = 'Nama lengkap wajib diisi.';
  else if (data.nama_lengkap.length < 3)
    errors.nama_lengkap = 'Nama lengkap minimal 3 karakter.';
  else if (data.nama_lengkap.length > 100)
    errors.nama_lengkap = 'Nama lengkap maksimal 100 karakter.';

  data.asal_sekolah = str(b.asal_sekolah).replace(/\s+/g, ' ');
  if (!data.asal_sekolah) errors.asal_sekolah = 'Asal sekolah wajib diisi.';
  else if (data.asal_sekolah.length > 120)
    errors.asal_sekolah = 'Asal sekolah maksimal 120 karakter.';

  data.tanggal_lahir = str(b.tanggal_lahir);
  if (!data.tanggal_lahir) {
    errors.tanggal_lahir = 'Tanggal lahir wajib diisi.';
  } else if (!validTanggal(data.tanggal_lahir)) {
    errors.tanggal_lahir = 'Format tanggal lahir tidak valid (YYYY-MM-DD).';
  } else {
    const d = new Date(data.tanggal_lahir + 'T00:00:00Z');
    const now = new Date();
    if (d.getTime() > now.getTime()) {
      errors.tanggal_lahir = 'Tanggal lahir tidak boleh di masa depan.';
    } else {
      const umur = (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (umur < 10) errors.tanggal_lahir = 'Umur minimal 10 tahun.';
      else if (umur > 80) errors.tanggal_lahir = 'Tanggal lahir tidak wajar.';
    }
  }

  data.status_pendidikan = str(b.status_pendidikan);
  if (!data.status_pendidikan) {
    errors.status_pendidikan = 'Status pendidikan wajib dipilih.';
  } else if (!STATUS_PENDIDIKAN.includes(data.status_pendidikan)) {
    errors.status_pendidikan = 'Status pendidikan tidak valid.';
  }

  data.nomor_wa = normalizeWa(b.nomor_wa);
  if (!data.nomor_wa) {
    errors.nomor_wa = 'Nomor WhatsApp wajib diisi.';
  } else if (!/^0\d{8,14}$/.test(data.nomor_wa)) {
    errors.nomor_wa = 'Nomor WhatsApp harus 9–15 digit dan diawali 0 (contoh: 0895xxxxxxx).';
  }

  data.instagram = normalizeInstagram(b.instagram);
  if (data.instagram && !/^[A-Za-z0-9._]{1,30}$/.test(data.instagram)) {
    errors.instagram = 'Username Instagram hanya boleh huruf, angka, titik, dan garis bawah.';
  }

  data.gmail = str(b.gmail).toLowerCase();
  if (!data.gmail) {
    errors.gmail = 'Gmail aktif wajib diisi.';
  } else if (!EMAIL_RE.test(data.gmail) || data.gmail.length > 120) {
    errors.gmail = 'Format email tidak valid.';
  }

  // Kode referral (opsional). Disimpan dalam bentuk ternormalisasi.
  const kodeRaw = str(b.referral || b.referral_kode);
  data.referral = kodeRaw;
  data.referral_kode = normalizeKode(kodeRaw);
  if (kodeRaw && !KODE_REFERRAL_RE.test(data.referral_kode)) {
    errors.referral = 'Kode referral terdiri dari 4–20 huruf/angka.';
  }

  // Nominal transfer (opsional, tapi kalau diisi harus wajar)
  const nominalRaw = str(b.nominal_transfer);
  data.nominal_transfer = nominalRaw;
  data.nominal_num = null;
  if (nominalRaw) {
    const n = parseRupiah(nominalRaw);
    if (n == null || n <= 0) {
      errors.nominal_transfer = 'Nominal transfer tidak valid.';
    } else if (n < 1000 || n > 1000000000) {
      errors.nominal_transfer = 'Nominal transfer di luar batas wajar.';
    } else {
      data.nominal_num = n;
      data.nominal_transfer = n.toLocaleString('id-ID');
    }
  }

  if (opts.requireBukti && !opts.hasBukti) {
    errors.bukti = 'Bukti pembayaran wajib diunggah.';
  }

  return { valid: Object.keys(errors).length === 0, errors, data };
}

/* ------------------------------------------------------------------ *
 * Password
 * ------------------------------------------------------------------ */
export function validatePassword(value, fieldLabel = 'Password') {
  const s = typeof value === 'string' ? value : '';
  if (!s) return `${fieldLabel} wajib diisi.`;
  if (s.length < 8) return `${fieldLabel} minimal 8 karakter.`;
  if (s.length > 72) return `${fieldLabel} maksimal 72 karakter.`;
  if (!/[A-Za-z]/.test(s)) return `${fieldLabel} harus memuat minimal satu huruf.`;
  if (!/\d/.test(s)) return `${fieldLabel} harus memuat minimal satu angka.`;
  return null;
}

/* ------------------------------------------------------------------ *
 * Affiliator
 * ------------------------------------------------------------------ */
/**
 * Validasi pendaftaran akun affiliator.
 * @param {Object} body
 * @param {{ requirePassword?: boolean }} [opts]
 */
export function validateAffiliator(body, opts = {}) {
  const requirePassword = opts.requirePassword !== false;
  const errors = {};
  const data = {};
  const b = body || {};

  data.nama_lengkap = str(b.nama_lengkap).replace(/\s+/g, ' ');
  if (!data.nama_lengkap) errors.nama_lengkap = 'Nama lengkap wajib diisi.';
  else if (data.nama_lengkap.length < 3)
    errors.nama_lengkap = 'Nama lengkap minimal 3 karakter.';
  else if (data.nama_lengkap.length > 100)
    errors.nama_lengkap = 'Nama lengkap maksimal 100 karakter.';

  data.email = str(b.email).toLowerCase();
  if (!data.email) errors.email = 'Email wajib diisi.';
  else if (!EMAIL_RE.test(data.email) || data.email.length > 120)
    errors.email = 'Format email tidak valid.';

  data.nomor_wa = normalizeWa(b.nomor_wa);
  if (!data.nomor_wa) errors.nomor_wa = 'Nomor WhatsApp wajib diisi.';
  else if (!/^0\d{8,14}$/.test(data.nomor_wa))
    errors.nomor_wa = 'Nomor WhatsApp harus 9–15 digit dan diawali 0.';

  data.instagram = normalizeInstagram(b.instagram);
  if (data.instagram && !/^[A-Za-z0-9._]{1,30}$/.test(data.instagram)) {
    errors.instagram = 'Username Instagram tidak valid.';
  }

  data.asal_institusi = str(b.asal_institusi).replace(/\s+/g, ' ');
  if (data.asal_institusi.length > 120)
    errors.asal_institusi = 'Asal sekolah/kampus maksimal 120 karakter.';

  data.bank_nama = str(b.bank_nama).slice(0, 60);
  data.bank_rekening = str(b.bank_rekening).replace(/[\s-]/g, '');
  if (data.bank_rekening && !/^\d{6,25}$/.test(data.bank_rekening)) {
    errors.bank_rekening = 'Nomor rekening/e-wallet harus 6–25 digit angka.';
  }
  data.bank_atasnama = str(b.bank_atasnama).slice(0, 80);

  // Kode referral: boleh diajukan sendiri, kalau kosong akan digenerate server
  data.kode_referral = normalizeKode(b.kode_referral);
  if (data.kode_referral && !KODE_REFERRAL_RE.test(data.kode_referral)) {
    errors.kode_referral = 'Kode referral 4–20 karakter, hanya huruf & angka.';
  }

  if (requirePassword) {
    const pwErr = validatePassword(b.password);
    if (pwErr) errors.password = pwErr;
    else if (str(b.password_confirm) && b.password !== b.password_confirm) {
      errors.password_confirm = 'Konfirmasi password tidak sama.';
    }
    data.password = typeof b.password === 'string' ? b.password : '';
  }

  return { valid: Object.keys(errors).length === 0, errors, data };
}

/** Validasi field profil yang boleh diubah affiliator sendiri. */
export function validateAffiliatorProfile(body) {
  const { errors, data } = validateAffiliator(
    { ...body, email: body?.email ?? 'x@x.xx' },
    { requirePassword: false }
  );
  // email tidak boleh diubah sendiri -> buang dari hasil & abaikan errornya
  delete data.email;
  delete errors.email;
  delete data.kode_referral;
  delete errors.kode_referral;
  return { valid: Object.keys(errors).length === 0, errors, data };
}

/* ------------------------------------------------------------------ *
 * Pengaturan situs
 * ------------------------------------------------------------------ */
export const SETTINGS_SCHEMA = {
  nama_situs: { type: 'text', max: 80, required: true, label: 'Nama situs' },
  tagline: { type: 'text', max: 220, label: 'Tagline' },
  logo_teks: { type: 'text', max: 3, required: true, label: 'Teks logo' },

  kuota_total: { type: 'int', min: 1, max: 100000, label: 'Kuota total' },
  biaya: { type: 'int', min: 0, max: 1000000000, label: 'Biaya' },
  durasi_program: { type: 'int', min: 1, max: 120, label: 'Durasi program (bulan)' },
  jumlah_tryout: { type: 'int', min: 0, max: 500, label: 'Jumlah try out' },
  kode_unik: { type: 'digits', min: 1, max: 6, label: 'Kode unik' },

  periode_pendaftaran: { type: 'text', max: 100, label: 'Periode pendaftaran' },
  periode_mulai: { type: 'date', allowEmpty: true, label: 'Tanggal mulai' },
  periode_selesai: { type: 'date', allowEmpty: true, label: 'Tanggal selesai' },
  pendaftaran_aktif: { type: 'bool', label: 'Pendaftaran aktif' },

  bank_nama: { type: 'text', max: 60, label: 'Nama bank' },
  bank_rekening: { type: 'digits', min: 6, max: 25, label: 'Nomor rekening' },
  bank_atasnama: { type: 'text', max: 80, label: 'Atas nama' },

  wa_kontak: { type: 'phone', label: 'Nomor WhatsApp' },
  email_kontak: { type: 'email', label: 'Email kontak' },
  instagram_kontak: { type: 'igname', allowEmpty: true, label: 'Instagram' },

  affiliate_aktif: { type: 'bool', label: 'Program affiliasi aktif' },
  affiliate_auto_approve: { type: 'bool', label: 'Setujui affiliator otomatis' },
  komisi_referral: { type: 'int', min: 0, max: 100000000, label: 'Komisi per referral' },
  affiliate_syarat: { type: 'text', max: 1200, label: 'Syarat & ketentuan affiliasi' },
};

export const EDITABLE_SETTINGS = Object.keys(SETTINGS_SCHEMA);

/**
 * Validasi + normalisasi patch pengaturan. Hanya key yang dikirim diproses.
 * @returns {{ valid: boolean, errors: Object, data: Record<string,string> }}
 */
export function validateSettings(body) {
  const errors = {};
  const data = {};
  const b = body || {};

  for (const [key, rule] of Object.entries(SETTINGS_SCHEMA)) {
    if (!(key in b)) continue;
    const raw = b[key];
    const label = rule.label || key;

    if (rule.type === 'bool') {
      const s = str(raw).toLowerCase();
      const truthy = ['1', 'true', 'on', 'ya', 'yes'].includes(s);
      const falsy = ['0', 'false', 'off', 'tidak', 'no', ''].includes(s);
      if (!truthy && !falsy) {
        errors[key] = `${label} harus bernilai ya/tidak.`;
        continue;
      }
      data[key] = truthy ? '1' : '0';
      continue;
    }

    const value = str(raw);

    if (rule.type === 'int') {
      if (value === '') {
        errors[key] = `${label} wajib diisi.`;
        continue;
      }
      const n = Number.parseInt(value.replace(/[^\d-]/g, ''), 10);
      if (!Number.isFinite(n)) {
        errors[key] = `${label} harus berupa angka.`;
        continue;
      }
      if (rule.min != null && n < rule.min) {
        errors[key] = `${label} minimal ${rule.min}.`;
        continue;
      }
      if (rule.max != null && n > rule.max) {
        errors[key] = `${label} maksimal ${rule.max}.`;
        continue;
      }
      data[key] = String(n);
      continue;
    }

    if (rule.type === 'digits') {
      const digits = value.replace(/[\s-]/g, '');
      if (!digits) {
        errors[key] = `${label} wajib diisi.`;
        continue;
      }
      if (!/^\d+$/.test(digits)) {
        errors[key] = `${label} hanya boleh angka.`;
        continue;
      }
      if (rule.min != null && digits.length < rule.min) {
        errors[key] = `${label} minimal ${rule.min} digit.`;
        continue;
      }
      if (rule.max != null && digits.length > rule.max) {
        errors[key] = `${label} maksimal ${rule.max} digit.`;
        continue;
      }
      data[key] = digits;
      continue;
    }

    if (rule.type === 'email') {
      if (!value) {
        errors[key] = `${label} wajib diisi.`;
        continue;
      }
      if (!EMAIL_RE.test(value) || value.length > 120) {
        errors[key] = `${label} tidak valid.`;
        continue;
      }
      data[key] = value.toLowerCase();
      continue;
    }

    if (rule.type === 'phone') {
      const wa = normalizeWa(value);
      if (!wa) {
        errors[key] = `${label} wajib diisi.`;
        continue;
      }
      if (!/^0\d{8,14}$/.test(wa)) {
        errors[key] = `${label} harus 9–15 digit dan diawali 0.`;
        continue;
      }
      data[key] = wa;
      continue;
    }

    if (rule.type === 'igname') {
      const ig = normalizeInstagram(value);
      if (!ig) {
        if (rule.allowEmpty) {
          data[key] = '';
          continue;
        }
        errors[key] = `${label} wajib diisi.`;
        continue;
      }
      if (!/^[A-Za-z0-9._]{1,30}$/.test(ig)) {
        errors[key] = `${label} tidak valid.`;
        continue;
      }
      data[key] = ig;
      continue;
    }

    if (rule.type === 'date') {
      if (!value) {
        if (rule.allowEmpty) {
          data[key] = '';
          continue;
        }
        errors[key] = `${label} wajib diisi.`;
        continue;
      }
      if (!validTanggal(value)) {
        errors[key] = `${label} harus format YYYY-MM-DD.`;
        continue;
      }
      data[key] = value;
      continue;
    }

    // type === 'text'
    if (rule.required && !value) {
      errors[key] = `${label} wajib diisi.`;
      continue;
    }
    if (rule.max != null && value.length > rule.max) {
      errors[key] = `${label} maksimal ${rule.max} karakter.`;
      continue;
    }
    data[key] = value;
  }

  // Validasi silang: periode selesai tidak boleh lebih awal dari mulai
  const mulai = data.periode_mulai;
  const selesai = data.periode_selesai;
  if (mulai && selesai && selesai < mulai) {
    errors.periode_selesai = 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.';
  }

  return { valid: Object.keys(errors).length === 0, errors, data };
}
