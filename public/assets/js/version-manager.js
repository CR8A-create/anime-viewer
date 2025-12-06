const APP_VERSION = '2.0.0';
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/TU_USUARIO/Pagina-Ver-Anime/main/public/version.json'; // REEMPLAZAR CON TU URL REAL

const RELEASE_NOTES = `
    <h3>🚀 ¡Novedades de la Versión 2.0!</h3>
    <ul>
        <li>✨ <strong>Nueva Interfaz:</strong> Diseño moderno y fluido con efectos Glassmorphism.</li>
        <li>📱 <strong>Reproductor Mejorado:</strong> Página dedicada con botones de "Siguiente" y "Anterior".</li>
        <li>🎡 <strong>Carrusel Dinámico:</strong> Descubre nuevos animes cada vez que entras.</li>
        <li>🐞 <strong>Correcciones:</strong> Solución a problemas de carga y navegación.</li>
    </ul>
`;

document.addEventListener('DOMContentLoaded', () => {
    checkWhatsNew();
    checkForUpdates();
});

function checkWhatsNew() {
    const lastVersion = localStorage.getItem('lastSeenVersion');

    if (lastVersion !== APP_VERSION) {
        showModal('whatsNewModal', RELEASE_NOTES);
        localStorage.setItem('lastSeenVersion', APP_VERSION);
    }
}

async function checkForUpdates() {
    try {
        // Add timestamp to avoid caching
        const response = await fetch(`${UPDATE_CHECK_URL}?t=${new Date().getTime()}`);
        if (!response.ok) return;

        const data = await response.json();
        const serverVersion = data.version;

        if (compareVersions(serverVersion, APP_VERSION) > 0) {
            const updateContent = `
                <h3>¡Nueva Versión Disponible! 🎉</h3>
                <p>Versión: <strong>${serverVersion}</strong></p>
                <p>${data.changelog || 'Mejoras y correcciones.'}</p>
                <a href="${data.apkUrl}" class="btn-primary" style="display:block; text-align:center; margin-top:15px; text-decoration:none;">
                    <i class="fas fa-download"></i> Descargar Actualización
                </a>
            `;
            showModal('updateModal', updateContent);
        }
    } catch (error) {
        console.log('No se pudo buscar actualizaciones:', error);
    }
}

function showModal(modalId, content) {
    // Create modal if it doesn't exist
    let modal = document.getElementById(modalId);
    if (!modal) {
        createModalHTML(modalId);
        modal = document.getElementById(modalId);
    }

    const contentDiv = modal.querySelector('.modal-body');
    contentDiv.innerHTML = content;

    modal.classList.add('show');

    // Close button logic
    const closeBtn = modal.querySelector('.close-modal');
    closeBtn.onclick = () => modal.classList.remove('show');

    // Close on click outside
    modal.onclick = (e) => {
        if (e.target === modal) modal.classList.remove('show');
    };
}

function createModalHTML(modalId) {
    const modalDiv = document.createElement('div');
    modalDiv.id = modalId;
    modalDiv.className = 'custom-modal';
    modalDiv.innerHTML = `
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <div class="modal-body"></div>
        </div>
    `;
    document.body.appendChild(modalDiv);
}

function compareVersions(v1, v2) {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
    }
    return 0;
}
