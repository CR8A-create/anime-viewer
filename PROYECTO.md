# AniNova — Documentación del proyecto (handoff)

Documento de contexto para retomar el proyecto en otra conversación. Resume
arquitectura, fuentes, endpoints, decisiones y mantenimiento. Última
actualización: sesión de julio 2026.

## Qué es

Web personal (uso privado: el dueño + 2 amigos, bajo tráfico) para **ver anime,
películas y series, y leer manga/manhwa/cómics y novelas ligeras**, todo en
español y gratis. No aloja nada: scrapea/incrusta fuentes de terceros.

## Despliegue

- **Frontend estático** → Netlify: `https://aninova.netlify.app` (carpeta `public/`).
- **API serverless** → Vercel: `https://pagina-ver-anime.vercel.app/api` (carpeta `api/`, funciones catch-all `[...path].js`).
- **`server.js`** → solo desarrollo local (`node server.js`, puerto 3000). Monta
  los mismos handlers `api/**/[...path].js` que producción para probar en local.
- Repo GitHub: `CR8A-create/anime-viewer`. Se despliega solo con cada push a `main`.
- Arrancar local para pruebas: hay `.claude/launch.json` con el server `aninova`.
- El frontend detecta host: en localhost usa `http://localhost:3000/api`, en
  producción `https://pagina-ver-anime.vercel.app/api`.

## Estructura

```
api/
  _lib/
    shared.js        cors, cache (getCache/getStale/setCache con TTL), scraperGet
                     (UA rotativos, headers anti-bloqueo, PROXY_URL opcional), tmdbGet
    animeSources.js  MOTOR de anime multi-fuente (ver abajo)
    zonatmo.js       fuente PRIMARIA de manga (scraping)
    leercapitulo.js  fuente de manga legacy (fallback, imágenes cifradas → solo enlace externo)
    firebase.js      Firestore para comentarios (opcional; fallback en memoria)
  anime/[...path].js   endpoints de anime
  movies/[...path].js  endpoints de películas
  series/[...path].js  endpoints de series
  manga/[...path].js   endpoints de manga
  novels/[...path].js  endpoints de novelas
  comments/[contentId].js
public/
  index.html           PORTADA (gateway: Anime / Cine&TV / Manga / Novelas)
  anime/  index.html directorio.html emision.html anime.html(ficha) ver.html(reproductor)
  movies/ index.html detalle.html(ficha) ver.html(reproductor)
  manga/  index.html manga.html(ficha) leer.html(lector)
  novelas/ index.html novela.html(ficha) leer.html(lector)
  assets/css/  style.css(anime, naranja) movies-theme.css(morado) manga-theme.css(verde) novelas-theme.css(ambar)
  assets/js/   anime-logic.js  movies-logic.js  manga-logic.js  mi-lista.js(favoritos/historial localStorage)
```

## Fuentes por sección

### ANIME — `api/_lib/animeSources.js` (multi-fuente con fallback)
- **animeflv.ar** (WordPress/AnimeStream): PRIMARIA de airing/recent/videos. Se
  actualiza a diario. Player rápido "HLS" = player.zilla-networks.com.
- **www3/www4.animeflv.net** (clásico): CONGELADO desde ~primavera 2026, pero
  catálogo profundo con sinopsis ES. Redirige www3→www4. Sus videos ya no van
  inline (`var videos = []`).
- **TioAnime, JKAnime, MonosChinos**: fallbacks de videos/recent.
- **Jikan (MyAnimeList)**: último recurso de metadata. Da 504 con frecuencia —
  por eso el buscador/directorio NO usan Jikan directo.
- `SOURCE_ORDER` define el orden por capacidad. `info` fusiona animeflv.ar +
  clásico en paralelo (episodios nuevos + catálogo viejo).
- Endpoints: `/api/anime/airing|recent|info?title=|videos?slug=&episode=|search?q=|top?page=&genre=&type=&order=|genres|status`.
- Directorio: filtros REALES de AnimeFLV (`FLV_GENRES` con slugs, tipo, orden
  rating/updated/added/title). No hay filtro por letra (la fuente no lo soporta).
- Monitoreo en vivo: `GET /api/anime/status`.

