// ============================================================
// API DE NOVELAS LIGERAS — SkyNovels + DevilNovels (español)
// ------------------------------------------------------------
// Dos fuentes:
//   · SkyNovels  (ids numéricos)  — primaria. OJO: desde nov. 2026 devuelve
//     403 a las IPs de Vercel; en local responde.
//   · DevilNovels (ids "dn:…", api/_lib/devilnovels.js) — respaldo con API
//     REST abierta. Si SkyNovels no responde, el catálogo sale de aquí.
// Los listados mezclan lo que haya disponible; info/chapter enrutan por el
// prefijo del id.
//
// SkyNovels (https://api.skynovels.net) tiene una API REST pública
// con novelas ligeras traducidas al español. Este proxy normaliza
// las respuestas y cachea. El contenido de los capítulos es texto
// HTML — se lee en nuestro propio lector (novelas/leer.html).
//
// Endpoints:
//   GET /api/novels/popular?page=1
//   GET /api/novels/search?q=...
//   GET /api/novels/info?id=...      → ficha + volúmenes con capítulos
//   GET /api/novels/chapter?id=...   → contenido HTML del capítulo
// ============================================================
const { cors, getCache, setCache } = require('../_lib/shared');
const axios = require('axios');
const dn = require('../_lib/devilnovels');

const SN = 'https://api.skynovels.net/api';
const IMG = (file) => file ? `https://api.skynovels.net/api/get-image/${file}/novels/false` : null;

function snGet(path) {
    return axios.get(`${SN}${path}`, {
        timeout: 9000,
        headers: { 'User-Agent': 'AniNova/1.0 (personal reader)' },
    });
}

/** Catálogo COMPLETO: la API capa limit a 100 → se piden todas las páginas. */
async function fetchFullCatalog() {
    const first = (await snGet('/novels?page=1&limit=100')).data;
    let all = first.novels || [];
    const total = first.total || all.length;
    const pages = Math.ceil(total / 100);
    if (pages > 1) {
        const rest = await Promise.all(
            Array.from({ length: pages - 1 }, (_, i) => snGet(`/novels?page=${i + 2}&limit=100`).then(r => r.data.novels || []).catch(() => []))
        );
        for (const chunk of rest) all = all.concat(chunk);
    }
    return all;
}

// ---- Disponibilidad de SkyNovels (breaker simple en memoria) ----
let skyDownUntil = 0;
const skyDown = () => Date.now() < skyDownUntil;
function markSky(e) {
    const st = e && e.response && e.response.status;
    // 403/429/5xx o sin respuesta: fuente caída o bloqueándonos → 10 min de pausa
    if (!st || st === 403 || st === 429 || st >= 500) skyDownUntil = Date.now() + 10 * 60 * 1000;
}
/** Ejecuta `fn` contra SkyNovels; null si está caída/bloqueada. */
async function trySky(fn) {
    if (skyDown()) return null;
    try { return await fn(); } catch (e) { markSky(e); console.warn('[novels] SkyNovels:', e.message); return null; }
}
/** Catálogo de DevilNovels; [] si tampoco responde. */
async function dnCatalog() {
    try { return await dn.catalog(); } catch (e) { console.warn('[novels] DevilNovels:', e.message); return []; }
}
const SOURCE_DOWN_MSG = 'La fuente de esta novela (SkyNovels) no responde ahora mismo desde el servidor. Prueba más tarde o busca la novela en el catálogo.';

function mapNovel(n) {
    return {
        id: n.id,
        title: n.nvl_title,
        name: n.nvl_name,
        writer: n.nvl_writer || n.nvl_author || '',
        status: n.nvl_status,
        cover: IMG(n.image),
        chapters: n.nvl_chapters,
        rating: n.nvl_rating,
        description: (n.nvl_content || '').replace(/<[^>]+>/g, '').trim(),
    };
}

