// ============================================================
// API DE CUENTAS — registro, login y sincronización de listas
// ------------------------------------------------------------
// Cuentas "anónimas sin serlo": usuario + contraseña + edad.
// No se pide email ni ningún dato personal más. La edad se
// guarda para funciones futuras (filtrado por edad).
//
// Endpoints:
//   POST /api/auth/register  { username, password, age }
//   POST /api/auth/login     { username, password }
//   GET  /api/auth/me                      (Bearer token)
//   GET  /api/auth/sync                    (Bearer token) → listas guardadas
//   POST /api/auth/sync      { data }      (Bearer token) → guarda listas
// ============================================================
const { cors } = require('../_lib/shared');
const fb = require('../_lib/firebase');
const auth = require('../_lib/auth');

// Rate limit básico por IP (por instancia caliente)
const rl = new Map();
function limited(ip, key, ms) {
    const k = `${key}:${ip}`;
    const last = rl.get(k);
    if (last && Date.now() - last < ms) return true;
    rl.set(k, Date.now());
    return false;
}

module.exports = async (req, res) => {
    if (cors(req, res)) return;
    const path = req.query.path || [];
    const action = path[0] || req.url.split('?')[0].split('/').filter(Boolean).pop();
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';

    try {
        // ---------- REGISTRO ----------
        if (action === 'register' && req.method === 'POST') {
            const { username, password, age } = req.body || {};
            const err = auth.validateUsername(username) || auth.validatePassword(password) || auth.validateAge(age);
            if (err) return res.status(400).json({ success: false, message: err });
            if (limited(ip, 'reg', 30000)) return res.status(429).json({ success: false, message: 'Espera un momento antes de intentarlo de nuevo' });

            const uname = username.trim();
            const id = uname.toLowerCase();
            if (await fb.getUser(id)) {
                return res.status(409).json({ success: false, message: 'Ese nombre de usuario ya existe' });
            }
            const user = await fb.createUser(id, {
                username: uname,
                passwordHash: auth.hashPassword(password),
                age: parseInt(age, 10),
                createdAt: new Date().toISOString(),
            });
            const token = auth.signToken({ id, username: uname });
            return res.json({ success: true, token, user: { username: user.username, age: user.age } });
        }

        // ---------- LOGIN ----------
        if (action === 'login' && req.method === 'POST') {
            const { username, password } = req.body || {};
            if (!username || !password) return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
            if (limited(ip, 'login', 3000)) return res.status(429).json({ success: false, message: 'Demasiados intentos, espera unos segundos' });

            const id = String(username).trim().toLowerCase();
            const user = await fb.getUser(id);
            if (!user || !auth.checkPassword(password, user.passwordHash)) {
                return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
            }
            const token = auth.signToken({ id, username: user.username });
            return res.json({ success: true, token, user: { username: user.username, age: user.age } });
        }

        // ---------- Rutas con sesión ----------
        const session = auth.authFromRequest(req);

        if (action === 'me' && req.method === 'GET') {
            if (!session) return res.status(401).json({ success: false, message: 'Sesión no válida' });
            const user = await fb.getUser(session.u);
            if (!user) return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
            return res.json({ success: true, user: { username: user.username, age: user.age, createdAt: user.createdAt } });
        }

        if (action === 'sync') {
            if (!session) return res.status(401).json({ success: false, message: 'Sesión no válida' });
            if (req.method === 'GET') {
                const data = await fb.getSyncData(session.u);
                return res.json({ success: true, data: data || null });
            }
            if (req.method === 'POST') {
                const { data } = req.body || {};
                if (!data || typeof data !== 'object') return res.status(400).json({ success: false, message: 'data requerido' });
                // Límite de tamaño defensivo (docs de Firestore: máx 1MB)
                if (JSON.stringify(data).length > 400000) return res.status(413).json({ success: false, message: 'Listas demasiado grandes' });
                await fb.setSyncData(session.u, data);
                return res.json({ success: true });
            }
        }

        return res.status(404).json({ success: false, message: 'Endpoint not found' });
    } catch (e) {
        console.error('Auth API Error:', e.message);
        res.status(500).json({ success: false, message: 'Error interno' });
    }
};