### PELÍCULAS y SERIES — `api/movies` y `api/series` (TMDB + embeds)
- Metadata: **TMDB** (key en `shared.js`). Ficha `movies/detalle.html` (series:
  temporadas + episodios con miniatura vía `/api/series/season`).
- Reproducción: embeds por tmdbId/imdbId. Español/latino: **Embed69**
  (`embed69.org/f/{imdbId}`, solo pelis, audio latino real dentro de iframe) +
  VidFast/VidLink. Series ES: **VidSrc.su** (multi-audio) + VidFast/VidLink.
- El player (`movies/ver.html`) abre en **ESPAÑOL por defecto** (julio 2026);
  `?lang=en` fuerza el original. AutoEmbed retirado (dominio muerto).
- No hay API de doblaje puro para series → nota en el player para cambiar el
  audio dentro del reproductor (los embeds arrancan en inglés muchas veces).

### MANGA — ZonaTMO → Mangalect → MangaDex (cadena de fallback)
- **ZonaTMO** (`zonatmo.org`, familia TMO/LectorTMO): manga, manhwa y cómics en
  español INCLUIDOS los licenciados (One Piece, MHA, JJK...). **Imágenes en URL
  PLANA sin cifrar** (`storage.zonatmo.org/chapters/ID/N.webp`) → lector propio
  completo. Sin protección de hotlink (cargan desde aninova). Funciona desde el
  datacenter de Vercel.
  - Búsqueda: `/biblioteca?title=X` (el form action es `/biblioteca`, no `/library`).
  - Ficha: `/library/{tipo}/{id}/{slug}` → `li.upload-link` con `.chapter-number[data-number]` y links `/view_uploads/{id}`.
  - Páginas: `/view_uploads/{id}` → URLs planas (regex sobre el HTML, orden del HTML).
  - Esquema de id del frontend: `zt:<ruta>` (ej. `zt:library/manga/31322/one-piece`, `zt:view_uploads/992869`).
- **OJO (julio 2026): ZonaTMO devuelve HTTP 403 desde el datacenter de Vercel**
  (bloqueo por IP; en local funciona). Por eso en producción sirve Mangalect.
  Si algún día se quiere ZonaTMO en producción: configurar env `PROXY_URL`
  (soportado en zonatmo.js/mangalect.js) o esperar a que levanten el bloqueo.
