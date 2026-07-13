const axios = require('axios');

// ============================================================
// CORS — Strict origin validation
// ============================================================
const ALLOWED_ORIGINS = [
    'https://aninova.netlify.app',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8080',
];

/**
 * Sets CORS headers and handles OPTIONS preflight.
 * @returns {boolean} true if request was an OPTIONS preflight (already handled)
 */
function cors(req, res) {
    const headers = (req && req.headers) || {};
    const origin = headers.origin || '';
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}

// ============================================================
// IN-MEMORY CACHE (persists across warm invocations ~5min)
// ============================================================
const cache = new Map();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes (default)
const STALE_DURATION = 24 * 60 * 60 * 1000; // ventana "stale": servir datos viejos si TODAS las fuentes fallan

function getCache(key) {
    const cached = cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < cached.ttl) {
        return cached.data;
    }
    return null;
}

/**
 * Datos expirados pero aún dentro de la ventana stale (24h).
 * Solo usar como último recurso cuando el scraping falla por completo.
 */
function getStale(key) {
    const cached = cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < STALE_DURATION) {
        return cached.data;
    }
    cache.delete(key);
    return null;
}

function setCache(key, data, ttl = CACHE_DURATION) {
    cache.set(key, { data, timestamp: Date.now(), ttl });
    // Evict oldest entries to prevent memory bloat in serverless
    if (cache.size > 200) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
}

// ============================================================
// USER-AGENT ROTATION (15 real, modern UAs)
// ============================================================
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/110.0.0.0',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

function getRandomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Axios GET with anti-block headers, rotating UA, and optional proxy support.
 * `opts.timeout` permite acortar el timeout por petición (útil al sondear
 * candidatos de slug sin quemar el presupuesto de la función serverless).
 */
function scraperGet(url, extraHeaders = {}, opts = {}) {
    const ua = getRandomUA();
    let parsedOrigin;
    try { parsedOrigin = new URL(url).origin; } catch { parsedOrigin = ''; }

    const config = {
        timeout: opts.timeout || 8000,
        headers: {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': parsedOrigin + '/',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
            ...extraHeaders,
        },
        decompress: true,
    };

    // Proxy support — activated via PROXY_URL env var
    if (process.env.PROXY_URL) {
        try {
            const { HttpsProxyAgent } = require('https-proxy-agent');
            config.httpsAgent = new HttpsProxyAgent(process.env.PROXY_URL);
        } catch { /* https-proxy-agent not installed, skip */ }
    }

    return axios.get(url, config);
}

// ============================================================
// TMDB Helpers
// ============================================================
const TMDB_API_KEY = process.env.TMDB_API_KEY || '38e61227f85671163c275f9bd95a8803';
const TMDB_BASE = 'https://api.themoviedb.org/3';

function tmdbGet(endpoint, params = {}) {
    return axios.get(`${TMDB_BASE}${endpoint}`, {
        timeout: 8000,
        params: { api_key: TMDB_API_KEY, language: 'es-ES', ...params },
    });
}

async function getImdbId(tmdbId, type = 'movie') {
    const cacheKey = `imdb:${type}:${tmdbId}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;
    try {
        const endpoint = type === 'tv' ? 'tv' : 'movie';
        const { data } = await axios.get(`${TMDB_BASE}/${endpoint}/${tmdbId}/external_ids`, {
            timeout: 8000,
            params: { api_key: TMDB_API_KEY },
        });
        const imdbId = data.imdb_id || null;
        if (imdbId) setCache(cacheKey, imdbId);
        return imdbId;
    } catch { return null; }
}

// ============================================================
// Scraper Domain Constants
// ============================================================
const ZONAAPS_BASE = 'https://zonaaps.com';
const CUEVANA_BASE = 'https://www.cuevana3.io';

// ============================================================
// Common Utility Functions
// ============================================================
function createSlug(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
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

function extractMovieSlug(href) {
    return (href || '').replace(/\/$/, '').split('/').pop();
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

module.exports = {
    cors, getCache, getStale, setCache,
    scraperGet, getRandomUA,
    tmdbGet, getImdbId, TMDB_API_KEY, TMDB_BASE,
    ZONAAPS_BASE, CUEVANA_BASE,
    createSlug, normTitle, titlesMatch, extractMovieSlug, parseLangBadges,
    ALLOWED_ORIGINS,
};