module.exports = async (req, res) => {
    if (cors(req, res)) return;
    const path = req.query.path || [];
    const action = path[0] || req.url.split('?')[0].split('/').filter(Boolean).pop();

    try {
        // --- POPULARES / LISTADO ---
        if (action === 'popular') {
            const page = parseInt(req.query.page, 10) || 1;
            const cacheKey = `novels:popular:${page}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            // La API base ordena por más recientes; paginamos con ?page&limit
            const sky = await trySky(() => snGet(`/novels?page=${page}&limit=24`));
            let result;
            if (sky) {
                result = { success: true, data: (sky.data.novels || []).map(mapNovel), total: sky.data.total, source: 'skynovels' };
            } else {
                // Respaldo: DevilNovels — con portada primero y, dentro, las más largas
                const all = [...await dnCatalog()].sort((a, b) => (a.cover ? 0 : 1) - (b.cover ? 0 : 1) || b.chapters - a.chapters);
                if (all.length === 0) return res.status(503).json({ success: false, message: 'Las fuentes de novelas no responden ahora mismo.' });
                result = { success: true, data: all.slice((page - 1) * 24, page * 24), total: all.length, source: 'devilnovels' };
            }
            setCache(cacheKey, result, 60 * 60 * 1000);
            return res.json(result);
        }

        // --- BÚSQUEDA (filtrado en memoria sobre el catálogo) ---
        if (action === 'search') {
            const q = (req.query.q || '').toLowerCase();
            if (!q) return res.status(400).json({ success: false, message: 'q required' });
            const cacheKey = `novels:search:${q}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            // SkyNovels no tiene endpoint de búsqueda abierto; traemos el
            // catálogo completo y filtramos por título/autor.
            const match = n => n.title.toLowerCase().includes(q) || (n.writer || '').toLowerCase().includes(q);
            const [skyAll, dnAll] = await Promise.all([trySky(fetchFullCatalog), dnCatalog()]);
            const list = [...(skyAll || []).map(mapNovel).filter(match), ...dnAll.filter(match)].slice(0, 24);
            const result = { success: true, data: list };
            setCache(cacheKey, result, 30 * 60 * 1000);
            return res.json(result);
        }

        // --- DIRECTORIO (filtros/orden en memoria sobre el catálogo) ---
        // SkyNovels no filtra server-side: traemos el catálogo completo
        // (cacheado 1h) y filtramos aquí. ~475 novelas, es barato.
        if (action === 'directory') {
            const q = (req.query.q || '').toLowerCase();
            const status = (req.query.status || '').toLowerCase();   // active|finished|paused
            const order = req.query.order || 'recent';               // recent|rating|views|chapters
            const page = parseInt(req.query.page, 10) || 1;
            const cacheKey = `novels:dir:${q}:${status}:${order}:${page}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            let all = getCache('novels:catalog');
            if (!all) {
                const [raw, dnAll] = await Promise.all([trySky(fetchFullCatalog), dnCatalog()]);
                const sky = (raw || []).map(n => ({ ...mapNovel(n), views: n.nvl_views_count || 0, updatedAt: Date.parse(n.nvl_last_update) || n.nvl_last_update || 0 }));
                all = [...sky, ...dnAll];
                if (all.length === 0) return res.status(503).json({ success: false, message: 'Las fuentes de novelas no responden ahora mismo.' });
                // Solo se cachea 1 h si están las dos fuentes; si falta SkyNovels, 10 min
                setCache('novels:catalog', all, raw ? 60 * 60 * 1000 : 10 * 60 * 1000);
            }
            let list = all;
            if (q) list = list.filter(n => n.title.toLowerCase().includes(q) || (n.writer || '').toLowerCase().includes(q));
            if (status) list = list.filter(n => String(n.status).toLowerCase() === status);
            const orders = {
                recent: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
                rating: (a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0),
                views: (a, b) => (b.views || 0) - (a.views || 0),
                chapters: (a, b) => (b.chapters || 0) - (a.chapters || 0),
            };
            list = [...list].sort(orders[order] || orders.recent);
            const PER = 24;
            const totalPages = Math.max(1, Math.ceil(list.length / PER));
            const result = {
                success: true,
                data: list.slice((page - 1) * PER, page * PER),
                page, totalPages, total: list.length,
            };
            setCache(cacheKey, result, 30 * 60 * 1000);
            return res.json(result);
        }

        // --- NOVEDADES (para el carrusel: últimas actualizadas) ---
        if (action === 'latest') {
            const cached = getCache('novels:latest');
            if (cached) return res.json(cached);
            const raw = await trySky(fetchFullCatalog);
            let list;
            if (raw) {
                list = raw.sort((a, b) => (b.nvl_last_update || 0) - (a.nvl_last_update || 0)).slice(0, 12).map(mapNovel);
            } else {
                // Respaldo: lo último actualizado en DevilNovels (con portada)
                list = (await dnCatalog()).filter(n => n.cover).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
                if (list.length === 0) return res.status(503).json({ success: false, message: 'Las fuentes de novelas no responden ahora mismo.' });
            }
            const result = { success: true, data: list };
            setCache('novels:latest', result, 30 * 60 * 1000);
            return res.json(result);
        }

        // --- INFO (ficha + capítulos) ---
        if (action === 'info') {
            const id = req.query.id || path[1];
            if (!id) return res.status(400).json({ success: false, message: 'id required' });
            const cacheKey = `novels:info:${id}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            if (dn.isDn(id)) {
                const info = await dn.novelInfo(id);
                const result = { success: true, source: 'devilnovels', ...info };
                setCache(cacheKey, result, 30 * 60 * 1000);
                return res.json(result);
            }
            if (!/^\d+$/.test(String(id))) return res.status(400).json({ success: false, message: 'id inválido' });
            if (skyDown()) return res.status(503).json({ success: false, sourceDown: true, message: SOURCE_DOWN_MSG });

            const [baseRes, genresRes, volsRes] = await Promise.all([
                snGet(`/novels/${id}/base`),
                snGet(`/novels/${id}/genres`).catch(() => ({ data: {} })),
                snGet(`/novels/${id}/volumes`).catch(() => ({ data: {} })),
            ]);
            const b = baseRes.data.novel || baseRes.data;
            const volumes = volsRes.data.volumes || volsRes.data || [];

            // Los capítulos de cada volumen se piden por su endpoint paginado.
            const chapters = [];
            const volChapterLists = await Promise.all(volumes.map(v =>
                snGet(`/volumes/${id}/${v.id}/chapters?page=1&limit=2000`)
                    .then(r => ({ v, items: r.data.items || r.data.chapters || [] }))
                    .catch(() => ({ v, items: [] }))
            ));
            for (const { v, items } of volChapterLists) {
                for (const c of items) {
                    if (String(c.chp_status).toLowerCase() !== 'active') continue;
                    if (String(c.isVip) === '1') continue; // capítulo de pago: saltar
                    chapters.push({
                        id: c.id,
                        number: c.chp_number,
                        title: c.chp_title || c.chp_index_title || `Capítulo ${c.chp_number}`,
                        volume: v.vlm_title,
                    });
                }
            }
            chapters.sort((a, b2) => a.number - b2.number);

            const result = {
                success: true,
                data: {
                    id: b.id,
                    title: b.nvl_title,
                    writer: b.nvl_writer || b.nvl_author || '',
                    translator: b.nvl_translator || '',
                    status: b.nvl_status,
                    cover: IMG(b.image),
                    description: (b.nvl_content || '').replace(/<[^>]+>/g, '').trim(),
                    genres: (genresRes.data.genres || []).map(g => g.genre_name),
                },
                chapters,
            };
            setCache(cacheKey, result, 30 * 60 * 1000);
            return res.json(result);
        }

        // --- CONTENIDO DE UN CAPÍTULO ---
        if (action === 'chapter') {
            const id = req.query.id || path[1];
            if (!id) return res.status(400).json({ success: false, message: 'id required' });
            const cacheKey = `novels:chapter:${id}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            if (dn.isDn(id)) {
                const result = { success: true, chapter: await dn.chapter(id) };
                setCache(cacheKey, result, 60 * 60 * 1000);
                return res.json(result);
            }
            if (skyDown()) return res.status(503).json({ success: false, sourceDown: true, message: SOURCE_DOWN_MSG });
            const { data } = await snGet(`/chapters/${id}`);
            const ch = data.chapter || data;
            // Contenido HTML; limpiamos los caracteres invisibles de marca de agua
            const content = (ch.chp_content || '').replace(/[​-‏‪-‮⁠﻿]/g, '');
            const result = {
                success: true,
                chapter: {
                    id: ch.id,
                    number: ch.chp_number,
                    title: ch.chp_title || ch.chp_index_title || '',
                    content,
                },
            };
            setCache(cacheKey, result, 60 * 60 * 1000);
            return res.json(result);
        }

        // --- STATUS (diagnóstico: ¿qué fuentes responden desde producción?) ---
        if (action === 'status') {
            const probes = {
                skynovels: `${SN}/novels?page=1&limit=1`,
                devilnovels: 'https://devilnovels.com/wp-json/wp/v2/categories?per_page=1',
            };
            const out = {};
            await Promise.all(Object.entries(probes).map(async ([name, url]) => {
                const t0 = Date.now();
                try {
                    const r = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'AniNova/1.0 (personal reader)' } });
                    out[name] = { ok: true, status: r.status, ms: Date.now() - t0 };
                } catch (e) {
                    out[name] = { ok: false, error: (e.response ? `HTTP ${e.response.status} — ` : '') + e.message, ms: Date.now() - t0 };
                }
            }));
            return res.json({ success: true, sources: out });
        }

        return res.status(404).json({ success: false, message: 'Endpoint not found' });
    } catch (e) {
        console.error('Novels API Error:', e.message);
        const st = e.response && e.response.status;
        const fromSky = e.config && String(e.config.url || '').startsWith(SN);
        if (fromSky) {
            markSky(e);
            if (st === 404) return res.status(404).json({ success: false, message: 'No se encontró esta novela.' });
            return res.status(503).json({ success: false, sourceDown: true, message: SOURCE_DOWN_MSG });
        }
        if (e.notFound || st === 404) return res.status(404).json({ success: false, message: 'No se encontró esta novela.' });
        res.status(500).json({ success: false, message: e.message });
    }
};
