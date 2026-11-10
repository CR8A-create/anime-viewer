# AniNova — Documentación del proyecto (handoff)

Documento de contexto para retomar el proyecto en otra conversación. Resume
arquitectura, fuentes, endpoints, decisiones y mantenimiento. Última
actualización: sesión de noviembre 2026.

## Qué es

Web personal (uso privado: el dueño + 2 amigos, bajo tráfico) para **ver anime,
películas y series, y leer manga/manhwa/cómics y novelas ligeras**, todo en
español y gratis. No aloja nada: scrapea/incrusta fuentes de terceros.

## Despliegue

- **Frontend estático** → Netlify: `https://aninova.netlify.app` (carpeta `public/`).
- **API serverless** → Vercel: `https://pagina-ver-anime.vercel.app/api` (carpeta `api/`, funciones catch-all `[...path].js`).
- **`server.js`** → solo desarrollo local (`npm run dev`, puerto 3000). ~60
  líneas: sirve `public/` (HTML sin caché) y monta los mismos handlers
  `api/**/[...path].js` que producción. No tiene lógica propia.
- **App Android** (Capacitor, carpeta `android/`) → carga la web publicada
  (`capacitor.config.json` → `server.url`), así que se actualiza sola. Lleva
  bloqueador de anuncios nativo (ver `ANUNCIOS.md`). APK: `npm run app:build`.
- Flujo de ramas: se trabaja en `dev` y se fusiona a `main` cuando está
  verificado (cada push a `main` despliega Netlify + Vercel).
- Repo GitHub: `CR8A-create/anime-viewer`. Se despliega solo con cada push a `main`.
- Arrancar local para pruebas: hay `.claude/launch.json` con el server `aninova`.
- El frontend detecta host: en `http://localhost` usa `http://localhost:3000/api`;
  en cualquier otro caso (producción y `https://localhost` de la app
  empaquetada) usa `https://pagina-ver-anime.vercel.app/api`. La API admite
  por CORS los orígenes de la app (`ALLOWED_ORIGINS` en `shared.js`).

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
  assets/css/  mobile.css = CAPA MÓVIL común (se carga la última en todas las páginas)
  assets/js/   anime-logic.js  movies-logic.js  manga-logic.js  mi-lista.js(favoritos/historial localStorage)
               app-shell.js = barra inferior de pestañas + gestos (móvil)
