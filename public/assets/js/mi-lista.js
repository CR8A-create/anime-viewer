// ============================================================
// MI LISTA — favoritos, episodios vistos e historial
// ------------------------------------------------------------
// Todo se guarda en localStorage del navegador: gratis, sin
// backend y sin límites de cuota para este volumen de datos.
// (Si algún día quieres sincronizar entre dispositivos, estos
// mismos datos pueden subirse a Firestore — plan gratuito — con
// el mismo patrón que ya usan los comentarios.)
//
// API global: window.MiLista
//   toggleFav(item) / isFav(key) / getFavs()
//   markWatched(animeKey, ep) / isWatched(animeKey, ep) / watchedCount(animeKey)
//   pushHistory(entry) / getHistory()
// ============================================================
(function () {
    const K_FAVS = 'anv_favs';
    const K_WATCHED = 'anv_watched';
    const K_HISTORY = 'anv_history';
    const HISTORY_MAX = 30;

    function load(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
    }
    function save(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* lleno */ }
    }

    // Clave estable a partir de un título ("One Piece" -> "one-piece")
    function keyOf(title) {
        return String(title || '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9\s-]/g, '').trim()
            .replace(/\s+/g, '-').replace(/-+/g, '-');
    }

    // ---- FAVORITOS ----
    // item: { key, title, image, url }
    function getFavs() { return load(K_FAVS, []); }
    function isFav(key) { return getFavs().some(f => f.key === key); }
    function toggleFav(item) {
        let favs = getFavs();
        if (favs.some(f => f.key === item.key)) {
            favs = favs.filter(f => f.key !== item.key);
        } else {
            favs.unshift({ ...item, addedAt: Date.now() });
        }
        save(K_FAVS, favs);
        return isFav(item.key);
    }

    // ---- VISTOS ----
    function _watched() { return load(K_WATCHED, {}); }
    function markWatched(animeKey, ep) {
        const w = _watched();
        if (!w[animeKey]) w[animeKey] = {};
        w[animeKey][ep] = Date.now();
        save(K_WATCHED, w);
    }
    function isWatched(animeKey, ep) {
        const w = _watched();
        return !!(w[animeKey] && w[animeKey][ep]);
    }
    function watchedCount(animeKey) {
        const w = _watched();
        return w[animeKey] ? Object.keys(w[animeKey]).length : 0;
    }

    // ---- HISTORIAL (continuar viendo) ----
    // entry: { key, title, image, label, url }
    function pushHistory(entry) {
        let h = load(K_HISTORY, []);
        h = h.filter(e => e.key !== entry.key); // una entrada por título
        h.unshift({ ...entry, at: Date.now() });
        save(K_HISTORY, h.slice(0, HISTORY_MAX));
    }
    function getHistory() { return load(K_HISTORY, []); }

    // ---- PROGRESO DE MANGA ----
    const K_MANGA_PROG = 'anv_manga_prog';   // { mangaKey: ultimoCapLeido }
    const K_MANGA_READ = 'anv_manga_read';   // { mangaKey: { cap: ts } }
    function setMangaProgress(key, chapter) { const p = load(K_MANGA_PROG, {}); p[key] = chapter; save(K_MANGA_PROG, p); }
    function getMangaProgress(key) { return load(K_MANGA_PROG, {})[key] || null; }
    function markChapterRead(key, chapter) {
        const r = load(K_MANGA_READ, {});
        if (!r[key]) r[key] = {};
        r[key][chapter] = Date.now();
        save(K_MANGA_READ, r);
    }
    function getReadChapters(key) { return load(K_MANGA_READ, {})[key] || {}; }

    window.MiLista = {
        keyOf, getFavs, isFav, toggleFav, markWatched, isWatched, watchedCount, pushHistory, getHistory,
        setMangaProgress, getMangaProgress, markChapterRead, getReadChapters,
    };

    // ---- SECCIÓN "CONTINUAR VIENDO" EN EL INICIO DE ANIME ----
    // Se inyecta sola si estamos en el index de anime y hay historial.
    document.addEventListener('DOMContentLoaded', () => {
        if (document.body.dataset.page !== 'home') return;
        const recentSection = document.getElementById('recentGrid') && document.getElementById('recentGrid').closest('section');
        if (!recentSection) return;

        const history = getHistory().filter(e => e.url && e.url.includes('ver.html'));
        const favs = getFavs();
        if (history.length === 0 && favs.length === 0) return;

        const makeSection = (icon, titulo, items, isHistory) => {
            const sec = document.createElement('section');
            sec.className = 'container section milista-injected';
            sec.innerHTML = `
                <div class="section-header"><h3><i class="fas ${icon}"></i> ${titulo}</h3></div>
                <div class="anime-grid"></div>`;
            const grid = sec.querySelector('.anime-grid');
            items.slice(0, 12).forEach(e => {
                const card = document.createElement('div');
                card.className = 'anime-card';
                card.onclick = () => { location.href = e.url; };
                card.innerHTML = `
                    ${e.image ? `<img src="${e.image}" alt="" loading="lazy">` : ''}
                    <div class="card-info">
                        <span class="type">${isHistory ? (e.label || 'Continuar') : '❤ Favorito'}</span>
                        <h4>${e.title}</h4>
                    </div>`;
                grid.appendChild(card);
            });
            return sec;
        };

        if (history.length > 0) {
            recentSection.parentNode.insertBefore(
                makeSection('fa-clock-rotate-left', 'Continuar Viendo', history, true), recentSection);
        }
        if (favs.length > 0) {
            recentSection.parentNode.insertBefore(
                makeSection('fa-heart', 'Mis Favoritos', favs, false), recentSection);
        }
    });
})();
