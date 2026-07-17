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
- No hay API de doblaje puro para series → nota en el player para cambiar el
  audio dentro del reproductor.

### MANGA — `api/_lib/zonatmo.js` (PRIMARIO) + MangaDex (respaldo)
- **ZonaTMO** (`zonatmo.org`, familia TMO/LectorTMO): manga, manhwa y cómics en
  español INCLUIDOS los licenciados (One Piece, MHA, JJK...). **Imágenes en URL
  PLANA sin cifrar** (`storage.zonatmo.org/chapters/ID/N.webp`) → lector propio
  completo. Sin protección de hotlink (cargan desde aninova). Funciona desde el
  datacenter de Vercel.
  - Búsqueda: `/biblioteca?title=X` (el form action es `/biblioteca`, no `/library`).
  - Ficha: `/library/{tipo}/{id}/{slug}` → `li.upload-link` con `.chapter-number[data-number]` y links `/view_uploads/{id}`.
  - Páginas: `/view_uploads/{id}` → URLs planas (regex sobre el HTML, orden del HTML).
  - Esquema de id del frontend: `zt:<ruta>` (ej. `zt:library/manga/31322/one-piece`, `zt:view_uploads/992869`).
- **MangaDex** (`api.mangadex.org`): respaldo. Tiene la mayoría pero RETIRA los
  shounen muy licenciados en español (por eso salían "solo 3 caps" antes).
- **leercapitulo.co** (`api/_lib/leercapitulo.js`): fuente legacy. Sus imágenes
  van cifradas (obfuscator.io, blob `#array_data`) → NO se descifran; quedó como
  enlace externo. Ya no se usa por defecto (ZonaTMO la reemplaza).
- Endpoints: `/api/manga/popular?type=manga|manhwa|comic&page=|search?q=|info?id=|chapters?id=|pages?chapter=`.
- El handler enruta por prefijo `zt:` → ZonaTMO; si no, MangaDex.
- Pendiente sugerido por el usuario: añadir **mangalect.org** como 2º fallback
  (limpio, sin CF; `/info/{slug}/` y `/lectura/{slug}/{cap}/`). ZonaTMO cubre
  casi todo, así que es baja prioridad.

### NOVELAS LIGERAS — `api/novels` (SkyNovels)
- **SkyNovels** (`api.skynovels.net/api`): API REST pública. Catálogo, ficha con
  volúmenes/capítulos (excluye VIP), y contenido de capítulo (texto HTML, se
  limpian marcas de agua invisibles). Lector de texto con tamaño de letra.

## "Mi Lista" — `public/assets/js/mi-lista.js`
Favoritos, vistos, historial y progreso de manga/novelas en **localStorage**
(gratis, sin backend, por dispositivo). Secciones "Continuar Viendo"/"Favoritos"
se autoinyectan en el index de anime. Para sincronizar entre dispositivos →
Firebase (ver `FIREBASE.md`), no implementado aún.

## Comentarios y Firebase
`api/comments` usa Firestore si están las env vars `FIREBASE_PROJECT_ID`,
`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` en Vercel; si no, memoria
(se borra en cada cold start). Guía paso a paso en `FIREBASE.md`. Plan Spark =
gratis, sin tarjeta.

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
