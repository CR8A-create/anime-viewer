// ============================================================
// FUENTE DE MANGA SECUNDARIA: MangaLect (mangalect.org)
// ------------------------------------------------------------
// Sitio limpio sin Cloudflare agresivo. Manga/manhwa en español.
// Tiene API JSON propia para catálogo/búsqueda y sus imágenes son
// URLs PLANAS (images.mangalect.org/file/leermangaesp/...), sin
// cifrado → sirve para el lector propio.
//
// Estructura del sitio:
//   Catálogo/búsqueda: GET /api/buscar_mangas/?query=X&tipo=manga|manhwa&page=N&page_size=24
//   Ficha:             GET /info/{slug}/          (h1.manga-title, #synopsis-text, .manga-cover, a.chapter-link)
//   Capítulo:          GET /lectura/{slug}/{cap}/ (imágenes planas en el HTML)
//
// Esquema de id usado por el frontend: "ml:<ruta>"
//   manga:    ml:info/one-piece
//   capítulo: ml:lectura/one-piece/1050.00
// ============================================================
const axios = require('axios');
const cheerio = require('cheerio');

const B = 'https://mangalect.org';
const IMG = 'https://images.mangalect.org/file/leermangaesp/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function mlGet(path, asJson) {
    const url = path.startsWith('http') ? path : B + path;
    const config = {
        timeout: 12000,
        headers: {
            'User-Agent': UA,
            'Accept-Language': 'es-ES,es;q=0.9',
            'Accept': asJson ? 'application/json' : 'text/html,application/xhtml+xml',
            'Referer': B + '/',
        },
        maxRedirects: 5,
    };
    if (process.env.PROXY_URL) {
        try {
            const { HttpsProxyAgent } = require('https-proxy-agent');
            config.httpsAgent = new HttpsProxyAgent(process.env.PROXY_URL);
        } catch { /* sin proxy */ }
    }
    return axios.get(url, config);
}

function toId(ruta) { return 'ml:' + ruta.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\/+$/, ''); }
function toUrl(id) { return B + '/' + id.replace(/^ml:/, '') + '/'; }

const TIPO = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua', comic: 'Cómic', novela: 'Novela' };

function card(m) {
    return {
        id: toId('info/' + m.slug),
        title: m.titulo,
        cover: m.portada ? IMG + m.portada : '',
        type: TIPO[(m.tipo || '').toLowerCase()] || 'Manga',
    };
}

/** Catálogo por tipo. type: manga|manhwa|comic (la API usa "tipo"). */
async function browse(type = 'manga', page = 1) {
    const t = ['manga', 'manhwa', 'manhua', 'comic', 'novela'].includes(type) ? type : 'manga';
    const { data } = await mlGet(`/api/buscar_mangas/?tipo=${t}&page=${page}&page_size=24`, true);
    return (data.resultados || []).map(card);
}

/** Búsqueda por título. */
async function search(q) {
    const { data } = await mlGet(`/api/buscar_mangas/?query=${encodeURIComponent(q)}&page=1&page_size=24`, true);
    return (data.resultados || []).map(card);
}

/** Ficha + capítulos (id "ml:info/{slug}"). */
async function mangaInfo(id) {
    const url = toUrl(id);
    const { data } = await mlGet(url);
    const $ = cheerio.load(data);

    const title = $('h1.manga-title').first().text().trim() || $('title').text().replace(/\s*[-|].*$/, '').trim();
    const cover = $('img.manga-cover').first().attr('src') || '';
    const description = $('#synopsis-text').first().text().trim();
    const status = $('.status-text').first().text().trim();
    const genres = $('.genre-tag, .genres a, .manga-genres a').map((_, e) => $(e).text().trim()).get().filter(g => g && g.length < 24);

    // Capítulos: a.chapter-link → /lectura/{slug}/{num}/
    const seen = new Map();
    $('a.chapter-link, a[href*="/lectura/"]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const m = href.match(/\/lectura\/([^/]+)\/([\d.]+)\/?$/);
        if (!m) return;
        const num = String(parseFloat(m[2]));      // "108.00" → "108"
        if (!seen.has(num)) {
            const name = $(a).find('.chapter-title').text().trim() || '';
            seen.set(num, { number: num, id: toId(`lectura/${m[1]}/${m[2]}`), title: name });
        }
    });
    const chapters = [...seen.values()].sort((a, b) => parseFloat(a.number) - parseFloat(b.number));

    return { id, title, cover, description, status, score: '', type: 'Manga', genres, chapters };
}

/** Páginas (imágenes) de un capítulo (id "ml:lectura/{slug}/{cap}"). */
async function pages(id) {
    const url = toUrl(id);
    const { data } = await mlGet(url);
    const html = String(data);
    // URLs planas: images.mangalect.org/file/leermangaesp/mangas/ID/capitulo_N/pagina_NNN.webp
    const found = [...new Set(html.match(/https?:\/\/images\.mangalect\.org\/file\/[^"'\s)\\]+\.(webp|jpg|jpeg|png)/gi) || [])]
        .filter(u => /\/mangas\//.test(u));
    // Orden por número de página (pagina_001, pagina_002...)
    found.sort((a, b) => {
        const na = parseInt((a.match(/pagina_(\d+)/i) || [])[1] || '0', 10);
        const nb = parseInt((b.match(/pagina_(\d+)/i) || [])[1] || '0', 10);
        return na - nb;
    });
    return found;
}

module.exports = { browse, search, mangaInfo, pages, toId, toUrl, B };
