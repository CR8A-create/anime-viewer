// ============================================================
// API DE MANGA — proxy a MangaDex (https://api.mangadex.org)
// ------------------------------------------------------------
// MangaDex es gratis, oficial y tiene traducciones al español
// (es-la = español latino, es = español de España). Este proxy
// normaliza las respuestas y cachea para no golpear su API.
// Las IMÁGENES de páginas se sirven directas desde su CDN
// (mangadex.network) — el frontend las carga sin pasar por aquí.
//
// Endpoints:
//   GET /api/manga/popular?type=manga|manhwa|webtoon&page=0
//   GET /api/manga/search?q=...
//   GET /api/manga/info?id=...
//   GET /api/manga/chapters?id=...            (capítulos en español)
//   GET /api/manga/pages?chapter=...          (imágenes del capítulo)
// ============================================================
const { cors, getCache, setCache } = require('../_lib/shared');
const axios = require('axios');

const MD = 'https://api.mangadex.org';
const ES = ['es-la', 'es'];
const RATING = ['safe', 'suggestive']; // sin contenido +18
const COVER = 'https://uploads.mangadex.org/covers';

function mdGet(path, params = {}) {
    // MangaDex exige arrays repetidos (?a[]=x&a[]=y). La serialización de
    // axios rompe las claves con []; construimos el query string a mano.
    const qs = [];
    for (const [key, val] of Object.entries(params)) {
        if (Array.isArray(val)) {
            for (const v of val) qs.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
        } else {
            qs.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
        }
    }
    const url = `${MD}${path}${qs.length ? '?' + qs.join('&') : ''}`;
    return axios.get(url, {
        timeout: 9000,
        headers: { 'User-Agent': 'AniNova/1.0 (personal reader)' },
    });
}

function pickTitle(attr) {
    const t = attr.title || {};
    return t.es || t['es-la'] || t.en || t.ja || Object.values(t)[0] || 'Sin título';
}
function pickDesc(attr) {
    const d = attr.description || {};
    return d.es || d['es-la'] || d.en || Object.values(d)[0] || '';
}

function mapManga(item) {
    const cover = (item.relationships || []).find(r => r.type === 'cover_art');
    const fileName = cover && cover.attributes && cover.attributes.fileName;
    return {
        id: item.id,
        title: pickTitle(item.attributes),
        description: pickDesc(item.attributes),
        status: item.attributes.status,
        year: item.attributes.year,
        contentRating: item.attributes.contentRating,
        originalLanguage: item.attributes.originalLanguage,
        tags: (item.attributes.tags || []).map(t => (t.attributes.name.es || t.attributes.name.en)).filter(Boolean),
        // Portada .512 = miniatura ligera; sin .xxx = completa
        cover: fileName ? `${COVER}/${item.id}/${fileName}.512.jpg` : null,
        coverFull: fileName ? `${COVER}/${item.id}/${fileName}` : null,
    };
}

// origin language por tipo de lectura
const ORIGIN = { manhwa: ['ko'], webtoon: ['ko'], manga: ['ja'] };

