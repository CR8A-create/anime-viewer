// ============================================================
// AUTH — usuarios simples (usuario + contraseña + edad)
// ------------------------------------------------------------
// Sin emails ni datos privados: login "anónimo sin serlo".
// - Contraseñas: scrypt (crypto nativo de Node, sin dependencias).
// - Sesión: token firmado con HMAC-SHA256 (formato payload.firma),
//   secreto = env AUTH_SECRET o derivado de FIREBASE_PRIVATE_KEY.
// - Los datos del usuario viven en Firestore (colección "users",
//   id del doc = username en minúsculas).
// ============================================================
const crypto = require('crypto');

const SECRET = process.env.AUTH_SECRET
    || (process.env.FIREBASE_PRIVATE_KEY
        ? crypto.createHash('sha256').update(process.env.FIREBASE_PRIVATE_KEY).digest('hex')
        : 'aninova-dev-secret-local');

const TOKEN_DAYS = 180;

// ---- contraseñas (scrypt) ----
function hashPassword(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
    return `${salt}$${hash}`;
}
function checkPassword(pw, stored) {
    const [salt, hash] = String(stored || '').split('$');
    if (!salt || !hash) return false;
    const calc = crypto.scryptSync(String(pw), salt, 32).toString('hex');
    try { return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex')); }
    catch { return false; }
}

// ---- tokens ----
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

function signToken(user) {
    const payload = { u: user.id, n: user.username, exp: Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000 };
    const body = b64url(JSON.stringify(payload));
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}

/** Devuelve { u, n, exp } o null si el token es inválido/expirado. */
function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    } catch { return null; }
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (!payload.u || !payload.exp || Date.now() > payload.exp) return null;
        return payload;
    } catch { return null; }
}

/** Extrae y verifica el token del header Authorization: Bearer. */
function authFromRequest(req) {
    const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? verifyToken(m[1]) : null;
}

// ---- validación de registro ----
function validateUsername(u) {
    if (typeof u !== 'string') return 'Usuario requerido';
    const t = u.trim();
    if (t.length < 3 || t.length > 20) return 'El usuario debe tener entre 3 y 20 caracteres';
    if (!/^[a-zA-Z0-9_.-]+$/.test(t)) return 'Solo letras, números y . _ - (sin espacios)';
    return null;
}
function validatePassword(p) {
    if (typeof p !== 'string' || p.length < 6) return 'La contraseña debe tener al menos 6 caracteres';
    if (p.length > 100) return 'Contraseña demasiado larga';
    return null;
}
function validateAge(a) {
    const n = parseInt(a, 10);
    if (!Number.isFinite(n) || n < 5 || n > 120) return 'Edad no válida';
    return null;
}

module.exports = {
    hashPassword, checkPassword,
    signToken, verifyToken, authFromRequest,
    validateUsername, validatePassword, validateAge,
};
