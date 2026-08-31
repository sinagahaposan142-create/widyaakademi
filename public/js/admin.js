/* Widya Nusantara Academy — Admin Dashboard logic */
(function () {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  const STATUS_LABEL = {
    MENUNGGU_VERIFIKASI: { text: 'Menunggu', cls: 'wait' },
    TERVERIFIKASI: { text: 'Terverifikasi', cls: 'ok' },
    DITOLAK: { text: 'Ditolak', cls: 'no' },
  };

  const fmtRp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
    );
  const fmtDate = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };

  // ---- Toast ----
  let toastTimer;
  function toast(msg, isErr = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = 'toast'), 2800);
  }

  // ---- Token storage (fallback bila cookie diblokir hosting/browser) ----
  const TOKEN_KEY = 'widya_admin_token';
  const getToken = () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  };
  const setToken = (t) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
  };

  // ---- API helper ----
  async function api(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, { credentials: 'same-origin', ...opts, headers });
    if (res.status === 401) {
      setToken(null);
      showLogin();
      throw new Error('unauthorized');
    }
    return res;
  }

  // =====================================================
  // AUTH
  // =====================================================
  const loginView = $('#loginView');
  const app = $('#app');

  function showLogin() {
    loginView.style.display = 'grid';
    app.classList.remove('show');
  }
  function showApp(admin) {
    loginView.style.display = 'none';
    app.classList.add('show');
    $('#whoami').textContent = admin ? `👤 ${admin.nama || admin.username}` : '';
    loadStats();
    loadRegistrations();
  }

  // check session (kirim token bila ada)
  (function checkSession() {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    fetch('/api/auth/me', { credentials: 'same-origin', headers })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => showApp(d.admin))
      .catch(() => showLogin());
  })();

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alert = $('#loginAlert');
    alert.classList.remove('show');
    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Masuk...';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          username: e.target.username.value,
          password: e.target.password.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert.textContent = data.error || 'Login gagal.';
        alert.classList.add('show');
        return;
      }
      if (data.token) setToken(data.token);
      showApp(data.admin);
    } catch {
      alert.textContent = 'Gagal terhubung ke server.';
      alert.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Masuk';
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    setToken(null);
    showLogin();
  });

  // =====================================================
  // TABS
  // =====================================================
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('active'));
      $$('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('#panel-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'qris') loadQris();
      if (tab.dataset.tab === 'pengaturan') loadSettings();
    });
  });

  // =====================================================
  // STATS
  // =====================================================
  async function loadStats() {
    try {
      const res = await api('/api/admin/stats');
      const s = await res.json();
      $('#stTotal').textContent = s.total;
      $('#stWait').textContent = s.by_status.MENUNGGU_VERIFIKASI || 0;
      $('#stOk').textContent = s.by_status.TERVERIFIKASI || 0;
      $('#stKuota').textContent = `${s.kuota_terisi} / ${s.kuota_total}`;
      const pct = s.kuota_total ? Math.min(100, (s.kuota_terisi / s.kuota_total) * 100) : 0;
      $('#stBar').style.width = pct + '%';
    } catch {}
  }

  // =====================================================
  // REGISTRATIONS TABLE
  // =====================================================
  let currentPage = 1;
  let searchTimer;

  async function loadRegistrations(page = 1) {
    currentPage = page;
    const q = $('#searchBox').value.trim();
    const status = $('#statusFilter').value;
    const params = new URLSearchParams({ page, pageSize: 20 });
    if (q) params.set('q', q);
    if (status) params.set('status', status);

    const tbody = $('#tableBody');
    tbody.innerHTML =
      '<tr><td colspan="7"><div class="loading-center"><span class="spinner dark"></span> Memuat...</div></td></tr>';

    try {
      const res = await api('/api/admin/registrations?' + params.toString());
      const data = await res.json();
      renderTable(data);
    } catch {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty">Gagal memuat data.</div></td></tr>';
    }
  }

  function renderTable(data) {
    const tbody = $('#tableBody');
    if (!data.data.length) {
      tbody.innerHTML =
        '<tr><td colspan="7"><div class="empty"><div class="ic">📭</div>Belum ada data pendaftar.</div></td></tr>';
      $('#pagination').innerHTML = '';
      return;
    }
    tbody.innerHTML = data.data
      .map((r) => {
        const st = STATUS_LABEL[r.status] || { text: r.status, cls: 'wait' };
        const wa = (r.nomor_wa || '').replace(/\D/g, '');
        const waIntl = wa.startsWith('0') ? '62' + wa.slice(1) : wa;
        return `<tr>
          <td>
            <div class="name">${esc(r.nama_lengkap)}</div>
            <div class="sub">${esc(r.asal_sekolah)}</div>
          </td>
          <td>${esc(r.status_pendidikan)}</td>
          <td>
            <div><a href="https://wa.me/${waIntl}" target="_blank" style="color:var(--blue)">${esc(r.nomor_wa)}</a></div>
            <div class="sub">${esc(r.gmail)}</div>
          </td>
          <td>${r.referral ? esc(r.referral) : '<span class="sub">—</span>'}</td>
          <td class="sub">${fmtDate(r.created_at)}</td>
          <td><span class="badge ${st.cls}">${st.text}</span></td>
          <td>
            <div class="row-actions">
              <button class="btn btn-light btn-sm" data-detail="${r.id}">Detail</button>
            </div>
          </td>
        </tr>`;
      })
      .join('');

    $$('[data-detail]', tbody).forEach((b) =>
      b.addEventListener('click', () => openDetail(b.dataset.detail))
    );

    // pagination
    const { page, totalPages, total } = data;
    let pg = `<div class="info">Menampilkan ${data.data.length} dari ${total} pendaftar</div><div class="pages">`;
    pg += `<button class="btn btn-light btn-sm" ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">‹ Prev</button>`;
    pg += `<span style="padding:7px 12px;font-size:.85rem;color:var(--muted)">Hal ${page} / ${totalPages || 1}</span>`;
    pg += `<button class="btn btn-light btn-sm" ${page >= totalPages ? 'disabled' : ''} data-page="${page + 1}">Next ›</button>`;
    pg += '</div>';
    $('#pagination').innerHTML = pg;
    $$('#pagination [data-page]').forEach((b) =>
      b.addEventListener('click', () => loadRegistrations(parseInt(b.dataset.page, 10)))
    );
  }

  $('#searchBox').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadRegistrations(1), 350);
  });
  $('#statusFilter').addEventListener('change', () => loadRegistrations(1));

  // ---- Export ----
  $('#exportBtn').addEventListener('click', async () => {
    try {
      const res = await api('/api/admin/export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pendaftar-widya-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('CSV berhasil diunduh');
    } catch {
      toast('Gagal mengunduh CSV', true);
    }
  });

  // =====================================================
  // DETAIL MODAL
  // =====================================================
  const modal = $('#detailModal');
  function closeModal() { modal.classList.remove('show'); }
  $('#modalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  async function openDetail(id) {
    modal.classList.add('show');
    const body = $('#modalBody');
    body.innerHTML = '<div class="loading-center"><span class="spinner dark"></span> Memuat...</div>';
    try {
      const res = await api('/api/admin/registrations/' + id);
      const r = await res.json();
      const st = STATUS_LABEL[r.status] || { text: r.status, cls: 'wait' };
      const wa = (r.nomor_wa || '').replace(/\D/g, '');
      const waIntl = wa.startsWith('0') ? '62' + wa.slice(1) : wa;

      body.innerHTML = `
        <div class="detail-grid">
          <div class="detail-item full"><div class="k">Nama Lengkap</div><div class="v">${esc(r.nama_lengkap)}</div></div>
          <div class="detail-item"><div class="k">Asal Sekolah</div><div class="v">${esc(r.asal_sekolah)}</div></div>
          <div class="detail-item"><div class="k">Tanggal Lahir</div><div class="v">${esc(r.tanggal_lahir)}</div></div>
          <div class="detail-item"><div class="k">Status Pendidikan</div><div class="v">${esc(r.status_pendidikan)}</div></div>
          <div class="detail-item"><div class="k">Nomor WhatsApp</div><div class="v"><a href="https://wa.me/${waIntl}" target="_blank" style="color:var(--blue)">${esc(r.nomor_wa)}</a></div></div>
          <div class="detail-item"><div class="k">Instagram</div><div class="v">${r.instagram ? '@' + esc(r.instagram) : '—'}</div></div>
          <div class="detail-item"><div class="k">Gmail</div><div class="v">${esc(r.gmail)}</div></div>
          <div class="detail-item"><div class="k">Referral</div><div class="v">${r.referral ? esc(r.referral) : '—'}</div></div>
          <div class="detail-item"><div class="k">Nominal Transfer</div><div class="v">${r.nominal_transfer ? esc(r.nominal_transfer) : '—'}</div></div>
          <div class="detail-item"><div class="k">Tanggal Daftar</div><div class="v">${fmtDate(r.created_at)}</div></div>
          <div class="detail-item"><div class="k">Status</div><div class="v"><span class="badge ${st.cls}">${st.text}</span></div></div>
        </div>

        <div class="detail-item full">
          <div class="k">Bukti Pembayaran</div>
          <div class="bukti-box" id="buktiBox">
            ${r.bukti_filename
              ? '<div class="bukti-none"><span class="spinner dark"></span> Memuat bukti...</div>'
              : '<div class="bukti-none">Belum ada bukti pembayaran diunggah.</div>'}
          </div>
        </div>

        <div style="margin-top:20px">
          <div class="k" style="font-size:.76rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:8px">Ubah Status</div>
          <div class="status-actions">
            <button class="btn btn-success btn-sm" data-set="TERVERIFIKASI">✓ Verifikasi</button>
            <button class="btn btn-light btn-sm" data-set="MENUNGGU_VERIFIKASI">↺ Menunggu</button>
            <button class="btn btn-danger btn-sm" data-set="DITOLAK">✕ Tolak</button>
          </div>
          <div style="margin-top:14px">
            <label style="font-size:.82rem;font-weight:700;color:var(--navy);display:block;margin-bottom:6px">Catatan Admin (opsional)</label>
            <textarea class="input" id="catatanAdmin" rows="2" placeholder="Catatan internal...">${esc(r.catatan_admin || '')}</textarea>
          </div>
          <div style="margin-top:16px;display:flex;justify-content:space-between;gap:10px">
            <button class="btn btn-danger btn-sm" data-delete="${r.id}">🗑️ Hapus Data</button>
          </div>
        </div>
      `;

      $$('[data-set]', body).forEach((b) =>
        b.addEventListener('click', () => setStatus(r.id, b.dataset.set))
      );
      $('[data-delete]', body).addEventListener('click', () => deleteReg(r.id));

      // Muat gambar bukti via fetch berautentikasi (mendukung cookie & Bearer token)
      if (r.bukti_filename) {
        api('/api/admin/registrations/' + r.id + '/bukti')
          .then((res) => (res.ok ? res.blob() : Promise.reject()))
          .then((blob) => {
            const box = $('#buktiBox');
            if (!box) return;
            const objUrl = URL.createObjectURL(blob);
            box.innerHTML = `<img src="${objUrl}" alt="Bukti pembayaran" style="cursor:zoom-in" />`;
            box.querySelector('img').addEventListener('click', () => window.open(objUrl, '_blank'));
          })
          .catch(() => {
            const box = $('#buktiBox');
            if (box) box.innerHTML = '<div class="bukti-none">Gagal memuat bukti pembayaran.</div>';
          });
      }
    } catch {
      body.innerHTML = '<div class="empty">Gagal memuat detail.</div>';
    }
  }

  async function setStatus(id, status) {
    const catatan = $('#catatanAdmin')?.value || '';
    try {
      const res = await api('/api/admin/registrations/' + id + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, catatan_admin: catatan }),
      });
      if (!res.ok) throw new Error();
      toast('Status diperbarui');
      closeModal();
      loadStats();
      loadRegistrations(currentPage);
    } catch {
      toast('Gagal memperbarui status', true);
    }
  }

  async function deleteReg(id) {
    if (!confirm('Hapus data pendaftar ini secara permanen? Tindakan ini tidak dapat dibatalkan.')) return;
    try {
      const res = await api('/api/admin/registrations/' + id, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast('Data dihapus');
      closeModal();
      loadStats();
      loadRegistrations(currentPage);
    } catch {
      toast('Gagal menghapus data', true);
    }
  }

  // =====================================================
  // QRIS
  // =====================================================
  async function loadQris() {
    try {
      const res = await fetch('/api/info');
      const info = await res.json();
      const cur = $('#qrisCurrent');
      if (info.qris_tersedia) {
        $('#qrisCurrentImg').src = '/api/qris?t=' + Date.now();
        cur.style.display = 'block';
      } else {
        cur.style.display = 'none';
      }
    } catch {}
  }

  $('#qrisUpload').addEventListener('click', () => $('#qrisInput').click());
  $('#qrisInput').addEventListener('change', async () => {
    const file = $('#qrisInput').files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('qris', file);
    try {
      const res = await api('/api/admin/qris', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast('QRIS berhasil diunggah');
      $('#qrisInput').value = '';
      loadQris();
    } catch (e) {
      toast(e.message || 'Gagal mengunggah QRIS', true);
    }
  });

  $('#qrisDelete').addEventListener('click', async () => {
    if (!confirm('Hapus gambar QRIS?')) return;
    try {
      const res = await api('/api/admin/qris', { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast('QRIS dihapus');
      loadQris();
    } catch {
      toast('Gagal menghapus QRIS', true);
    }
  });

  // =====================================================
  // SETTINGS
  // =====================================================
  async function loadSettings() {
    try {
      const res = await api('/api/admin/settings');
      const s = await res.json();
      const form = $('#settingsForm');
      Object.keys(s).forEach((k) => {
        if (form.elements[k]) form.elements[k].value = s[k];
      });
    } catch {}
  }

  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#settingsBtn');
    btn.disabled = true;
    const payload = {};
    new FormData(e.target).forEach((v, k) => (payload[k] = v));
    try {
      const res = await api('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      toast('Pengaturan disimpan');
      loadStats();
    } catch {
      toast('Gagal menyimpan pengaturan', true);
    } finally {
      btn.disabled = false;
    }
  });
})();