module.exports = async (req, res) => {
    if (cors(req, res)) return;
    const path = req.query.path || [];
    const action = path[0] || req.url.split('?')[0].split('/').filter(Boolean).pop();

    try {
        // --- POPULAR / POR TIPO ---
        if (action === 'popular') {
            const type = (req.query.type || 'manga').toLowerCase();
            const page = parseInt(req.query.page, 10) || 0;
            const cacheKey = `manga:popular:${type}:${page}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const params = {
                limit: 24,
                offset: page * 24,
                'availableTranslatedLanguage[]': ES,
                'order[followedCount]': 'desc',
                'contentRating[]': RATING,
                'includes[]': ['cover_art'],
                'hasAvailableChapters': 'true',
            };
            if (ORIGIN[type]) params['originalLanguage[]'] = ORIGIN[type];

            const { data } = await mdGet('/manga', params);
            const result = { success: true, data: (data.data || []).map(mapManga), total: data.total };
            setCache(cacheKey, result, 60 * 60 * 1000); // 1h
            return res.json(result);
        }

        // --- BÚSQUEDA ---
        if (action === 'search') {
            const q = req.query.q || '';
            if (!q) return res.status(400).json({ success: false, message: 'q required' });
            const cacheKey = `manga:search:${q.toLowerCase()}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const { data } = await mdGet('/manga', {
                limit: 24,
                title: q,
                'availableTranslatedLanguage[]': ES,
                'contentRating[]': RATING,
                'includes[]': ['cover_art'],
                'order[relevance]': 'desc',
            });
            const result = { success: true, data: (data.data || []).map(mapManga) };
            setCache(cacheKey, result, 30 * 60 * 1000);
            return res.json(result);
        }

        // --- INFO (ficha) ---
        if (action === 'info') {
            const id = req.query.id || path[1];
            if (!id) return res.status(400).json({ success: false, message: 'id required' });
            const cacheKey = `manga:info:${id}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const { data } = await mdGet(`/manga/${id}`, { 'includes[]': ['cover_art', 'author'] });
            const manga = mapManga(data.data);
            const author = (data.data.relationships || []).find(r => r.type === 'author');
            manga.author = author && author.attributes && author.attributes.name;
            const result = { success: true, data: manga };
            setCache(cacheKey, result, 60 * 60 * 1000);
            return res.json(result);
        }

        // --- CAPÍTULOS (en español, ordenados) ---
        if (action === 'chapters') {
            const id = req.query.id || path[1];
            if (!id) return res.status(400).json({ success: false, message: 'id required' });
            const cacheKey = `manga:chapters:${id}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            // La API pagina de 100 en 100; recogemos hasta 500 capítulos.
            const seen = new Map();
            for (let offset = 0; offset < 500; offset += 100) {
                const { data } = await mdGet(`/manga/${id}/feed`, {
                    limit: 100,
                    offset,
                    'translatedLanguage[]': ES,
                    'contentRating[]': RATING,
                    'order[chapter]': 'asc',
                    'includes[]': ['scanlation_group'],
                });
                for (const c of data.data || []) {
                    if (c.attributes.externalUrl) continue;       // capítulo en sitio externo, no legible aquí
                    if (!c.attributes.pages) continue;
                    const num = c.attributes.chapter || '0';
                    // un capítulo por número (evita duplicados de varios grupos)
                    if (!seen.has(num)) {
                        seen.set(num, {
                            id: c.id,
                            chapter: num,
                            title: c.attributes.title || '',
                            pages: c.attributes.pages,
                            lang: c.attributes.translatedLanguage,
                        });
                    }
                }
                if (offset + 100 >= (data.total || 0)) break;
            }
            const chapters = [...seen.values()].sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
            const result = { success: true, chapters };
            setCache(cacheKey, result, 30 * 60 * 1000);
            return res.json(result);
        }

        // --- PÁGINAS de un capítulo ---
        if (action === 'pages') {
            const chapter = req.query.chapter || path[1];
            if (!chapter) return res.status(400).json({ success: false, message: 'chapter required' });
            const cacheKey = `manga:pages:${chapter}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const { data } = await mdGet(`/at-home/server/${chapter}`);
            const base = data.baseUrl;
            const hash = data.chapter.hash;
            // data = calidad alta; dataSaver = comprimido (más rápido en móvil)
            const pages = (data.chapter.data || []).map(f => `${base}/data/${hash}/${f}`);
            const pagesSaver = (data.chapter.dataSaver || []).map(f => `${base}/data-saver/${hash}/${f}`);
            const result = { success: true, pages, pagesSaver };
            setCache(cacheKey, result, 20 * 60 * 1000);
            return res.json(result);
        }

        return res.status(404).json({ success: false, message: 'Endpoint not found' });
    } catch (e) {
        console.error('Manga API Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
};
