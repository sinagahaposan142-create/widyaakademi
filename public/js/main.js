/* Widya Nusantara Academy — landing page & registration logic */
(function () {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  // ---- Year ----
  $('#year').textContent = new Date().getFullYear();

  // ---- Mobile nav toggle ----
  const navToggle = $('#navToggle');
  const navLinks = $('#navLinks');
  navToggle?.addEventListener('click', () => navLinks.classList.toggle('open'));
  $$('#navLinks a').forEach((a) =>
    a.addEventListener('click', () => navLinks.classList.remove('open'))
  );

  // ---- Load public info ----
  const formatRp = (n) => 'Rp' + Number(n).toLocaleString('id-ID');

  fetch('/api/info')
    .then((r) => r.json())
    .then((info) => {
      // Quota
      const sisa = info.kuota_tersisa;
      $('#statSisa').textContent = sisa;
      $('#quotaText').textContent =
        sisa > 0 ? `${sisa} kursi tersisa` : 'Kuota penuh';

      // Bank / payment
      if (info.bank_nama) $('#bankName').textContent = info.bank_nama;
      if (info.bank_rekening) $('#accNo').textContent = info.bank_rekening;
      if (info.bank_atasnama) $('#accName').textContent = info.bank_atasnama;
      if (info.kode_unik) {
        $('#kodeUnik').textContent = info.kode_unik;
        $('#kodeUnik2').textContent = info.kode_unik;
      }

      // Contact
      const wa = (info.wa_kontak || '').replace(/\D/g, '');
      const waIntl = wa.startsWith('0') ? '62' + wa.slice(1) : wa;
      $('#waLink').href = `https://wa.me/${waIntl}`;
      $('#waText').textContent = info.wa_kontak || '';
      $('#footWa').textContent = 'WhatsApp: ' + (info.wa_kontak || '');
      $('#footWa').href = `https://wa.me/${waIntl}`;
      $('#mailLink').href = `mailto:${info.email_kontak || ''}`;
      $('#mailText').textContent = info.email_kontak || '';
      $('#footMail').textContent = info.email_kontak || '';
      $('#footMail').href = `mailto:${info.email_kontak || ''}`;

      // QRIS image
      if (info.qris_tersedia) {
        $('#qrisImg').src = '/api/qris?t=' + Date.now();
        $('#qrisPreview').style.display = 'block';
      }

      // Disable form if quota full
      if (sisa <= 0) {
        const alert = $('#formAlert');
        alert.textContent =
          'Mohon maaf, kuota pendaftaran sudah penuh. Silakan hubungi kami untuk info lebih lanjut.';
        alert.classList.add('show');
        $('#submitBtn').disabled = true;
      }
    })
    .catch(() => {});

  // ---- Copy account number ----
  $('#copyAcc')?.addEventListener('click', () => {
    const no = $('#accNo').textContent.trim();
    navigator.clipboard?.writeText(no).then(() => {
      const btn = $('#copyAcc');
      const orig = btn.textContent;
      btn.textContent = '✓ Tersalin';
      setTimeout(() => (btn.textContent = orig), 1500);
    });
  });

  // ---- File upload preview ----
  const uploadArea = $('#uploadArea');
  const buktiInput = $('#buktiInput');
  const filePreview = $('#filePreview');
  const previewImg = $('#previewImg');
  const fileName = $('#fileName');

  const MAX = 5 * 1024 * 1024;
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

  function showFile(file) {
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      setFieldError('bukti', 'Hanya file JPG, PNG, atau WebP.');
      resetFile();
      return;
    }
    if (file.size > MAX) {
      setFieldError('bukti', 'Ukuran file maksimal 5 MB.');
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
    previewImg.src = '';
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

  // ---- Field error helpers ----
  function setFieldError(name, msg) {
    const el = $(`.field-error[data-for="${name}"]`);
    if (el) {
      el.textContent = msg;
      el.classList.add('show');
    }
    const input = $(`[name="${name}"]`);
    input?.classList.add('invalid');
  }
  function clearFieldError(name) {
    const el = $(`.field-error[data-for="${name}"]`);
    if (el) el.classList.remove('show');
    const input = $(`[name="${name}"]`);
    input?.classList.remove('invalid');
  }
  function clearAllErrors() {
    $$('.field-error').forEach((e) => e.classList.remove('show'));
    $$('.input, .select').forEach((e) => e.classList.remove('invalid'));
    $('#formAlert').classList.remove('show');
  }

  // ---- Client-side validation ----
  function validateClient(form) {
    const errors = {};
    const g = (n) => form.elements[n]?.value.trim() || '';

    if (!g('nama_lengkap')) errors.nama_lengkap = 'Nama lengkap wajib diisi.';
    if (!g('asal_sekolah')) errors.asal_sekolah = 'Asal sekolah wajib diisi.';
    if (!g('tanggal_lahir')) errors.tanggal_lahir = 'Tanggal lahir wajib diisi.';
    if (!g('status_pendidikan'))
      errors.status_pendidikan = 'Status pendidikan wajib dipilih.';

    const wa = g('nomor_wa').replace(/[\s-]/g, '');
    if (!wa) errors.nomor_wa = 'Nomor WhatsApp wajib diisi.';
    else if (!/^\+?\d{8,15}$/.test(wa))
      errors.nomor_wa = 'Nomor WhatsApp harus 8-15 digit angka.';

    const email = g('gmail');
    if (!email) errors.gmail = 'Gmail aktif wajib diisi.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.gmail = 'Format email tidak valid.';

    if (!buktiInput.files[0])
      errors.bukti = 'Bukti pembayaran wajib diunggah.';

    return errors;
  }

  // ---- Submit ----
  const form = $('#regForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors();

    const errors = validateClient(form);
    if (Object.keys(errors).length) {
      for (const [k, v] of Object.entries(errors)) setFieldError(k, v);
      const alert = $('#formAlert');
      alert.textContent = 'Mohon lengkapi data yang ditandai.';
      alert.classList.add('show');
      $(`.field-error.show`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const btn = $('#submitBtn');
    btn.disabled = true;
    const origText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Mengirim...';

    try {
      const fd = new FormData(form);
      const res = await fetch('/api/registrations', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.fields) {
          for (const [k, v] of Object.entries(data.fields)) setFieldError(k, v);
        }
        const alert = $('#formAlert');
        alert.textContent = data.error || 'Terjadi kesalahan. Coba lagi.';
        alert.classList.add('show');
        alert.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      // Success
      $('#regForm').style.display = 'none';
      if (data.message) $('#successMsg').textContent = data.message;
      $('#successScreen').classList.add('show');
      $('#successScreen').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      const alert = $('#formAlert');
      alert.textContent = 'Gagal terhubung ke server. Periksa koneksi kamu.';
      alert.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  });

  // ---- Live clear errors on input ----
  $$('#regForm [name]').forEach((el) => {
    el.addEventListener('input', () => clearFieldError(el.name));
    el.addEventListener('change', () => clearFieldError(el.name));
  });
})();
