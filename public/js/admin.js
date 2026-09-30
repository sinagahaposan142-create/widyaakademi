/* Widya Nusantara Academy — Panel Admin */
(function () {
  'use strict';

  const { $, $$, esc, fmtRp, fmtNum, fmtTanggal, waLink, applyBranding } = window.WNA;

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
  const AFF_LABEL = {
    PENDING: 'Menunggu',
    AKTIF: 'Aktif',
    NONAKTIF: 'Nonaktif',
    DITOLAK: 'Ditolak',
  };
  const AFF_CLASS = { PENDING: 'wait', AKTIF: 'ok', NONAKTIF: 'mute', DITOLAK: 'no' };

  const PAGE_TITLE = {
    dashboard: 'Dashboard',
    pendaftar: 'Data Pendaftar',
    affiliator: 'Affiliator & Kode Referral',
    pembayaran: 'Pembayaran & QRIS',
    branding: 'Logo & Branding',
    pengaturan: 'Pengaturan',
    admins: 'Akun Admin',
    log: 'Log Aktivitas',
    sistem: 'Kesehatan Sistem',
  };

  let me = null;
  let siteInfo = null;
  const objectUrls = [];

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

  /* ---------------- Token ---------------- */
  const TOKEN_KEY = 'wna_admin_token';
  function getToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }
  function setToken(t) {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* penyimpanan diblokir -> andalkan cookie httpOnly */
    }
  }

  /* ---------------- API ---------------- */
  class ApiError extends Error {
    constructor(status, body) {
      super(body?.error || 'Terjadi kesalahan.');
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

    /*
     * 401 pada endpoint biasa berarti sesi habis -> paksa kembali ke layar masuk.
     * Untuk endpoint login sendiri, 401 berarti "kredensial salah", jadi pemanggil
     * memakai opts.noAuthRedirect agar pesan asli dari server tetap tersampaikan.
     */
    if (res.status === 401 && !opts.noAuthRedirect) {
      setToken('');
      showLogin();
      // silentAuth dipakai saat pemeriksaan sesi awal (belum login itu normal)
      if (!opts.silentAuth) toast('Sesi berakhir. Silakan masuk kembali.', 'err');
      throw new ApiError(401, { error: 'Sesi berakhir. Silakan masuk kembali.' });
    }

    const ct = res.headers.get('content-type') || '';
    if (opts.raw) {
      if (!res.ok) throw new ApiError(res.status, ct.includes('json') ? await res.json() : {});
      return res;
    }
    const body = ct.includes('json') ? await res.json().catch(() => ({})) : {};
    if (!res.ok) throw new ApiError(res.status, body);
    return body;
  }

  /* ---------------- Modal ---------------- */
  function openModal({ title, body, footer = '', narrow = false }) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML = footer;
    $('#modalFoot').style.display = footer ? '' : 'none';
    $('#modalBox').classList.toggle('narrow', !!narrow);
    $('#modal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    $('#modal').classList.remove('show');
    document.body.style.overflow = '';
    while (objectUrls.length) URL.revokeObjectURL(objectUrls.pop());
  }
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modal').classList.contains('show')) closeModal();
  });

  /** Dialog konfirmasi berbasis Promise. */
  function confirmDialog({ title, message, confirmText = 'Ya, lanjutkan', danger = true }) {
    return new Promise((resolve) => {
      openModal({
        title,
        narrow: true,
        body: `<p style="font-size:.93rem">${message}</p>`,
        footer:
          `<button class="btn btn-outline" data-cancel>Batal</button>` +
          `<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>`,
      });
      const done = (v) => {
        closeModal();
        resolve(v);
      };
      $('#modalFoot [data-ok]').addEventListener('click', () => done(true));
      $('#modalFoot [data-cancel]').addEventListener('click', () => done(false));
    });
  }

  /* ---------------- Util form ---------------- */
  function busy(btn, on, labelWhenBusy = 'Menyimpan…') {
    if (!btn) return;
    if (on) {
      btn.dataset.orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> ${labelWhenBusy}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
    }
  }

  function clearErrors(scope) {
    $$('.field-error', scope).forEach((e) => e.classList.remove('show'));
    $$('.input, .select', scope).forEach((e) => e.classList.remove('invalid'));
    const alertEl = $('[data-alert]', scope);
    if (alertEl) alertEl.className = 'alert';
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
    if (!el) {
      toast(msg, kind === 'error' ? 'err' : 'ok');
      return;
    }
    el.textContent = msg;
    el.className = `alert ${kind} show`;
    if (kind === 'success') setTimeout(() => (el.className = 'alert'), 4000);
  }

  // Tombol lihat/sembunyikan password (delegasi, berlaku juga di dalam modal)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pw-toggle]');
    if (!btn) return;
    const input = document.getElementById(btn.getAttribute('data-pw-toggle'));
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁' : '🙈';
  });

  /* ================================================================
   *  SESI
   * ================================================================ */
  function showLogin() {
    $('#app').hidden = true;
    $('#loginView').hidden = false;
    me = null;
  }

  async function showApp(admin) {
    me = admin;
    $('#loginView').hidden = true;
    $('#app').hidden = false;
    $('#whoName').textContent = admin.nama || admin.username;
    $('#whoRole').textContent = admin.role === 'SUPERADMIN' ? 'Super Admin' : 'Admin';
    $('#navAdmins').hidden = admin.role !== 'SUPERADMIN';
    $('#lClear').hidden = admin.role !== 'SUPERADMIN';

    try {
      siteInfo = await window.WNA.fetchInfo();
      applyBranding(siteInfo);
      fillPendidikanFilter();
    } catch {
      siteInfo = null;
    }

    loadedOnce.add('dashboard');
    try {
      await loadDashboard();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'err');
    }
  }

  /** Isi opsi filter status pendidikan dari data publik (sekali saja). */
  function fillPendidikanFilter() {
    const sel = $('#pPendidikan');
    if (sel.options.length > 1 || !siteInfo?.status_pendidikan_opsi) return;
    for (const opt of siteInfo.status_pendidikan_opsi) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      sel.appendChild(o);
    }
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const alertEl = $('#loginAlert');
    alertEl.className = 'alert error';

    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    if (!username || !password) {
      alertEl.textContent = 'Username dan password wajib diisi.';
      alertEl.classList.add('show');
      return;
    }

    const btn = $('#loginBtn');
    busy(btn, true, 'Masuk…');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        json: { username, password },
        noAuthRedirect: true,
      });
      if (data.token) setToken(data.token);
      form.reset();
      await showApp(data.admin);
      toast('Selamat datang, ' + (data.admin.nama || data.admin.username), 'ok');
    } catch (err) {
      alertEl.textContent = err.message;
      alertEl.classList.add('show');
    } finally {
      busy(btn, false);
    }
  });

  async function doLogout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* tetap keluar di sisi klien */
    }
    setToken('');
    showLogin();
    toast('Kamu telah keluar.');
  }
  $('#logoutBtn').addEventListener('click', doLogout);
  $('#logoutBtn2').addEventListener('click', doLogout);

  /* ================================================================
   *  NAVIGASI
   * ================================================================ */
  const loadedOnce = new Set();
  const PAGE_LOADER = {
    dashboard: loadDashboard,
    pendaftar: () => loadRegistrations(1),
    affiliator: () => loadAffiliators(1),
    pembayaran: async () => {
      await loadSettings();
      await loadBranding();
    },
    branding: async () => {
      await loadSettings();
      await loadBranding();
    },
    pengaturan: loadSettings,
    admins: loadAdmins,
    log: () => loadLog(1),
    sistem: loadHealth,
  };

  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sbBackdrop').classList.remove('show');
  }

  async function goPage(name) {
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name));
    $('#pageTitle').textContent = PAGE_TITLE[name] || name;
    closeSidebar();
    window.scrollTo({ top: 0 });

    const loader = PAGE_LOADER[name];
    if (loader && !loadedOnce.has(name)) {
      loadedOnce.add(name);
      try {
        await loader();
      } catch (err) {
        if (err.status !== 401) toast(err.message, 'err');
      }
    }
  }

  $$('.nav-item').forEach((btn) =>
    btn.addEventListener('click', () => goPage(btn.dataset.page))
  );
  $('#sbToggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
    $('#sbBackdrop').classList.toggle('show');
  });
  $('#sbBackdrop').addEventListener('click', closeSidebar);

  /** Muat ulang halaman yang sedang aktif. */
  async function reloadCurrent() {
    const active = $('.nav-item.active');
    const name = active ? active.dataset.page : 'dashboard';
    loadedOnce.delete(name);
    await goPage(name);
  }

  /* ================================================================
   *  DASHBOARD
   * ================================================================ */
  function renderChart(tren) {
    const max = Math.max(1, ...tren.map((t) => t.jumlah));
    $('#chartTren').innerHTML = tren
      .map((t) => {
        const h = Math.round((t.jumlah / max) * 100);
        const d = new Date(t.tanggal + 'T00:00:00');
        const cap = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
        return `<div class="col" title="${esc(cap)}: ${t.jumlah} pendaftar">
            <div class="num">${t.jumlah || ''}</div>
            <div class="bar-v" data-zero="${t.jumlah ? 0 : 1}" style="height:${Math.max(h, 2)}%"></div>
            <div class="cap">${esc(cap.replace(' ', '\u00a0'))}</div>
          </div>`;
      })
      .join('');
  }

  function renderHBars(items) {
    if (!items.length) {
      $('#barPendidikan').innerHTML = '<p class="cell-sub">Belum ada data.</p>';
      return;
    }
    const max = Math.max(1, ...items.map((i) => i.jumlah));
    $('#barPendidikan').innerHTML = items
      .map(
        (i) => `<div class="hbar-row">
          <span class="nm">${esc(i.nama)}</span>
          <span class="ct">${fmtNum(i.jumlah)}</span>
          <span class="track"><i style="width:${Math.round((i.jumlah / max) * 100)}%"></i></span>
        </div>`
      )
      .join('');
  }

  function renderAktivitas(target, list) {
    if (!list.length) {
      target.innerHTML = '<p class="cell-sub">Belum ada aktivitas.</p>';
      return;
    }
    target.innerHTML = list
      .map(
        (a) => `<div class="log-item">
          <span class="when">${esc(fmtTanggal(a.created_at))}</span>
          <span class="what"><b>${esc(a.aksi.replace(/_/g, ' '))}</b>
            ${a.actor_nama ? '· ' + esc(a.actor_nama) : ''}
            ${a.detail ? '<br><span class="cell-sub">' + esc(a.detail) + '</span>' : ''}
          </span>
        </div>`
      )
      .join('');
  }

  async function loadDashboard() {
    const d = await api('/api/admin/overview');

    $('#stTotal').textContent = fmtNum(d.total);
    $('#stWait').textContent = fmtNum(d.by_status.MENUNGGU_VERIFIKASI);
    $('#stOk').textContent = fmtNum(d.by_status.TERVERIFIKASI);
    $('#stNo').textContent = fmtNum(d.by_status.DITOLAK);
    $('#stHariIni').textContent = fmtNum(d.hari_ini);
    $('#stMingguIni').textContent = fmtNum(d.minggu_ini);
    $('#stPendapatan').textContent = fmtRp(d.estimasi_pendapatan);

    $('#stKuotaSisa').textContent = fmtNum(d.kuota_tersisa);
    $('#stKuotaTerisi').textContent = fmtNum(d.kuota_terisi);
    $('#stKuotaTotal').textContent = fmtNum(d.kuota_total);
    $('#stPersen').textContent = d.persen_terisi;
    $('#stBar').style.width = d.persen_terisi + '%';
    $('#dashPeriode').textContent = d.periode_pendaftaran || '–';

    const st = $('#dashStatus');
    st.textContent = d.pendaftaran_dibuka ? 'Dibuka' : 'Ditutup';
    st.className = 'badge ' + (d.pendaftaran_dibuka ? 'ok' : 'no');

    $('#quotaChip').textContent = `${fmtNum(d.kuota_tersisa)} / ${fmtNum(d.kuota_total)} kursi tersisa`;

    const wait = d.by_status.MENUNGGU_VERIFIKASI;
    $('#badgeWait').hidden = wait === 0;
    $('#badgeWait').textContent = fmtNum(wait);
    const pend = d.affiliator_by_status.PENDING;
    $('#badgeAff').hidden = pend === 0;
    $('#badgeAff').textContent = fmtNum(pend);

    $('#affTotal').textContent = fmtNum(d.affiliator_total);
    $('#affAktif').textContent = fmtNum(d.affiliator_by_status.AKTIF);
    $('#affPending').textContent = fmtNum(d.affiliator_by_status.PENDING);
    $('#komisiTerutang').textContent = fmtRp(d.komisi_terutang);
    $('#komisiDibayar').textContent = fmtRp(d.komisi_dibayar);

    renderChart(d.tren);
    renderHBars(d.komposisi_pendidikan);
    renderAktivitas($('#dashAktivitas'), d.aktivitas);

    $('#topAffList').innerHTML = d.top_affiliator.length
      ? d.top_affiliator
          .map(
            (a) => `<div class="log-item">
              <span class="what">
                <b>${esc(a.nama_lengkap)}</b> <span class="kode-chip">${esc(a.kode_referral)}</span>
                <br><span class="cell-sub">${a.total} referral · ${a.terverifikasi} terverifikasi</span>
              </span>
              <button class="btn btn-outline btn-xs" data-aff-detail="${a.id}">Lihat</button>
            </div>`
          )
          .join('')
      : '<p class="cell-sub">Belum ada affiliator yang membawa pendaftar.</p>';

    bindAffDetailButtons();
  }

  $('#dashRefresh').addEventListener('click', async () => {
    try {
      await loadDashboard();
      toast('Data diperbarui.', 'ok');
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'err');
    }
  });

  /* ================================================================
   *  PENDAFTAR
   * ================================================================ */
  const pState = { page: 1, totalPages: 1, total: 0 };
  const selected = new Set();

  function pFilters() {
    return {
      q: $('#pSearch').value.trim(),
      status: $('#pStatus').value,
      status_pendidikan: $('#pPendidikan').value,
      referral: $('#pReferral').value,
      bukti: $('#pBukti').value,
      dari: $('#pDari').value,
      sampai: $('#pSampai').value,
      sort: $('#pSort').value,
      pageSize: $('#pPageSize').value,
    };
  }

  function buildQuery(obj) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) if (v) p.set(k, v);
    return p.toString();
  }

  function renderPagination(target, page, totalPages, total, onGo) {
    if (total === 0) {
      target.innerHTML = '';
      return;
    }
    target.innerHTML =
      `<button data-go="1" ${page <= 1 ? 'disabled' : ''}>« Awal</button>` +
      `<button data-go="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button>` +
      `<span class="info">Halaman ${page} dari ${totalPages} · ${fmtNum(total)} data</span>` +
      `<button data-go="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Berikutnya ›</button>` +
      `<button data-go="${totalPages}" ${page >= totalPages ? 'disabled' : ''}>Akhir »</button>`;
    $$('button[data-go]', target).forEach((b) =>
      b.addEventListener('click', () => onGo(Number(b.dataset.go)))
    );
  }

  function syncBulkBar() {
    const bar = $('#bulkBar');
    bar.classList.toggle('show', selected.size > 0);
    $('#bulkCount').textContent = selected.size;
    $$('#pTableBody tr').forEach((tr) => {
      const id = Number(tr.dataset.id);
      tr.classList.toggle('selected', selected.has(id));
    });
    const boxes = $$('#pTableBody .chk');
    $('#pChkAll').checked = boxes.length > 0 && boxes.every((b) => b.checked);
  }

  async function loadRegistrations(page = 1) {
    pState.page = page;
    const tbody = $('#pTableBody');
    tbody.innerHTML =
      '<tr><td colspan="10"><div class="loading-center"><span class="spinner dark"></span> Memuat data…</div></td></tr>';

    const data = await api('/api/admin/registrations?' + buildQuery({ ...pFilters(), page }));
    pState.totalPages = data.totalPages;
    pState.total = data.total;

    if (!data.data.length) {
      tbody.innerHTML =
        '<tr><td colspan="10"><div class="empty-state"><div class="ic">📭</div><b>Tidak ada data</b><br><span class="cell-sub">Coba ubah kata kunci atau filter.</span></div></td></tr>';
      renderPagination($('#pPagination'), 1, 1, 0, () => {});
      selected.clear();
      syncBulkBar();
      return;
    }

    tbody.innerHTML = data.data
      .map((r) => {
        const ig = r.instagram
          ? `<a href="https://instagram.com/${encodeURIComponent(r.instagram)}" target="_blank" rel="noopener">@${esc(r.instagram)}</a>`
          : '';
        return `<tr data-id="${r.id}">
        <td><input type="checkbox" class="chk" data-sel="${r.id}" ${selected.has(r.id) ? 'checked' : ''} aria-label="Pilih ${esc(r.nama_lengkap)}" /></td>
        <td>
          <div class="cell-main">${esc(r.nama_lengkap)}</div>
          <div class="cell-sub">${esc(r.asal_sekolah)}</div>
        </td>
        <td>
          <div><a href="${waLink(r.nomor_wa)}" target="_blank" rel="noopener">${esc(r.nomor_wa)}</a></div>
          <div class="cell-sub">${esc(r.gmail)}${ig ? ' · ' + ig : ''}</div>
        </td>
        <td class="cell-sub">${esc(r.status_pendidikan)}</td>
        <td>${
          r.referral_kode
            ? `<span class="kode-chip">${esc(r.referral_kode)}</span><div class="cell-sub">${esc(r.affiliator_nama || 'affiliator dihapus')}</div>`
            : r.referral
              ? `<span class="cell-sub">${esc(r.referral)}</span>`
              : '<span class="cell-sub">–</span>'
        }</td>
        <td class="nowrap">${r.nominal_transfer ? 'Rp' + esc(r.nominal_transfer) : '<span class="cell-sub">–</span>'}</td>
        <td class="t-center">${Number(r.has_bukti) === 1 ? '🧾' : '<span class="cell-sub">–</span>'}</td>
        <td><span class="badge ${STATUS_CLASS[r.status] || 'mute'}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
        <td class="cell-sub nowrap">${esc(fmtTanggal(r.created_at))}</td>
        <td class="t-right"><button class="btn btn-outline btn-xs" data-detail="${r.id}">Detail</button></td>
      </tr>`;
      })
      .join('');

    $$('#pTableBody [data-sel]').forEach((box) =>
      box.addEventListener('change', () => {
        const id = Number(box.dataset.sel);
        if (box.checked) selected.add(id);
        else selected.delete(id);
        syncBulkBar();
      })
    );
    $$('#pTableBody [data-detail]').forEach((b) =>
      b.addEventListener('click', () => openRegDetail(Number(b.dataset.detail)))
    );

    renderPagination($('#pPagination'), data.page, data.totalPages, data.total, loadRegistrations);
    syncBulkBar();
  }

  const reloadRegs = () => {
    selected.clear();
    loadRegistrations(1).catch((err) => {
      if (err.status !== 401) toast(err.message, 'err');
    });
  };

  let searchTimer = null;
  $('#pSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reloadRegs, 350);
  });
  ['#pStatus', '#pPendidikan', '#pReferral', '#pBukti', '#pSort', '#pPageSize', '#pDari', '#pSampai'].forEach(
    (sel) => $(sel).addEventListener('change', reloadRegs)
  );
  $('#pReset').addEventListener('click', () => {
    $('#pSearch').value = '';
    ['#pStatus', '#pPendidikan', '#pReferral', '#pBukti', '#pDari', '#pSampai'].forEach(
      (s) => ($(s).value = '')
    );
    $('#pSort').value = 'terbaru';
    $('#pPageSize').value = '20';
    reloadRegs();
  });

  $('#pChkAll').addEventListener('change', (e) => {
    $$('#pTableBody [data-sel]').forEach((box) => {
      box.checked = e.target.checked;
      const id = Number(box.dataset.sel);
      if (e.target.checked) selected.add(id);
      else selected.delete(id);
    });
    syncBulkBar();
  });
  $('#bulkClear').addEventListener('click', () => {
    selected.clear();
    $$('#pTableBody [data-sel]').forEach((b) => (b.checked = false));
    syncBulkBar();
  });

  async function bulkStatus(status, label) {
    if (!selected.size) return;
    const ok = await confirmDialog({
      title: 'Ubah status massal',
      message: `Ubah status <b>${selected.size}</b> pendaftar menjadi <b>${esc(label)}</b>?`,
      confirmText: 'Ya, ubah',
      danger: status === 'DITOLAK',
    });
    if (!ok) return;
    try {
      const res = await api('/api/admin/registrations/bulk-status', {
        method: 'POST',
        json: { ids: [...selected], status },
      });
      toast(`${res.changed} data diperbarui.`, 'ok');
      selected.clear();
      await loadRegistrations(pState.page);
      await loadDashboard();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'err');
    }
  }
  $('#bulkVerif').addEventListener('click', () => bulkStatus('TERVERIFIKASI', 'Terverifikasi'));
  $('#bulkWait').addEventListener('click', () => bulkStatus('MENUNGGU_VERIFIKASI', 'Menunggu Verifikasi'));
  $('#bulkTolak').addEventListener('click', () => bulkStatus('DITOLAK', 'Ditolak'));

  async function downloadCsv(url, fallbackName) {
    try {
      const res = await api(url, { raw: true });
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = m ? m[1] : fallbackName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast('File CSV diunduh.', 'ok');
    } catch (err) {
      if (err.status !== 401) toast(err.message || 'Gagal mengunduh.', 'err');
    }
  }

  $('#pExport').addEventListener('click', () =>
    downloadCsv('/api/admin/registrations/export?' + buildQuery(pFilters()), 'pendaftar.csv')
  );

  /* ---------------- Detail pendaftar ---------------- */
  async function openRegDetail(id) {
    openModal({
      title: 'Detail Pendaftar',
      body: '<div class="loading-center"><span class="spinner dark"></span> Memuat…</div>',
    });

    let r;
    try {
      r = await api('/api/admin/registrations/' + id);
    } catch (err) {
      $('#modalBody').innerHTML = `<div class="alert error show">${esc(err.message)}</div>`;
      return;
    }

    const rows = [
      ['Nama Lengkap', esc(r.nama_lengkap)],
      ['Asal Sekolah', esc(r.asal_sekolah)],
      ['Tanggal Lahir', esc(fmtTanggal(r.tanggal_lahir, false))],
      ['Status Pendidikan', esc(r.status_pendidikan)],
      ['Nomor WhatsApp', `<a href="${waLink(r.nomor_wa)}" target="_blank" rel="noopener">${esc(r.nomor_wa)}</a>`],
      ['Email', `<a href="mailto:${esc(r.gmail)}">${esc(r.gmail)}</a>`],
      [
        'Instagram',
        r.instagram
          ? `<a href="https://instagram.com/${encodeURIComponent(r.instagram)}" target="_blank" rel="noopener">@${esc(r.instagram)}</a>`
          : '–',
      ],
      [
        'Kode Referral',
        r.referral_kode
          ? `<span class="kode-chip">${esc(r.referral_kode)}</span> ${esc(r.affiliator_nama || '')}` +
            (r.affiliator_wa ? `<br><span class="cell-sub">${esc(r.affiliator_wa)}</span>` : '')
          : r.referral
            ? esc(r.referral) + ' <span class="badge mute">teks bebas</span>'
            : '–',
      ],
      ['Nominal Transfer', r.nominal_transfer ? 'Rp' + esc(r.nominal_transfer) : '–'],
      ['Tanggal Daftar', esc(fmtTanggal(r.created_at))],
      ['Terakhir Diubah', esc(fmtTanggal(r.updated_at))],
      [
        'Verifikasi',
        r.verified_at
          ? `${esc(fmtTanggal(r.verified_at))} oleh <b>${esc(r.verified_by || '-')}</b>`
          : '–',
      ],
    ];

    $('#modalBody').innerHTML = `
      <div class="detail-grid">
        <div>
          <p style="margin-bottom:12px">
            <span class="badge ${STATUS_CLASS[r.status] || 'mute'}">${esc(STATUS_LABEL[r.status] || r.status)}</span>
            <span class="cell-sub">· ID #${r.id}</span>
          </p>
          <dl class="dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
        </div>
        <div>
          <div class="cell-sub" style="margin-bottom:6px;font-weight:650">Bukti Pembayaran</div>
          <div class="bukti-box" id="buktiBox">
            ${Number(r.has_bukti) === 1 ? '<div class="muted"><span class="spinner dark"></span> Memuat…</div>' : '<div class="muted">Tidak ada bukti</div>'}
          </div>
        </div>
      </div>

      <div class="subcard">
        <h4>Ubah Status</h4>
        <div class="field">
          <label>Catatan Admin (opsional, tampil di riwayat)</label>
          <textarea class="input" id="catatanAdmin" rows="2" maxlength="1000">${esc(r.catatan_admin || '')}</textarea>
        </div>
        <div class="row-actions">
          <button class="btn btn-success btn-sm" data-set="TERVERIFIKASI">✓ Terverifikasi</button>
          <button class="btn btn-warn btn-sm" data-set="MENUNGGU_VERIFIKASI">⏳ Menunggu</button>
          <button class="btn btn-danger btn-sm" data-set="DITOLAK">✕ Tolak</button>
        </div>
      </div>

      <div class="subcard">
        <h4>Perbaiki Data</h4>
        <form id="formEditReg">
          <div class="alert" data-alert></div>
          <div class="grid-2">
            <div class="field"><label>Nama Lengkap</label>
              <input class="input" name="nama_lengkap" value="${esc(r.nama_lengkap)}" />
              <div class="field-error" data-for="nama_lengkap"></div></div>
            <div class="field"><label>Asal Sekolah</label>
              <input class="input" name="asal_sekolah" value="${esc(r.asal_sekolah)}" />
              <div class="field-error" data-for="asal_sekolah"></div></div>
            <div class="field"><label>Nomor WhatsApp</label>
              <input class="input" name="nomor_wa" value="${esc(r.nomor_wa)}" />
              <div class="field-error" data-for="nomor_wa"></div></div>
            <div class="field"><label>Email</label>
              <input class="input" name="gmail" value="${esc(r.gmail)}" />
              <div class="field-error" data-for="gmail"></div></div>
            <div class="field"><label>Instagram</label>
              <input class="input" name="instagram" value="${esc(r.instagram || '')}" />
              <div class="field-error" data-for="instagram"></div></div>
            <div class="field"><label>Kode Referral</label>
              <input class="input" name="referral" value="${esc(r.referral_kode || '')}" placeholder="kosongkan untuk melepas" />
              <div class="field-error" data-for="referral"></div></div>
            <div class="field"><label>Nominal Transfer</label>
              <input class="input" name="nominal_transfer" value="${esc(r.nominal_transfer || '')}" />
              <div class="field-error" data-for="nominal_transfer"></div></div>
            <div class="field"><label>Tanggal Lahir</label>
              <input class="input" type="date" name="tanggal_lahir" value="${esc(r.tanggal_lahir)}" />
              <div class="field-error" data-for="tanggal_lahir"></div></div>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">💾 Simpan Perubahan</button>
        </form>
      </div>`;

    $('#modalFoot').style.display = '';
    $('#modalFoot').innerHTML =
      `<button class="btn btn-danger" data-delete="${r.id}">🗑️ Hapus Pendaftar</button>` +
      `<button class="btn btn-outline" data-close>Tutup</button>`;
    $('#modalFoot [data-close]').addEventListener('click', closeModal);
    $('#modalFoot [data-delete]').addEventListener('click', () => deleteReg(r.id, r.nama_lengkap));

    // Bukti dimuat lewat fetch berautentikasi (tag <img> biasa tidak mengirim token)
    if (Number(r.has_bukti) === 1) {
      try {
        const res = await api(`/api/admin/registrations/${r.id}/bukti`, { raw: true });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        const box = $('#buktiBox');
        if (box) {
          box.innerHTML = `<img src="${url}" alt="Bukti pembayaran" style="max-height:260px" />
            <a class="btn btn-outline btn-xs" style="margin-top:8px" href="${url}" target="_blank" rel="noopener">🔍 Buka ukuran penuh</a>`;
        }
      } catch {
        const box = $('#buktiBox');
        if (box) box.innerHTML = '<div class="muted">Gagal memuat bukti pembayaran.</div>';
      }
    }

    $$('#modalBody [data-set]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        busy(btn, true, 'Menyimpan…');
        try {
          await api(`/api/admin/registrations/${r.id}/status`, {
            method: 'PATCH',
            json: { status: btn.dataset.set, catatan_admin: $('#catatanAdmin').value },
          });
          toast('Status diperbarui.', 'ok');
          closeModal();
          await loadRegistrations(pState.page);
          await loadDashboard();
        } catch (err) {
          busy(btn, false);
          if (err.status !== 401) toast(err.message, 'err');
        }
      })
    );

    const editForm = $('#formEditReg');
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(editForm);
      const btn = editForm.querySelector('button[type="submit"]');
      const payload = {};
      for (const el of editForm.elements) {
        if (el.name) payload[el.name] = el.value;
      }
      busy(btn, true);
      try {
        await api(`/api/admin/registrations/${r.id}`, { method: 'PATCH', json: payload });
        showAlert(editForm, 'Data pendaftar berhasil diperbarui.', 'success');
        toast('Data diperbarui.', 'ok');
        await loadRegistrations(pState.page);
      } catch (err) {
        showFieldErrors(editForm, err.fields);
        showAlert(editForm, err.message, 'error');
      } finally {
        busy(btn, false);
      }
    });
  }

  async function deleteReg(id, nama) {
    const ok = await confirmDialog({
      title: 'Hapus pendaftar',
      message: `Hapus permanen data <b>${esc(nama)}</b> beserta bukti pembayarannya?<br><br><span class="cell-sub">Tindakan ini tidak bisa dibatalkan. Kuota akan bertambah kembali.</span>`,
      confirmText: 'Ya, hapus',
    });
    if (!ok) return;
    try {
      await api('/api/admin/registrations/' + id, { method: 'DELETE' });
      toast('Data pendaftar dihapus.', 'ok');
      await loadRegistrations(pState.page);
      await loadDashboard();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'err');
    }
  }

  /* ================================================================
   *  AFFILIATOR
   * ================================================================ */
  const aState = { page: 1, komisi: 0 };

  async function loadAffiliators(page = 1) {
    aState.page = page;
    const tbody = $('#aTableBody');
    tbody.innerHTML =
      '<tr><td colspan="8"><div class="loading-center"><span class="spinner dark"></span> Memuat data…</div></td></tr>';

    const data = await api(
      '/api/admin/affiliators?' +
        buildQuery({ q: $('#aSearch').value.trim(), status: $('#aStatus').value, page })
    );
    aState.komisi = data.komisi_per_referral;

    if (!data.data.length) {
      tbody.innerHTML =
        '<tr><td colspan="8"><div class="empty-state"><div class="ic">🤝</div><b>Belum ada affiliator</b><br><span class="cell-sub">Affiliator mendaftar sendiri lewat halaman /affiliasi, atau tambahkan manual di sini.</span></div></td></tr>';
      renderPagination($('#aPagination'), 1, 1, 0, () => {});
      return;
    }

    tbody.innerHTML = data.data
      .map(
        (a) => `<tr>
        <td><span class="kode-chip">${esc(a.kode_referral)}</span></td>
        <td>
          <div class="cell-main">${esc(a.nama_lengkap)}</div>
          <div class="cell-sub">${esc(a.asal_institusi || '–')}</div>
        </td>
        <td>
          <div><a href="${waLink(a.nomor_wa)}" target="_blank" rel="noopener">${esc(a.nomor_wa)}</a></div>
          <div class="cell-sub">${esc(a.email)}</div>
        </td>
        <td class="t-center"><b>${fmtNum(a.total_referral)}</b><div class="cell-sub">${fmtNum(a.menunggu)} menunggu</div></td>
        <td class="t-center"><b style="color:var(--success)">${fmtNum(a.terverifikasi)}</b></td>
        <td class="nowrap">
          <div>${fmtRp(a.komisi_diperoleh)}</div>
          <div class="cell-sub">sisa ${fmtRp(a.komisi_sisa)}</div>
        </td>
        <td><span class="badge ${AFF_CLASS[a.status] || 'mute'}">${esc(AFF_LABEL[a.status] || a.status)}</span></td>
        <td class="t-right">
          <div class="row-actions" style="justify-content:flex-end">
            ${a.status === 'PENDING' ? `<button class="btn btn-success btn-xs" data-approve="${a.id}">✓ Setujui</button>` : ''}
            <button class="btn btn-outline btn-xs" data-aff-detail="${a.id}">Detail</button>
          </div>
        </td>
      </tr>`
      )
      .join('');

    $$('#aTableBody [data-approve]').forEach((b) =>
      b.addEventListener('click', async () => {
        busy(b, true, '…');
        try {
          await api('/api/admin/affiliators/' + b.dataset.approve, {
            method: 'PATCH',
            json: { status: 'AKTIF' },
          });
          toast('Affiliator disetujui & kode referralnya aktif.', 'ok');
          await loadAffiliators(aState.page);
          await loadDashboard();
        } catch (err) {
          busy(b, false);
          if (err.status !== 401) toast(err.message, 'err');
        }
      })
    );
    bindAffDetailButtons();
    renderPagination($('#aPagination'), data.page, data.totalPages, data.total, loadAffiliators);
  }

  function bindAffDetailButtons() {
    $$('[data-aff-detail]').forEach((b) => {
      if (b.dataset.bound === '1') return;
      b.dataset.bound = '1';
      b.addEventListener('click', () => openAffDetail(Number(b.dataset.affDetail)));
    });
  }

  const reloadAffs = () => {
    loadAffiliators(1).catch((err) => {
      if (err.status !== 401) toast(err.message, 'err');
    });
  };
  let aSearchTimer = null;
  $('#aSearch').addEventListener('input', () => {
    clearTimeout(aSearchTimer);
    aSearchTimer = setTimeout(reloadAffs, 350);
  });
  $('#aStatus').addEventListener('change', reloadAffs);
  $('#aExport').addEventListener('click', () =>
    downloadCsv('/api/admin/affiliators/export', 'affiliator.csv')
  );

  async function openAffDetail(id) {
    openModal({
      title: 'Detail Affiliator',
      body: '<div class="loading-center"><span class="spinner dark"></span> Memuat…</div>',
    });

    let d;
    try {
      d = await api('/api/admin/affiliators/' + id);
    } catch (err) {
      $('#modalBody').innerHTML = `<div class="alert error show">${esc(err.message)}</div>`;
      return;
    }
    const a = d.affiliator;

    $('#modalBody').innerHTML = `
      <div class="card-row" style="margin-bottom:14px">
        <div>
          <div style="font-size:1.1rem;font-weight:750;color:var(--navy)">${esc(a.nama_lengkap)}</div>
          <div class="cell-sub">Bergabung ${esc(fmtTanggal(a.created_at, false))} · Login terakhir ${esc(fmtTanggal(a.last_login_at))}</div>
        </div>
        <span class="kode-chip" style="font-size:.95rem">${esc(a.kode_referral)}</span>
      </div>

      <div class="stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
        <div class="stat-card"><div class="label">Total Referral</div><div class="value b">${fmtNum(d.total_referral)}</div></div>
        <div class="stat-card"><div class="label">Terverifikasi</div><div class="value g">${fmtNum(d.by_status.TERVERIFIKASI)}</div></div>
        <div class="stat-card"><div class="label">Komisi Diperoleh</div><div class="value" style="font-size:1.15rem">${fmtRp(d.komisi_diperoleh)}</div></div>
        <div class="stat-card"><div class="label">Belum Dibayar</div><div class="value w" style="font-size:1.15rem">${fmtRp(d.komisi_sisa)}</div></div>
      </div>

      <form id="formEditAff">
        <div class="alert" data-alert></div>
        <div class="grid-2">
          <div class="field"><label>Nama Lengkap</label>
            <input class="input" name="nama_lengkap" value="${esc(a.nama_lengkap)}" />
            <div class="field-error" data-for="nama_lengkap"></div></div>
          <div class="field"><label>Kode Referral</label>
            <input class="input mono" name="kode_referral" value="${esc(a.kode_referral)}" />
            <div class="hint">Mengubah kode akan memperbarui jejak pada data pendaftar.</div>
            <div class="field-error" data-for="kode_referral"></div></div>
          <div class="field"><label>Email</label>
            <input class="input" name="email" value="${esc(a.email)}" />
            <div class="field-error" data-for="email"></div></div>
          <div class="field"><label>Nomor WhatsApp</label>
            <input class="input" name="nomor_wa" value="${esc(a.nomor_wa)}" />
            <div class="field-error" data-for="nomor_wa"></div></div>
          <div class="field"><label>Instagram</label>
            <input class="input" name="instagram" value="${esc(a.instagram || '')}" />
            <div class="field-error" data-for="instagram"></div></div>
          <div class="field"><label>Asal Sekolah / Kampus</label>
            <input class="input" name="asal_institusi" value="${esc(a.asal_institusi || '')}" />
            <div class="field-error" data-for="asal_institusi"></div></div>
          <div class="field"><label>Bank / E-wallet</label>
            <input class="input" name="bank_nama" value="${esc(a.bank_nama || '')}" />
            <div class="field-error" data-for="bank_nama"></div></div>
          <div class="field"><label>Nomor Rekening</label>
            <input class="input" name="bank_rekening" value="${esc(a.bank_rekening || '')}" />
            <div class="field-error" data-for="bank_rekening"></div></div>
          <div class="field"><label>Atas Nama</label>
            <input class="input" name="bank_atasnama" value="${esc(a.bank_atasnama || '')}" />
            <div class="field-error" data-for="bank_atasnama"></div></div>
          <div class="field"><label>Status</label>
            <select class="select" name="status">
              ${Object.entries(AFF_LABEL)
                .map(
                  ([v, l]) =>
                    `<option value="${v}" ${a.status === v ? 'selected' : ''}>${esc(l)}</option>`
                )
                .join('')}
            </select></div>
          <div class="field full"><label>Catatan Admin</label>
            <textarea class="input" name="catatan_admin" rows="2" maxlength="500">${esc(a.catatan_admin || '')}</textarea></div>
        </div>
        <div class="row-actions">
          <button type="submit" class="btn btn-primary btn-sm">💾 Simpan</button>
          <button type="button" class="btn btn-outline btn-sm" id="affResetPw">🔑 Reset Password</button>
        </div>
      </form>

      <div class="subcard">
        <h4>💰 Catat Pembayaran Komisi</h4>
        <form id="formPayout">
          <div class="alert" data-alert></div>
          <div class="grid-2">
            <div class="field"><label>Jumlah (Rp)</label>
              <input class="input" type="number" name="jumlah" min="1" step="1000" value="${d.komisi_sisa || ''}" />
              <div class="field-error" data-for="jumlah"></div></div>
            <div class="field"><label>Catatan</label>
              <input class="input" name="catatan" placeholder="mis. transfer 12 Okt" /></div>
          </div>
          <button type="submit" class="btn btn-success btn-sm">＋ Catat Pembayaran</button>
        </form>
        <div style="margin-top:12px">${
          d.payouts.length
            ? `<div class="kv-list">${d.payouts
                .map(
                  (p) =>
                    `<div class="row"><span>${esc(fmtTanggal(p.created_at, false))} · ${esc(p.catatan || 'tanpa catatan')} <span class="cell-sub">(${esc(p.created_by || '-')})</span></span>
                     <span>${fmtRp(p.jumlah)} <button class="btn btn-ghost btn-xs" data-del-payout="${p.id}" title="Hapus catatan">✕</button></span></div>`
                )
                .join('')}</div>`
            : '<p class="cell-sub">Belum ada pembayaran komisi tercatat.</p>'
        }</div>
      </div>

      <div class="subcard">
        <h4>👥 Pengguna Kode Referral (${d.referrals.length})</h4>
        ${
          d.referrals.length
            ? `<div class="table-scroll"><table>
                <thead><tr><th>Nama</th><th>Sekolah</th><th>Kontak</th><th>Status</th><th>Tanggal</th></tr></thead>
                <tbody>${d.referrals
                  .map(
                    (r) => `<tr>
                      <td class="cell-main">${esc(r.nama_lengkap)}</td>
                      <td class="cell-sub">${esc(r.asal_sekolah)}</td>
                      <td class="cell-sub">${esc(r.nomor_wa)}<br>${esc(r.gmail)}</td>
                      <td><span class="badge ${STATUS_CLASS[r.status] || 'mute'}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
                      <td class="cell-sub nowrap">${esc(fmtTanggal(r.created_at, false))}</td>
                    </tr>`
                  )
                  .join('')}</tbody></table></div>`
            : '<p class="cell-sub">Belum ada yang memakai kode referral ini.</p>'
        }
      </div>`;

    $('#modalFoot').style.display = '';
    $('#modalFoot').innerHTML =
      `<button class="btn btn-danger" id="affDelete">🗑️ Hapus Affiliator</button>` +
      `<button class="btn btn-outline" data-close>Tutup</button>`;
    $('#modalFoot [data-close]').addEventListener('click', closeModal);

    // --- simpan perubahan ---
    const form = $('#formEditAff');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      const btn = form.querySelector('button[type="submit"]');
      const payload = {};
      for (const el of form.elements) if (el.name) payload[el.name] = el.value;
      busy(btn, true);
      try {
        await api('/api/admin/affiliators/' + id, { method: 'PATCH', json: payload });
        showAlert(form, 'Data affiliator diperbarui.', 'success');
        toast('Data affiliator diperbarui.', 'ok');
        await loadAffiliators(aState.page);
        await loadDashboard();
      } catch (err) {
        showFieldErrors(form, err.fields);
        showAlert(form, err.message, 'error');
      } finally {
        busy(btn, false);
      }
    });

    // --- reset password ---
    $('#affResetPw').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Reset password affiliator',
        message: `Buat password baru untuk <b>${esc(a.nama_lengkap)}</b>? Password lama langsung tidak berlaku.`,
        confirmText: 'Ya, reset',
        danger: false,
      });
      if (!ok) return;
      try {
        const res = await api(`/api/admin/affiliators/${id}/reset-password`, { method: 'POST' });
        showCredential('Password Baru Affiliator', a.email, res.password, res.message);
      } catch (err) {
        if (err.status !== 401) toast(err.message, 'err');
      }
    });

    // --- payout ---
    const payoutForm = $('#formPayout');
    payoutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(payoutForm);
      const btn = payoutForm.querySelector('button[type="submit"]');
      busy(btn, true);
      try {
        await api(`/api/admin/affiliators/${id}/payouts`, {
          method: 'POST',
          json: {
            jumlah: payoutForm.elements.jumlah.value,
            catatan: payoutForm.elements.catatan.value,
          },
        });
        toast('Pembayaran komisi dicatat.', 'ok');
        await openAffDetail(id);
        await loadAffiliators(aState.page);
      } catch (err) {
        showFieldErrors(payoutForm, err.fields);
        showAlert(payoutForm, err.message, 'error');
        busy(btn, false);
      }
    });

    $$('#modalBody [data-del-payout]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Hapus catatan pembayaran',
          message: 'Hapus catatan pembayaran komisi ini?',
          confirmText: 'Ya, hapus',
        });
        if (!ok) return;
        try {
          await api('/api/admin/payouts/' + b.dataset.delPayout, { method: 'DELETE' });
          toast('Catatan pembayaran dihapus.', 'ok');
          await openAffDetail(id);
          await loadAffiliators(aState.page);
        } catch (err) {
          if (err.status !== 401) toast(err.message, 'err');
        }
      })
    );

    // --- hapus affiliator ---
    $('#affDelete').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Hapus affiliator',
        message: `Hapus akun <b>${esc(a.nama_lengkap)}</b> (${esc(a.kode_referral)})?<br><br><span class="cell-sub">Data pendaftar TIDAK dihapus — hanya tautan ke affiliator ini yang dilepas.</span>`,
        confirmText: 'Ya, hapus',
      });
      if (!ok) return;
      try {
        await api('/api/admin/affiliators/' + id, { method: 'DELETE' });
        closeModal();
        toast('Affiliator dihapus.', 'ok');
        await loadAffiliators(1);
        await loadDashboard();
      } catch (err) {
        if (err.status !== 401) toast(err.message, 'err');
      }
    });
  }

  /** Tampilkan kredensial sekali-pakai dengan tombol salin. */
  function showCredential(title, identitas, password, pesan) {
    openModal({
      title,
      narrow: true,
      body:
        `<div class="alert warn show">${esc(pesan || 'Catat sekarang — password hanya ditampilkan sekali.')}</div>` +
        `<div class="field"><label>Identitas / Username</label><div class="mono">${esc(identitas)}</div></div>` +
        `<div class="credbox"><span id="credPw">${esc(password)}</span>
           <button class="btn btn-gold btn-xs" id="credCopy">📋 Salin</button></div>`,
      footer: '<button class="btn btn-primary" data-close>Selesai</button>',
    });
    $('#modalFoot [data-close]').addEventListener('click', closeModal);
    $('#credCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(password);
        toast('Password disalin.', 'ok');
      } catch {
        toast('Tidak bisa menyalin otomatis — salin manual.', 'err');
      }
    });
  }

  /* ---------------- Tambah affiliator ---------------- */
  $('#aTambah').addEventListener('click', () => {
    openModal({
      title: 'Tambah Affiliator',
      body: `<form id="formAddAff">
          <div class="alert" data-alert></div>
          <div class="grid-2">
            <div class="field"><label>Nama Lengkap *</label>
              <input class="input" name="nama_lengkap" />
              <div class="field-error" data-for="nama_lengkap"></div></div>
            <div class="field"><label>Email *</label>
              <input class="input" type="email" name="email" />
              <div class="field-error" data-for="email"></div></div>
            <div class="field"><label>Nomor WhatsApp *</label>
              <input class="input" name="nomor_wa" placeholder="08xxxxxxxxxx" />
              <div class="field-error" data-for="nomor_wa"></div></div>
            <div class="field"><label>Kode Referral</label>
              <input class="input mono" name="kode_referral" placeholder="otomatis bila kosong" />
              <div class="field-error" data-for="kode_referral"></div></div>
            <div class="field"><label>Instagram</label>
              <input class="input" name="instagram" />
              <div class="field-error" data-for="instagram"></div></div>
            <div class="field"><label>Asal Sekolah / Kampus</label>
              <input class="input" name="asal_institusi" />
              <div class="field-error" data-for="asal_institusi"></div></div>
            <div class="field"><label>Bank / E-wallet</label><input class="input" name="bank_nama" /></div>
            <div class="field"><label>Nomor Rekening</label>
              <input class="input" name="bank_rekening" />
              <div class="field-error" data-for="bank_rekening"></div></div>
            <div class="field full"><label>Atas Nama</label><input class="input" name="bank_atasnama" /></div>
            <div class="field full"><label>Status Awal</label>
              <select class="select" name="status">
                <option value="AKTIF">Aktif (langsung bisa dipakai)</option>
                <option value="PENDING">Menunggu Persetujuan</option>
              </select></div>
          </div>
          <p class="cell-sub">Password akan dibuat otomatis dan ditampilkan sekali setelah akun dibuat.</p>
        </form>`,
      footer:
        '<button class="btn btn-outline" data-close>Batal</button>' +
        '<button class="btn btn-primary" id="addAffSubmit">Buat Akun</button>',
    });
    $('#modalFoot [data-close]').addEventListener('click', closeModal);

    $('#addAffSubmit').addEventListener('click', async () => {
      const form = $('#formAddAff');
      clearErrors(form);
      const btn = $('#addAffSubmit');
      const payload = {};
      for (const el of form.elements) if (el.name) payload[el.name] = el.value;
      busy(btn, true, 'Membuat…');
      try {
        const res = await api('/api/admin/affiliators', { method: 'POST', json: payload });
        showCredential(
          'Akun Affiliator Dibuat',
          `${payload.email}  (kode: ${res.kode_referral})`,
          res.password,
          res.message
        );
        await loadAffiliators(1);
        await loadDashboard();
      } catch (err) {
        showFieldErrors(form, err.fields);
        showAlert(form, err.message, 'error');
        busy(btn, false);
      }
    });
  });

  /* ================================================================
   *  PENGATURAN (generik untuk semua .js-settings-form)
   * ================================================================ */
  let settingsCache = null;

  function fillSettingsForms(settings) {
    $$('.js-settings-form').forEach((form) => {
      for (const el of form.elements) {
        if (!el.name || !(el.name in settings)) continue;
        if (el.type === 'checkbox') el.checked = String(settings[el.name]) === '1';
        else el.value = settings[el.name];
      }
    });
  }

  async function loadSettings() {
    const data = await api('/api/admin/settings');
    settingsCache = data.settings;
    fillSettingsForms(data.settings);
    fillPendidikanFilter();
  }

  $$('.js-settings-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      const btn = form.querySelector('button[type="submit"]');
      const payload = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        payload[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
      }
      busy(btn, true);
      try {
        const res = await api('/api/admin/settings', { method: 'PATCH', json: payload });
        settingsCache = res.settings;
        fillSettingsForms(res.settings);
        showAlert(form, 'Pengaturan berhasil disimpan.', 'success');
        toast('Pengaturan disimpan.', 'ok');
        // segarkan branding & angka kuota di topbar
        siteInfo = await window.WNA.fetchInfo().catch(() => siteInfo);
        if (siteInfo) applyBranding(siteInfo);
        await loadDashboard().catch(() => {});
      } catch (err) {
        showFieldErrors(form, err.fields);
        showAlert(form, err.message || 'Gagal menyimpan pengaturan.', 'error');
      } finally {
        busy(btn, false);
      }
    });
  });

  /* ---------------- Ganti password admin ---------------- */
  $('#formPassword').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    clearErrors(form);
    const btn = form.querySelector('button[type="submit"]');
    const lama = form.elements.password_lama.value;
    const baru = form.elements.password_baru.value;
    const baru2 = form.elements.password_baru2.value;

    if (baru !== baru2) {
      showFieldErrors(form, { password_baru2: 'Konfirmasi password tidak sama.' });
      return;
    }
    busy(btn, true);
    try {
      const res = await api('/api/auth/change-password', {
        method: 'POST',
        json: { password_lama: lama, password_baru: baru },
      });
      form.reset();
      showAlert(form, res.message, 'success');
      toast('Password berhasil diubah.', 'ok');
    } catch (err) {
      showFieldErrors(form, err.fields);
      showAlert(form, err.message, 'error');
    } finally {
      busy(btn, false);
    }
  });

  /* ================================================================
   *  BRANDING & QRIS (unggah gambar)
   * ================================================================ */
  const UPLOADERS = [
    { kind: 'logo', drop: '#logoDrop', input: '#logoInput', preview: '#logoPreview', meta: '#logoMeta', del: '#logoDelete', kosong: 'Memakai teks logo' },
    { kind: 'favicon', drop: '#favDrop', input: '#favInput', preview: '#favPreview', meta: '#favMeta', del: '#favDelete', kosong: 'Memakai ikon bawaan' },
    { kind: 'qris', drop: '#qrisDrop', input: '#qrisInput', preview: '#qrisPreview', meta: '#qrisMeta', del: '#qrisDelete', kosong: 'Belum ada QRIS' },
  ];
  const MAX_UPLOAD = 3 * 1024 * 1024;
  const ALLOWED_UPLOAD = ['image/jpeg', 'image/png', 'image/webp'];

  async function loadBranding() {
    const data = await api('/api/admin/branding');
    for (const u of UPLOADERS) {
      const info = data.branding[u.kind];
      const preview = $(u.preview);
      const meta = $(u.meta);
      const del = $(u.del);
      if (info?.tersedia) {
        preview.innerHTML = `<img src="${esc(info.url)}" alt="${u.kind}" />`;
        meta.textContent = `${info.mime} · ${info.ukuran_kb} KB · diperbarui ${fmtTanggal(info.diperbarui)}`;
        del.hidden = false;
      } else {
        preview.innerHTML = `<div class="none">${esc(u.kosong)}</div>`;
        meta.textContent = '';
        del.hidden = true;
      }
    }
  }

  async function uploadBranding(kind, file) {
    if (!file) return;
    if (!ALLOWED_UPLOAD.includes(file.type)) {
      toast('Format harus JPG, PNG, atau WebP.', 'err');
      return;
    }
    if (file.size > MAX_UPLOAD) {
      toast('Ukuran file maksimal 3 MB.', 'err');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api('/api/admin/branding/' + kind, { method: 'POST', body: fd });
      toast(res.message, 'ok');
      await loadBranding();
      siteInfo = await window.WNA.fetchInfo().catch(() => siteInfo);
      if (siteInfo) applyBranding(siteInfo);
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'err');
    }
  }

  for (const u of UPLOADERS) {
    const drop = $(u.drop);
    const input = $(u.input);
    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      uploadBranding(u.kind, input.files[0]);
      input.value = '';
    });
    ['dragover', 'dragenter'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('drag');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove('drag');
      })
    );
    drop.addEventListener('drop', (e) => uploadBranding(u.kind, e.dataTransfer.files[0]));

    $(u.del).addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Hapus gambar',
        message: `Hapus ${u.kind}? Situs akan kembali memakai tampilan bawaan.`,
        confirmText: 'Ya, hapus',
      });
      if (!ok) return;
      try {
        const res = await api('/api/admin/branding/' + u.kind, { method: 'DELETE' });
        toast(res.message, 'ok');
        await loadBranding();
        siteInfo = await window.WNA.fetchInfo().catch(() => siteInfo);
        if (siteInfo) applyBranding(siteInfo);
      } catch (err) {
        if (err.status !== 401) toast(err.message, 'err');
      }
    });
  }

  /* ================================================================
   *  AKUN ADMIN
   * ================================================================ */
  async function loadAdmins() {
    const tbody = $('#adTableBody');
    tbody.innerHTML =
      '<tr><td colspan="7"><div class="loading-center"><span class="spinner dark"></span> Memuat…</div></td></tr>';
    const data = await api('/api/admin/admins');

    tbody.innerHTML = data.data
      .map(
        (a) => `<tr>
        <td class="cell-main">${esc(a.username)} ${a.saya ? '<span class="badge info">saya</span>' : ''}</td>
        <td>${esc(a.nama)}</td>
        <td class="cell-sub">${esc(a.email || '–')}</td>
        <td><span class="badge ${a.role === 'SUPERADMIN' ? 'gold' : 'info'}">${a.role === 'SUPERADMIN' ? 'Super Admin' : 'Admin'}</span></td>
        <td><span class="badge ${a.is_active ? 'ok' : 'no'}">${a.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
        <td class="cell-sub nowrap">${esc(fmtTanggal(a.last_login_at))}</td>
        <td class="t-right"><div class="row-actions" style="justify-content:flex-end">
          <button class="btn btn-outline btn-xs" data-ad-edit="${a.id}">Ubah</button>
          ${a.saya ? '' : `<button class="btn btn-danger btn-xs" data-ad-del="${a.id}" data-nama="${esc(a.username)}">Hapus</button>`}
        </div></td>
      </tr>`
      )
      .join('');

    $$('#adTableBody [data-ad-edit]').forEach((b) =>
      b.addEventListener('click', () =>
        openAdminEdit(data.data.find((x) => x.id === Number(b.dataset.adEdit)))
      )
    );
    $$('#adTableBody [data-ad-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Hapus akun admin',
          message: `Hapus akun admin <b>${esc(b.dataset.nama)}</b>?`,
          confirmText: 'Ya, hapus',
        });
        if (!ok) return;
        try {
          await api('/api/admin/admins/' + b.dataset.adDel, { method: 'DELETE' });
          toast('Akun admin dihapus.', 'ok');
          await loadAdmins();
        } catch (err) {
          if (err.status !== 401) toast(err.message, 'err');
        }
      })
    );
  }

  function openAdminEdit(a) {
    if (!a) return;
    openModal({
      title: 'Ubah Akun Admin',
      narrow: true,
      body: `<form id="formAdEdit">
          <div class="alert" data-alert></div>
          <div class="field"><label>Username</label>
            <input class="input" value="${esc(a.username)}" disabled /></div>
          <div class="field"><label>Nama</label>
            <input class="input" name="nama" value="${esc(a.nama)}" />
            <div class="field-error" data-for="nama"></div></div>
          <div class="field"><label>Email</label>
            <input class="input" type="email" name="email" value="${esc(a.email || '')}" /></div>
          <div class="field"><label>Peran</label>
            <select class="select" name="role">
              <option value="ADMIN" ${a.role !== 'SUPERADMIN' ? 'selected' : ''}>Admin</option>
              <option value="SUPERADMIN" ${a.role === 'SUPERADMIN' ? 'selected' : ''}>Super Admin</option>
            </select></div>
          <div class="field">
            <label class="switch">
              <input type="checkbox" name="is_active" ${a.is_active ? 'checked' : ''} />
              <span class="track"></span><span class="switch-label">Akun aktif</span>
            </label>
          </div>
          <div class="field">
            <label class="switch">
              <input type="checkbox" name="reset_password" />
              <span class="track"></span><span class="switch-label">Reset password (buat password baru)</span>
            </label>
          </div>
        </form>`,
      footer:
        '<button class="btn btn-outline" data-close>Batal</button>' +
        '<button class="btn btn-primary" id="adEditSave">Simpan</button>',
    });
    $('#modalFoot [data-close]').addEventListener('click', closeModal);

    $('#adEditSave').addEventListener('click', async () => {
      const form = $('#formAdEdit');
      clearErrors(form);
      const btn = $('#adEditSave');
      const payload = {
        nama: form.elements.nama.value,
        email: form.elements.email.value,
        role: form.elements.role.value,
        is_active: form.elements.is_active.checked ? '1' : '0',
        reset_password: form.elements.reset_password.checked ? '1' : '0',
      };
      busy(btn, true);
      try {
        const res = await api('/api/admin/admins/' + a.id, { method: 'PATCH', json: payload });
        if (res.password) {
          showCredential('Password Baru Admin', a.username, res.password, res.message);
        } else {
          closeModal();
          toast(res.message, 'ok');
        }
        await loadAdmins();
      } catch (err) {
        showFieldErrors(form, err.fields);
        showAlert(form, err.message, 'error');
        busy(btn, false);
      }
    });
  }

  $('#adTambah').addEventListener('click', () => {
    openModal({
      title: 'Tambah Akun Admin',
      narrow: true,
      body: `<form id="formAdAdd">
          <div class="alert" data-alert></div>
          <div class="field"><label>Username *</label>
            <input class="input" name="username" placeholder="mis. operator1" spellcheck="false" />
            <div class="hint">4–32 karakter: huruf kecil, angka, titik, garis bawah, strip.</div>
            <div class="field-error" data-for="username"></div></div>
          <div class="field"><label>Nama</label>
            <input class="input" name="nama" placeholder="Nama tampilan" /></div>
          <div class="field"><label>Email</label>
            <input class="input" type="email" name="email" /></div>
          <div class="field"><label>Peran</label>
            <select class="select" name="role">
              <option value="ADMIN">Admin</option>
              <option value="SUPERADMIN">Super Admin</option>
            </select></div>
          <p class="cell-sub">Password dibuat otomatis dan ditampilkan sekali.</p>
        </form>`,
      footer:
        '<button class="btn btn-outline" data-close>Batal</button>' +
        '<button class="btn btn-primary" id="adAddSave">Buat Akun</button>',
    });
    $('#modalFoot [data-close]').addEventListener('click', closeModal);

    $('#adAddSave').addEventListener('click', async () => {
      const form = $('#formAdAdd');
      clearErrors(form);
      const btn = $('#adAddSave');
      const payload = {};
      for (const el of form.elements) if (el.name) payload[el.name] = el.value;
      busy(btn, true, 'Membuat…');
      try {
        const res = await api('/api/admin/admins', { method: 'POST', json: payload });
        showCredential('Akun Admin Dibuat', payload.username, res.password, res.message);
        await loadAdmins();
      } catch (err) {
        showFieldErrors(form, err.fields);
        showAlert(form, err.message, 'error');
        busy(btn, false);
      }
    });
  });

  /* ================================================================
   *  LOG AKTIVITAS
   * ================================================================ */
  async function loadLog(page = 1) {
    const tbody = $('#lTableBody');
    tbody.innerHTML =
      '<tr><td colspan="6"><div class="loading-center"><span class="spinner dark"></span> Memuat…</div></td></tr>';
    const data = await api(
      '/api/admin/activity?' +
        buildQuery({ page, q: $('#lSearch').value.trim(), actor_type: $('#lType').value })
    );

    tbody.innerHTML = data.data.length
      ? data.data
          .map(
            (a) => `<tr>
          <td class="cell-sub nowrap">${esc(fmtTanggal(a.created_at))}</td>
          <td><span class="badge mute">${esc(a.actor_type)}</span> ${esc(a.actor_nama || '–')}</td>
          <td class="cell-main">${esc(a.aksi.replace(/_/g, ' '))}</td>
          <td class="cell-sub">${esc(a.entitas || '–')}${a.entitas_id ? ' #' + a.entitas_id : ''}</td>
          <td class="cell-sub">${esc(a.detail || '–')}</td>
          <td class="cell-sub mono">${esc(a.ip || '–')}</td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="6"><div class="empty-state"><div class="ic">🕘</div><b>Belum ada log</b></div></td></tr>';

    renderPagination($('#lPagination'), data.page, data.totalPages, data.total, loadLog);
  }

  let lTimer = null;
  $('#lSearch').addEventListener('input', () => {
    clearTimeout(lTimer);
    lTimer = setTimeout(
      () => loadLog(1).catch((err) => err.status !== 401 && toast(err.message, 'err')),
      350
    );
  });
  $('#lType').addEventListener('change', () =>
    loadLog(1).catch((err) => err.status !== 401 && toast(err.message, 'err'))
  );
  $('#lClear').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Bersihkan log',
      message: 'Hapus semua log aktivitas yang lebih tua dari 30 hari?',
      confirmText: 'Ya, bersihkan',
    });
    if (!ok) return;
    try {
      const res = await api('/api/admin/activity?older_than_days=30', { method: 'DELETE' });
      toast(`${res.deleted} baris log dihapus.`, 'ok');
      await loadLog(1);
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'err');
    }
  });

  /* ================================================================
   *  KESEHATAN SISTEM
   * ================================================================ */
  async function loadHealth() {
    const el = $('#sysBody');
    el.innerHTML = '<div class="loading-center"><span class="spinner dark"></span> Memuat…</div>';
    const h = await api('/api/admin/health');

    const gudang = h.database.penyimpanan_gambar.length
      ? h.database.penyimpanan_gambar
          .map(
            (f) =>
              `<div class="row"><span>${esc(f.scope)}</span><span>${fmtNum(f.jumlah)} file · ${f.ukuran_mb} MB</span></div>`
          )
          .join('')
      : '<div class="row"><span>Belum ada gambar</span><span>–</span></div>';

    el.innerHTML = `
      <div class="cards-2">
        <div class="card">
          <h3>🗄️ Basis Data</h3>
          <div class="kv-list">
            <div class="row"><span>Status</span><span><span class="badge ok">Terhubung</span></span></div>
            <div class="row"><span>Mode</span><span>${esc(h.database.mode)}</span></div>
            <div class="row"><span>Pendaftar</span><span>${fmtNum(h.database.pendaftar)}</span></div>
            <div class="row"><span>Affiliator</span><span>${fmtNum(h.database.affiliator)}</span></div>
            <div class="row"><span>Akun admin</span><span>${fmtNum(h.database.admin)}</span></div>
            <div class="row"><span>Baris log</span><span>${fmtNum(h.database.baris_log)}</span></div>
          </div>
        </div>
        <div class="card">
          <h3>⚙️ Konfigurasi</h3>
          <div class="kv-list">
            <div class="row"><span>JWT_SECRET dari environment</span>
              <span><span class="badge ${h.konfigurasi.jwt_secret_dari_env ? 'ok' : 'wait'}">${h.konfigurasi.jwt_secret_dari_env ? 'Ya' : 'Dibuat otomatis'}</span></span></div>
            <div class="row"><span>Admin dari environment</span>
              <span><span class="badge ${h.konfigurasi.admin_dari_env ? 'ok' : 'mute'}">${h.konfigurasi.admin_dari_env ? 'Ya' : 'Tidak'}</span></span></div>
            <div class="row"><span>NODE_ENV</span><span>${esc(h.konfigurasi.node_env)}</span></div>
            <div class="row"><span>Berjalan di Vercel</span><span>${h.konfigurasi.vercel ? 'Ya' : 'Tidak'}</span></div>
            <div class="row"><span>Waktu server (UTC)</span><span>${esc(h.waktu_server)}</span></div>
            <div class="row"><span>Tanggal (WIB)</span><span>${esc(h.tanggal_jakarta)}</span></div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>🖼️ Penyimpanan Gambar</h3>
        <p class="desc">Gambar disimpan sebagai base64 di database (bukti pembayaran, logo, favicon, QRIS).</p>
        <div class="kv-list">${gudang}</div>
      </div>`;
  }
  $('#sysRefresh').addEventListener('click', () =>
    loadHealth().catch((err) => err.status !== 401 && toast(err.message, 'err'))
  );

  /* ================================================================
   *  BOOT
   * ================================================================ */
  (async function boot() {
    // Branding diterapkan lebih dulu supaya layar login sudah memakai logo & favicon
    window.WNA.initBranding().then((info) => {
      if (info) siteInfo = info;
    });
    try {
      const data = await api('/api/auth/me', { silentAuth: true });
      await showApp(data.admin);
    } catch {
      showLogin();
    }
  })();
})();
