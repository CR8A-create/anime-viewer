// ============ LÓGICA DEL CATÁLOGO DE MANGA ============
const VERCEL_PROJECT = 'pagina-ver-anime';
const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/api'
    : `https://${VERCEL_PROJECT}.vercel.app/api`;

let currentType = 'manga';
let currentPage = 1;
let searchMode = false;

function cardHtml(m) {
    const badge = m.type || (m.originalLanguage === 'ko' ? 'Manhwa' : 'Manga');
    return `
        <div class="manga-card" onclick="openManga('${encodeURIComponent(m.id)}')">
            ${m.cover ? `<img src="${m.cover}" alt="${escapeAttr(m.title)}" loading="lazy" referrerpolicy="no-referrer">` : ''}
            <div class="card-info">
                <span class="badge">${escapeHtml(badge)}</span>
                <h4>${escapeHtml(m.title)}</h4>
            </div>
        </div>`;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escapeAttr(s) { return (s || '').replace(/"/g, '&quot;'); }

function openManga(id) { location.href = `manga.html?id=${id}`; }

async function loadPopular(type, page, append) {
    const grid = document.getElementById('mangaGrid');
    if (!append) grid.innerHTML = Array(12).fill('<div class="skeleton"></div>').join('');
    try {
        const res = await fetch(`${API}/manga/popular?type=${type}&page=${page}`);
        const data = await res.json();
        if (!data.success || data.data.length === 0) {
            if (!append) grid.innerHTML = '<div class="error-box">No se pudo cargar el catálogo.</div>';
            return;
        }
        const html = data.data.map(cardHtml).join('');
        if (append) grid.insertAdjacentHTML('beforeend', html);
        else grid.innerHTML = html;
        document.getElementById('loadMore').style.display = data.data.length >= 24 ? 'flex' : 'none';
    } catch {
        if (!append) grid.innerHTML = '<div class="error-box">Error de conexión.</div>';
    }
}

// Tarjeta-enlace a ZonaTMO: su web abre bien desde el navegador del usuario
// aunque nuestro servidor no pueda scrapearla (bloqueo a IPs de datacenter).
function zonatmoSearchHtml(q) {
    return `
        <div style="grid-column:1/-1;text-align:center;padding:14px 10px 4px">
            <a href="https://zonatmo.org/biblioteca?title=${encodeURIComponent(q)}" target="_blank" rel="noopener"
               style="display:inline-block;background:#2b8a5c;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:.9rem">
                <i class="fas fa-external-link-alt"></i> ¿No está lo que buscas? Míralo en ZonaTMO
            </a>
        </div>`;
}

async function doSearch(q) {
    searchMode = true;
    const grid = document.getElementById('mangaGrid');
    document.getElementById('sectionTitle').innerHTML = `<i class="fas fa-search"></i> Resultados: ${escapeHtml(q)}`;
    document.getElementById('loadMore').style.display = 'none';
    grid.innerHTML = Array(6).fill('<div class="skeleton"></div>').join('');
    try {
        const res = await fetch(`${API}/manga/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        grid.innerHTML = ((data.success && data.data.length)
            ? data.data.map(cardHtml).join('')
            : '<div class="error-box">Sin resultados en español.</div>') + zonatmoSearchHtml(q);
    } catch {
        grid.innerHTML = '<div class="error-box">Error de conexión.</div>' + zonatmoSearchHtml(q);
    }
}

// ---------- CARRUSEL DE NOVEDADES ----------
let mcIndex = 0, mcItems = [], mcTimer = null;

function mcRender() {
    const track = document.getElementById('mcTrack');
    const dots = document.getElementById('mcDots');
    if (!track || !mcItems.length) return;
    const m = mcItems[mcIndex];
    track.innerHTML = `
        <div onclick="openManga('${encodeURIComponent(m.id)}')" style="cursor:pointer;position:absolute;inset:0;display:flex;align-items:stretch">
            ${m.cover ? `<div style="position:absolute;inset:0;background:url('${escapeAttr(m.cover)}') center 25%/cover;filter:blur(22px) brightness(.35)"></div>` : ''}
            <div style="position:relative;display:flex;gap:20px;align-items:center;padding:20px 26px;width:100%">
                ${m.cover ? `<img src="${escapeAttr(m.cover)}" referrerpolicy="no-referrer" alt="" style="height:200px;aspect-ratio:2/3;object-fit:cover;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.6)">` : ''}
                <div style="min-width:0">
                    <span style="background:#2b8a5c;color:#fff;font-size:.7rem;font-weight:800;text-transform:uppercase;padding:3px 10px;border-radius:4px">Novedad · ${escapeHtml(m.type || 'Manga')}</span>
                    <h2 style="color:#fff;font-size:1.5rem;margin-top:10px;line-height:1.25">${escapeHtml(m.title)}</h2>
                    <p style="color:#9ab;font-size:.85rem;margin-top:8px"><i class="fas fa-book-open"></i> Toca para ver la ficha y leer</p>
                </div>
            </div>
        </div>`;
    dots.innerHTML = mcItems.map((_, i) =>
        `<button onclick="mcGo(${i})" style="width:9px;height:9px;border-radius:50%;border:none;cursor:pointer;background:${i === mcIndex ? '#2b8a5c' : '#3a3f47'}"></button>`).join('');
}
function mcGo(i) { mcIndex = i; mcRender(); mcRestart(); }
function mcRestart() { clearInterval(mcTimer); mcTimer = setInterval(() => { mcIndex = (mcIndex + 1) % mcItems.length; mcRender(); }, 6000); }

async function loadCarousel() {
    try {
        const res = await fetch(`${API}/manga/latest`);
        const data = await res.json();
        if (!data.success || !data.data.length) return;
        mcItems = data.data.slice(0, 8);
        document.getElementById('mangaCarousel').style.display = 'block';
        mcRender();
        mcRestart();
    } catch { /* sin carrusel */ }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'manga-home') return;

    loadCarousel();
    loadPopular(currentType, 1, false);

    document.querySelectorAll('.type-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentType = tab.dataset.type;
            currentPage = 1;
            searchMode = false;
            document.getElementById('sectionTitle').innerHTML = `<i class="fas fa-fire"></i> Populares`;
            document.getElementById('searchInput').value = '';
            loadPopular(currentType, 1, false);
        };
    });

    document.getElementById('loadMore').onclick = () => {
        currentPage++;
        loadPopular(currentType, currentPage, true);
    };

    const doIt = () => {
        const q = document.getElementById('searchInput').value.trim();
        if (q) doSearch(q);
    };
    document.getElementById('searchBtn').onclick = doIt;
    document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doIt(); });
});
