// ============================================================
// SERVIDOR DE DESARROLLO LOCAL  (npm run dev → http://localhost:3000)
// ------------------------------------------------------------
// Sirve `public/` y monta EXACTAMENTE los mismos handlers
// serverless que producción (Vercel, carpeta `api/`), así lo que
// funciona aquí funciona desplegado. No se usa en producción.
// ============================================================
const express = require('express');
const cors = require('cors');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Static: el HTML nunca se cachea (los cambios se ven al recargar);
// CSS/JS/imágenes se revalidan con ETag.
app.use(express.static('public', {
    etag: true,
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=0, must-revalidate');
    },
}));

/**
 * Monta un handler catch-all de Vercel (`api/<name>/[...path].js`) en Express:
 * /api/<name>/a/b/c  →  req.query.path = ['a','b','c']
 */
function mountCatchAll(name) {
    const handler = require(`./api/${name}/[...path].js`);
    app.all(`/api/${name}/*`, (req, res) => {
        req.query.path = req.params[0].split('/').filter(Boolean);
        return handler(req, res);
    });
}
['anime', 'movies', 'series', 'manga', 'novels', 'auth'].forEach(mountCatchAll);

const commentsHandler = require('./api/comments/[contentId].js');
app.all('/api/comments/:contentId', (req, res) => {
    req.query.contentId = req.params.contentId;
    return commentsHandler(req, res);
});

app.all('/api/health', require('./api/health.js'));

app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Endpoint not found' }));

app.listen(PORT, () => {
    console.log(`\n✓ AniNova (dev) en http://localhost:${PORT}`);
    console.log(`  Anime    http://localhost:${PORT}/anime/index.html`);
    console.log(`  Cine/TV  http://localhost:${PORT}/movies/index.html`);
    console.log(`  Manga    http://localhost:${PORT}/manga/index.html`);
    console.log(`  Novelas  http://localhost:${PORT}/novelas/index.html`);
    console.log(`  Estado de fuentes: /api/anime/status · /api/manga/status\n`);
});
