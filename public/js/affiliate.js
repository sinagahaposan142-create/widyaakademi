/* Widya Nusantara Academy — Dashboard Affiliator */
(function () {
  'use strict';

  const {
    $,
    $$,
    esc,
    fmtRp,
    fmtNum,
    fmtTanggal,
    waLink,
    applyBranding,
    readJsonResponse,
  } = window.WNA;

  const STATUS_LABEL = {
    MENUNGGU_VERIFIKASI: 'Menunggu',
    TERVERIFIKASI: 'Terverifikasi',
    DITOLAK: 'Ditolak',
  };
  const STATUS_CLASS = {
    MENUNGGU_VERIFIKASI: 'wait',
    TERVERIFIKASI: 'ok',
    DITOLAK: 'no',
  };

  let info = null;
  let affiliator = null;

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, kind = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = 'toast' + (kind ? ' ' + kind : '');
    }, 3600);
  }

  /* ---------------- Token & API ---------------- */
  const TOKEN_KEY = 'wna_aff_token';
  const getToken = () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  };
  const setToken = (t) => {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* diblokir -> andalkan cookie httpOnly */
    }
  };

  class ApiError extends Error {
    constructor(status, body) {
      super(body?.error || 'Layanan tidak memberikan detail kesalahan. Silakan muat ulang.');
      this.status = status;
      this.fields = body?.fields || null;
      this.body = body || {};
    }
  }

  async function api(url, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }

    let res;
    try {
      res = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
    } catch {
      throw new ApiError(0, { error: 'Gagal terhubung ke server. Periksa koneksi internet.' });
    }

    if (opts.raw && res.ok) return res;
    const body = await readJsonResponse(res, `API ${url}`);

    if (res.status === 401 || res.status === 403) {
      if (!opts.keepSession) {
        setToken('');
        affiliator = null;
        showAuth('login');
        if (!opts.silentAuth) toast(body.error || 'Sesi berakhir. Silakan masuk kembali.', 'err');
      }
      throw new ApiError(res.status, body);
    }

    if (!res.ok || body.code === 'INVALID_API_RESPONSE') {
      throw new ApiError(res.status, body);
    }
    return body;
  }

  /* ---------------- Util form ---------------- */
  function busy(btn, on, label = 'Memproses…') {
    if (!btn) return;
    if (on) {
      btn.dataset.orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> ${label}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
    }
  }
  function clearErrors(scope) {
    $$('.field-error', scope).forEach((e) => e.classList.remove('show'));
    $$('.input, .select', scope).forEach((e) => e.classList.remove('invalid'));
    const a = $('[data-alert]', scope);
    if (a) a.className = 'alert';
  }
  function showFieldErrors(scope, fields) {
    if (!fields) return;
    for (const [name, msg] of Object.entries(fields)) {
      const err = $(`.field-error[data-for="${name}"]`, scope);
      if (err) {
        err.textContent = msg;
        err.classList.add('show');
      }
      const input = scope.querySelector(`[name="${name}"]`);
      if (input) input.classList.add('invalid');
    }
  }
  function showAlert(scope, msg, kind = 'error') {
    const el = $('[data-alert]', scope);
    if (!el) return toast(msg, kind === 'error' ? 'err' : 'ok');
    el.textContent = msg;
    el.className = `alert ${kind} show`;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (kind === 'success') setTimeout(() => (el.className = 'alert'), 5000);
    return undefined;
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pw-toggle]');
    if (!btn) return;
    const input = document.getElementById(btn.getAttribute('data-pw-toggle'));
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁' : '🙈';
  });

  async function copyText(text, okMsg = 'Tersalin!') {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg, 'ok');
    } catch {
      toast('Tidak bisa menyalin otomatis. Salin manual, ya.', 'err');
    }
  }

  /* ---------------- Tampilan ---------------- */
  function showAuth(tab = 'login') {
    $('#authView').hidden = false;
    $('#dashView').hidden = true;
    $('#successView').hidden = true;
    $('#logoutBtn').hidden = true;
    switchAuthTab(tab);
  }
  function showDash() {
    $('#authView').hidden = true;
    $('#successView').hidden = true;
    $('#dashView').hidden = false;
    $('#logoutBtn').hidden = false;
  }
  function switchAuthTab(tab) {
    $$('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.auth === tab));
    $('#loginForm').classList.toggle('active', tab === 'login');
    $('#registerForm').classList.toggle('active', tab === 'register');
  }
  $$('.auth-tab').forEach((b) => b.addEventListener('click', () => switchAuthTab(b.dataset.auth)));
  $$('[data-goto]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab(a.dataset.goto);
    })
  );

  /* ================================================================
   *  LOGIN
   * ================================================================ */
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    clearErrors(form);
    const btn = form.querySelector('button[type="submit"]');
    const identifier = form.elements.identifier.value.trim();
    const password = form.elements.password.value;

    if (!identifier || !password) {
      showFieldErrors(form, {
        ...(identifier ? {} : { identifier: 'Wajib diisi.' }),
        ...(password ? {} : { password: 'Wajib diisi.' }),
      });
      return;
    }

    busy(btn, true, 'Masuk…');
    try {
      const data = await api('/api/affiliate/login', {
        method: 'POST',
        json: { identifier, password },
        keepSession: true,
      });
      if (data.token) setToken(data.token);
      form.reset();
      await enterDashboard();
      toast('Selamat datang kembali!', 'ok');
    } catch (err) {
      showAlert(form, err.message, 'error');
    } finally {
      busy(btn, false);
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try {
      await api('/api/affiliate/logout', { method: 'POST', keepSession: true });
    } catch {
      /* tetap keluar di klien */
    }
    setToken('');
    affiliator = null;
    showAuth('login');
    toast('Kamu telah keluar.');
  });

  /* ================================================================
   *  PENDAFTARAN
   * ================================================================ */
  $('#registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    clearErrors(form);
    const btn = form.querySelector('button[type="submit"]');

    const payload = {};
    for (const el of form.elements) {
      if (el.name && el.type !== 'checkbox') payload[el.name] = el.value;
    }

    if (!form.elements.setuju.checked) {
      showFieldErrors(form, { setuju: 'Kamu harus menyetujui syarat & ketentuan.' });
      return;
    }
    if (payload.password !== payload.password_confirm) {
      showFieldErrors(form, { password_confirm: 'Konfirmasi password tidak sama.' });
      return;
    }

    busy(btn, true, 'Mendaftar…');
    try {
      const data = await api('/api/affiliate/register', {
        method: 'POST',
        json: payload,
        keepSession: true,
      });
      if (data.token) setToken(data.token);

      form.reset();
      $('#authView').hidden = true;
      $('#successView').hidden = false;
      $('#successTitle').textContent =
        data.status === 'AKTIF' ? 'Akun Affiliator Aktif!' : 'Pendaftaran Terkirim!';
      $('#successMsg').textContent = data.message;
      $('#successKode').hidden = false;
      $('#successKodeVal').textContent = data.kode_referral;
      $('#successLogin').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Bila auto-approve aktif, langsung masuk dashboard
      $('#successLogin').onclick = async () => {
        if (data.status === 'AKTIF') {
          try {
            await enterDashboard();
            return;
          } catch {
            /* jatuh ke layar masuk */
          }
        }
        showAuth('login');
      };
    } catch (err) {
      showFieldErrors(form, err.fields);
      showAlert(form, err.message, 'error');
    } finally {
      busy(btn, false);
    }
  });

  /* ================================================================
   *  DASHBOARD
   * ================================================================ */
  async function enterDashboard() {
    const data = await api('/api/affiliate/me', { keepSession: true });
    affiliator = data.affiliator;
    showDash();
    fillProfile();
    await Promise.all([loadStats(), loadReferrals(1)]);
  }

  function fillProfile() {
    const a = affiliator;
    $('#affNama').textContent = String(a.nama_lengkap).split(' ')[0];
    $('#affKode').textContent = a.kode_referral;

    const link = `${location.origin}/?ref=${encodeURIComponent(a.kode_referral)}`;
    $('#affLink').value = link;
    const pesan =
      `Hai! Aku ikut ${info?.nama_situs || 'Widya Nusantara Academy'} — bimbel intensif UTBK/SNBT.\n\n` +
      `Daftar pakai kode referral aku: ${a.kode_referral}\n${link}`;
    $('#shareWa').href = 'https://wa.me/?text=' + encodeURIComponent(pesan);

    $('#pfEmail').value = a.email;
    const form = $('#profileForm');
    for (const key of [
      'nama_lengkap',
      'nomor_wa',
      'instagram',
      'asal_institusi',
      'bank_nama',
      'bank_rekening',
      'bank_atasnama',
    ]) {
      if (form.elements[key]) form.elements[key].value = a[key] || '';
    }
    $('#dashSyarat').textContent = info?.affiliate_syarat || '–';
  }

  function renderChart(tren) {
    const el = $('#affChart');
    if (!tren.length) {
      el.innerHTML = '<p class="cell-sub">Belum ada data referral.</p>';
      return;
    }
    const max = Math.max(1, ...tren.map((t) => t.jumlah));
    el.innerHTML = tren
      .map((t) => {
        const d = new Date(t.tanggal + 'T00:00:00');
        const cap = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
        return `<div class="col" title="${esc(cap)}: ${t.jumlah}">
          <div class="num">${t.jumlah || ''}</div>
          <div class="bar-v" data-zero="${t.jumlah ? 0 : 1}" style="height:${Math.max(Math.round((t.jumlah / max) * 100), 2)}%"></div>
          <div class="cap">${esc(cap.replace(' ', '\u00a0'))}</div>
        </div>`;
      })
      .join('');
  }

  async function loadStats() {
    const s = await api('/api/affiliate/stats');

    $('#sTotal').textContent = fmtNum(s.total_referral);
    $('#sBulan').textContent = fmtNum(s.bulan_ini);
    $('#sOk').textContent = fmtNum(s.by_status.TERVERIFIKASI);
    $('#sWait').textContent = fmtNum(s.by_status.MENUNGGU_VERIFIKASI);
    $('#sSisa').textContent = fmtRp(s.komisi_belum_dibayar);
    $('#sTotalKomisi').textContent = fmtRp(s.komisi_diperoleh);

    $('#kPer').textContent = fmtRp(s.komisi_per_referral);
    $('#kDiperoleh').textContent = fmtRp(s.komisi_diperoleh);
    $('#kDibayar').textContent = fmtRp(s.komisi_dibayar);
    $('#kSisa').textContent = fmtRp(s.komisi_belum_dibayar);

    $('#payoutList').innerHTML = s.payouts.length
      ? `<div class="kv-list">${s.payouts
          .map(
            (p) =>
              `<div class="row"><span>${esc(fmtTanggal(p.created_at, false))}${p.catatan ? ' · ' + esc(p.catatan) : ''}</span><span>${fmtRp(p.jumlah)}</span></div>`
          )
          .join('')}</div>`
      : '<p class="cell-sub">Belum ada pembayaran komisi.</p>';

    renderChart(s.tren || []);
  }

  const rState = { page: 1 };

  function renderPagination(target, page, totalPages, total, onGo) {
    if (!total) {
      target.innerHTML = '';
      return;
    }
    target.innerHTML =
      `<button data-go="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button>` +
      `<span class="info">Halaman ${page} dari ${totalPages} · ${fmtNum(total)} data</span>` +
      `<button data-go="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Berikutnya ›</button>`;
    $$('button[data-go]', target).forEach((b) =>
      b.addEventListener('click', () => onGo(Number(b.dataset.go)))
    );
  }

  async function loadReferrals(page = 1) {
    rState.page = page;
    const tbody = $('#rTableBody');
    tbody.innerHTML =
      '<tr><td colspan="7"><div class="loading-center"><span class="spinner dark"></span> Memuat…</div></td></tr>';

    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    const cari = $('#rSearch').value.trim();
    const status = $('#rStatus').value;
    if (cari) params.set('q', cari);
    if (status) params.set('status', status);

    const data = await api('/api/affiliate/referrals?' + params.toString());

    if (!data.data.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
          <div class="ic">🌱</div><b>Belum ada yang memakai kode referralmu</b><br>
          <span class="cell-sub">Bagikan kode <b>${esc(affiliator?.kode_referral || '')}</b> ke teman-temanmu untuk mulai mengumpulkan komisi.</span>
        </div></td></tr>`;
      renderPagination($('#rPagination'), 1, 1, 0, () => {});
      return;
    }

    const offset = (data.page - 1) * data.pageSize;
    tbody.innerHTML = data.data
      .map(
        (r, i) => `<tr>
        <td class="cell-sub">${offset + i + 1}</td>
        <td class="cell-main">${esc(r.nama_lengkap)}</td>
        <td class="cell-sub">${esc(r.asal_sekolah)}</td>
        <td class="cell-sub">${esc(r.status_pendidikan)}</td>
        <td class="cell-sub">${esc(r.nomor_wa)}<br>${esc(r.gmail)}</td>
        <td><span class="badge ${STATUS_CLASS[r.status] || 'mute'}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
        <td class="cell-sub nowrap">${esc(fmtTanggal(r.created_at, false))}</td>
      </tr>`
      )
      .join('');

    renderPagination($('#rPagination'), data.page, data.totalPages, data.total, (p) =>
      loadReferrals(p).catch((err) => err.status >= 500 && toast(err.message, 'err'))
    );
  }

  let rTimer = null;
  $('#rSearch').addEventListener('input', () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(() => loadReferrals(1).catch(() => {}), 350);
  });
  $('#rStatus').addEventListener('change', () => loadReferrals(1).catch(() => {}));

  $('#dashRefresh').addEventListener('click', async () => {
    try {
      await Promise.all([loadStats(), loadReferrals(rState.page)]);
      toast('Data diperbarui.', 'ok');
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) toast(err.message, 'err');
    }
  });

  $('#copyKode').addEventListener('click', () =>
    copyText(affiliator.kode_referral, 'Kode referral disalin!')
  );
  $('#copyLink').addEventListener('click', () =>
    copyText($('#affLink').value, 'Tautan referral disalin!')
  );

  $('#affExport').addEventListener('click', async () => {
    try {
      const res = await api('/api/affiliate/export', { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `referral-${affiliator.kode_referral}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('File CSV diunduh.', 'ok');
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) toast(err.message, 'err');
    }
  });

  /* ---------------- Profil & password ---------------- */
  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    clearErrors(form);
    const btn = form.querySelector('button[type="submit"]');
    const payload = {};
    for (const el of form.elements) if (el.name) payload[el.name] = el.value;

    busy(btn, true, 'Menyimpan…');
    try {
      const data = await api('/api/affiliate/profile', { method: 'PATCH', json: payload });
      affiliator = data.affiliator;
      fillProfile();
      showAlert(form, 'Profil berhasil disimpan.', 'success');
      toast('Profil disimpan.', 'ok');
    } catch (err) {
      showFieldErrors(form, err.fields);
      showAlert(form, err.message, 'error');
    } finally {
      busy(btn, false);
    }
  });

  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    clearErrors(form);
    const btn = form.querySelector('button[type="submit"]');
    const baru = form.elements.password_baru.value;
    if (baru !== form.elements.password_baru2.value) {
      showFieldErrors(form, { password_baru2: 'Konfirmasi password tidak sama.' });
      return;
    }
    busy(btn, true, 'Menyimpan…');
    try {
      const data = await api('/api/affiliate/change-password', {
        method: 'POST',
        json: {
          password_lama: form.elements.password_lama.value,
          password_baru: baru,
        },
      });
      form.reset();
      showAlert(form, data.message, 'success');
      toast('Password diubah.', 'ok');
    } catch (err) {
      showFieldErrors(form, err.fields);
      showAlert(form, err.message, 'error');
    } finally {
      busy(btn, false);
    }
  });

  /* ================================================================
   *  BOOT
   * ================================================================ */
  (async function boot() {
    $('#year').textContent = new Date().getFullYear();

    try {
      info = await window.WNA.fetchInfo();
      applyBranding(info);

      $('#heroKomisi').textContent = fmtRp(info.komisi_referral);
      $('#syaratText').textContent = info.affiliate_syarat || '–';

      const wa = $('#footWa');
      wa.textContent = info.wa_kontak || '–';
      wa.href = waLink(info.wa_kontak);
      const mail = $('#footMail');
      mail.textContent = info.email_kontak || '–';
      mail.href = 'mailto:' + (info.email_kontak || '');

      if (!info.affiliate_aktif) {
        $('#affClosedNotice').hidden = false;
        const btn = $('#registerForm').querySelector('button[type="submit"]');
        btn.disabled = true;
      }
    } catch {
      applyBranding({ logo_teks: 'W' });
    }

    // Coba pulihkan sesi; kalau gagal tampilkan layar masuk
    try {
      await api('/api/affiliate/me', { silentAuth: true, keepSession: true });
      await enterDashboard();
    } catch {
      showAuth(location.hash === '#daftar' ? 'register' : 'login');
    }
  })();
})();
