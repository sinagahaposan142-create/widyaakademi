/*
 * Widya Nusantara Academy — utilitas bersama (branding + helper).
 * Dipakai oleh landing page, panel admin, dan dashboard affiliator.
 *
 * Logo dan favicon dikelola dari panel admin: jika admin mengunggah gambar,
 * semua elemen [data-logo] dan ikon tab browser otomatis memakai gambar itu.
 */
(function () {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /** Escape teks agar aman dimasukkan ke innerHTML. */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const fmtRp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const fmtNum = (n) => Number(n || 0).toLocaleString('id-ID');

  function fmtTanggal(iso, withTime = true) {
    if (!iso) return '–';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
  }

  /** Nomor WA -> tautan wa.me. */
  function waLink(nomor) {
    const s = String(nomor || '').replace(/\D/g, '');
    if (!s) return '#';
    return 'https://wa.me/' + (s.startsWith('0') ? '62' + s.slice(1) : s);
  }

  /** Ganti ikon tab browser (favicon) dengan URL dari server. */
  function setFavicon(url) {
    if (!url) return;
    $$('link[rel~="icon"]').forEach((l) => l.remove());
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = url;
    document.head.appendChild(link);

    // iOS/Android home-screen icon
    const apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    apple.href = url;
    document.head.appendChild(apple);
  }

  /**
   * Terapkan branding ke halaman.
   * - [data-logo]        : kotak logo (diganti <img> bila admin mengunggah logo)
   * - [data-brand="key"] : isi teks dari field /api/info
   * - [data-title]       : pola judul dokumen, {nama} diganti nama situs
   */
  function applyBranding(info) {
    if (!info) return;

    if (info.favicon_url) setFavicon(info.favicon_url);

    $$('[data-logo]').forEach((el) => {
      if (info.logo_url) {
        el.innerHTML = `<img src="${esc(info.logo_url)}" alt="${esc(info.nama_situs || 'Logo')}" />`;
        el.classList.add('has-img');
      } else {
        el.textContent = info.logo_teks || 'W';
        el.classList.remove('has-img');
      }
    });

    $$('[data-brand]').forEach((el) => {
      const key = el.getAttribute('data-brand');
      if (key in info && info[key] != null && info[key] !== '') {
        el.textContent = info[key];
      }
    });

    const titleEl = $('[data-title]');
    if (titleEl && info.nama_situs) {
      document.title = titleEl.getAttribute('data-title').replace('{nama}', info.nama_situs);
    }
  }

  /**
   * Baca respons API secara defensif.
   * Vercel dapat mengembalikan halaman HTML/teks saat function gagal sebelum
   * Express berjalan. Jangan ubah respons seperti itu menjadi pesan kosong;
   * tampilkan status + request ID yang dapat ditelusuri tanpa membocorkan body.
   */
  async function readJsonResponse(res, context = 'API') {
    const raw = await res.text();
    let body = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }
    if (body && typeof body === 'object') return body;

    const requestId = res.headers.get('x-vercel-id') || res.headers.get('x-request-id') || '';
    const suffix = requestId ? ` ID: ${requestId}.` : '';
    const message = res.ok
      ? `${context} mengembalikan respons tidak valid (HTTP ${res.status}).${suffix}`
      : `Layanan server bermasalah (HTTP ${res.status}). Muat ulang lalu coba kembali.${suffix}`;

    // Body hanya ke console pengembang, dipotong agar halaman error besar tidak
    // memenuhi memori. Tidak pernah ditampilkan sebagai HTML ke pengguna.
    console.error(`[WNA] ${context} non-JSON`, {
      status: res.status,
      contentType: res.headers.get('content-type'),
      requestId,
      preview: raw.slice(0, 300),
    });
    return { error: message, code: 'INVALID_API_RESPONSE', request_id: requestId };
  }

  /** Ambil /api/info. Melempar error rinci bila gagal / respons bukan JSON. */
  async function fetchInfo() {
    const res = await fetch('/api/info', {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const body = await readJsonResponse(res, 'Informasi situs');
    if (!res.ok || body.code === 'INVALID_API_RESPONSE') {
      throw new Error(body.error || `Gagal memuat informasi situs (HTTP ${res.status}).`);
    }
    return body;
  }

  /** Muat info lalu terapkan branding; mengembalikan info (atau null bila gagal). */
  async function initBranding() {
    try {
      const info = await fetchInfo();
      applyBranding(info);
      return info;
    } catch {
      applyBranding({ logo_teks: 'W' });
      return null;
    }
  }

  window.WNA = {
    $,
    $$,
    esc,
    fmtRp,
    fmtNum,
    fmtTanggal,
    waLink,
    setFavicon,
    applyBranding,
    readJsonResponse,
    fetchInfo,
    initBranding,
  };
})();
