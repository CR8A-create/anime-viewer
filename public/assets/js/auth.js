// ============================================================
// AUTH (frontend) — sesión de usuario simple
// ------------------------------------------------------------
// Guarda { token, username, age } en localStorage (anv_auth).
// API global: window.Auth
//   user()            → { username, age } | null
//   token()           → string | null
//   register(u,p,age) / login(u,p) → Promise (lanza Error con mensaje)
//   logout()
//   headers()         → cabecera Authorization si hay sesión
//   syncPush(data) / syncPull() → sincroniza "Mi Lista" con la nube
// ============================================================
(function () {
    const K = 'anv_auth';
    const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://pagina-ver-anime.vercel.app/api';

    function read() {
        try { return JSON.parse(localStorage.getItem(K)) || null; } catch { return null; }
    }
    function save(s) { localStorage.setItem(K, JSON.stringify(s)); }

    function user() { const s = read(); return s ? { username: s.username, age: s.age } : null; }
    function token() { const s = read(); return s ? s.token : null; }

    function headers() {
        const t = token();
        return t ? { 'Authorization': `Bearer ${t}` } : {};
    }

    async function call(path, body) {
        const res = await fetch(`${API}/auth/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers() },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || 'Error de conexión');
        return data;
    }

    async function register(username, password, age) {
        const data = await call('register', { username, password, age });
        save({ token: data.token, username: data.user.username, age: data.user.age });
        return data.user;
    }

    async function login(username, password) {
        const data = await call('login', { username, password });
        save({ token: data.token, username: data.user.username, age: data.user.age });
        return data.user;
    }

    function logout() { localStorage.removeItem(K); }

    // ---- Sincronización de "Mi Lista" ----
    async function syncPush(data) {
        if (!token()) return false;
        try {
            const res = await fetch(`${API}/auth/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers() },
                body: JSON.stringify({ data }),
            });
            return res.ok;
        } catch { return false; }
    }

    async function syncPull() {
        if (!token()) return null;
        try {
            const res = await fetch(`${API}/auth/sync`, { headers: headers() });
            const data = await res.json();
            return (data.success && data.data) ? data.data : null;
        } catch { return null; }
    }

    window.Auth = { user, token, register, login, logout, headers, syncPush, syncPull, API };
})();
