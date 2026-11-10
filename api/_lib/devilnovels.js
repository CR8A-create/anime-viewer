// ============================================================
// FUENTE DE NOVELAS SECUNDARIA: DevilNovels (devilnovels.com)
// ------------------------------------------------------------
// WordPress con la API REST abierta (wp-json/wp/v2). Novelas web
// chinas/coreanas traducidas al español. Se usa cuando SkyNovels no
// responde (desde nov. 2026 devuelve 403 a las IPs de Vercel).
//
// Modelo del sitio:
//   novela   = CATEGORÍA  (/categories → id, name, slug, count = nº de capítulos)
//   capítulo = POST de esa categoría (/posts?categories=ID)
//   portada y sinopsis = PÁGINA con el mismo slug/título (/pages?_embed)
//
// Esquema de id usado por el frontend: "dn:<id>"
//   novela:   dn:40        (id de categoría)
//   capítulo: dn:46616     (id de post)
// ============================================================
const axios = require('axios');

const API = 'https://devilnovels.com/wp-json/wp/v2';
const UA = 'AniNova/1.0 (personal reader)';
const CATALOG_TTL = 6 * 60 * 60 * 1000;

function dnGet(path) {
    return axios.get(`${API}${path}`, { timeout: 12000, headers: { 'User-Agent': UA, Accept: 'application/json' } });
}

const isDn = (id) => typeof id === 'string' && id.startsWith('dn:');
const rawId = (id) => String(id).replace(/^dn:/, '').replace(/\D/g, '');

function decode(html) {
    return String(html || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&hellip;/g, '…')
        .replace(/\s+/g, ' ').trim();
}
const norm = (t) => decode(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** Todas las páginas de un listado paginado de WP (per_page=100). */
async function wpAll(path) {
    const sep = path.includes('?') ? '&' : '?';
    const first = await dnGet(`${path}${sep}per_page=100&page=1`);
    const pages = parseInt(first.headers['x-wp-totalpages'], 10) || 1;
    let all = first.data;
    if (pages > 1) {
        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) =>
            dnGet(`${path}${sep}per_page=100&page=${i + 2}`).then(r => r.data).catch(() => [])));
        for (const chunk of rest) all = all.concat(chunk);
    }
    return all;
}

// ---- Catálogo (categorías + portadas de las páginas), cacheado en memoria ----
let catalogCache = null, catalogAt = 0;
async function catalog() {
    if (catalogCache && Date.now() - catalogAt < CATALOG_TTL) return catalogCache;
    const [cats, pages] = await Promise.all([
        wpAll('/categories?_fields=id,name,slug,count&hide_empty=true'),
        wpAll('/pages?_embed=wp:featuredmedia&_fields=slug,title,excerpt,modified,_links,_embedded').catch(() => []),
    ]);
    const bySlug = new Map(), byTitle = new Map();
    for (const p of pages) {
        const media = ((p._embedded || {})['wp:featuredmedia'] || [])[0];
        if (!media || !media.source_url) continue; // páginas de utilidad (contacto, donaciones…)
        const sizes = (media.media_details || {}).sizes || {};
        const entry = {
            cover: (sizes.medium_large || sizes.large || {}).source_url || media.source_url,
            description: decode((p.excerpt || {}).rendered),
            updatedAt: Date.parse(p.modified) || 0,
        };
        bySlug.set(p.slug, entry);
        byTitle.set(norm((p.title || {}).rendered), entry);
    }
    const list = cats
        .filter(c => c.count >= 5 && c.slug !== 'uncategorized' && c.slug !== 'sin-categoria')
        .map(c => {
            const extra = bySlug.get(c.slug) || byTitle.get(norm(c.name)) || {};
            return {
                id: `dn:${c.id}`,
                title: decode(c.name),
                name: c.slug,
                writer: '',
                status: '',
                cover: extra.cover || null,
                chapters: c.count,
                rating: null,
                description: extra.description || '',
                views: c.count,                 // sin dato de visitas: los más largos primero
                updatedAt: extra.updatedAt || 0,
            };
        });
    catalogCache = list;
    catalogAt = Date.now();
    return list;
}

/** Nº de capítulo a partir del título ("ED Capítulo 12: …" → 12). */
function chapterNumber(title, fallback) {
    const m = String(title).match(/cap[ií]tulo\s*(\d+(?:[.,]\d+)?)/i) || String(title).match(/\b(?:cap|ch|c)\.?\s*(\d+(?:[.,]\d+)?)/i) || String(title).match(/(\d+(?:[.,]\d+)?)/);
    return m ? parseFloat(m[1].replace(',', '.')) : fallback;
}

/** Ficha + lista completa de capítulos (id "dn:<categoría>"). */
async function novelInfo(id) {
    const catId = rawId(id);
    const [list, posts] = await Promise.all([
        catalog(),
        wpAll(`/posts?categories=${catId}&orderby=date&order=asc&_fields=id,title`),
    ]);
    const card = list.find(n => n.id === `dn:${catId}`);
    if (!card && posts.length === 0) {
        const e = new Error('Novela no encontrada'); e.notFound = true; throw e;
    }
    const chapters = posts.map((p, i) => {
        const title = decode((p.title || {}).rendered);
        return { id: `dn:${p.id}`, number: chapterNumber(title, i + 1), title, volume: '' };
    });
    // Orden por nº de capítulo; a igualdad, el orden de publicación (sort estable)
    chapters.sort((a, b) => a.number - b.number);
    return {
        data: {
            id: `dn:${catId}`,
            title: card ? card.title : '',
            writer: '', translator: 'DevilNovels',
            status: '',
            cover: card ? card.cover : null,
            description: card ? card.description : '',
            genres: [],
        },
        chapters,
    };
}

/** Contenido HTML de un capítulo (id "dn:<post>"). */
async function chapter(id) {
    const { data } = await dnGet(`/posts/${rawId(id)}?_fields=id,title,content`);
    const title = decode((data.title || {}).rendered);
    // Fuera scripts/iframes/anuncios incrustados; el resto es texto en <p>.
    const content = String((data.content || {}).rendered || '')
        .replace(/<(script|style|iframe|ins|form|noscript)[\s\S]*?<\/\1>/gi, '')
        .replace(/<(script|iframe|ins|img|input|button)[^>]*>/gi, '')
        .replace(/\son\w+="[^"]*"/gi, '');
    return { id: `dn:${data.id}`, number: chapterNumber(title, 0), title, content };
}

module.exports = { isDn, catalog, novelInfo, chapter, API };
