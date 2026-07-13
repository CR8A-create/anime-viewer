const express = require('express');
const cors = require('cors');
const compression = require('compression');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Gzip compression — reduce payload ~70%
app.use(compression());
app.use(express.json());

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Static files con cache de 1 hora en el navegador
app.use(express.static('public', {
    maxAge: '1h',
    etag: true
}));

app.get('/', (req, res) => {
    res.send('¡El servidor API de Anime está funcionando! Abre index.html para ver la página.');
});

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.sendStatus(200);
});

// ============================================================
// API DE ANIME — misma lógica multi-fuente que producción (Vercel).
// Montado ANTES de las rutas legacy de abajo para interceptarlas.
// La lógica vive en api/_lib/animeSources.js + api/anime/[...path].js
// ============================================================
const animeApiHandler = require('./api/anime/[...path].js');
app.all(['/api/anime/:action', '/api/anime/:action/:p1', '/api/anime/:action/:p1/:p2'], (req, res) => {
    req.query.path = [req.params.action, req.params.p1, req.params.p2].filter(Boolean);
    return animeApiHandler(req, res);
});

// Simple in-memory cache
const cache = new Map();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes (anime data barely changes)

function getCache(key) {
    const cached = cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        console.log(`✓ Cache HIT: ${key}`);
        return cached.data;
    }
    console.log(`✗ Cache MISS: ${key}`);
    return null;
}

function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
    console.log(`✓ Cache SET: ${key}`);
}

// Add timeout to axios requests
axios.defaults.timeout = 10000; // 10 seconds

// Helper function to create slug from title
function createSlug(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
        .replace(/\s+/g, '-')         // Replace spaces with hyphens
        .replace(/-+/g, '-');         // Remove duplicate hyphens
}

// Helper to search AnimeFLV if direct slug fails
async function searchAnimeFLV(query) {
    try {
        const searchUrl = `https://www3.animeflv.net/browse?q=${encodeURIComponent(query)}`;
        console.log(`Fallback: Buscando en AnimeFLV: ${searchUrl}`);
        const response = await axios.get(searchUrl);
        const $ = cheerio.load(response.data);

        // Select the first anime in the list
        const firstResult = $('.ListAnimes li article a').first();
        if (firstResult.length > 0) {
            const href = firstResult.attr('href'); // e.g., /anime/re-zero-kara-hajimeru-isekai-seikatsu-3rd-season
            return `https://www3.animeflv.net${href}`;
        }
        return null;
    } catch (error) {
        console.error('Error en búsqueda fallback:', error.message);
        return null;
    }
}

// -1. Get Airing Anime (Carousel)
app.get('/api/airing', async (req, res) => {
    const cacheKey = 'airing';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get('https://www3.animeflv.net/browse?status=1&order=rating');
        const $ = cheerio.load(response.data);
        const airingAnime = [];

        $('.ListAnimes li article').slice(0, 24).each((i, el) => {
            const $el = $(el);
            const title = $el.find('.Title').text().trim();
            const image = $el.find('img').attr('src');
            const url = $el.find('a').attr('href'); // /anime/slug
            const slug = url.split('/').pop();
            // Try to find description if available in listing, strict search pages usually have .Description
            // If not, we might need a placeholder or fetch details (expensive).
            // AnimeFLV browse page usually has .Description p -- let's verify visual memory or generic selector
            let synopsis = $el.find('.Description p').text().trim();
            // Clean unwanted "Anime 4.5" prefix if present due to scraping structure
            synopsis = synopsis.replace(/^Anime\s+\d+(\.\d+)?\s*/i, '');
            if (!synopsis) synopsis = "Mira este anime en español en AniNova.";

            airingAnime.push({
                mal_id: slug, // Use slug for ID
                title: title,
                images: { jpg: { large_image_url: image, image_url: image } },
                synopsis: synopsis,
                score: $el.find('.Vts').text().trim() || 'N/A'
            });
        });

        const result = { success: true, data: airingAnime };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Error scraping airing:', error.message);
        res.status(500).json({ success: false, message: 'Error fetching airing anime' });
    }
});

