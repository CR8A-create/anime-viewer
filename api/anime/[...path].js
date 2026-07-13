// ============================================================
// API DE ANIME — handler serverless (Vercel) y también montado
// por server.js para desarrollo local.
//
// Endpoints (shapes 100% compatibles con el frontend actual):
//   GET /api/anime/airing                     → { success, data:[...], source }
//   GET /api/anime/recent                     → { success, data:[...], source }
//   GET /api/anime/info?title=...             → { success, slug, description, genres, status, rate, episodes, source }
//   GET /api/anime/videos?slug=...&episode=N  → { success, servers:[{name,url,lang}], source }
//   GET /api/anime/status                     → estado en vivo de todas las fuentes
//
// El scraping en sí vive en api/_lib/animeSources.js (multi-fuente
// con fallback automático). Para arreglar un selector roto, edita
// ese archivo — este no debería necesitar cambios.
// ============================================================
const { cors, getCache, getStale, setCache } = require('../_lib/shared');
const { scrapeWithFallback, checkSourcesStatus } = require('../_lib/animeSources');

const TTL = {
    airing: 30 * 60 * 1000,
    recent: 10 * 60 * 1000,
    info: 30 * 60 * 1000,
    videos: 15 * 60 * 1000,
};

/**
 * Ejecuta el scraping con fallback; si TODAS las fuentes fallan,
 * sirve la última respuesta buena (hasta 24h) marcada como stale.
 */
async function withStaleFallback(cacheKey, capability, ...args) {
    try {
        const { data, source } = await scrapeWithFallback(capability, ...args);
        return { data, source, stale: false };
    } catch (e) {
        const stale = getStale(cacheKey);
        if (stale) {
            console.warn(`[anime] Todas las fuentes fallaron para ${cacheKey}; sirviendo copia stale. Detalle: ${e.message}`);
            return { data: null, staleResponse: { ...stale, stale: true }, stale: true };
        }
        throw e;
    }
}

module.exports = async (req, res) => {
    if (cors(req, res)) return;

    const path = req.query.path || [];
    const action = path[0] || req.url.split('?')[0].split('/').filter(Boolean).pop();

    try {
        // --- AIRING ---
        if (action === 'airing') {
            const cacheKey = 'anime:airing';
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const r = await withStaleFallback(cacheKey, 'airing');
            if (r.stale) return res.json(r.staleResponse);

            const result = { success: true, data: r.data, source: r.source };
            setCache(cacheKey, result, TTL.airing);
            return res.json(result);
        }

        // --- RECENT ---
        if (action === 'recent') {
            const cacheKey = 'anime:recent';
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const r = await withStaleFallback(cacheKey, 'recent');
            if (r.stale) return res.json(r.staleResponse);

            const result = { success: true, data: r.data, source: r.source };
            setCache(cacheKey, result, TTL.recent);
            return res.json(result);
        }

        // --- INFO ---
        if (action === 'info') {
            const title = req.query.title || path[1] || '';
            if (!title) return res.status(400).json({ success: false, message: 'Title required' });
            const cacheKey = `anime:info:${title.toLowerCase()}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            let r;
            try {
                r = await withStaleFallback(cacheKey, 'info', title);
            } catch (e) {
                console.warn(`[anime] info "${title}" sin resultados: ${e.message}`);
                return res.json({ success: false, message: 'Anime no encontrado en ninguna fuente. Intenta con otro título.' });
            }
            if (r.stale) return res.json(r.staleResponse);

            const result = { success: true, source: r.source, ...r.data };
            setCache(cacheKey, result, TTL.info);
            return res.json(result);
        }

        // --- VIDEOS ---
        if (action === 'videos') {
            const slug = req.query.slug || path[1];
            const episode = req.query.episode || path[2];
            if (!slug || !episode) return res.status(400).json({ success: false, message: 'Slug and episode required' });

            const cacheKey = `anime:videos:${slug}:${episode}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            let r;
            try {
                r = await withStaleFallback(cacheKey, 'videos', slug, episode);
            } catch (e) {
                console.warn(`[anime] videos ${slug}-${episode}: ${e.message}`);
                return res.json({ success: false, message: 'No se encontraron servidores para este episodio en ninguna fuente.' });
            }
            if (r.stale) return res.json(r.staleResponse);

            const servers = r.data;
            // Latino primero (comportamiento existente)
            servers.sort((a, b) => (a.lang === 'lat' ? -1 : 1) - (b.lang === 'lat' ? -1 : 1));

            const result = { success: true, servers, source: r.source };
            setCache(cacheKey, result, TTL.videos);
            return res.json(result);
        }

        // --- STATUS (monitoreo de fuentes) ---
        if (action === 'status') {
            const cacheKey = 'anime:status';
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const sources = await checkSourcesStatus();
            const result = {
                success: true,
                checkedAt: new Date().toISOString(),
                allDown: sources.every(s => !s.alive),
                sources,
            };
            setCache(cacheKey, result, 60 * 1000); // 1 min: es un chequeo en vivo
            return res.json(result);
        }

        // --- HEALTH (ping barato, sin scraping) ---
        if (action === 'health') {
            return res.json({ success: true, ok: true });
        }

        return res.status(404).json({ success: false, message: 'Endpoint not found' });
    } catch (e) {
        console.error('Anime API Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
};
