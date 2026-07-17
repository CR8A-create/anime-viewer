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

async function doSearch(q) {
    searchMode = true;
    const grid = document.getElementById('mangaGrid');
    document.getElementById('sectionTitle').innerHTML = `<i class="fas fa-search"></i> Resultados: ${escapeHtml(q)}`;
    document.getElementById('loadMore').style.display = 'none';
    grid.innerHTML = Array(6).fill('<div class="skeleton"></div>').join('');
    try {
        const res = await fetch(`${API}/manga/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        grid.innerHTML = (data.success && data.data.length)
            ? data.data.map(cardHtml).join('')
            : '<div class="error-box">Sin resultados en español.</div>';
    } catch {
        grid.innerHTML = '<div class="error-box">Error de conexión.</div>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'manga-home') return;

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
