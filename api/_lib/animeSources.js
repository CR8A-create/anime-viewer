// ============================================================
// MOTOR MULTI-FUENTE DE ANIME
// ------------------------------------------------------------
// Cada capacidad (airing, recent, info, videos, search) tiene una
// lista ordenada de fuentes. Si una falla, se prueba la siguiente.
// Para actualizar selectores cuando un sitio cambie de HTML,
// edita SOLO la función del proveedor correspondiente aquí.
// Guía de mantenimiento: ver SOURCES.md en la raíz del repo.
// ============================================================
const cheerio = require('cheerio');
const axios = require('axios');
const { scraperGet, createSlug, normTitle } = require('./shared');

// ------------------------------------------------------------
// CONFIGURACIÓN DE FUENTES
// domains: se prueban en orden; el que funcione queda "fijado"
// mientras la función serverless siga caliente.
// ------------------------------------------------------------
const SOURCES = {
    animeflv: {
        name: 'AnimeFLV',
        domains: ['https://www3.animeflv.net', 'https://www4.animeflv.net', 'https://animeflv.net'],
    },
    tioanime: {
        name: 'TioAnime',
        domains: ['https://tioanime.com'],
    },
    jkanime: {
        name: 'JKAnime',
        domains: ['https://jkanime.net'],
    },
    monoschinos: {
        name: 'MonosChinos',
        domains: ['https://monoschinos.st', 'https://monoschinos2.com'],
    },
    jikan: {
        name: 'Jikan (MyAnimeList)',
        domains: ['https://api.jikan.moe'],
    },
};

// Orden de preferencia por capacidad. Cambiar el orden aquí cambia
// qué fuente se intenta primero — no hace falta tocar nada más.
const SOURCE_ORDER = {
    airing: ['animeflv', 'tioanime', 'jikan'],
    recent: ['animeflv', 'tioanime', 'monoschinos'],
    info: ['animeflv', 'tioanime', 'jikan'],
    videos: ['tioanime', 'jkanime', 'monoschinos', 'animeflv'],
};

// ------------------------------------------------------------
// SALUD DE FUENTES (en memoria; se reinicia en cada cold start)
// ------------------------------------------------------------
const health = {};
for (const key of Object.keys(SOURCES)) {
    health[key] = { activeDomainIdx: 0, lastOk: null, lastFail: null, lastError: null, lastMs: null, consecFails: 0 };
}

const BREAKER_THRESHOLD = 3;          // fallos seguidos para abrir el breaker
const BREAKER_COOLDOWN = 4 * 60 * 1000; // tiempo antes de reintentar una fuente caída

function breakerOpen(key) {
    const h = health[key];
    return h.consecFails >= BREAKER_THRESHOLD && h.lastFail && (Date.now() - h.lastFail) < BREAKER_COOLDOWN;
}

function markOk(key, ms) {
    const h = health[key];
    h.lastOk = Date.now();
    h.lastMs = ms;
    h.consecFails = 0;
}

function markFail(key, err) {
    const h = health[key];
    h.lastFail = Date.now();
    h.lastError = (err && err.message) || String(err);
    h.consecFails++;
}

/**
 * GET a una fuente probando sus dominios en orden. Un 404 se propaga
 * como NOT_FOUND sin rotar dominio (el dominio funciona, la página no
 * existe). Errores de red/403/5xx rotan al siguiente dominio.
 */
async function sourceGet(key, path, opts = {}) {
    const src = SOURCES[key];
    const h = health[key];
    const start = (h.activeDomainIdx < src.domains.length) ? h.activeDomainIdx : 0;
    let lastErr;

    for (let i = 0; i < src.domains.length; i++) {
        const idx = (start + i) % src.domains.length;
        const url = src.domains[idx] + path;
        const t0 = Date.now();
        try {
            const res = await scraperGet(url, opts.headers || {}, { timeout: opts.timeout || 6500 });
            h.activeDomainIdx = idx;
            markOk(key, Date.now() - t0);
            return res;
        } catch (e) {
            if (e.response && e.response.status === 404) {
                // El dominio responde: la página pedida no existe.
                markOk(key, Date.now() - t0);
                const nf = new Error(`NOT_FOUND: ${url}`);
                nf.notFound = true;
                throw nf;
            }
            lastErr = e;
        }
    }
    markFail(key, lastErr);
    throw lastErr || new Error(`Sin dominios disponibles para ${key}`);
}