// 0. Get Recent Episodes (Home Page)
app.get('/api/recent', async (req, res) => {
    const cacheKey = 'recent';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get('https://www3.animeflv.net/');
        const $ = cheerio.load(response.data);
        const recentEpisodes = [];

        $('.ListEpisodios li').each((i, el) => {
            const $el = $(el);
            const title = $el.find('.Title').text().trim();
            const episodeStr = $el.find('.Capi').text().trim(); // "Episodio X"
            const episodeNum = episodeStr.replace(/Episodio\s*/i, '').trim();
            const image = $el.find('img').attr('src');
            const url = $el.find('a').attr('href'); // /ver/slug-episode
            const slug = url.split('/ver/')[1].split('-').slice(0, -1).join('-');

            // Construct Jikan-like structure for frontend compatibility
            recentEpisodes.push({
                entry: {
                    mal_id: slug, // Use slug as ID for local logic
                    title: title,
                    images: { jpg: { image_url: 'https://www3.animeflv.net' + image } }
                },
                episodes: [{ title: `Episodio ${episodeNum}` }] // Used for "type" badge
            });
        });

        const result = { success: true, data: recentEpisodes };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Error scraping recent:', error.message);
        res.status(500).json({ success: false, message: 'Error fetching recent episodes' });
    }
});

// 1. Get Anime Info and Episode List
app.get('/api/anime/:title', async (req, res) => {
    const { title } = req.params;
    const cacheKey = `anime:${title}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    let slug = createSlug(title);
    console.log(`Buscando información de: ${title} (Slug estimado: ${slug})`);

    try {
        let animeUrl = `https://www3.animeflv.net/anime/${slug}`;
        let animePage;

        try {
            animePage = await axios.get(animeUrl);
        } catch (err) {
            console.log('Slug directo falló, intentando búsqueda fallback...');
            const fallbackUrl = await searchAnimeFLV(title);
            if (fallbackUrl) {
                console.log(`Encontrado por búsqueda: ${fallbackUrl}`);
                animeUrl = fallbackUrl;
                // Update slug from found URL for cleaner future use if needed
                slug = fallbackUrl.split('/').pop();
                animePage = await axios.get(animeUrl);
            } else {
                console.log('No se encontró tampoco por búsqueda.');
                return res.json({ success: false, message: 'Anime no encontrado en AnimeFLV.' });
            }
        }

        const $ = cheerio.load(animePage.data);

        const scripts = $('script').map((i, el) => $(el).html()).get();
        const episodesScript = scripts.find(s => s.includes('var episodes ='));

        if (!episodesScript) {
            return res.json({ success: false, message: 'No se encontraron episodios.' });
        }

        const episodesMatch = episodesScript.match(/var episodes = (\[.*?\]);/);
        if (!episodesMatch) {
            return res.json({ success: false, message: 'Error al leer episodios.' });
        }

        // AnimeFLV episodes format: [episodeNum, episodeId]
        // We map it to a cleaner format
        const rawEpisodes = JSON.parse(episodesMatch[1]);
        const episodes = rawEpisodes.map(ep => ({
            number: ep[0],
            id: ep[1]
        }));

        // Scrape details (Spanish)
        // Fallback for description
        let description = $('.Description p').text().trim();
        if (!description) description = $('.Description').text().trim();
        if (!description) description = $('meta[property="og:description"]').attr('content');
        if (!description) description = $('meta[name="description"]').attr('content');

        // Fallback for genres
        let genres = $('.Genres a').map((i, el) => $(el).text()).get();
        if (genres.length === 0) genres = $('.Nvgnrs a').map((i, el) => $(el).text()).get();

        const status = $('.AnmStts').text().trim();
        const rate = $('.vtprmd').text().trim();

        // Sort by number descending (usually already sorted, but good to ensure)
        episodes.sort((a, b) => b.number - a.number);

        const result = {
            success: true,
            slug: slug, // Return the CORRECT slug
            description: description,
            genres: genres,
            status: status,
            rate: rate,
            episodes: episodes
        };

        setCache(cacheKey, result);
        res.json(result);

    } catch (error) {
        console.error('Error en scraping anime:', error.message);
        res.json({ success: false, message: 'Error interno del servidor.' });
    }
});

