const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 4000;

// CORS configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Cache system
const cache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

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

// Cuevana domain - puede cambiar
const CUEVANA_DOMAIN = process.env.CUEVANA_DOMAIN || 'https://cuevana3.rip';

// User agent para evitar bloqueos
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', server: 'Movies API - Cuevana Scraper', timestamp: new Date().toISOString() });
});

// ====================================================================
// SEARCH ENDPOINT
// ====================================================================
app.get('/api/search', async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ success: false, message: 'Query parameter required' });
    }

    const cacheKey = `search:${query}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        console.log(`🔍 Searching Cuevana for: ${query}`);

        const searchUrl = `${CUEVANA_DOMAIN}/search?q=${encodeURIComponent(query)}`;
        const response = await axios.get(searchUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const results = [];

        // Selectors pueden variar - ajustar según estructura actual de Cuevana
        $('.item').each((i, elem) => {
            const $elem = $(elem);

            const title = $elem.find('.title').text().trim() || $elem.find('h2').text().trim();
            const link = $elem.find('a').attr('href');
            const poster = $elem.find('img').attr('data-src') || $elem.find('img').attr('src');
            const year = $elem.find('.year').text().trim();

            if (title && link) {
                const id = link.split('/').pop(); // Extract ID from URL
                const type = link.includes('/serie/') ? 'tv' : 'movie';

                results.push({
                    id: id,
                    title: title,
                    poster: poster || 'https://via.placeholder.com/300x450?text=No+Image',
                    year: year,
                    type: type,
                    link: link
                });
            }
        });

        console.log(`✓ Found ${results.length} results for: ${query}`);

        const result = { success: true, data: results };
        setCache(cacheKey, result);
        res.json(result);

    } catch (error) {
        console.error('❌ Search error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error al buscar en Cuevana',
            error: error.message
        });
    }
});

// ====================================================================
// GET MOVIE/SERIES DETAILS AND STREAMING LINKS
// ====================================================================
app.get('/api/watch/:type/:id', async (req, res) => {
    const { type, id } = req.params; // type: 'movie' or 'series'
    const { season, episode } = req.query;

    const cacheKey = `watch:${type}:${id}:${season || ''}:${episode || ''}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        console.log(`🎬 Getting streaming links for ${type}: ${id}`);

        // Construir URL de Cuevana
        let cuevanaUrl = `${CUEVANA_DOMAIN}/${type === 'series' ? 'serie' : 'pelicula'}/${id}`;

        const response = await axios.get(cuevanaUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);

        // Extraer información
        const title = $('h1').first().text().trim();
        const synopsis = $('.description').text().trim() || $('.sinopsis').text().trim();
        const poster = $('img.poster').attr('src') || $('.poster img').attr('src');

        // Extraer enlaces de streaming (pueden estar en iframes o enlaces directos)
        const streamingOptions = [];

        // Buscar opciones de idioma
        $('.language-options a, .audio-options a, .server-option').each((i, elem) => {
            const $elem = $(elem);
            const language = $elem.text().trim().toLowerCase();
            const link = $elem.attr('href') || $elem.attr('data-url');

            if (link) {
                let audioType = 'subtitulado';
                if (language.includes('latino')) audioType = 'latino';
                if (language.includes('castellano') || language.includes('español')) audioType = 'castellano';

                streamingOptions.push({
                    audio: audioType,
                    url: link.startsWith('http') ? link : `${CUEVANA_DOMAIN}${link}`
                });
            }
        });

        // Si no encuentra opciones específicas, buscar iframes genéricos
        if (streamingOptions.length === 0) {
            $('iframe').each((i, elem) => {
                const src = $(elem).attr('src');
                if (src && src.includes('embed')) {
                    streamingOptions.push({
                        audio: 'disponible',
                        url: src
                    });
                }
            });
        }

        console.log(`✓ Found ${streamingOptions.length} streaming options`);

        const result = {
            success: true,
            data: {
                title: title,
                synopsis: synopsis,
                poster: poster,
                streamingOptions: streamingOptions
            }
        };

        setCache(cacheKey, result);
        res.json(result);

    } catch (error) {
        console.error('❌ Watch error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error al obtener enlaces de streaming',
            error: error.message
        });
    }
});

// ====================================================================
// POPULAR MOVIES (Scrape from Cuevana homepage)
// ====================================================================
app.get('/api/popular', async (req, res) => {
    const cacheKey = 'popular:movies';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        console.log('🔥 Fetching popular movies from Cuevana');

        const response = await axios.get(CUEVANA_DOMAIN, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const popular = [];

        $('.item, .movie-item, .grid-item').slice(0, 20).each((i, elem) => {
            const $elem = $(elem);

            const title = $elem.find('.title').text().trim() || $elem.find('h2, h3').text().trim();
            const link = $elem.find('a').attr('href');
            const poster = $elem.find('img').attr('data-src') || $elem.find('img').attr('src');
            const rating = $elem.find('.rating').text().trim();

            if (title && link) {
                const id = link.split('/').pop();
                const type = link.includes('/serie/') ? 'tv' : 'movie';

                popular.push({
                    id: id,
                    title: title,
                    poster: poster || 'https://via.placeholder.com/300x450?text=No+Image',
                    rating: rating || 'N/A',
                    type: type
                });
            }
        });

        console.log(`✓ Found ${popular.length} popular items`);

        const result = { success: true, data: popular };
        setCache(cacheKey, result);
        res.json(result);

    } catch (error) {
        console.error('❌ Popular error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error al obtener contenido popular',
            error: error.message
        });
    }
});

// ====================================================================
// START SERVER
// ====================================================================
app.listen(PORT, () => {
    console.log(`\n✓ Servidor Movies API corriendo en http://localhost:${PORT}`);
    console.log(`🎬 Dominio Cuevana: ${CUEVANA_DOMAIN}`);
    console.log(`📝 Endpoints disponibles:`);
    console.log(`   GET /api/health`);
    console.log(`   GET /api/search?query=terminator`);
    console.log(`   GET /api/popular`);
    console.log(`   GET /api/watch/:type/:id`);
    console.log(``);
});
