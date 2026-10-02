/* Widya Nusantara Academy — landing page & logika pendaftaran */
(function () {
  'use strict';

  const { $, $$, fmtRp, waLink, applyBranding } = window.WNA;

  const MAX_UPLOAD = 3 * 1024 * 1024;
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

  // Fallback operasional tetap membuat kontak & rekening dapat dipakai ketika
  // API sedang cold-start/bermasalah. Nilai kuota tidak ditebak dari fallback.
  const FALLBACK_INFO = Object.freeze({
    biaya: 160000,
    durasi_program: 5,
    jumlah_tryout: 6,
    kuota_total: 100,
    periode_pendaftaran: '28 September – 25 Oktober 2026',
    komisi_referral: 10000,
    bank_nama: 'Bank Neo / Neo Bank',
    bank_rekening: '5859459250325726',
    bank_atasnama: 'Haposan Sinaga',
    kode_unik: '550',
    wa_kontak: '0895360396759',
    email_kontak: 'rubelautbk@gmail.com',
    instagram_kontak: 'rubelaindonesia',
  });

  const operationalInfo = (raw = {}) => ({
    ...FALLBACK_INFO,
    ...raw,
    bank_nama: raw.bank_nama || FALLBACK_INFO.bank_nama,
    bank_rekening: raw.bank_rekening || FALLBACK_INFO.bank_rekening,
    bank_atasnama: raw.bank_atasnama || FALLBACK_INFO.bank_atasnama,
    kode_unik: raw.kode_unik || FALLBACK_INFO.kode_unik,
    wa_kontak: raw.wa_kontak || FALLBACK_INFO.wa_kontak,
    email_kontak: raw.email_kontak || FALLBACK_INFO.email_kontak,
    instagram_kontak: raw.instagram_kontak || FALLBACK_INFO.instagram_kontak,
  });

  let info = null;
  let infoLoadFailed = false;

  /* ---------------- Tahun & navigasi ---------------- */
  $('#year').textContent = new Date().getFullYear();

  const navToggle = $('#navToggle');
  const navLinks = $('#navLinks');
  navToggle?.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
  $$('#navLinks a').forEach((a) =>
    a.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle?.setAttribute('aria-expanded', 'false');
    })
  );

  /* ---------------- Render informasi publik ---------------- */
  const setAll = (sel, value) => $$(sel).forEach((el) => (el.textContent = value));

  function renderQuota(d) {
    const raw = d?.kuota_tersisa;
    if (raw == null || raw === '' || !Number.isFinite(Number(raw))) {
      $('#statSisa').textContent = '–';
      $('#quotaText').textContent = 'Kuota sedang diperbarui';
      return;
    }
    const sisa = Math.max(0, Number(raw));
    $('#statSisa').textContent = sisa;
    $('#quotaText').textContent = sisa > 0 ? `${sisa} kursi tersisa` : 'Kuota penuh';
  }

  function renderInfo(raw) {
    const d = operationalInfo(raw);
    info = d;
    applyBranding(d);

    // Angka & teks dinamis (bisa diubah dari panel admin)
    setAll('.js-biaya', fmtRp(d.biaya));
    setAll('.js-durasi', d.durasi_program);
    setAll('.js-tryout', d.jumlah_tryout);
    setAll('.js-kuota', d.kuota_total);
    setAll('.js-periode', d.periode_pendaftaran || '–');
    setAll('.js-komisi', fmtRp(d.komisi_referral));

    renderQuota(d);

    // Pembayaran
    $('#bankName').textContent = d.bank_nama || '–';
    $('#accNo').textContent = d.bank_rekening || '–';
    $('#accName').textContent = d.bank_atasnama || '–';
    $('#kodeUnik').textContent = d.kode_unik || '–';
    // Contoh nominal = biaya dengan 3 digit terakhir diganti kode unik
    if (d.biaya && d.kode_unik) {
      const kode = String(d.kode_unik);
      const dasar = String(d.biaya);
      const contoh =
        dasar.length > kode.length ? dasar.slice(0, -kode.length) + kode : dasar + kode;
      $('#contohNominal').textContent = fmtRp(contoh);
    } else {
      $('#contohNominal').textContent = fmtRp(d.biaya || 0);
    }

    // QRIS
    if (d.qris_tersedia && d.qris_url) {
      $('#qrisImg').src = d.qris_url;
      $('#qrisPreview').style.display = 'block';
    } else {
      $('#qrisPreview').style.display = 'none';
    }

    // Kontak
    const wa = d.wa_kontak || '';
    $('#waLink').href = waLink(wa);
    $('#waText').textContent = wa || '–';
    $('#footWa').textContent = 'WhatsApp: ' + (wa || '–');
    $('#footWa').href = waLink(wa);

    const mail = d.email_kontak || '';
    $('#mailLink').href = 'mailto:' + mail;
    $('#mailText').textContent = mail || '–';
    $('#footMail').textContent = mail || '–';
    $('#footMail').href = 'mailto:' + mail;

    const ig = d.instagram_kontak || '';
    if (ig) {
      $('#igLink').href = 'https://instagram.com/' + encodeURIComponent(ig);
      $('#igText').textContent = '@' + ig;
      $('#footIg').textContent = '@' + ig;
      $('#footIg').href = 'https://instagram.com/' + encodeURIComponent(ig);
    } else {
      $('#igLink').closest('.contact-card').style.display = 'none';
      $('#footIg').style.display = 'none';
    }

    // Syarat referral dari pengaturan admin
    if (d.affiliate_syarat) {
      const list = $('#syaratList');
      list.innerHTML = '';
      d.affiliate_syarat
        .split(/(?<=\.)\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => {
          const li = document.createElement('li');
          li.textContent = s;
          list.appendChild(li);
        });
    }

    // Status pendaftaran
    const alertBox = $('#formAlert');
    const submitBtn = $('#submitBtn');
    if (!d.pendaftaran_dibuka) {
      alertBox.textContent =
        (d.alasan_tutup || 'Pendaftaran sedang ditutup.') +
        ' Hubungi kami lewat WhatsApp untuk informasi lebih lanjut.';
      alertBox.classList.add('show');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Pendaftaran Ditutup';
    } else if (submitBtn.disabled) {
      alertBox.classList.remove('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Kirim Pendaftaran';
    }
  }

  async function loadInfo() {
    try {
      const data = await window.WNA.fetchInfo();
      renderInfo(data);
    } catch (err) {
      // Kontak dan rekening statis tetap berfungsi; hanya pendaftaran dinonaktifkan
      // karena kuota tidak boleh ditebak ketika backend tidak dapat diverifikasi.
      infoLoadFailed = true;
      const fallback = operationalInfo();
      info = fallback;
      applyBranding({ logo_teks: 'W' });
      renderQuota({});
      const alertBox = $('#formAlert');
      alertBox.textContent =
        'Sistem pendaftaran sedang tidak dapat terhubung ke server. Kontak kami tetap dapat digunakan; silakan coba muat ulang beberapa saat lagi.';
      alertBox.classList.add('show');
      $('#submitBtn').disabled = true;
      $('#submitBtn').textContent = 'Server Sedang Diperbarui';
      console.error('[WNA] Gagal memuat /api/info:', err);
    }
  }

  /** Perbarui hanya angka kuota (dipanggil berkala & saat tab kembali aktif). */
  async function refreshQuota() {
    try {
      const data = await window.WNA.fetchInfo();
      const recovered = infoLoadFailed;
      infoLoadFailed = false;
      info = operationalInfo(data);
      // Setelah kegagalan awal, render penuh agar tombol/form dan semua nilai
      // pulih tanpa meminta pengguna melakukan hard reload.
      if (recovered || !data.pendaftaran_dibuka) renderInfo(data);
      else renderQuota(data);
    } catch {
      // Pertahankan state terakhir. Jika belum pernah berhasil, refresh berikutnya
      // tetap akan mencoba pemulihan penuh.
      if (!info) infoLoadFailed = true;
    }
  }

  loadInfo();
  setInterval(refreshQuota, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshQuota();
  });

  /* ---------------- Salin nomor rekening ---------------- */
  $('#copyAcc')?.addEventListener('click', async () => {
    const no = $('#accNo').textContent.trim();
    const btn = $('#copyAcc');
    const orig = btn.textContent;
    try {
      await navigator.clipboard.writeText(no);
      btn.textContent = '✓ Tersalin';
    } catch {
      btn.textContent = '✕ Gagal';
    }
    setTimeout(() => (btn.textContent = orig), 1600);
  });

  /* ---------------- Pesan error per field ---------------- */
  function setFieldError(name, msg) {
    const el = $(`.field-error[data-for="${name}"]`);
    if (el) {
      el.textContent = msg;
      el.classList.add('show');
    }
    $(`[name="${name}"]`)?.classList.add('invalid');
  }
  function clearFieldError(name) {
    $(`.field-error[data-for="${name}"]`)?.classList.remove('show');
    $(`[name="${name}"]`)?.classList.remove('invalid');
  }
  function clearAllErrors() {
    $$('.field-error').forEach((e) => e.classList.remove('show'));
    $$('.input, .select').forEach((e) => e.classList.remove('invalid'));
    if (info?.pendaftaran_dibuka !== false) $('#formAlert').classList.remove('show');
  }

  /* ---------------- Kode referral ---------------- */
  const refInput = $('#f-referral');
  const refHint = $('#refHint');
  const HINT_DEFAULT = 'Isi jika kamu diajak oleh affiliator. Kode akan diperiksa otomatis.';

  // Prefill dari tautan referral: /?ref=KODE
  const paramRef = new URLSearchParams(location.search).get('ref');
  if (paramRef) {
    refInput.value = paramRef.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  let refTimer = null;
  async function checkReferral() {
    const kode = refInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    refInput.value = kode;
    clearFieldError('referral');

    if (!kode) {
      refHint.textContent = HINT_DEFAULT;
      refHint.style.color = '';
      return;
    }
    if (kode.length < 4) {
      refHint.textContent = 'Kode referral minimal 4 karakter.';
      refHint.style.color = 'var(--warn)';
      return;
    }

    refHint.textContent = 'Memeriksa kode…';
    refHint.style.color = '';
    try {
      const res = await fetch('/api/referral/check?kode=' + encodeURIComponent(kode));
      const data = await res.json();
      if (data.valid) {
        refHint.textContent = `✓ Kode valid — kamu diajak oleh ${data.nama}.`;
        refHint.style.color = 'var(--success)';
      } else {
        refHint.textContent = '✕ ' + (data.error || 'Kode referral tidak valid.');
        refHint.style.color = 'var(--danger)';
      }
    } catch {
      refHint.textContent = 'Tidak bisa memeriksa kode sekarang. Kode akan diperiksa saat dikirim.';
      refHint.style.color = 'var(--warn)';
    }
  }
  refInput.addEventListener('input', () => {
    clearTimeout(refTimer);
    refTimer = setTimeout(checkReferral, 450);
  });
  if (paramRef) checkReferral();

  /* ---------------- Unggah bukti ---------------- */
  const uploadArea = $('#uploadArea');
  const buktiInput = $('#buktiInput');
  const filePreview = $('#filePreview');
  const previewImg = $('#previewImg');
  const fileName = $('#fileName');

  function showFile(file) {
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      setFieldError('bukti', 'Hanya file JPG, PNG, atau WebP.');
      resetFile();
      return;
    }
    if (file.size > MAX_UPLOAD) {
      setFieldError(
        'bukti',
        `Ukuran file maksimal 3 MB (file kamu ${(file.size / 1048576).toFixed(1)} MB). Kompres dulu, ya.`
      );
      resetFile();
      return;
    }
    clearFieldError('bukti');
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      fileName.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
      filePreview.classList.add('show');
      uploadArea.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  function resetFile() {
    buktiInput.value = '';
    filePreview.classList.remove('show');
    uploadArea.style.display = 'block';
    previewImg.removeAttribute('src');
  }

  uploadArea?.addEventListener('click', () => buktiInput.click());
  buktiInput?.addEventListener('change', () => showFile(buktiInput.files[0]));
  $('#fileRemove')?.addEventListener('click', resetFile);

  ['dragover', 'dragenter'].forEach((ev) =>
    uploadArea?.addEventListener(ev, (e) => {
      e.preventDefault();
      uploadArea.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    uploadArea?.addEventListener(ev, (e) => {
      e.preventDefault();
      uploadArea.classList.remove('drag');
    })
  );
  uploadArea?.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) {
      buktiInput.files = e.dataTransfer.files;
      showFile(file);
    }
  });

  /* ---------------- Validasi klien ---------------- */
  function validateClient(form) {
    const errors = {};
    const g = (n) => (form.elements[n]?.value || '').trim();

    if (!g('nama_lengkap')) errors.nama_lengkap = 'Nama lengkap wajib diisi.';
    else if (g('nama_lengkap').length < 3) errors.nama_lengkap = 'Nama lengkap minimal 3 karakter.';

    if (!g('asal_sekolah')) errors.asal_sekolah = 'Asal sekolah wajib diisi.';
    if (!g('tanggal_lahir')) errors.tanggal_lahir = 'Tanggal lahir wajib diisi.';
    if (!g('status_pendidikan')) errors.status_pendidikan = 'Status pendidikan wajib dipilih.';

    let wa = g('nomor_wa').replace(/[\s\-().]/g, '');
    if (wa.startsWith('+62')) wa = '0' + wa.slice(3);
    else if (wa.startsWith('62') && wa.length > 10) wa = '0' + wa.slice(2);
    if (!wa) errors.nomor_wa = 'Nomor WhatsApp wajib diisi.';
    else if (!/^0\d{8,14}$/.test(wa))
      errors.nomor_wa = 'Nomor WhatsApp harus 9–15 digit dan diawali 0 (contoh: 0895xxxxxxx).';

    const email = g('gmail');
    if (!email) errors.gmail = 'Gmail aktif wajib diisi.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.gmail = 'Format email tidak valid.';

    const ref = g('referral');
    if (ref && !/^[A-Z0-9]{4,20}$/.test(ref))
      errors.referral = 'Kode referral terdiri dari 4–20 huruf/angka.';

    if (!buktiInput.files[0]) errors.bukti = 'Bukti pembayaran wajib diunggah.';

    return errors;
  }

  /* ---------------- Kirim pendaftaran ---------------- */
  const form = $('#regForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors();

    const errors = validateClient(form);
    if (Object.keys(errors).length) {
      for (const [k, v] of Object.entries(errors)) setFieldError(k, v);
      const alertBox = $('#formAlert');
      alertBox.textContent = 'Mohon lengkapi data yang ditandai.';
      alertBox.classList.add('show');
      $('.field-error.show')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const btn = $('#submitBtn');
    btn.disabled = true;
    const origText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Mengirim…';

    try {
      const res = await fetch('/api/registrations', { method: 'POST', body: new FormData(form) });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // Respons bukan JSON (mis. body ditolak platform karena terlalu besar)
        throw new Error(
          res.status === 413
            ? 'Ukuran bukti pembayaran terlalu besar. Kompres gambarnya lalu coba lagi.'
            : 'Server memberi respons yang tidak terduga. Coba lagi beberapa saat.'
        );
      }

      if (!res.ok) {
        if (data.fields) for (const [k, v] of Object.entries(data.fields)) setFieldError(k, v);
        const alertBox = $('#formAlert');
        alertBox.textContent = data.error || 'Terjadi kesalahan. Coba lagi.';
        alertBox.classList.add('show');
        alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        refreshQuota();
        return;
      }

      // Sukses
      form.style.display = 'none';
      if (data.message) $('#successMsg').textContent = data.message;
      $('#successScreen').classList.add('show');
      $('#successScreen').scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Kuota langsung diperbarui dari respons server
      if (typeof data.kuota_tersisa === 'number') {
        renderQuota({ kuota_tersisa: data.kuota_tersisa });
      }
      refreshQuota();
    } catch (err) {
      const alertBox = $('#formAlert');
      alertBox.textContent = err.message || 'Gagal terhubung ke server. Periksa koneksi kamu.';
      alertBox.classList.add('show');
      alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  });

  $('#daftarLagi')?.addEventListener('click', () => location.reload());

  /* ---------------- Bersihkan error saat mengetik ---------------- */
  $$('#regForm [name]').forEach((el) => {
    el.addEventListener('input', () => clearFieldError(el.name));
    el.addEventListener('change', () => clearFieldError(el.name));
  });
})();