// 2. Get Video Servers for a Specific Episode
app.get('/api/videos/:slug/:episode', async (req, res) => {
    const { slug, episode } = req.params;
    console.log(`Buscando videos para: ${slug} Episodio ${episode}`);

    try {
        const episodeUrl = `https://www3.animeflv.net/ver/${slug}-${episode}`;

        const episodePage = await axios.get(episodeUrl);
        const $ = cheerio.load(episodePage.data);

        const scripts = $('script').map((i, el) => $(el).html()).get();
        const videosScript = scripts.find(s => s.includes('var videos ='));

        if (!videosScript) {
            return res.json({ success: false, message: 'No se encontraron videos.' });
        }

        const videosMatch = videosScript.match(/var videos = (\{.*?\});/);
        if (!videosMatch) {
            return res.json({ success: false, message: 'Error al leer videos.' });
        }

        const videosData = JSON.parse(videosMatch[1]);
        const servers = videosData.SUB; // We want subtitled

        const mappedServers = servers.map(s => ({
            name: s.server,
            url: s.code
        }));

        res.json({
            success: true,
            servers: mappedServers
        });

    } catch (error) {
        console.error('Error en scraping video:', error.message);
        res.json({ success: false, message: 'Error al obtener videos.' });
    }
});

// ===================================================================
// MOVIES & SERIES ENDPOINTS (TMDB + VidSrc/SuperEmbed)
// ===================================================================

const TMDB_API_KEY = process.env.TMDB_API_KEY || '38e61227f85671163c275f9bd95a8803';
const TMDB_BASE = 'https://api.themoviedb.org/3';

app.get('/api/movies/popular', async (req, res) => {
    const page = req.query.page || 1;
    const cacheKey = `movies:popular:${page}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/movie/popular`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES', page: page }
        });
        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/series/airing', async (req, res) => {
    const page = req.query.page || 1;
    const cacheKey = `series:airing:${page}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/tv/on_the_air`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES', page: page }
        });
        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/movies/search', async (req, res) => {
    const { query, q } = req.query;

    // NEW: dual-source scraping search via ?q=
    if (q) {
        const cacheKey = `scrape-search:${q}`;
        const cached = getCache(cacheKey);
        if (cached) return res.json(cached);
        const [zonaRes, cuevRes] = await Promise.allSettled([
            scrapeZonaAPS_search(q),
            scrapeCuevana_search(q)
        ]);
        const zonaItems = zonaRes.status === 'fulfilled' ? zonaRes.value : [];
        const cuevItems = cuevRes.status === 'fulfilled' ? cuevRes.value : [];
        const combined  = [...zonaItems];
        for (const cv of cuevItems) {
            if (!zonaItems.some(z => titlesMatch(z.title, cv.title))) combined.push(cv);
        }
        const result = { success: true, data: combined };
        setCache(cacheKey, result);
        return res.json(result);
    }

    // LEGACY: TMDB search via ?query=
    if (!query) return res.status(400).json({ success: false, message: 'Query required' });
    const cacheKey = `search:${query}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);
    try {
        const response = await axios.get(`${TMDB_BASE}/search/multi`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES', query: query }
        });
        const result = { success: true, data: response.data.results };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Helper: get IMDB ID from TMDB (needed for some embed providers)
async function getImdbId(tmdbId, type = 'movie') {
    const cacheKey = `imdb:${type}:${tmdbId}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    try {
        const endpoint = type === 'tv' ? 'tv' : 'movie';
        const response = await axios.get(`${TMDB_BASE}/${endpoint}/${tmdbId}/external_ids`, {
            params: { api_key: TMDB_API_KEY }
        });
        const imdbId = response.data.imdb_id || null;
        if (imdbId) setCache(cacheKey, imdbId);
        return imdbId;
    } catch (error) {
        console.error('Error fetching IMDB ID:', error.message);
        return null;
    }
}

