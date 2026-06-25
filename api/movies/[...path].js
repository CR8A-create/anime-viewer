const { cors, getCache, setCache, tmdbGet, scraperGet, extractMovieSlug, parseLangBadges, titlesMatch, getImdbId, ZONAAPS_BASE, CUEVANA_BASE } = require('../_lib/shared');
const cheerio = require('cheerio');

async function scrapeZonaAPS(query) {
    const { data } = await scraperGet(`${ZONAAPS_BASE}/?s=${encodeURIComponent(query)}`);
    const $ = cheerio.load(data);
    const results = [];
    $('article, .TPostMv, .ml-item').each((_, el) => {
        const a = $(el).find('a[href*="zonaaps.com"]').first().length ? $(el).find('a[href*="zonaaps.com"]').first() : $(el).find('a').first();
        const href = a.attr('href') || '';
        const title = ($(el).find('h2, .Title, .entry-title').first().text().trim() || a.attr('title') || '').trim();
        if (title && href) results.push({
            title, slug: extractMovieSlug(href), poster: $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '',
            rating: $(el).find('.vote, .Score, .rating').first().text().trim(), year: ($(el).find('.year, .Year, time').first().text().trim().match(/\d{4}/) || [])[0] || '',
            idiomas: parseLangBadges($(el), $), source: 'zonaaps'
        });
    });
    return results;
}

async function scrapeCuevana(query) {
    const { data } = await scraperGet(`${CUEVANA_BASE}/?s=${encodeURIComponent(query)}`);
    const $ = cheerio.load(data);
    const results = [];
    $('article, .TPostMv, .ml-item').each((_, el) => {
        const a = $(el).find('a').first();
        const href = a.attr('href') || '';
        const title = ($(el).find('h2, .Title, .entry-title').first().text().trim() || a.attr('title') || '').trim();
        if (title && href) results.push({
            title, slug: extractMovieSlug(href), poster: $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '',
            rating: $(el).find('.vote, .Score').first().text().trim(), year: ($(el).find('.Year, time').first().text().trim().match(/\d{4}/) || [])[0] || '',
            idiomas: ['subtitulado'], source: 'cuevana'
        });
    });
    return results;
}