- **Mangalect** (`api/_lib/mangalect.js`, prefijo `ml:`): 2ª fuente, FUNCIONA
  desde Vercel. API JSON propia: `/api/buscar_mangas/?query=&tipo=manga|manhwa|manhua&page=&page_size=24`
  (tipo `comic` NO existe → cae a MangaDex). Ficha `/info/{slug}/`
  (h1.manga-title, #synopsis-text, .status-text, a.chapter-link). Capítulo
  `/lectura/{slug}/{cap}/` con imágenes PLANAS
  (`images.mangalect.org/file/leermangaesp/mangas/ID/capitulo_N/pagina_NNN.webp`)
  → lector propio completo.
- **MangaDex** (`api.mangadex.org`): 3er respaldo. RETIRA los shounen muy
  licenciados en español. Sus URLs de páginas (at-home) EXPIRAN ~15 min →
  TTL de caché 5 min (si se sube, el lector da 404).
- **leercapitulo.co** (`api/_lib/leercapitulo.js`): legacy, imágenes cifradas,
  no se usa.
- Endpoints: `/api/manga/popular?type=|search?q=|info?id=|chapters?id=|pages?chapter=|status`.
- `GET /api/manga/status` sondea las 3 fuentes en vivo (ok/error/latencia) —
  usar para diagnosticar producción.
- El handler enruta por prefijo del id: `zt:` → ZonaTMO, `ml:` → Mangalect,
  si no → MangaDex.
- Lector `manga/leer.html`: las `<img>` van SIN `loading="lazy"` a propósito —
  miden 0px hasta cargar y el lazy nativo nunca las disparaba (bug "imágenes
  sin imágenes"). Llevan `min-height` de placeholder que se quita al cargar.

### NOVELAS LIGERAS — `api/novels` (SkyNovels)
- **SkyNovels** (`api.skynovels.net/api`): API REST pública. Catálogo, ficha con
  volúmenes/capítulos (excluye VIP), y contenido de capítulo (texto HTML, se
  limpian marcas de agua invisibles). Lector de texto con tamaño de letra.

## CUENTAS DE USUARIO — `api/auth` + `public/cuenta.html` (julio 2026)
Login "anónimo sin serlo": **usuario + contraseña + edad**, sin email. La edad
se guarda para funciones futuras.
- Backend `api/auth/[...path].js` + `api/_lib/auth.js`: scrypt para
  contraseñas, token HMAC-SHA256 (180 días), rate limit por IP. Secreto =
  env `AUTH_SECRET` o derivado de `FIREBASE_PRIVATE_KEY`. Firestore:
  colección `users` (doc id = username en minúsculas) y `userSync` (blob de
  listas). Sin Firebase (local) → memoria.
- Endpoints: `POST /api/auth/register|login`, `GET /api/auth/me`,
  `GET|POST /api/auth/sync` (Bearer token).
- Frontend `assets/js/auth.js` (window.Auth) + `cuenta.html` (perfil estilo
  Crunchyroll: pestañas Historial / Favoritos / Mis Listas con listas
  personalizadas). Enlace "Cuenta" en todos los navs y en la portada.

## "Mi Lista" — `public/assets/js/mi-lista.js`
Favoritos, vistos, historial y progreso de manga/novelas en localStorage.
**Favoritos e historial requieren perfil** (sin sesión: aviso con enlace a
crear cuenta; el resto sigue local). Con sesión, TODO el estado se sincroniza
a Firestore (`userSync`, debounce 1.2s) y se baja al cargar cualquier página →
sigue al usuario entre dispositivos. `MiLista.mergeWithCloud()` fusiona lo
local con la nube al iniciar sesión.

## Comentarios y Firebase
`api/comments` usa Firestore si están las env vars `FIREBASE_PROJECT_ID`,
`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` en Vercel; si no, memoria
(se borra en cada cold start). **Con sesión** los comentarios se firman con el
nombre de usuario (`userId` = username en minúsculas) y el autor puede
borrarlos (`DELETE /api/comments/{contentId}?id=` con Bearer; el backend
verifica propiedad). Sin sesión siguen los nombres anónimos aleatorios.

## Anuncios (decisión del usuario)
Se probó `sandbox` en los iframes y un ranking de servidores por fiabilidad;
ambos se REVIRTIERON porque rompían/movían el problema. Decisión final: **no
tocar los reproductores**; el usuario usa bloqueador (uBlock/Brave/DNS AdGuard).
Los reproductores quedan con su orden original de servidores, sin sandbox.

## Mantenimiento (cuando algo se rompe)
- Un sitio cambia de dominio → editar el array `domains` de esa fuente en
  `animeSources.js` (`SOURCES`). Rotación automática entre dominios.
- Un sitio cambia el HTML → actualizar los selectores de esa función proveedora.
  Guía de selectores vigentes en `SOURCES.md`.
- ZonaTMO cambia estructura → ajustar `api/_lib/zonatmo.js` (search/mangaInfo/pages).
- Estado de fuentes de anime en vivo: `/api/anime/status`.
- Caché en memoria (sobrevive a warm invocations, se reinicia en cold start).
  TTL por clave. Ventana "stale" 24h si TODAS las fuentes de anime caen.

## UX (julio 2026)
- Las 4 secciones están enlazadas entre sí en todos los navs; fichas con botón
  "Volver" (history.back con fallback al índice).
- Búsqueda en el index de anime: al buscar se ocultan carrusel/Continuar
  Viendo/Favoritos/Populares (los resultados quedaban tapados); se restaura al
  vaciar el buscador o con Escape (`enterSearchMode`/`exitSearchMode` en
  anime-logic.js).

## Convenciones
- No romper los shapes que consume el frontend (tipo Jikan en anime:
  `images.jpg.image_url`, etc.).
- Los CSS llevan `?v=N` para cache-busting; subir N al cambiarlos.
- Al probar en el navegador in-app, las capturas a veces se cuelgan por los
  players/imágenes pesados; usar `javascript_tool` para verificar el DOM.
- Commits en español, y `git push` tras cada bloque verificado.

## Otros docs del repo
- `SOURCES.md` — selectores vigentes por fuente de anime + guía de actualización.
- `FIREBASE.md` — conectar Firestore (gratis) para comentarios/sincronización.
- `README.md` — original del proyecto.