/**
 * GET a la API de Jikan (JSON, sin headers de scraping).
 * Jikan devuelve 429/5xx intermitentes con frecuencia: un reintento
 * corto resuelve la mayoría.
 */
async function jikanGet(path) {
    const t0 = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await axios.get(`https://api.jikan.moe${path}`, { timeout: 7000 });
            markOk('jikan', Date.now() - t0);
            return res;
        } catch (e) {
            const status = e.response && e.response.status;
            const retryable = status === 429 || (status >= 500);
            if (attempt === 0 && retryable) {
                await new Promise(r => setTimeout(r, 400));
                continue;
            }
            markFail('jikan', e);
            throw e;
        }
    }
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
function absolutize(url, base) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    return base.replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);
}

function activeDomain(key) {
    const src = SOURCES[key];
    return src.domains[health[key].activeDomainIdx] || src.domains[0];
}

/** Extrae `var nombre = [...]` o `var nombre = {...}` de un HTML y lo parsea. */
function parseJsVar(html, varName) {
    if (typeof html !== 'string') return null;
    const m = html.match(new RegExp(`var\\s+${varName}\\s*=\\s*(\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\});`));
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
}

function tokens(t) {
    return normTitleSpaced(t).split(' ').filter(Boolean);
}

function normTitleSpaced(t) {
    return (t || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Puntúa qué tan bien `candidate` corresponde a `query`.
 * exacto > prefijo > contenido > solapamiento de palabras.
 * Penaliza diferencia de longitud (prefiere "One Piece" sobre
 * "One Piece: Episode of Sorajima" al buscar "one piece").
 */
function matchScore(query, candidate) {
    const nq = normTitle(query), nc = normTitle(candidate);
    if (!nq || !nc) return 0;
    if (nq === nc) return 1000;
    let score = 0;
    if (nc.startsWith(nq) || nq.startsWith(nc)) score = 600;
    else if (nc.includes(nq) || nq.includes(nc)) score = 400;
    else {
        const qset = new Set(tokens(query));
        const ctoks = tokens(candidate);
        const common = ctoks.filter(w => qset.has(w)).length;
        if (common === 0) return 0;
        score = Math.round(300 * common / Math.max(qset.size, ctoks.length));
    }
    return score - Math.min(Math.abs(nc.length - nq.length), 100);
}

/** Elige el mejor resultado de búsqueda para `query` (o null). */
function pickBestMatch(query, results, minScore = 100) {
    let best = null, bestScore = 0;
    for (const r of results) {
        const s = matchScore(query, r.title);
        if (s > bestScore) { best = r; bestScore = s; }
    }
    return (best && bestScore >= minScore) ? best : null;
}

/** Variantes de slug a probar entre sitios (FLV usa -tv, otros no, etc.) */
function slugCandidates(slug, extraSuffixes = []) {
    const base = slug.replace(/-(tv|ova|movie|special|specials)$/, '');
    const out = [slug, base, `${base}-tv`];
    for (const suf of extraSuffixes) {
        out.push(`${slug}${suf}`, `${base}${suf}`);
    }
    return [...new Set(out)];
}

const PLACEHOLDER_SYNOPSIS = 'Mira este anime en español.';

// ============================================================
// PROVEEDORES — AIRING
// Shape: { mal_id, title, images:{jpg:{large_image_url,image_url}}, synopsis, score }
// ============================================================
const airingProviders = {
    async animeflv() {
        const { data } = await sourceGet('animeflv', '/browse?status=1&order=rating');
        const $ = cheerio.load(data);
        const base = activeDomain('animeflv');
        const items = [];
        $('.ListAnimes li article').slice(0, 24).each((_, el) => {
            const $el = $(el);
            const title = $el.find('.Title').first().text().trim();
            const href = $el.find('a').attr('href') || '';
            if (!title || !href) return;
            const image = absolutize($el.find('img').attr('src'), base);
            const synopsis = $el.find('.Description p').last().text().trim()
                .replace(/^Anime\s+\d+(\.\d+)?\s*/i, '') || PLACEHOLDER_SYNOPSIS;
            items.push({
                mal_id: href.split('/').pop(),
                title,
                images: { jpg: { large_image_url: image, image_url: image } },
                synopsis,
                score: $el.find('.Vts').first().text().trim() || 'N/A',
            });
        });
        if (items.length === 0) throw new Error('AnimeFLV airing: 0 items (¿cambió el HTML?)');
        return items;
    },

    async tioanime() {
        const { data } = await sourceGet('tioanime', '/directorio?status=2&sort=recent');
        const $ = cheerio.load(data);
        const base = activeDomain('tioanime');
        const items = [];
        $('article').slice(0, 24).each((_, el) => {
            const $el = $(el);
            const title = $el.find('h3').first().text().trim();
            const href = $el.find('a').attr('href') || '';
            if (!title || !href.includes('/anime/')) return;
            const image = absolutize($el.find('img').attr('src') || $el.find('img').attr('data-src'), base);
            items.push({
                mal_id: href.split('/anime/').pop().replace(/\/$/, ''),
                title,
                images: { jpg: { large_image_url: image, image_url: image } },
                synopsis: PLACEHOLDER_SYNOPSIS,
                score: 'N/A',
            });
        });
        if (items.length === 0) throw new Error('TioAnime airing: 0 items (¿cambió el HTML?)');
        return items;
    },

    async jikan() {
        const { data } = await jikanGet('/v4/seasons/now?limit=24');
        const items = (data.data || []).map(a => ({
            mal_id: a.mal_id,
            title: a.title,
            images: a.images,
            synopsis: a.synopsis || PLACEHOLDER_SYNOPSIS,
            score: a.score != null ? String(a.score) : 'N/A',
        }));
        if (items.length === 0) throw new Error('Jikan airing: 0 items');
        return items;
    },
};

// ============================================================
// PROVEEDORES — RECENT (últimos episodios)
// Shape: { entry:{mal_id,title,images:{jpg:{image_url}}}, episodes:[{title:'Episodio N'}] }
// ============================================================
const recentProviders = {
    async animeflv() {
        const { data } = await sourceGet('animeflv', '/');
        const $ = cheerio.load(data);
        const base = activeDomain('animeflv');
        const items = [];
        $('.ListEpisodios li').each((_, el) => {
            const $el = $(el);
            const title = $el.find('.Title').first().text().trim();
            const href = $el.find('a').attr('href') || '';
            const verPart = href.split('/ver/')[1];
            if (!title || !verPart) return;
            const epNum = $el.find('.Capi').text().trim().replace(/Episodio\s*/i, '').trim();
            const image = absolutize($el.find('img').attr('src'), base);
            const slug = verPart.split('-').slice(0, -1).join('-');
            items.push({
                entry: { mal_id: slug, title, images: { jpg: { image_url: image } } },
                episodes: [{ title: `Episodio ${epNum}` }],
            });
        });
        if (items.length === 0) throw new Error('AnimeFLV recent: 0 items (¿cambió el HTML?)');
        return items;
    },

    async tioanime() {
        const { data } = await sourceGet('tioanime', '/');
        const $ = cheerio.load(data);
        const base = activeDomain('tioanime');
        const items = [];
        $('ul.episodes li article').each((_, el) => {
            const $el = $(el);
            // El título viene como "Nombre Del Anime 7" (número de episodio al final)
            const raw = $el.find('h3').first().text().trim() || $el.find('img').attr('alt') || '';
            const m = raw.match(/^(.*?)\s+(\d+)$/);
            const title = m ? m[1].trim() : raw;
            const epNum = m ? m[2] : '?';
            if (!title) return;
            const image = absolutize($el.find('img').attr('src') || $el.find('img').attr('data-src'), base);
            items.push({
                entry: { mal_id: createSlug(title), title, images: { jpg: { image_url: image } } },
                episodes: [{ title: `Episodio ${epNum}` }],
            });
        });
        if (items.length === 0) throw new Error('TioAnime recent: 0 items (¿cambió el HTML?)');
        return items;
    },

    async monoschinos() {
        const { data } = await sourceGet('monoschinos', '/');
        const $ = cheerio.load(data);
        const items = [];
        $('article a[href*="/ver/"]').each((_, el) => {
            const $a = $(el);
            const href = $a.attr('href') || '';
            const m = href.match(/\/ver\/(.+)-episodio-(\d+)/);
            if (!m) return;
            const img = $a.find('img');
            const alt = (img.attr('alt') || '').replace(/\s+cap[ií]tulo\s+\d+$/i, '').trim();
            const title = alt || m[1].replace(/-sub-espanol$/, '').replace(/-/g, ' ');
            let image = img.attr('data-src') || img.attr('src') || '';
            if (image.includes('capblank')) image = '';
            items.push({
                entry: { mal_id: m[1], title, images: { jpg: { image_url: image } } },
                episodes: [{ title: `Episodio ${m[2]}` }],
            });
        });
        if (items.length === 0) throw new Error('MonosChinos recent: 0 items (¿cambió el HTML?)');
        return items.slice(0, 24);
    },
};

// ============================================================
// BÚSQUEDA POR FUENTE → [{ title, slug, image }]
// ============================================================
const searchProviders = {
    async animeflv(query) {
        const { data } = await sourceGet('animeflv', `/browse?q=${encodeURIComponent(query)}`);
        const $ = cheerio.load(data);
        const out = [];
        $('.ListAnimes li article').each((_, el) => {
            const $el = $(el);
            const href = $el.find('a').attr('href') || '';
            const title = $el.find('.Title').first().text().trim();
            if (href.includes('/anime/') && title) out.push({ title, slug: href.split('/').pop() });
        });
        return out;
    },

    async tioanime(query) {
        const { data } = await sourceGet('tioanime', `/directorio?q=${encodeURIComponent(query)}`);
        const $ = cheerio.load(data);
        const out = [];
        $('article').each((_, el) => {
            const $el = $(el);
            const href = $el.find('a').attr('href') || '';
            const title = $el.find('h3').first().text().trim();
            if (href.includes('/anime/') && title) out.push({ title, slug: href.split('/anime/').pop().replace(/\/$/, '') });
        });
        return out;
    },

    async jkanime(query) {
        const { data } = await sourceGet('jkanime', `/buscar/${encodeURIComponent(query)}/`);
        const $ = cheerio.load(data);
        const out = [];
        $('.anime__item').each((_, el) => {
            const $el = $(el);
            const href = $el.find('a').attr('href') || '';
            const title = $el.find('h5, .title').first().text().trim();
            const slug = (href.match(/jkanime\.net\/([^/]+)\/?$/) || [])[1] || href.replace(/\/$/, '').split('/').pop();
            if (slug && title) out.push({ title, slug });
        });
        return out;
    },

    async monoschinos(query) {
        const { data } = await sourceGet('monoschinos', `/buscar?q=${encodeURIComponent(query)}`);
        const $ = cheerio.load(data);
        const out = [];
        $('article').each((_, el) => {
            const $el = $(el);
            const href = $el.find('a').attr('href') || '';
            const title = $el.find('h3, h2, .title').first().text().trim();
            if (href.includes('/anime/') && title) out.push({ title, slug: href.split('/anime/').pop().replace(/\/$/, '') });
        });
        return out;
    },
};

// ============================================================
// PROVEEDORES — INFO (detalle + lista de episodios)
// Shape: { slug, description, genres, status, rate, episodes:[{number,id}] }
// ============================================================
const infoProviders = {
    async animeflv(title) {
        const { slug, data } = await fetchAnimePage('animeflv', title);
        const rawEps = parseJsVar(data, 'episodes');
        if (!rawEps || rawEps.length === 0) throw new Error(`AnimeFLV info ${slug}: sin var episodes`);
        const $ = cheerio.load(data);
        return {
            slug,
            description: $('.Description p').first().text().trim() || $('.Description').text().trim(),
            genres: $('.Nvgnrs a, .Genres a').map((_, el) => $(el).text().trim()).get(),
            status: $('.AnmStts').first().text().trim(),
            rate: $('.vtprmd').first().text().trim(),
            episodes: rawEps.map(ep => ({ number: ep[0], id: ep[1] })).sort((a, b) => b.number - a.number),
        };
    },

    async tioanime(title) {
        const { slug, data } = await fetchAnimePage('tioanime', title);
        const rawEps = parseJsVar(data, 'episodes');
        if (!rawEps || rawEps.length === 0) throw new Error(`TioAnime info ${slug}: sin var episodes`);
        const $ = cheerio.load(data);
        const info = parseJsVar(data, 'anime_info') || [];
        return {
            slug: info[1] || slug,
            description: $('.sinopsis').first().text().trim(),
            genres: $('.genres a').map((_, el) => $(el).text().trim()).get(),
            status: $('.anime-status, .status').first().text().trim() || '',
            rate: '',
            episodes: rawEps.map(n => ({ number: n, id: null })).sort((a, b) => b.number - a.number),
        };
    },

    // Último recurso: metadata de MyAnimeList. Devuelve episodios 1..N
    // con slug aproximado para que /videos intente resolverlos.
    async jikan(title) {
        const { data } = await jikanGet(`/v4/anime?q=${encodeURIComponent(title)}&limit=5&order_by=members&sort=desc`);
        const results = (data.data || []).map(a => ({ title: a.title, raw: a }));
        const best = pickBestMatch(title, results, 50);
        if (!best) throw new Error('Jikan info: sin resultados');
        const a = best.raw;
        const count = a.episodes;
        if (!count || count < 1) throw new Error('Jikan info: sin recuento de episodios');
        const episodes = [];
        for (let n = count; n >= 1; n--) episodes.push({ number: n, id: null });
        return {
            slug: createSlug(a.title),
            description: a.synopsis || '',
            genres: (a.genres || []).map(g => g.name),
            status: a.status === 'Currently Airing' ? 'En emisión' : (a.status === 'Finished Airing' ? 'Finalizado' : (a.status || '')),
            rate: a.score != null ? String(a.score) : '',
            episodes,
        };
    },
};

/**
 * Obtiene la página /anime/{slug} de una fuente resolviendo el slug:
 * primero prueba slugs directos derivados del título (barato), luego
 * busca en la fuente y elige el mejor match por similitud de título.
 * Devuelve { slug, data } (una sola petición por candidato).
 */
async function fetchAnimePage(sourceKey, title) {
    for (const cand of slugCandidates(createSlug(title))) {
        try {
            const { data } = await sourceGet(sourceKey, `/anime/${cand}`, { timeout: 5000 });
            return { slug: cand, data };
        } catch (e) {
            if (!e.notFound) throw e; // error real de red: no seguir quemando requests
        }
    }
    const results = await searchProviders[sourceKey](title);
    const best = pickBestMatch(title, results);
    if (!best) throw new Error(`${sourceKey}: sin resultados de búsqueda para "${title}"`);
    const { data } = await sourceGet(sourceKey, `/anime/${best.slug}`, { timeout: 5000 });
    return { slug: best.slug, data };
}

// ============================================================
// PROVEEDORES — VIDEOS
// Shape: [{ name, url, lang: 'sub'|'lat' }]
// ============================================================
const BLOCKED_EMBEDS = ['mega.nz', 'mail.ru'];
const JK_EMBED_OK = ['Streamtape', 'VOE', 'Vidhide', 'Streamwish', 'Doodstream', 'Mp4upload', 'Mixdrop', 'YourUpload', 'Uqload'];

function embedAllowed(url) {
    return url && !BLOCKED_EMBEDS.some(b => url.includes(b));
}

const videoProviders = {
    async tioanime(slug, episode) {
        for (const cand of slugCandidates(slug)) {
            let data;
            try {
                ({ data } = await sourceGet('tioanime', `/ver/${cand}-${episode}`, { timeout: 5500 }));
            } catch (e) {
                if (e.notFound) continue;
                throw e;
            }
            const videos = parseJsVar(data, 'videos');
            if (!Array.isArray(videos) || videos.length === 0) continue;
            const servers = videos
                .filter(v => Array.isArray(v) && embedAllowed(v[1]))
                .map(([name, url]) => ({ name, url, lang: 'sub' }));
            if (servers.length > 0) return servers;
        }
        return [];
    },

    async jkanime(slug, episode) {
        for (const cand of slugCandidates(slug)) {
            let data;
            try {
                ({ data } = await sourceGet('jkanime', `/${cand}/${episode}/`, { timeout: 5500 }));
            } catch (e) {
                if (e.notFound) continue;
                throw e;
            }
            const srvData = parseJsVar(data, 'servers');
            if (!Array.isArray(srvData) || srvData.length === 0) continue;
            const servers = srvData
                .filter(s => JK_EMBED_OK.includes(s.server))
                .map(s => {
                    let url = '';
                    try { url = Buffer.from(s.remote, 'base64').toString('utf8'); } catch { /* remote inválido */ }
                    return { name: s.server, url, lang: s.lang === 2 ? 'lat' : 'sub' };
                })
                .filter(s => embedAllowed(s.url));
            if (servers.length > 0) return servers;
        }
        return [];
    },

    async monoschinos(slug, episode) {
        const candidates = slugCandidates(slug, ['-sub-espanol']);
        // Rescate: si ningún slug directo existe, buscar por título en el sitio
        let searched = false;
        while (candidates.length > 0) {
            const cand = candidates.shift();
            let data;
            try {
                ({ data } = await sourceGet('monoschinos', `/ver/${cand}-episodio-${episode}`, { timeout: 5500 }));
            } catch (e) {
                if (!e.notFound) throw e;
                if (candidates.length === 0 && !searched) {
                    searched = true;
                    const query = slug.replace(/-(tv|ova|movie|special|specials)$/, '').replace(/-/g, ' ');
                    try {
                        const results = await searchProviders.monoschinos(query);
                        const best = pickBestMatch(query, results);
                        if (best) candidates.push(best.slug);
                    } catch { /* búsqueda caída: nos quedamos sin candidatos */ }
                }
                continue;
            }
            const $ = cheerio.load(data);
            const servers = [];
            $('[data-player]').each((_, el) => {
                const enc = $(el).attr('data-player') || '';
                let url = '';
                try { url = Buffer.from(enc, 'base64').toString('utf8'); } catch { /* no era base64 */ }
                if (!/^https?:\/\//.test(url) || !embedAllowed(url)) return;
                const name = $(el).text().trim() || new URL(url).hostname.replace(/^www\./, '');
                servers.push({ name, url, lang: 'sub' });
            });
            if (servers.length > 0) return servers;
        }
        return [];
    },

    // AnimeFLV cargaba `var videos` inline; hoy llega vacío (AJAX), pero
    // se conserva por si restauran el formato. Soporta array u objeto {SUB,LAT}.
    async animeflv(slug, episode) {
        for (const cand of slugCandidates(slug)) {
            let data;
            try {
                ({ data } = await sourceGet('animeflv', `/ver/${cand}-${episode}`, { timeout: 5500 }));
            } catch (e) {
                if (e.notFound) continue;
                throw e;
            }
            const videos = parseJsVar(data, 'videos');
            if (!videos) continue;
            const servers = [];
            if (Array.isArray(videos)) {
                for (const v of videos) {
                    if (Array.isArray(v) && embedAllowed(v[1])) servers.push({ name: v[0], url: v[1], lang: 'sub' });
                }
            } else {
                for (const [langKey, list] of Object.entries(videos)) {
                    const lang = langKey.toUpperCase() === 'LAT' ? 'lat' : 'sub';
                    for (const v of list || []) {
                        const url = v.url || v.code;
                        if (embedAllowed(url)) servers.push({ name: v.title || v.server || 'Servidor', url, lang });
                    }
                }
            }
            if (servers.length > 0) return servers;
        }
        return [];
    },
};

// ============================================================
// ORQUESTADOR
// ============================================================
/**
 * Prueba las fuentes de `capability` en orden hasta que una devuelva
 * datos. Devuelve { data, source }. Lanza con el detalle de todos los
 * fallos si ninguna funciona.
 */
async function scrapeWithFallback(capability, ...args) {
    const providersMap = { airing: airingProviders, recent: recentProviders, info: infoProviders, videos: videoProviders }[capability];
    const errors = [];
    for (const key of SOURCE_ORDER[capability]) {
        if (breakerOpen(key)) {
            errors.push(`${key}: omitida (breaker abierto: ${health[key].lastError})`);
            continue;
        }
        try {
            const data = await providersMap[key](...args);
            if (data && (Array.isArray(data) ? data.length > 0 : true)) {
                return { data, source: key };
            }
            errors.push(`${key}: respuesta vacía`);
        } catch (e) {
            errors.push(`${key}: ${e.message}`);
        }
    }
    const err = new Error(`Todas las fuentes fallaron para "${capability}" → ${errors.join(' | ')}`);
    err.allFailed = true;
    throw err;
}

/** Chequeo en vivo de todas las fuentes (para /api/anime/status). */
async function checkSourcesStatus() {
    const checks = Object.keys(SOURCES).map(async (key) => {
        const t0 = Date.now();
        let alive = false, error = null;
        try {
            if (key === 'jikan') await jikanGet('/v4/anime/1');
            else await sourceGet(key, '/', { timeout: 5000 });
            alive = true;
        } catch (e) {
            error = e.message;
        }
        const h = health[key];
        return {
            key,
            name: SOURCES[key].name,
            alive,
            responseMs: Date.now() - t0,
            activeDomain: activeDomain(key),
            error,
            lastOk: h.lastOk ? new Date(h.lastOk).toISOString() : null,
            lastFail: h.lastFail ? new Date(h.lastFail).toISOString() : null,
            consecutiveFails: h.consecFails,
            lastError: h.lastError,
            usedFor: Object.entries(SOURCE_ORDER).filter(([, v]) => v.includes(key)).map(([k]) => k),
        };
    });
    return Promise.all(checks);
}

module.exports = {
    SOURCES, SOURCE_ORDER, health,
    scrapeWithFallback, checkSourcesStatus,
    searchProviders, fetchAnimePage, pickBestMatch, matchScore, slugCandidates,
    absolutize, parseJsVar,
};