// Movie servers — supports lang param: 'en' (default) or 'es' (dubbed)
app.get('/api/movies/servers/:tmdbId/:lang?', async (req, res) => {
    const { tmdbId } = req.params;
    const lang = req.params.lang || 'en';
    const cacheKey = `movie-servers:${tmdbId}:${lang}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    let servers;

    if (lang === 'es') {
        // Servidores con audio en español — proveedores con mejor soporte multi-idioma
        const imdbId = await getImdbId(tmdbId, 'movie');
        servers = [
            { name: 'Embed.su ES', url: `https://embed.su/embed/movie/${tmdbId}?lang=Spanish` },
            { name: 'MultiEmbed ES', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&lang=es` },
            { name: 'AutoEmbed ES', url: `https://player.autoembed.cc/embed/movie/${tmdbId}?lang=spa` },
            { name: 'MoviesAPI ES', url: `https://moviesapi.club/movie/${tmdbId}?lang=es` },
        ];
        if (imdbId) {
            servers.push({ name: 'WarezCDN ES', url: `https://embed.warezcdn.com/filme/${imdbId}` });
        }
    } else {
        // Servidores originales (inglés + sub español)
        servers = [
            { name: 'VidSrc.to', url: `https://vidsrc.to/embed/movie/${tmdbId}` },
            { name: 'Embed.su', url: `https://embed.su/embed/movie/${tmdbId}` },
            { name: 'VidSrc PRO', url: `https://vidsrc.pro/embed/movie/${tmdbId}` },
            { name: 'VidSrc.in', url: `https://vidsrc.in/embed/movie?tmdb=${tmdbId}` },
            { name: 'SmashyStream', url: `https://player.smashy.stream/movie/${tmdbId}` },
            { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/movie/${tmdbId}` }
        ];
    }

    const result = { success: true, servers, lang };
    setCache(cacheKey, result);
    res.json(result);
});

// Series servers — supports lang param
app.get('/api/series/servers/:tmdbId/:season/:episode/:lang?', async (req, res) => {
    const { tmdbId, season, episode } = req.params;
    const lang = req.params.lang || 'en';
    const cacheKey = `series-servers:${tmdbId}:${season}:${episode}:${lang}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    let servers;

    if (lang === 'es') {
        const imdbId = await getImdbId(tmdbId, 'tv');
        servers = [
            { name: 'Embed.su ES', url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}?lang=Spanish` },
            { name: 'MultiEmbed ES', url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}&lang=es` },
            { name: 'AutoEmbed ES', url: `https://player.autoembed.cc/embed/tv/${tmdbId}/${season}/${episode}?lang=spa` },
            { name: 'MoviesAPI ES', url: `https://moviesapi.club/tv/${tmdbId}/${season}/${episode}?lang=es` },
        ];
        if (imdbId) {
            servers.push({ name: 'WarezCDN ES', url: `https://embed.warezcdn.com/serie/${imdbId}/${season}/${episode}` });
        }
    } else {
        servers = [
            { name: 'VidSrc.to', url: `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}` },
            { name: 'Embed.su', url: `https://embed.su/embed/tv/${tmdbId}/${season}/${episode}` },
            { name: 'VidSrc PRO', url: `https://vidsrc.pro/embed/tv/${tmdbId}/${season}/${episode}` },
            { name: 'VidSrc.in', url: `https://vidsrc.in/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}` },
            { name: 'SmashyStream', url: `https://player.smashy.stream/tv/${tmdbId}?s=${season}&e=${episode}` },
            { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/tv/${tmdbId}/${season}/${episode}` }
        ];
    }

    const result = { success: true, servers, lang };
    setCache(cacheKey, result);
    res.json(result);
});

app.get('/api/series/details/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;
    const cacheKey = `series-details:${tmdbId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/tv/${tmdbId}`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES' }
        });
        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Movie details (for player info panel)
app.get('/api/movies/details/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;
    const cacheKey = `movie-details:${tmdbId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/movie/${tmdbId}`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES' }
        });
        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Episode details (for Netflix-style overlay)
app.get('/api/series/episode/:tmdbId/:season/:episode', async (req, res) => {
    const { tmdbId, season, episode } = req.params;
    const cacheKey = `episode-detail:${tmdbId}:${season}:${episode}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${season}/episode/${episode}`, {
            params: { api_key: TMDB_API_KEY, language: 'es-ES' }
        });
        const result = { success: true, data: response.data };
        setCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ===================================================================
// ZONAAPS + CUEVANA — PELÍCULAS EN ESPAÑOL
// ===================================================================

const SCRAPER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ZONAAPS_BASE = 'https://zonaaps.com';
const CUEVANA_BASE = 'https://www.cuevana3.io';

function scraperGet(url) {
    return axios.get(url, {
        timeout: 8000,
        headers: { 'User-Agent': SCRAPER_UA }
    });
}

function normTitle(t) {
    return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titlesMatch(a, b) {
    const na = normTitle(a), nb = normTitle(b);
    if (na === nb) return true;
    if (na.length < 5 || nb.length < 5) return false;
    return na.includes(nb) || nb.includes(na);
}

function parseLangBadges($el, $) {
    const idiomas = [];
    const BADGES = ['latino', 'castellano', 'ingles', 'portugues', 'japones', 'subtitulado'];
    $el.find('img').each((_, img) => {
        const src = ($(img).attr('src') || $(img).attr('data-src') || '').toLowerCase();
        const alt = ($(img).attr('alt') || '').toLowerCase();
        for (const b of BADGES) {
            if ((src.includes(b) || alt.includes(b)) && !idiomas.includes(b)) idiomas.push(b);
        }
    });
    return idiomas;
}

function extractMovieSlug(href) {
    return (href || '').replace(/\/$/, '').split('/').pop();
}

// --- ZonaAPS scraper helpers ---

async function scrapeZonaAPS_search(query) {
    try {
        const { data } = await scraperGet(`${ZONAAPS_BASE}/?s=${encodeURIComponent(query)}`);
        const $ = cheerio.load(data);
        const results = [];
        $('article, .TPostMv, .ml-item').each((_, el) => {
            const $el  = $(el);
            const a    = $el.find(`a[href*="zonaaps.com"]`).first().length
                       ? $el.find(`a[href*="zonaaps.com"]`).first()
                       : $el.find('a').first();
            const href  = a.attr('href') || '';
            const slug  = extractMovieSlug(href);
            const title = ($el.find('h2, .Title, .entry-title').first().text().trim()
                         || a.attr('title') || '').trim();
            const poster  = $el.find('img').attr('src') || $el.find('img').attr('data-src') || '';
            const rating  = $el.find('.vote, .Score, .rating').first().text().trim();
            const year    = ($el.find('.year, .Year, time').first().text().trim().match(/\d{4}/) || [])[0] || '';
            const idiomas = parseLangBadges($el, $);
            if (title && slug) results.push({ title, slug, poster, rating, year, idiomas, source: 'zonaaps' });
        });
        return results;
    } catch (e) {
        console.error('ZonaAPS search error:', e.message);
        return [];
    }
}

async function scrapeZonaAPS_detail(slug) {
    const url = `${ZONAAPS_BASE}/movies/${slug}/`;
    const { data } = await scraperGet(url);
    const $ = cheerio.load(data);
    const title    = $('h1.Title, h1.entry-title, h1').first().text().trim();
    const poster   = $('img.TPostBg, .poster img, img.wp-post-image').first().attr('src') || '';
    const rating   = $('.vote, .Score, .rating').first().text().trim();
    const year     = ($('.Date, time, .year').first().text().trim().match(/\d{4}/) || [])[0] || '';
    const synopsis = $('.Description p, .entry-content p, .sinopsis p').first().text().trim();
    const idiomas  = parseLangBadges($('body'), $);
    const players  = [];
    $('[data-src], iframe[src]').each((_, el) => {
        const $el   = $(el);
        const src   = $el.attr('data-src') || $el.attr('src') || '';
        const server = $el.closest('[data-server]').attr('data-server')
                     || $el.attr('data-server')
                     || 'Player';
        const idioma = $el.closest('[data-lang]').attr('data-lang') || 'desconocido';
        if (src && !src.startsWith('data:')) players.push({ server, url: src, idioma });
    });
    return { title, poster, rating, year, synopsis, idiomas, players };
}

// --- Cuevana scraper helpers ---

async function scrapeCuevana_search(query) {
    try {
        const { data } = await scraperGet(`${CUEVANA_BASE}/?s=${encodeURIComponent(query)}`);
        const $ = cheerio.load(data);
        const results = [];
        $('article, .TPostMv, .ml-item').each((_, el) => {
            const $el  = $(el);
            const a    = $el.find('a').first();
            const href = a.attr('href') || '';
            const slug = extractMovieSlug(href);
            const title = ($el.find('h2, .Title, .entry-title').first().text().trim()
                         || a.attr('title') || '').trim();
            const poster = $el.find('img').attr('src') || $el.find('img').attr('data-src') || '';
            const rating = $el.find('.vote, .Score').first().text().trim();
            const year   = ($el.find('.Year, time').first().text().trim().match(/\d{4}/) || [])[0] || '';
            if (title && slug) results.push({ title, slug, poster, rating, year, idiomas: ['subtitulado'], source: 'cuevana' });
        });
        return results;
    } catch (e) {
        console.error('Cuevana search error:', e.message);
        return [];
    }
}

async function scrapeCuevana_detail(slug) {
    const url = `${CUEVANA_BASE}/peliculas/${slug}/`;
    const { data } = await scraperGet(url);
    const $ = cheerio.load(data);
    const title    = $('h1.Title, h1').first().text().trim();
    const poster   = $('img.TPostBg, .poster img, img.wp-post-image').first().attr('src') || '';
    const rating   = $('.vote, .Score').first().text().trim();
    const year     = ($('.Date, time').first().text().trim().match(/\d{4}/) || [])[0] || '';
    const synopsis = $('.Description p, .entry-content p').first().text().trim();
    const players  = [];
    $('iframe[src], [data-src]').each((_, el) => {
        const src    = $(el).attr('src') || $(el).attr('data-src') || '';
        const server = $(el).closest('[data-server]').attr('data-server') || 'Cuevana Player';
        if (src && !src.startsWith('data:')) players.push({ server, url: src, idioma: 'subtitulado' });
    });
    return { title, poster, rating, year, synopsis, idiomas: ['subtitulado'], players };
}

// GET /api/movies/zonaaps/:slug — detalle de película desde ZonaAPS
app.get('/api/movies/zonaaps/:slug', async (req, res) => {
    const { slug } = req.params;
    const cacheKey = `zonaaps-detail:${slug}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);
    try {
        const detail = await scrapeZonaAPS_detail(slug);
        const result = { success: true, ...detail };
        setCache(cacheKey, result);
        res.json(result);
    } catch (e) {
        console.error('ZonaAPS detail error:', e.message);
        res.status(500).json({ error: e.message, data: [] });
    }
});

// GET /api/movies/cuevana/:slug — detalle de película desde Cuevana
app.get('/api/movies/cuevana/:slug', async (req, res) => {
    const { slug } = req.params;
    const cacheKey = `cuevana-detail:${slug}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);
    try {
        const detail = await scrapeCuevana_detail(slug);
        const result = { success: true, ...detail };
        setCache(cacheKey, result);
        res.json(result);
    } catch (e) {
        console.error('Cuevana detail error:', e.message);
        res.status(500).json({ error: e.message, data: [] });
    }
});

// GET /api/movies/latino — películas con badge latino de ZonaAPS
app.get('/api/movies/latino', async (req, res) => {
    const cacheKey = 'zonaaps:latino';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);
    try {
        const { data } = await scraperGet(`${ZONAAPS_BASE}/movies/`);
        const $ = cheerio.load(data);
        const items = [];
        $('article, .TPostMv, .ml-item').each((_, el) => {
            const $el    = $(el);
            const idiomas = parseLangBadges($el, $);
            if (!idiomas.includes('latino')) return;
            const a    = $el.find('a').first();
            const href = a.attr('href') || '';
            const slug = extractMovieSlug(href);
            const title = ($el.find('h2, .Title, .entry-title').first().text().trim()
                         || a.attr('title') || '').trim();
            const poster = $el.find('img').attr('src') || $el.find('img').attr('data-src') || '';
            const rating = $el.find('.vote, .Score').first().text().trim();
            if (title && slug) items.push({ title, slug, poster, rating, idiomas, source: 'zonaaps' });
        });
        const result = { success: true, data: items };
        setCache(cacheKey, result);
        res.json(result);
    } catch (e) {
        console.error('ZonaAPS latino error:', e.message);
        res.status(500).json({ error: e.message, data: [] });
    }
});

// GET /api/movies/recientes — últimas 20 películas combinando ZonaAPS + Cuevana
app.get('/api/movies/recientes', async (req, res) => {
    const cacheKey = 'movies:recientes';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    async function fetchZonaRecent() {
        const { data } = await scraperGet(`${ZONAAPS_BASE}/movies/`);
        const $ = cheerio.load(data);
        const items = [];
        $('article, .TPostMv, .ml-item').slice(0, 15).each((_, el) => {
            const $el  = $(el);
            const a    = $el.find('a').first();
            const slug = extractMovieSlug(a.attr('href') || '');
            const title = ($el.find('h2, .Title, .entry-title').first().text().trim()
                         || a.attr('title') || '').trim();
            const poster  = $el.find('img').attr('src') || $el.find('img').attr('data-src') || '';
            const rating  = $el.find('.vote, .Score').first().text().trim();
            const idiomas = parseLangBadges($el, $);
            if (title && slug) items.push({ title, slug, poster, rating, idiomas, source: 'zonaaps' });
        });
        return items;
    }

    async function fetchCuevanaRecent() {
        const { data } = await scraperGet(`${CUEVANA_BASE}/peliculas/`);
        const $ = cheerio.load(data);
        const items = [];
        $('article, .TPostMv, .ml-item').slice(0, 15).each((_, el) => {
            const $el  = $(el);
            const a    = $el.find('a').first();
            const slug = extractMovieSlug(a.attr('href') || '');
            const title = ($el.find('h2, .Title, .entry-title').first().text().trim()
                         || a.attr('title') || '').trim();
            const poster = $el.find('img').attr('src') || $el.find('img').attr('data-src') || '';
            const rating = $el.find('.vote, .Score').first().text().trim();
            if (title && slug) items.push({ title, slug, poster, rating, idiomas: ['subtitulado'], source: 'cuevana' });
        });
        return items;
    }

    const [zonaRes, cuevRes] = await Promise.allSettled([fetchZonaRecent(), fetchCuevanaRecent()]);
    const zonaItems = zonaRes.status === 'fulfilled' ? zonaRes.value : [];
    const cuevItems = cuevRes.status === 'fulfilled' ? cuevRes.value : [];
    const combined  = [...zonaItems];
    for (const cv of cuevItems) {
        if (!zonaItems.some(z => titlesMatch(z.title, cv.title))) combined.push(cv);
    }
    const result = { success: true, data: combined.slice(0, 20) };
    setCache(cacheKey, result);
    res.json(result);
});

// ===================================================================
// ANONYMOUS COMMENTS SYSTEM
// ===================================================================

const COMMENTS_DIR = path.join(__dirname, 'data');
const COMMENTS_FILE = path.join(COMMENTS_DIR, 'comments.json');
const commentRateLimit = new Map(); // IP -> timestamp

// Ensure data directory exists
if (!fs.existsSync(COMMENTS_DIR)) {
    fs.mkdirSync(COMMENTS_DIR, { recursive: true });
}
if (!fs.existsSync(COMMENTS_FILE)) {
    fs.writeFileSync(COMMENTS_FILE, '{}');
}

function loadComments() {
    try {
        return JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf8'));
    } catch { return {}; }
}

function saveComments(data) {
    fs.writeFileSync(COMMENTS_FILE, JSON.stringify(data, null, 2));
}

// Random anonymous names
const ANON_NAMES = [
    'Naruto Fan', 'Otaku Oscuro', 'Senpai Anónimo', 'Weeb Silencioso',
    'Ninja del Sofá', 'Samurai sin Nombre', 'Pirata del Streaming',
    'Cazador de Series', 'Shinigami Anónimo', 'Héroe Random',
    'Dragón Nocturno', 'Fantasma del Chat', 'Leyenda Oculta',
    'Titán Anónimo', 'Espíritu Libre', 'Lobo Solitario',
    'Viajero del Tiempo', 'Caballero Oscuro', 'Phoenix Anónimo'
];

function getAnonName() {
    return ANON_NAMES[Math.floor(Math.random() * ANON_NAMES.length)];
}

// GET comments for a content
app.get('/api/comments/:contentId', (req, res) => {
    const { contentId } = req.params;
    const allComments = loadComments();
    const comments = allComments[contentId] || [];
    res.json({ success: true, comments });
});

// POST a new comment
app.post('/api/comments/:contentId', (req, res) => {
    const { contentId } = req.params;
    const { text } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Validations
    if (!text || text.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Comentario vacío' });
    }
    if (text.length > 500) {
        return res.status(400).json({ success: false, message: 'Máximo 500 caracteres' });
    }

    // Rate limit: 1 comment per 30 seconds per IP
    const lastComment = commentRateLimit.get(ip);
    if (lastComment && Date.now() - lastComment < 30000) {
        const wait = Math.ceil((30000 - (Date.now() - lastComment)) / 1000);
        return res.status(429).json({ success: false, message: `Espera ${wait}s para comentar de nuevo` });
    }

    const allComments = loadComments();
    if (!allComments[contentId]) allComments[contentId] = [];

    const comment = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        name: getAnonName(),
        text: text.trim().substring(0, 500),
        timestamp: new Date().toISOString()
    };

    allComments[contentId].push(comment);

    // Keep only last 100 comments per content
    if (allComments[contentId].length > 100) {
        allComments[contentId] = allComments[contentId].slice(-100);
    }

    saveComments(allComments);
    commentRateLimit.set(ip, Date.now());

    res.json({ success: true, comment });
});

// ===================================================================
// SERVER START + KEEP-ALIVE + PRE-FETCH
// ===================================================================

app.listen(PORT, () => {
    console.log(`\n✓ Servidor API corriendo en http://localhost:${PORT}`);
    console.log(`📺 Anime: http://localhost:${PORT}/anime/index.html`);
    console.log(`🎬 Movies: http://localhost:${PORT}/movies/index.html\n`);

    // Pre-fetch: llenar caché al arrancar para que el primer usuario tenga datos
    console.log('🔄 Pre-cargando datos en caché...');
    Promise.allSettled([
        axios.get(`http://localhost:${PORT}/api/airing`),
        axios.get(`http://localhost:${PORT}/api/recent`),
        axios.get(`http://localhost:${PORT}/api/movies/popular?page=1`),
        axios.get(`http://localhost:${PORT}/api/series/airing?page=1`)
    ]).then(results => {
        const ok = results.filter(r => r.status === 'fulfilled').length;
        console.log(`✓ Pre-fetch completado: ${ok}/4 endpoints cargados en caché`);
    });

    // Self-ping keep-alive: evita que Render.com apague el servidor
    if (process.env.RENDER) {
        const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `https://mi-anime-api.onrender.com`;
        setInterval(() => {
            axios.get(`${RENDER_URL}/api/health`)
                .then(() => console.log('♻ Keep-alive ping OK'))
                .catch(() => console.log('♻ Keep-alive ping sent'));
        }, 14 * 60 * 1000); // Cada 14 minutos
        console.log('♻ Keep-alive activado (ping cada 14 min)');
    }
});
