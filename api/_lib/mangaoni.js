// ============================================================
// FUENTE DE MANGA DE RESCATE: Manga Oni (manga-oni.com)
// ------------------------------------------------------------
// Manga/manhwa/manhua en español con imágenes en URL PLANA
// (oni.ntr-files.online, sin protección de hotlink) → lector propio.
// Tiene títulos que Mangalect lista SIN capítulos (p. ej. Solo
// Leveling). Se usa para: (a) rellenar los capítulos cuando la
// fuente principal devuelve una ficha vacía y (b) completar la
// búsqueda.
//
// Estructura del sitio:
//   Búsqueda: GET /buscar?q=X          → a[itemprop=url] + img[itemprop=image]
//   Ficha:    GET /{tipo}/{slug}/      → h1.post-title, #sinopsis, a[href*="/lector/"]
//                                         (nº en span.timeago[data-num])
//   Capítulo: GET /lector/{slug}/{id}/cascada/
//             var unicap = base64("<carpeta>||[\"001.webp?up=…\", …]||<id siguiente>")
//
// Esquema de id usado por el frontend: "mo:<ruta>"
//   manga:    mo:manhwa/solo-leveling-alt
//   capítulo: mo:lector/solo-leveling-alt/308816
// ============================================================
const axios = require('axios');
const cheerio = require('cheerio');

const B = 'https://manga-oni.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const TYPES = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua' };

function moGet(path) {
    return axios.get(B + path, {
        timeout: 10000,
        headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9', Accept: 'text/html,application/xhtml+xml', Referer: B + '/' },
    });
}

const isMo = (id) => typeof id === 'string' && id.startsWith('mo:');
const toPath = (id) => '/' + String(id).replace(/^mo:/, '').replace(/[^a-z0-9/_-]/gi, '').replace(/^\/+|\/+$/g, '') + '/';

/** Búsqueda por título (solo manga/manhwa/manhua; las novelas se descartan). */
async function search(q) {
    const { data } = await moGet(`/buscar?q=${encodeURIComponent(q)}`);
    const $ = cheerio.load(data);
    const out = [];
    const seen = new Set();
    $('a[itemprop="url"]').each((_, a) => {
        const m = ($(a).attr('href') || '').match(/manga-oni\.com\/(manga|manhwa|manhua)\/([^/]+)\/?$/);
        if (!m || seen.has(m[2])) return;
        seen.add(m[2]);
        const img = $(a).find('img').first();
        const title = (img.attr('alt') || '').trim();
        if (!title) return;
        out.push({ id: `mo:${m[1]}/${m[2]}`, title, cover: img.attr('src') || '', type: TYPES[m[1]] });
    });
    return out;
}

/** Ficha + capítulos (id "mo:{tipo}/{slug}"). */
async function mangaInfo(id) {
    const path = toPath(id);
    const { data } = await moGet(path);
    const $ = cheerio.load(data);
    const tipo = path.split('/')[1];

    const seen = new Map();
    $('a[href*="/lector/"]').each((_, a) => {
        const m = ($(a).attr('href') || '').match(/\/lector\/([^/]+)\/(\d+)\//);
        if (!m) return;
        const raw = $(a).find('[data-num]').attr('data-num') || ($(a).text().match(/[\d.]+/) || [])[0];
        const num = String(parseFloat(raw));
        if (num === 'NaN' || seen.has(num)) return;
        seen.set(num, { number: num, id: `mo:lector/${m[1]}/${m[2]}`, title: '' });
    });
    const chapters = [...seen.values()].sort((a, b) => parseFloat(a.number) - parseFloat(b.number));

    return {
        id,
        title: $('h1.post-title').first().text().trim(),
        cover: $('meta[property="og:image"]').attr('content') || '',
        description: $('#sinopsis').first().text().replace(/\s+/g, ' ').trim()
            || $('meta[property="og:description"]').attr('content') || '',
        status: $('.estado').last().text().trim(),
        score: '',
        type: TYPES[tipo] || 'Manga',
        genres: $('#categ a').map((_, e) => $(e).text().trim()).get().filter(g => g && g.length < 24),
        chapters,
    };
}

/** Páginas (imágenes) de un capítulo (id "mo:lector/{slug}/{id}"). */
async function pages(id) {
    const { data } = await moGet(toPath(id) + 'cascada/');
    const m = String(data).match(/var\s+unicap\s*=\s*'([^']+)'/);
    if (!m) return [];
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    // Formato: "<carpeta>||[\"001.webp\",…]" y, a veces, "||<id del siguiente>"
    const [dir, list] = decoded.split('||');
    if (!dir || !list) return [];
    let files = [];
    try { files = JSON.parse(list); } catch { return []; }
    if (!/^https:\/\//.test(dir)) return [];
    return files.filter(f => typeof f === 'string').map(f => dir + f);
}

/**
 * Busca `title` y devuelve la ficha del mejor resultado SOLO si el título
 * coincide de verdad (normalizado, igual). null si no hay equivalente.
 */
async function findByTitle(title) {
    const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const want = norm(title);
    if (!want) return null;
    const hit = (await search(title)).find(r => norm(r.title) === want);
    return hit ? mangaInfo(hit.id) : null;
}

module.exports = { isMo, search, mangaInfo, pages, findByTitle, B };
