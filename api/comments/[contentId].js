const { cors } = require('../_lib/shared');
const { getComments, addComment, deleteComment } = require('../_lib/firebase');
const { authFromRequest } = require('../_lib/auth');

// Random anonymous names
const ANON_NAMES = [
    'Naruto Fan', 'Otaku Oscuro', 'Senpai Anónimo', 'Weeb Silencioso',
    'Ninja del Sofá', 'Samurai sin Nombre', 'Pirata del Streaming',
    'Cazador de Series', 'Shinigami Anónimo', 'Héroe Random',
    'Dragón Nocturno', 'Fantasma del Chat', 'Leyenda Oculta',
    'Titán Anónimo', 'Espíritu Libre', 'Lobo Solitario',
    'Viajero del Tiempo', 'Caballero Oscuro', 'Phoenix Anónimo',
];

function getAnonName() {
    return ANON_NAMES[Math.floor(Math.random() * ANON_NAMES.length)];
}

// Rate limiter (in-memory, per warm instance)
const rateLimiter = new Map();

module.exports = async (req, res) => {
    if (cors(req, res)) return;

    const { contentId } = req.query;
    if (!contentId) return res.status(400).json({ success: false, message: 'contentId required' });

    // GET — list comments
    if (req.method === 'GET') {
        try {
            const comments = await getComments(contentId);
            return res.json({ success: true, comments });
        } catch (err) {
            console.error('Error loading comments:', err.message);
            return res.status(500).json({ success: false, message: 'Error loading comments' });
        }
    }

    // POST — new comment
    if (req.method === 'POST') {
        const { text } = req.body || {};

        if (!text || text.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Comentario vacío' });
        }
        if (text.length > 500) {
            return res.status(400).json({ success: false, message: 'Máximo 500 caracteres' });
        }

        // Rate limit: 1 comment per 30s per IP
        const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
        const lastComment = rateLimiter.get(ip);
        if (lastComment && Date.now() - lastComment < 30000) {
            const wait = Math.ceil((30000 - (Date.now() - lastComment)) / 1000);
            return res.status(429).json({ success: false, message: `Espera ${wait}s para comentar de nuevo` });
        }

        try {
            // Con sesión: firma con el nombre de usuario y guarda el dueño
            // (userId) para poder borrar el comentario después.
            const session = authFromRequest(req);
            const comment = await addComment(contentId, {
                name: session ? session.n : getAnonName(),
                userId: session ? session.u : null,
                text: text.trim().substring(0, 500),
                timestamp: new Date().toISOString(),
            });

            rateLimiter.set(ip, Date.now());
            return res.json({ success: true, comment });
        } catch (err) {
            console.error('Error posting comment:', err.message);
            return res.status(500).json({ success: false, message: 'Error posting comment' });
        }
    }

    // DELETE — solo el autor puede borrar su comentario (?id=commentId)
    if (req.method === 'DELETE') {
        const session = authFromRequest(req);
        if (!session) return res.status(401).json({ success: false, message: 'Inicia sesión para borrar comentarios' });
        const commentId = req.query.id;
        if (!commentId) return res.status(400).json({ success: false, message: 'id required' });
        try {
            const result = await deleteComment(contentId, commentId, session.u);
            if (result === 'notfound') return res.status(404).json({ success: false, message: 'Comentario no encontrado' });
            if (result === 'forbidden') return res.status(403).json({ success: false, message: 'Solo puedes borrar tus propios comentarios' });
            return res.json({ success: true });
        } catch (err) {
            console.error('Error deleting comment:', err.message);
            return res.status(500).json({ success: false, message: 'Error deleting comment' });
        }
    }

    res.status(405).json({ success: false, message: 'Method not allowed' });
};