module.exports = async (req, res) => {
    if (cors(req, res)) return;

    const path = req.query.path || [];
    const action = path[0] || req.url.split('?')[0].split('/').filter(Boolean).pop();

    try {
        if (action === 'popular') {
            const page = req.query.page || 1;
            const cacheKey = `movies:popular:${page}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await tmdbGet('/movie/popular', { page });
            setCache(cacheKey, { success: true, data });
            return res.json({ success: true, data });
        }

        if (action === 'search') {
            const { query, q } = req.query;
            if (q) {
                const cacheKey = `movies:scrape-search:${q}`;
                const cached = getCache(cacheKey);
                if (cached) return res.json(cached);
                const [zonaRes, cuevRes] = await Promise.allSettled([scrapeZonaAPS(q), scrapeCuevana(q)]);
                const zonaItems = zonaRes.status === 'fulfilled' ? zonaRes.value : [];
                const cuevItems = cuevRes.status === 'fulfilled' ? cuevRes.value : [];
                const combined = [...zonaItems];
                for (const cv of cuevItems) if (!zonaItems.some(z => titlesMatch(z.title, cv.title))) combined.push(cv);
                setCache(cacheKey, { success: true, data: combined });
                return res.json({ success: true, data: combined });
            }
            if (!query) return res.status(400).json({ success: false, message: 'Query required' });
            const cacheKey = `movies:tmdb-search:${query}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await tmdbGet('/search/multi', { query });
            setCache(cacheKey, { success: true, data: data.results });
            return res.json({ success: true, data: data.results });
        }

        if (action === 'details') {
            const tmdbId = req.query.id || path[1];
            const cacheKey = `movies:details:${tmdbId}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await tmdbGet(`/movie/${tmdbId}`);
            setCache(cacheKey, { success: true, data });
            return res.json({ success: true, data });
        }

        if (action === 'servers') {
            const tmdbId = req.query.id || path[1];
            const lang = req.query.lang || path[2] || 'en';
            const cacheKey = `movies:servers:${tmdbId}:${lang}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            let servers = [];
            if (lang === 'es') {
                servers = [
                    { name: 'MultiEmbed ES', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&lang=es` },
                    { name: 'VidSrc ES', url: `https://vidsrc.to/embed/movie/${tmdbId}?sub_lang=es` },
                    { name: '2Embed ES', url: `https://www.2embed.stream/embed/movie/${tmdbId}` },
                    { name: 'Embed.su ES', url: `https://embed.su/embed/movie/${tmdbId}` },
                    { name: 'Smashy ES', url: `https://player.smashy.stream/movie/${tmdbId}?lang=es` },
                ];
            } else {
                servers = [
                    { name: 'VidSrc.to', url: `https://vidsrc.to/embed/movie/${tmdbId}` },
                    { name: 'Embed.su', url: `https://embed.su/embed/movie/${tmdbId}` },
                    { name: '2Embed', url: `https://www.2embed.stream/embed/movie/${tmdbId}` },
                    { name: 'VidSrc PRO', url: `https://vidsrc.pro/embed/movie/${tmdbId}` },
                    { name: 'VidSrc.xyz', url: `https://vidsrc.xyz/embed/movie?tmdb=${tmdbId}` },
                    { name: 'MultiEmbed', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1` },
                ];
            }
            setCache(cacheKey, { success: true, servers, lang });
            return res.json({ success: true, servers, lang });
        }

        if (action === 'latino') {
            const cacheKey = 'movies:latino';
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await scraperGet(`${ZONAAPS_BASE}/movies/`);
            const $ = cheerio.load(data);
            const items = [];
            $('article, .TPostMv, .ml-item').each((_, el) => {
                const idiomas = parseLangBadges($(el), $);
                if (!idiomas.includes('latino')) return;
                const a = $(el).find('a').first();
                const title = ($(el).find('h2, .Title, .entry-title').first().text().trim() || a.attr('title') || '').trim();
                if (title && a.attr('href')) items.push({ title, slug: extractMovieSlug(a.attr('href')), poster: $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '', rating: $(el).find('.vote, .Score').first().text().trim(), idiomas, source: 'zonaaps' });
            });
            setCache(cacheKey, { success: true, data: items });
            return res.json({ success: true, data: items });
        }

        if (action === 'recientes') {
            const cacheKey = 'movies:recientes';
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const [{ data: zonaData }, { data: cuevData }] = await Promise.all([scraperGet(`${ZONAAPS_BASE}/movies/`), scraperGet(`${CUEVANA_BASE}/peliculas/`)]);
            const $zona = cheerio.load(zonaData);
            const $cuev = cheerio.load(cuevData);
            const combined = [];
            $zona('article, .TPostMv, .ml-item').slice(0, 15).each((_, el) => {
                const a = $zona(el).find('a').first();
                const title = ($zona(el).find('h2, .Title, .entry-title').first().text().trim() || a.attr('title') || '').trim();
                if (title && a.attr('href')) combined.push({ title, slug: extractMovieSlug(a.attr('href')), poster: $zona(el).find('img').attr('src') || $zona(el).find('img').attr('data-src') || '', rating: $zona(el).find('.vote, .Score').first().text().trim(), idiomas: parseLangBadges($zona(el), $zona), source: 'zonaaps' });
            });
            $cuev('article, .TPostMv, .ml-item').slice(0, 15).each((_, el) => {
                const a = $cuev(el).find('a').first();
                const title = ($cuev(el).find('h2, .Title, .entry-title').first().text().trim() || a.attr('title') || '').trim();
                if (title && a.attr('href') && !combined.some(z => titlesMatch(z.title, title))) combined.push({ title, slug: extractMovieSlug(a.attr('href')), poster: $cuev(el).find('img').attr('src') || $cuev(el).find('img').attr('data-src') || '', rating: $cuev(el).find('.vote, .Score').first().text().trim(), idiomas: ['subtitulado'], source: 'cuevana' });
            });
            setCache(cacheKey, { success: true, data: combined.slice(0, 20) });
            return res.json({ success: true, data: combined.slice(0, 20) });
        }

        if (action === 'zonaaps') {
            const slug = path[1];
            const cacheKey = `movies:zonaaps:${slug}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await scraperGet(`${ZONAAPS_BASE}/movies/${slug}/`);
            const $ = cheerio.load(data);
            const players = [];
            $('[data-src], iframe[src]').each((_, el) => {
                const src = $(el).attr('data-src') || $(el).attr('src') || '';
                const server = $(el).closest('[data-server]').attr('data-server') || $(el).attr('data-server') || 'Player';
                const idioma = $(el).closest('[data-lang]').attr('data-lang') || 'desconocido';
                if (src && !src.startsWith('data:')) players.push({ server, url: src, idioma });
            });
            const result = { success: true, title: $('h1.Title, h1.entry-title, h1').first().text().trim(), poster: $('img.TPostBg, .poster img, img.wp-post-image').first().attr('src') || '', rating: $('.vote, .Score, .rating').first().text().trim(), year: ($('.Date, time, .year').first().text().trim().match(/\d{4}/) || [])[0] || '', synopsis: $('.Description p, .entry-content p, .sinopsis p').first().text().trim(), idiomas: parseLangBadges($('body'), $), players };
            setCache(cacheKey, result);
            return res.json(result);
        }

        if (action === 'cuevana') {
            const slug = path[1];
            const cacheKey = `movies:cuevana:${slug}`;
            const cached = getCache(cacheKey);
            if (cached) return res.json(cached);
            const { data } = await scraperGet(`${CUEVANA_BASE}/peliculas/${slug}/`);
            const $ = cheerio.load(data);
            const players = [];
            $('iframe[src], [data-src]').each((_, el) => {
                const src = $(el).attr('src') || $(el).attr('data-src') || '';
                const server = $(el).closest('[data-server]').attr('data-server') || 'Cuevana Player';
                if (src && !src.startsWith('data:')) players.push({ server, url: src, idioma: 'subtitulado' });
            });
            const result = { success: true, title: $('h1.Title, h1').first().text().trim(), poster: $('img.TPostBg, .poster img, img.wp-post-image').first().attr('src') || '', rating: $('.vote, .Score').first().text().trim(), year: ($('.Date, time').first().text().trim().match(/\d{4}/) || [])[0] || '', synopsis: $('.Description p, .entry-content p').first().text().trim(), idiomas: ['subtitulado'], players };
            setCache(cacheKey, result);
            return res.json(result);
        }

        return res.status(404).json({ success: false, message: 'Not found' });
    } catch (e) {
        console.error('Movies API Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
};
