// ============================================================
// API DE NOVELAS LIGERAS — proxy a SkyNovels (español)
// ------------------------------------------------------------
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

const SN = 'https://api.skynovels.net/api';
const IMG = (file) => file ? `https://api.skynovels.net/api/get-image/${file}/novels/false` : null;

function snGet(path) {
    return axios.get(`${SN}${path}`, {
        timeout: 9000,
        headers: { 'User-Agent': 'AniNova/1.0 (personal reader)' },
    });
}

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
            const { data } = await snGet(`/novels?page=${page}&limit=24`);
            const list = (data.novels || []).map(mapNovel);
            const result = { success: true, data: list, total: data.total };
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

            // SkyNovels no tiene endpoint de búsqueda abierto; traemos un lote
            // amplio y filtramos por título/autor (el catálogo es manejable).
            const { data } = await snGet(`/novels?page=1&limit=300`);
            const list = (data.novels || []).map(mapNovel)
                .filter(n => n.title.toLowerCase().includes(q) || (n.writer || '').toLowerCase().includes(q))
                .slice(0, 24);
            const result = { success: true, data: list };
            setCache(cacheKey, result, 30 * 60 * 1000);
            return res.json(result);
        }

        // --- INFO (ficha + capítulos) ---
        if (action === 'info') {
            const id = req.query.id || path[1];
            if (!id) return res.status(400).json({ success: false, message: 'id required' });
            const cacheKey = `novels:info:${id}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

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

        return res.status(404).json({ success: false, message: 'Endpoint not found' });
    } catch (e) {
        console.error('Novels API Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
};
