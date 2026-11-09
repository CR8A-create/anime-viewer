// ============================================================
// APP SHELL — capa móvil compartida por todas las páginas
// ------------------------------------------------------------
// - Inyecta la barra de pestañas inferior (solo visible ≤768px,
//   ver assets/css/mobile.css). No aparece en la portada ni en
//   los lectores (páginas sin <header>).
// - Marca los enlaces del nav que llevan a OTRA sección para que
//   en móvil solo queden los propios de la sección como "chips".
// - Añade theme-color / viewport-fit para que la app y el
//   navegador del móvil pinten la barra de estado a juego.
// ============================================================
(function () {
    const path = location.pathname;
    const SECTIONS = [
        { id: 'anime', dir: '/anime/', href: 'anime/index.html', icon: 'fa-dragon', label: 'Anime' },
        { id: 'movies', dir: '/movies/', href: 'movies/index.html', icon: 'fa-film', label: 'Cine y TV' },
        { id: 'manga', dir: '/manga/', href: 'manga/index.html', icon: 'fa-book-open', label: 'Manga' },
        { id: 'novelas', dir: '/novelas/', href: 'novelas/index.html', icon: 'fa-feather-pointed', label: 'Novelas' },
        { id: 'cuenta', dir: '/cuenta.html', href: 'cuenta.html', icon: 'fa-user', label: 'Cuenta' },
    ];
    const current = SECTIONS.find(s => path.includes(s.dir));
    const inSubdir = !!current && current.id !== 'cuenta';
    const base = inSubdir ? '../' : '';

    // Meta para móvil (barra de estado del color de la app, notch)
    function meta(name, content) {
        if (document.querySelector(`meta[name="${name}"]`)) return;
        const m = document.createElement('meta');
        m.name = name; m.content = content;
        document.head.appendChild(m);
    }
    meta('theme-color', '#0b0c10');
    meta('mobile-web-app-capable', 'yes');
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp && !vp.content.includes('viewport-fit')) vp.content += ', viewport-fit=cover';

    function init() {
        const header = document.querySelector('header');
        if (!header) return; // portada y lectores: sin barra

        // Enlaces del nav que salen de la sección actual
        const nav = header.querySelector('nav');
        if (nav) {
            let own = 0;
            nav.querySelectorAll('li').forEach(li => {
                const a = li.querySelector('a');
                const href = a ? (a.getAttribute('href') || '') : '';
                const cross = href.startsWith('../') || /\/index\.html$/.test(href) || href.endsWith('cuenta.html');
                if (cross) li.classList.add('anv-xsec');
                else if (!a || !a.classList.contains('active')) own++;
            });
            if (own === 0) nav.classList.add('anv-empty');
        }

        initSwipe();

        const bar = document.createElement('div');
        bar.className = 'anv-tabbar';
        bar.setAttribute('role', 'navigation');
        bar.setAttribute('aria-label', 'Secciones');
        bar.innerHTML = SECTIONS.map(s => `
            <a href="${base}${s.href}" class="${current && current.id === s.id ? 'active' : ''}">
                <i class="fas ${s.icon}"></i><span>${s.label}</span>
            </a>`).join('');
        document.body.appendChild(bar);
        document.body.classList.add('has-tabbar');
    }

    // Deslizar con el dedo en los carruseles (en móvil no hay flechas)
    function onSwipe(el, next, prev) {
        if (!el) return;
        let x0 = null, y0 = null;
        el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
        el.addEventListener('touchend', e => {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0;
            const dy = e.changedTouches[0].clientY - y0;
            x0 = null;
            if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            (dx < 0 ? next : prev)();
        }, { passive: true });
    }
    function initSwipe() {
        const click = id => () => { const b = document.getElementById(id); if (b) b.click(); };
        onSwipe(document.getElementById('heroCarousel'), click('nextBtn'), click('prevBtn'));
        // Carruseles de novedades: avanzar pulsando el punto vecino
        ['mc', 'nc'].forEach(p => {
            const step = d => () => {
                const dots = [...document.querySelectorAll(`#${p}Dots button`)];
                if (!dots.length) return;
                const active = dots.findIndex(b => b.dataset.active === '1');
                const i = ((active < 0 ? 0 : active) + d + dots.length) % dots.length;
                dots[i].click();
            };
            onSwipe(document.getElementById(p + 'Track'), step(1), step(-1));
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
