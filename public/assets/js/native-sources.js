// ============================================================
// FUENTES DESDE EL DISPOSITIVO (solo en la app Android)
// ------------------------------------------------------------
// JKAnime y Manga Oni devuelven 403 a nuestro servidor (Vercel), pero
// responden con normalidad a un móvil. Dentro de la app, Capacitor
// permite hacer la petición desde el propio teléfono (CapacitorHttp,
// HTTP nativo sin CORS), igual que haría su navegador. Aquí se piden
// esas páginas y se extrae lo mismo que extrae la API:
//
//   NativeSources.available()               → ¿estamos en la app?
//   NativeSources.jkServers(slug, episodio) → [{name,url,lang,source}]
//   NativeSources.mangaChapters(titulo)     → [{id:'mo:…',chapter,…}] | []
//   NativeSources.mangaPages(idCapitulo)    → [url, …]
//
// En el navegador normal available() es false y nada de esto se usa.
// Los analizadores son los mismos que api/_lib/animeSources.js (JKAnime)
// y api/_lib/mangaoni.js: si uno cambia, hay que tocar los dos sitios.
// El módulo también se puede cargar en Node (pruebas) pasando `http`.
// ============================================================
(function (root) {
    const JK = 'https://jkanime.net';
    const MO = 'https://manga-oni.com';
    const JK_NATIVE_OK = ['Desu', 'Magi'];
    const JK_EMBED_OK = ['Streamtape', 'VOE', 'Vidhide', 'Streamwish', 'Filemoon', 'Doodstream', 'Mp4upload', 'Mixdrop', 'YourUpload', 'Uqload'];

    function isNative() {
        const C = root.Capacitor;
        return !!(C && typeof C.nativePromise === 'function' && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
    }

    /** GET desde el dispositivo. Devuelve el HTML o lanza. */
    let http = async function (url) {
        const r = await root.Capacitor.nativePromise('CapacitorHttp', 'request', {
            url, method: 'GET', responseType: 'text',
            connectTimeout: 10000, readTimeout: 10000,
            headers: {
                'User-Agent': root.navigator.userAgent,
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'es-ES,es;q=0.9',
            },
        });
        if (!r || r.status === 404) { const e = new Error('404'); e.notFound = true; throw e; }
        if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
        return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    };

    const b64 = (s) => {
        try {
            const bin = atob(s);
            try { return decodeURIComponent(escape(bin)); } catch { return bin; }
        } catch { return ''; }
    };
    const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const unescapeHtml = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    // ---------------- JKAnime ----------------
    function parseJkServers(html) {
        const servers = [];
        const seen = new Set();
        const re = /video\[(\d+)\]\s*=\s*'<iframe[^>]*\ssrc="([^"]+)"/g;
        let m;
        while ((m = re.exec(html))) {
            const nameM = html.match(new RegExp('id="btn-show-' + m[1] + '"[^>]*>\\s*([^<]+?)\\s*<'));
            const name = nameM ? nameM[1].trim() : '';
            if (!JK_NATIVE_OK.includes(name) || seen.has(name)) continue;
            seen.add(name);
            servers.push({ name, url: m[2], lang: 'sub', source: 'jkanime' });
        }
        const sm = html.match(/var\s+servers\s*=\s*(\[[\s\S]*?\]);/);
        let list = [];
        if (sm) { try { list = JSON.parse(sm[1]); } catch { list = []; } }
        for (const s of list) {
            if (!JK_EMBED_OK.includes(s.server)) continue;
            const url = b64(s.remote || '').trim();
            if (!/^https:\/\//.test(url) || /mega\.nz|mail\.ru/.test(url)) continue;
            servers.push({ name: s.server, url, lang: s.lang === 2 ? 'lat' : 'sub', source: 'jkanime' });
        }
        return servers;
    }

    async function jkServers(slug, episode) {
        const base = String(slug || '').replace(/-(tv|ova|movie|special|specials)$/, '');
        const cands = [...new Set([slug, base, base + '-tv'])].filter(Boolean);
        for (const c of cands) {
            let html;
            try { html = await http(`${JK}/${encodeURIComponent(c)}/${encodeURIComponent(episode)}/`); }
            catch (e) { if (e.notFound) continue; throw e; }
            const servers = parseJkServers(html);
            if (servers.length) return servers;
        }
        return [];
    }

    // ---------------- Manga Oni ----------------
    function parseMoSearch(html) {
        const out = [];
        const seen = new Set();
        const re = /<a href="https:\/\/manga-oni\.com\/(manga|manhwa|manhua)\/([^"/]+)\/"[^>]*itemprop="url"[^>]*>\s*<div[^>]*>\s*<img[^>]*?alt="([^"]*)"/g;
        let m;
        while ((m = re.exec(html))) {
            if (seen.has(m[2])) continue;
            seen.add(m[2]);
            out.push({ path: `${m[1]}/${m[2]}`, title: unescapeHtml(m[3]).trim() });
        }
        return out;
    }

    function parseMoChapters(html) {
        const seen = new Map();
        const re = /href="https:\/\/manga-oni\.com\/lector\/([^"/]+)\/(\d+)\/[^"]*"[^>]*>[\s\S]{0,300}?data-num="([\d.]+)"/g;
        let m;
        while ((m = re.exec(html))) {
            const num = String(parseFloat(m[3]));
            if (num === 'NaN' || seen.has(num)) continue;
            seen.set(num, { id: `mo:lector/${m[1]}/${m[2]}`, chapter: num, title: '', pages: null, lang: 'es' });
        }
        return [...seen.values()].sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
    }

    function parseMoPages(html) {
        const m = html.match(/var\s+unicap\s*=\s*'([^']+)'/);
        if (!m) return [];
        const parts = b64(m[1]).split('||');
        if (parts.length < 2 || !/^https:\/\//.test(parts[0])) return [];
        let files = [];
        try { files = JSON.parse(parts[1]); } catch { return []; }
        return files.filter(f => typeof f === 'string').map(f => parts[0] + f);
    }

    /** Capítulos de `title` en Manga Oni (solo si el título coincide exacto). */
    async function mangaChapters(title) {
        const want = norm(title);
        if (!want) return [];
        const results = parseMoSearch(await http(`${MO}/buscar?q=${encodeURIComponent(title)}`));
        const hit = results.find(r => norm(r.title) === want);
        if (!hit) return [];
        return parseMoChapters(await http(`${MO}/${hit.path}/`));
    }

    /** Páginas de un capítulo "mo:lector/{slug}/{id}". */
    async function mangaPages(chapterId) {
        const path = String(chapterId).replace(/^mo:/, '').replace(/[^a-z0-9/_-]/gi, '').replace(/^\/+|\/+$/g, '');
        if (!/^lector\//.test(path)) return [];
        return parseMoPages(await http(`${MO}/${path}/cascada/`));
    }

    // Caché corta en sessionStorage: la ficha y el lector piden lo mismo.
    function cached(key, ttlMs, fn) {
        return async function () {
            try {
                const hit = JSON.parse(root.sessionStorage.getItem(key));
                if (hit && Date.now() - hit.at < ttlMs && hit.v && hit.v.length) return hit.v;
            } catch { /* sin caché */ }
            const v = await fn();
            try { if (v && v.length) root.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch { /* lleno */ }
            return v;
        };
    }

    const api = {
        available: isNative,
        jkServers,
        mangaChapters: (title) => cached('ns:moch:' + norm(title), 30 * 60 * 1000, () => mangaChapters(title))(),
        mangaPages,
        _setHttp(fn) { http = fn; },
        _parse: { parseJkServers, parseMoSearch, parseMoChapters, parseMoPages },
        _raw: { mangaChapters },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.NativeSources = api;
})(typeof window !== 'undefined' ? window : globalThis);
