// ============================================
// OSM OAuth2 PKCE — KEHarita OSM Entegrasyonu
// ============================================
// apps.openstreetmap.org adresinden uygulama
// kaydederek CLIENT_ID alınır.
// Redirect URI: https://keharita.app/osm-callback
// ============================================

const OSM_AUTH = (() => {

  const CONFIG = {
    clientId:    'fjnwUVmRp5E_NC4abf7IsW2nSInyPIIIuII8j9UXdQ',
    authUrl:     'https://www.openstreetmap.org/oauth2/authorize',
    redirectUri: 'https://keharita.app/osm-callback',
    scope:       'read_prefs write_api',
    proxyBase:   'https://keharita.toolforge.org',  // mevcut Cloudflare Worker proxy
  };

  // ── Yardımcı: PKCE ──────────────────────────────────────────
  function randomBase64url(byteCount) {
    const arr = new Uint8Array(byteCount);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function sha256Base64url(plain) {
    const enc  = new TextEncoder().encode(plain);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // ── Login ────────────────────────────────────────────────────
  async function login() {
    const verifier  = randomBase64url(32);
    const challenge = await sha256Base64url(verifier);
    const state     = randomBase64url(16);

    localStorage.setItem('osm_code_verifier', verifier);
    localStorage.setItem('osm_state',         state);

    const params = new URLSearchParams({
      response_type:         'code',
      client_id:             CONFIG.clientId,
      redirect_uri:          CONFIG.redirectUri,
      scope:                 CONFIG.scope,
      state:                 state,
      code_challenge:        challenge,
      code_challenge_method: 'S256',
    });

    window.location.href = `${CONFIG.authUrl}?${params}`;
  }

  // ── Token Exchange (proxy üzerinden — CORS kısıtı nedeniyle) ─
  async function handleCallback(code, returnedState) {
    const savedState  = localStorage.getItem('osm_state');
    const verifier    = localStorage.getItem('osm_code_verifier');

    // CSRF koruması: state doğrula
    if (!savedState || savedState !== returnedState) {
      throw new Error('OSM OAuth: state uyuşmazlığı — olası CSRF saldırısı.');
    }

    localStorage.removeItem('osm_state');
    localStorage.removeItem('osm_code_verifier');

    // keharita.toolforge.org'a eklenmesi gereken endpoint: POST /osm-token
    const res = await fetch(`${CONFIG.proxyBase}/osm-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        redirect_uri:  CONFIG.redirectUri,
        client_id:     CONFIG.clientId,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token alınamadı: ${err}`);
    }

    const data = await res.json();
    // {access_token, token_type, scope, created_at}

    // Kullanıcı bilgisini çek
    const profile = await fetchProfile(data.access_token);

    const osmUser = {
      username:    profile.display_name,
      userId:      String(profile.id),
      accessToken: data.access_token,
      loggedInAt:  Date.now(),
    };

    localStorage.setItem('osm_user', JSON.stringify(osmUser));
    return osmUser;
  }

  // ── Kullanıcı Profili ────────────────────────────────────────
  // OSM API direkt CORS'u destekler (okuma için)
  async function fetchProfile(token) {
    const res = await fetch('https://api.openstreetmap.org/api/0.6/user/details.json', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('OSM profil alınamadı');
    const data = await res.json();
    return data.user;
  }

  // ── Oturum Yönetimi ──────────────────────────────────────────
  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('osm_user') || 'null');
    } catch {
      return null;
    }
  }

  function isLoggedIn() {
    return getUser() !== null;
  }

  function logout() {
    localStorage.removeItem('osm_user');
    updateLoginButton();
  }

  // ── UI: Login Butonu Güncelle ────────────────────────────────
  function updateLoginButton() {
    const btn = document.getElementById('osmLoginButton');
    if (!btn) return;
    const user = getUser();
    if (user) {
      btn.textContent = `OSM: ${user.username}`;
      btn.style.background = 'linear-gradient(135deg, #27ae60 0%, #1e8449 100%)';
      btn.onclick = () => {
        if (confirm(`OSM çıkış: ${user.username}?`)) logout();
      };
    } else {
      btn.textContent = 'OSM Girişi';
      btn.style.background = 'linear-gradient(135deg, #e67e22 0%, #ca6f1e 100%)';
      btn.onclick = login;
    }
  }

  // ── Public API ───────────────────────────────────────────────
  return { login, handleCallback, getUser, isLoggedIn, logout, updateLoginButton };

})();

// Sayfa yüklenince butonu güncelle
document.addEventListener('DOMContentLoaded', () => OSM_AUTH.updateLoginButton());