```

## Fuentes por sección

### ANIME — `api/_lib/animeSources.js` (multi-fuente con fallback)
- **animeflv.ar** (WordPress/AnimeStream): PRIMARIA de airing/recent/videos. Se
  actualiza a diario. Player rápido "HLS" = player.zilla-networks.com.
- **www3/www4.animeflv.net** (clásico): **CAÍDO desde nov. 2026** (timeout en
  sus 3 dominios). Sigue en `SOURCES` marcado `fragile` (timeout 3 s, sin
  rotar dominios, breaker al primer fallo durante 30 min) por si vuelve, pero
  ya no es primaria de nada.
- **TioAnime**: catálogo profundo + sinopsis ES. Es la compañera de fusión de
  `info` (episodios antiguos) y fallback de búsqueda/videos.
- **JKAnime, MonosChinos**: fallbacks de videos/recent.
- **Jikan (MyAnimeList)**: último recurso de metadata. Da 504 con frecuencia —
  por eso el buscador/directorio NO usan Jikan directo.
- `SOURCE_ORDER` define el orden por capacidad. `info` fusiona animeflv.ar +
  TioAnime en paralelo (episodios nuevos + catálogo viejo; p. ej. One Piece
  1..1180). Si .ar ya respondió, a la otra se le dan 2,5 s de margen.
- Endpoints: `/api/anime/airing|recent|info?title=|videos?slug=&episode=|search?q=|top?page=&genre=&type=&order=|genres|status`.
- Directorio (`/top`): filtros REALES de **animeflv.ar** (`/anime/?order=&page=
  &genre[]=&type=&status=`, 30 por página). `FLV_GENRES` = [slug frontend,
  etiqueta, slug en .ar]; orden rating/updated/added/title. Respaldo: clásico
  → Jikan. No hay filtro por letra (la fuente no lo soporta).
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
- Endpoints: `/api/manga/popular?type=|search?q=|info?id=|chapters?id=|pages?chapter=|status`,
  más `directory?q=&type=&genre=&page=` (Mangalect; el género se filtra por
  NOMBRE, no por id), `genres` (lista deduplicada) y `latest` (novedades para
  el carrusel; Mangalect ordena por más nuevo por defecto).
- Pestañas del index: Manga/Manhwa/**Manhua** (Cómics se quitó: ninguna fuente
  con lector propio los tiene con contenido). `manga/directorio.html` = filtros
  tipo+género+búsqueda con paginación.
- Fallback externo: cuando una ficha no tiene capítulos, la búsqueda no
  encuentra algo o el lector no carga páginas, se muestra botón "Leer/Buscar
  en ZonaTMO" (zonatmo.org/biblioteca?title=) — el navegador del USUARIO sí
  entra aunque el servidor esté bloqueado (Solo Leveling, TBATE, cómics...).
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
- OJO: su API capa `limit` a 100 → `fetchFullCatalog()` pagina hasta el total
  (~475) y se cachea 1h. `directory?q=&status=&order=recent|rating|views|chapters&page=`
  filtra/ordena en memoria; `latest` = últimas actualizadas (carrusel).
- `novelas/directorio.html` = filtros estado+orden+búsqueda con paginación;
  carrusel de novedades en el index (igual que manga).

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

## Anuncios
Se probó `sandbox` en los iframes y un ranking de servidores por fiabilidad;
ambos se REVIRTIERON porque rompían/movían el problema. En la WEB **no se
tocan los reproductores** (orden original de servidores, sin sandbox); el
bloqueo va en el contenedor:
- **App Android**: bloqueador nativo en `MainActivity.java` (lista
  `res/raw/adblock_hosts.txt`, pop-ups y redirecciones canceladas).
- **Navegador**: DNS privado AdGuard / Brave / uBlock.
Guía completa para el usuario en `ANUNCIOS.md`.

## Diseño móvil (nov. 2026)
`assets/css/mobile.css` + `assets/js/app-shell.js`, incluidos en todas las
páginas (antes de `</head>`). En ≤768px: cabecera compacta (logo + buscador),
los enlaces propios de la sección pasan a chips con scroll y los enlaces a
otras secciones se ocultan porque están en la **barra inferior fija**
(Anime · Cine y TV · Manga · Novelas · Cuenta). La barra no aparece en la
portada ni en los lectores (páginas sin `<header>`). Rejillas a 3 columnas,
carruseles deslizables con el dedo, y en el reproductor de anime la lista de
episodios va justo debajo del vídeo. Escritorio no cambia.

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
- `ANUNCIOS.md` — cómo quitar anuncios (app, móvil, PC) y cómo ampliar la lista.
- `FIREBASE.md` — conectar Firestore (gratis) para comentarios/sincronización.
- `README.md` — original del proyecto.

## Cambios de noviembre 2026 (2ª tanda): fuentes bloqueadas y respaldos

**Regla general:** JKAnime, ZonaTMO y SkyNovels devuelven **HTTP 403 a las IPs
de Vercel** (en local, con `npm run dev`, responden). No se rodea ese bloqueo
con proxys/relays: cada sección tiene una fuente de respaldo que sí responde.
Diagnóstico en vivo: `/api/anime/status`, `/api/manga/status`,
`/api/novels/status`.

- **Anime — servidores**: `/api/anime/videos` fusiona TODAS las fuentes
  (`videosMerged` en `animeSources.js`); cada servidor lleva `source`. Embeds
  rotos filtrados en `BLOCKED_EMBEDS`. JKAnime aporta sus reproductores propios
  (Desu, Magi) cuando responde, es decir, en local. Detalle en `SOURCES.md`.
- **Anime — marcador** (`anime/ver.html` → `Marker`, datos en `MiLista.setMark`
  / `getMark`, clave localStorage `anv_marks`, sincronizada con la cuenta): los
  reproductores son iframes de terceros y NO informan del minuto, así que el
  marcador cuenta el tiempo con el episodio en marcha (arranca al tocar el
  vídeo, se detiene al cambiar de pestaña, botones Pausar y ±30 s). Al volver
  muestra "lo dejaste en el minuto X". No puede adelantar el vídeo por ti.
  También se recuerda el último servidor elegido (`anv_fav_server`).
- **Anime — títulos**: `altTitles()` pregunta a AniList el título romaji/inglés
  cuando la búsqueda o la ficha no encuentran nada.
- **Manga — Manga Oni** (`api/_lib/mangaoni.js`, prefijo `mo:`): fuente de
  rescate. Si una ficha llega SIN capítulos (Mangalect lista Solo Leveling
  vacío), `loadInfo()` busca el mismo título en Manga Oni y usa sus capítulos.
  También completa la búsqueda. Imágenes planas, lector propio.
- **Novelas — DevilNovels** (`api/_lib/devilnovels.js`, prefijo `dn:`): API
  REST de WordPress abierta. novela = categoría, capítulo = post, portada y
  sinopsis = página con el mismo slug. Si SkyNovels no responde, los listados
  salen de aquí; con las dos vivas (local) se mezclan. Las novelas con id
  numérico (SkyNovels) muestran "la fuente no responde" en producción.
- **Vercel no despliega producción si `dev` y `main` se suben a la vez con el
  mismo commit** (solo crea el Preview). Subir primero `main` y luego `dev`.
