// ============================================================
// API DE MANGA — ZonaTMO primario, MangaDex de respaldo
// ------------------------------------------------------------
// ZonaTMO (api/_lib/zonatmo.js) tiene manga/manhwa/cómics en español
// INCLUIDOS los licenciados (One Piece, MHA...) con imágenes en URL
// plana → lector propio completo. Es la fuente primaria.
// MangaDex queda como respaldo si ZonaTMO falla.
//
// Los ids de ZonaTMO llevan prefijo "zt:"; el enrutado interno decide
// la fuente por ese prefijo (así conviven con ids antiguos de MangaDex).
//
// Endpoints (shapes compatibles con el frontend):
//   GET /api/manga/popular?type=manga|manhwa|comic&page=1
//   GET /api/manga/search?q=...
//   GET /api/manga/info?id=...
//   GET /api/manga/chapters?id=...
//   GET /api/manga/pages?chapter=...
// ============================================================
const { cors, getCache, setCache } = require('../_lib/shared');
const axios = require('axios');
const zt = require('../_lib/zonatmo');
const ml = require('../_lib/mangalect');

// ---------- MangaDex (respaldo) ----------
const MD = 'https://api.mangadex.org';
const ES = ['es-la', 'es'];
const RATING = ['safe', 'suggestive'];
const COVER = 'https://uploads.mangadex.org/covers';

function mdGet(path, params = {}) {
    const qs = [];
    for (const [key, val] of Object.entries(params)) {
        if (Array.isArray(val)) for (const v of val) qs.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
        else qs.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }
    return axios.get(`${MD}${path}${qs.length ? '?' + qs.join('&') : ''}`, {
        timeout: 9000, headers: { 'User-Agent': 'AniNova/1.0 (personal reader)' },
    });
}
function mdTitle(a) { const t = a.title || {}; return t.es || t['es-la'] || t.en || t.ja || Object.values(t)[0] || 'Sin título'; }
function mdDesc(a) { const d = a.description || {}; return d.es || d['es-la'] || d.en || Object.values(d)[0] || ''; }
function mdCard(item) {
    const cov = (item.relationships || []).find(r => r.type === 'cover_art');
    const fn = cov && cov.attributes && cov.attributes.fileName;
    const badge = item.attributes.originalLanguage === 'ko' ? 'Manhwa' : (item.attributes.originalLanguage === 'zh' ? 'Manhua' : 'Manga');
    return {
        id: item.id, title: mdTitle(item.attributes), description: mdDesc(item.attributes),
        status: item.attributes.status, year: item.attributes.year, type: badge,
        tags: (item.attributes.tags || []).map(t => (t.attributes.name.es || t.attributes.name.en)).filter(Boolean),
        cover: fn ? `${COVER}/${item.id}/${fn}.512.jpg` : null,
        coverFull: fn ? `${COVER}/${item.id}/${fn}` : null,
    };
}
const MD_ORIGIN = { manhwa: ['ko'], webtoon: ['ko'], manga: ['ja'] };

// ¿a qué fuente pertenece el id?
const isZt = (id) => typeof id === 'string' && id.startsWith('zt:');
const isMl = (id) => typeof id === 'string' && id.startsWith('ml:');

