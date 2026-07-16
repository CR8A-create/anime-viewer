const { cors, getCache, setCache, tmdbGet, getImdbId } = require('../_lib/shared');

module.exports = async (req, res) => {
    if (cors(req, res)) return;

    const path = req.query.path || [];
    const action = path[0] || req.url.split('?')[0].split('/').filter(Boolean).pop();

    try {
        if (action === 'airing') {
            const page = req.query.page || 1;
            const cacheKey = `series:airing:${page}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await tmdbGet('/tv/on_the_air', { page });
            setCache(cacheKey, { success: true, data });
            return res.json({ success: true, data });
        }

        if (action === 'details') {
            const tmdbId = req.query.id || path[1];
            const cacheKey = `series:details:${tmdbId}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await tmdbGet(`/tv/${tmdbId}`);
            setCache(cacheKey, { success: true, data });
            return res.json({ success: true, data });
        }

        if (action === 'servers') {
            const tmdbId = req.query.id || path[1];
            const season = req.query.season || path[2];
            const episode = req.query.episode || path[3];
            const lang = req.query.lang || path[4] || 'en';
            if (!tmdbId || !season || !episode) return res.status(400).json({ success: false, message: 'tmdbId, season, and episode required' });

            const cacheKey = `series:servers:${tmdbId}:${season}:${episode}:${lang}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            // Julio 2026: retirados los proveedores muertos (embed.su,
            // vidsrc.xyz/pro/in, smashy con TLS roto) y 2embed (bloquea iframes).
            // VidFast/VidLink tienen selector de servidores con doblajes.
            let servers = [];
            if (lang === 'es') {
                servers = [
                    { name: 'VidFast ES', url: `https://vidfast.pro/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'VidLink', url: `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'MultiEmbed ES', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}&lang=es` },
                    { name: 'VidSrc ES', url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}?sub_lang=es` },
                ];
            } else {
                servers = [
                    { name: 'VidSrc.to', url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'VidLink', url: `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'VidFast', url: `https://vidfast.pro/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/tv/${tmdbId}/${season}/${episode}` },
                    { name: 'MultiEmbed', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}` },
                ];
            }
            setCache(cacheKey, { success: true, servers, lang });
            return res.json({ success: true, servers, lang });
        }

        if (action === 'season') {
            // Todos los episodios de una temporada (nombre, sinopsis y miniatura)
            const tmdbId = req.query.id || path[1];
            const season = req.query.season || path[2];
            if (!tmdbId || !season) return res.status(400).json({ success: false, message: 'tmdbId and season required' });

            const cacheKey = `series:season:${tmdbId}:${season}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const { data } = await tmdbGet(`/tv/${tmdbId}/season/${season}`);
            const result = {
                success: true,
                episodes: (data.episodes || []).map(ep => ({
                    episode_number: ep.episode_number,
                    name: ep.name,
                    overview: ep.overview,
                    still: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null,
                    air_date: ep.air_date,
                })),
            };
            setCache(cacheKey, result);
            return res.json(result);
        }

        if (action === 'episode') {
            const tmdbId = req.query.id || path[1];
            const season = req.query.season || path[2];
            const episode = req.query.episode || path[3];
            if (!tmdbId || !season || !episode) return res.status(400).json({ success: false, message: 'tmdbId, season, and episode required' });

            const cacheKey = `series:episode:${tmdbId}:${season}:${episode}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);

            const { data } = await tmdbGet(`/tv/${tmdbId}/season/${season}/episode/${episode}`);
            setCache(cacheKey, { success: true, data });
            return res.json({ success: true, data });
        }

        return res.status(404).json({ success: false, message: 'Not found' });
    } catch (e) {
        console.error('Series API Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
};
