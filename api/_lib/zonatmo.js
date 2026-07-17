// ============================================================
// FUENTE DE MANGA PRIMARIA: ZonaTMO (zonatmo.org)
// ------------------------------------------------------------
// Familia TMO/LectorTMO. Tiene manga, manhwa y cómics en español,
// INCLUIDOS los licenciados (One Piece, MHA...) que MangaDex retira.
// Sus imágenes son URLs PLANAS (storage.zonatmo.org/chapters/ID/N.webp),
// sin cifrado → lector propio funciona. Funciona desde el datacenter.
//
// Esquema de id usado por el frontend: "zt:<ruta>"
//   manga:   zt:library/manga/31322/one-piece
//   capítulo: zt:view_uploads/992869
// ============================================================
const axios = require('axios');
const cheerio = require('cheerio');

const B = 'https://zonatmo.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function zGet(path, referer) {
    const url = path.startsWith('http') ? path : B + path;
    const config = {
        timeout: 12000,
        headers: {
            // Cabeceras completas de navegador real: zonatmo funciona en local
            // pero desde el datacenter de Vercel puede exigir más señales.
            'User-Agent': UA,
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Referer': referer || B + '/',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            'sec-ch-ua': '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Cache-Control': 'max-age=0',
        },
        maxRedirects: 5,
    };
    // Proxy opcional (env PROXY_URL) por si el datacenter está bloqueado
    if (process.env.PROXY_URL) {
        try {
            const { HttpsProxyAgent } = require('https-proxy-agent');
            config.httpsAgent = new HttpsProxyAgent(process.env.PROXY_URL);
        } catch { /* sin proxy */ }
    }
    return axios.get(url, config);
}

// URL absoluta zonatmo → id "zt:<ruta>" y viceversa
function toId(href) { return 'zt:' + href.replace(/^https?:\/\/[^/]+\//, ''); }
function toUrl(id) { return B + '/' + id.replace(/^zt:/, ''); }

function typeFromPath(p) {
    if (/\/manhwa\//.test(p)) return 'Manhwa';
    if (/\/manhua\//.test(p)) return 'Manhua';
    if (/\/comic\//.test(p)) return 'Cómic';
    if (/\/novel\//.test(p)) return 'Novela';
    if (/\/one_shot\//.test(p)) return 'One Shot';
    return 'Manga';
}

function parseCards($) {
    const out = [];
    $('.element').each((_, el) => {
        const $el = $(el);
        const a = $el.find('a').first();
        const href = a.attr('href') || '';
        if (!/\/library\//.test(href)) return;
        const title = ($el.find('.thumbnail-title').attr('title') || $el.find('.thumbnail-title').text() || a.text()).trim();
        const bg = $el.find('.cover-bg-img, style, [data-bg]');
        let cover = $el.find('img.cover-bg-img').attr('src') || $el.find('[data-bg]').attr('data-bg') || '';
        if (!cover) {
            const style = $el.find('[style*="background-image"]').attr('style') || '';
            cover = (style.match(/url\(['"]?([^'")]+)/) || [])[1] || '';
        }
        if (title && href) out.push({ id: toId(href), title, cover, type: typeFromPath(href) });
    });
    return out;
}

/** Catálogo por tipo (populares). type: manga|manhwa|comic */
async function browse(type = 'manga', page = 1) {
    const t = ['manga', 'manhwa', 'comic', 'manhua', 'novel'].includes(type) ? type : 'manga';
    const { data } = await zGet(`/biblioteca?order_item=likes_count&order_dir=desc&type=${t}&_pg=1&page=${page}`);
    return parseCards(cheerio.load(data));
}

/** Búsqueda por título. */
async function search(q) {
    const { data } = await zGet(`/biblioteca?title=${encodeURIComponent(q)}`);
    return parseCards(cheerio.load(data));
}

/** Ficha + capítulos de un manga (id "zt:library/manga/..."). */
async function mangaInfo(id) {
    const url = toUrl(id);
    const { data } = await zGet(url);
    const $ = cheerio.load(data);

    let title = ($('h1.element-title').text().trim() || $('title').first().text().replace(/\s*[-|].*$/, '').trim());
    title = title.split('\n')[0].replace(/\s*\(\d{4}\)\s*$/, '').replace(/\s+/g, ' ').trim();
    const cover = $('.book-thumbnail, img.book-thumbnail').first().attr('src') || '';
    const description = $('.element-description').first().text().trim();
    const status = $('.book-status, span.book-status').first().text().trim();
    const score = $('#score, span#score').first().text().trim();
    const genres = $('.book-genre a, h6.badge, a.py-2').map((_, e) => $(e).text().trim()).get().filter(g => g && g.length < 24);

    // Capítulos: li.upload-link → data-number + primer view_uploads.
    // Dedup por número (varios grupos de scan por capítulo → el primero).
    const seen = new Map();
    $('li.upload-link').each((_, li) => {
        const $li = $(li);
        const num = $li.find('.chapter-number').attr('data-number') || $li.find('.chapter-number').text().replace(/[^\d.]/g, '');
        const view = $li.find('a[href*="/view_uploads/"], a[href*="/viewer/"]').first().attr('href');
        if (!num || !view) return;
        if (!seen.has(num)) {
            const name = $li.find('.chapter-number').text().replace(/\s+/g, ' ').trim();
            seen.set(num, { number: num, id: toId(view), title: name });
        }
    });
    const chapters = [...seen.values()].sort((a, b) => parseFloat(a.number) - parseFloat(b.number));

    return {
        id, title, cover, description, status, score,
        type: typeFromPath(url), genres,
        chapters,
    };
}

/** Páginas (imágenes) de un capítulo (id "zt:view_uploads/ID"). */
async function pages(id) {
    const url = toUrl(id);
    // Sigue el redirect al visor (cascada). Referer del propio sitio.
    const { data } = await zGet(url);
    const html = String(data);
    // URLs planas: storage*.zonatmo.org/chapters/ID/<pagina>.ext
    // Se conserva el ORDEN del HTML (= orden de lectura). Los nombres
    // pueden ser numéricos (1.webp) o hashes; solo reordenamos si TODOS
    // son numéricos (por si el HTML los desordenara).
    const found = [...new Set(html.match(/https?:\/\/[^"'\s)]+\/chapters\/\d+\/[^"'\s)]+\.(webp|jpg|jpeg|png)/gi) || [])];
    const allNumeric = found.length > 0 && found.every(u => /\/\d+\.\w+$/.test(u));
    if (allNumeric) {
        found.sort((a, b) =>
            parseInt(a.match(/\/(\d+)\.\w+$/)[1], 10) - parseInt(b.match(/\/(\d+)\.\w+$/)[1], 10));
    }
    return found;
}

module.exports = { browse, search, mangaInfo, pages, toId, toUrl, B };