module.exports = async (req, res) => {
    if (cors(req, res)) return;
    const path = req.query.path || [];
    const action = path[0] || req.url.split('?')[0].split('/').filter(Boolean).pop();

    try {
        // --- POPULAR / POR TIPO ---
        if (action === 'popular') {
            let type = (req.query.type || 'manga').toLowerCase();
            if (type === 'webtoon') type = 'manhwa';
            const page = parseInt(req.query.page, 10) || 1;
            const cacheKey = `manga2:popular:${type}:${page}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            let data = [];
            try { data = await zt.browse(type, page); } catch (e) { console.warn('zt browse:', e.message); }
            if (data.length === 0) {
                try { data = await ml.browse(type, page); } catch (e) { console.warn('ml browse:', e.message); }
            }
            if (data.length === 0) {
                // Respaldo MangaDex
                try {
                    const params = {
                        limit: 24, offset: (page - 1) * 24,
                        'availableTranslatedLanguage[]': ES, 'order[followedCount]': 'desc',
                        'contentRating[]': RATING, 'includes[]': ['cover_art'], 'hasAvailableChapters': 'true',
                    };
                    if (MD_ORIGIN[type]) params['originalLanguage[]'] = MD_ORIGIN[type];
                    const md = await mdGet('/manga', params);
                    data = (md.data.data || []).map(mdCard);
                } catch (e) { console.warn('md popular:', e.message); }
            }
            const result = { success: true, data };
            setCache(cacheKey, result, 60 * 60 * 1000);
            return res.json(result);
        }

        // --- BÚSQUEDA ---
        if (action === 'search') {
            const q = req.query.q || '';
            if (!q) return res.status(400).json({ success: false, message: 'q required' });
            const cacheKey = `manga2:search:${q.toLowerCase()}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            let data = [];
            try { data = await zt.search(q); } catch (e) { console.warn('zt search:', e.message); }
            if (data.length === 0) {
                try { data = await ml.search(q); } catch (e) { console.warn('ml search:', e.message); }
            }
            if (data.length === 0) {
                try {
                    const md = await mdGet('/manga', {
                        limit: 24, title: q, 'availableTranslatedLanguage[]': ES,
                        'contentRating[]': RATING, 'includes[]': ['cover_art'], 'order[relevance]': 'desc',
                    });
                    data = (md.data.data || []).map(mdCard);
                } catch (e) { console.warn('md search:', e.message); }
            }
            const result = { success: true, data };
            setCache(cacheKey, result, 30 * 60 * 1000);
            return res.json(result);
        }

        // --- INFO (ficha) ---
        if (action === 'info') {
            const id = req.query.id || path[1];
            if (!id) return res.status(400).json({ success: false, message: 'id required' });
            const cacheKey = `manga2:info:${id}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            if (isZt(id) || isMl(id)) {
                const info = await (isZt(id) ? zt : ml).mangaInfo(id);
                const estado = { publicandose: 'En curso', finalizado: 'Finalizado', cancelado: 'Cancelado', pausado: 'En pausa' };
                const result = {
                    success: true,
                    data: {
                        id: info.id, title: info.title,
                        cover: info.cover, coverFull: info.cover,
                        description: info.description,
                        status: estado[(info.status || '').toLowerCase()] || info.status,
                        type: info.type, tags: info.genres || [], author: '',
                        rating: info.score,
                    },
                    _chapters: info.chapters,   // reutilizado por /chapters (evita 2 fetch)
                };
                setCache(cacheKey, result, 30 * 60 * 1000);
                return res.json(result);
            }
            // MangaDex
            const { data } = await mdGet(`/manga/${id}`, { 'includes[]': ['cover_art', 'author'] });
            const m = mdCard(data.data);
            const author = (data.data.relationships || []).find(r => r.type === 'author');
            m.author = author && author.attributes && author.attributes.name;
            const result = { success: true, data: m };
            setCache(cacheKey, result, 60 * 60 * 1000);
            return res.json(result);
        }

        // --- CAPÍTULOS ---
        if (action === 'chapters') {
            const id = req.query.id || path[1];
            if (!id) return res.status(400).json({ success: false, message: 'id required' });
            const cacheKey = `manga2:chapters:${id}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            if (isZt(id) || isMl(id)) {
                // Reutiliza la ficha cacheada si existe (info trae _chapters)
                const infoCached = getCache(`manga2:info:${id}`);
                let list = infoCached && infoCached._chapters;
                if (!list) list = (await (isZt(id) ? zt : ml).mangaInfo(id)).chapters;
                const chapters = list.map(c => ({ id: c.id, chapter: c.number, title: c.title, pages: null, lang: 'es' }));
                const result = { success: true, chapters };
                setCache(cacheKey, result, 30 * 60 * 1000);
                return res.json(result);
            }
            // MangaDex
            const seen = new Map();
            let external = 0;
            for (let offset = 0; offset < 3000; offset += 100) {
                const { data } = await mdGet(`/manga/${id}/feed`, {
                    limit: 100, offset, 'translatedLanguage[]': ES, 'contentRating[]': RATING,
                    'order[chapter]': 'asc', 'includes[]': ['scanlation_group'],
                });
                for (const c of data.data || []) {
                    if (c.attributes.externalUrl) { external++; continue; }
                    if (!c.attributes.pages) continue;
                    const num = c.attributes.chapter || '0';
                    if (!seen.has(num)) seen.set(num, { id: c.id, chapter: num, title: c.attributes.title || '', pages: c.attributes.pages, lang: c.attributes.translatedLanguage });
                }
                if (offset + 100 >= (data.total || 0)) break;
            }
            const chapters = [...seen.values()].sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
            const result = { success: true, chapters, licensed: chapters.length === 0 && external > 0 };
            setCache(cacheKey, result, 30 * 60 * 1000);
            return res.json(result);
        }

        // --- PÁGINAS ---
        if (action === 'pages') {
            const chapter = req.query.chapter || path[1];
            if (!chapter) return res.status(400).json({ success: false, message: 'chapter required' });
            const cacheKey = `manga2:pages:${chapter}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            if (isZt(chapter) || isMl(chapter)) {
                const pages = await (isZt(chapter) ? zt : ml).pages(chapter);
                const result = { success: true, pages };
                setCache(cacheKey, result, 20 * 60 * 1000);
                return res.json(result);
            }
            // MangaDex — sus URLs de at-home EXPIRAN (~15 min): TTL corto,
            // si se cachean más tiempo el lector recibe 404 en las imágenes.
            const { data } = await mdGet(`/at-home/server/${chapter}`);
            const base = data.baseUrl, hash = data.chapter.hash;
            const pages = (data.chapter.data || []).map(f => `${base}/data/${hash}/${f}`);
            const result = { success: true, pages };
            setCache(cacheKey, result, 5 * 60 * 1000);
            return res.json(result);
        }

        // --- STATUS (diagnóstico de fuentes en producción) ---
        if (action === 'status') {
            const out = {};
            const probes = [
                ['zonatmo', async () => (await zt.browse('manga', 1)).length],
                ['mangalect', async () => (await ml.browse('manga', 1)).length],
                ['mangadex', async () => {
                    const md = await mdGet('/manga', { limit: 1, 'availableTranslatedLanguage[]': ES, 'contentRating[]': RATING });
                    return (md.data.data || []).length;
                }],
            ];
            await Promise.all(probes.map(async ([name, fn]) => {
                const t0 = Date.now();
                try {
                    const n = await fn();
                    out[name] = { ok: n > 0, items: n, ms: Date.now() - t0 };
                } catch (e) {
                    const st = e.response && e.response.status;
                    out[name] = { ok: false, error: (st ? `HTTP ${st} — ` : '') + e.message, ms: Date.now() - t0 };
                }
            }));
            return res.json({ success: true, sources: out });
        }

        return res.status(404).json({ success: false, message: 'Endpoint not found' });
    } catch (e) {
        console.error('Manga API Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
};
