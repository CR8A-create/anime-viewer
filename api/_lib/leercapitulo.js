// ============================================================
// FUENTE DE MANGA: leercapitulo.co (fallback para licenciados)
// ------------------------------------------------------------
// MangaDex retira los shounen muy licenciados en español (One Piece,
// MHA, JJK...). leercapitulo SÍ los tiene. Su BÚSQUEDA y LISTA DE
// CAPÍTULOS se leen limpio desde el servidor; las IMÁGENES van
// cifradas en un blob (#array_data) que solo su JS ofuscado descifra
// en el navegador (se regenera en cada actualización suya).
//
// Estrategia (aprobada por el usuario):
//  - Catálogo + capítulos: scraping directo (robusto).
//  - Páginas: se intenta descifrar; si no se logra, se devuelve la
//    URL externa y el lector ofrece abrir el capítulo en la fuente.
//    Cuando se consiga descifrar, rellenar decodeArrayData() y el
//    lector propio se activa solo.
// ============================================================
const axios = require('axios');
const cheerio = require('cheerio');

const LC = 'https://www.leercapitulo.co';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function lcGet(path, extra = {}) {
    return axios.get(LC + path, {
        timeout: 10000,
        headers: {
            'User-Agent': UA,
            'Accept-Language': 'es-ES,es;q=0.9',
            'Referer': LC + '/',
            ...extra,
        },
        maxRedirects: 5,
    });
}

function norm(t) {
    return (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

/** Busca un manga por título → [{ title, path, thumbnail }]. */
async function search(title) {
    const { data } = await lcGet(`/search-autocomplete?term=${encodeURIComponent(title)}`);
    if (!Array.isArray(data)) return [];
    return data.map(x => ({
        title: x.value || x.label,
        path: x.link,                              // /manga/{id}/{slug}/
        thumbnail: x.thumbnail ? (x.thumbnail.startsWith('http') ? x.thumbnail : LC + x.thumbnail) : null,
    })).filter(x => x.title && x.path);
}

/** Elige la mejor coincidencia de título (exacta > contiene). */
function pickBest(title, results) {
    const n = norm(title);
    let best = null, score = -1;
    for (const r of results) {
        const rn = norm(r.title);
        let s = 0;
        if (rn === n) s = 100;
        else if (rn.startsWith(n) || n.startsWith(rn)) s = 70;
        else if (rn.includes(n) || n.includes(rn)) s = 40;
        s -= Math.abs(rn.length - n.length) * 0.5;
        if (s > score) { score = s; best = r; }
    }
    return score >= 30 ? best : null;
}

/** Lista de capítulos de un manga (path /manga/{id}/{slug}/) → [{number,title,path}] asc. */
async function chapters(mangaPath) {
    const { data } = await lcGet(mangaPath);
    const $ = cheerio.load(data);
    const map = new Map();
    $('a[href*="/leer/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const m = href.match(/\/leer\/[^/]+\/[^/]+\/([\d.]+)\/?$/);
        if (!m) return;
        const num = m[1];
        if (!map.has(num)) {
            map.set(num, { number: num, title: $(el).text().trim().replace(/\s+/g, ' '), path: href });
        }
    });
    const list = [...map.values()].sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
    const title = $('h1').first().text().trim();
    const cover = $('.manga-detail img, .cover img, img.img-responsive').first().attr('src');
    return { title, cover: cover ? (cover.startsWith('http') ? cover : LC + cover) : null, chapters: list };
}

/**
 * Descifrado del blob #array_data → lista de URLs de imagen.
 * Su cifrado (obfuscator.io) aún no está resuelto: por ahora devuelve
 * null y el lector usa el enlace externo. Cuando se resuelva, este es
 * el único punto a rellenar para activar el lector propio.
 */
function decodeArrayData(/* raw */) {
    return null;
}

/**
 * Páginas de un capítulo. Si se logra descifrar → { pages:[...] };
 * si no → { externalUrl } para leer en la fuente.
 */
async function pages(chapterPath) {
    const url = chapterPath.startsWith('http') ? chapterPath : LC + chapterPath;
    let raw = null;
    try {
        const { data } = await lcGet(chapterPath.startsWith('http') ? chapterPath.replace(LC, '') : chapterPath);
        const $ = cheerio.load(data);
        raw = $('#array_data').text().trim() || null;
    } catch { /* red caída: caemos a externo */ }

    const decoded = raw ? decodeArrayData(raw) : null;
    if (decoded && decoded.length > 0) {
        return { pages: decoded };
    }
    return { externalUrl: url };
}

module.exports = { search, pickBest, chapters, pages, LC };
