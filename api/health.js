// Ping barato para el chequeo de conexión del frontend (HEAD/GET /api/health)
const { cors } = require('./_lib/shared');

module.exports = (req, res) => {
    if (cors(req, res)) return;
    res.status(200).json({ ok: true });
};
