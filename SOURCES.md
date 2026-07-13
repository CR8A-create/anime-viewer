# Guía de mantenimiento de fuentes de scraping

Toda la lógica de scraping de anime vive en **`api/_lib/animeSources.js`**.
El handler (`api/anime/[...path].js`) y `server.js` solo la consumen — casi
nunca necesitarás tocarlos.

## Cómo funciona

Cada capacidad tiene una cadena de fuentes que se prueban en orden hasta que
una devuelva datos (`SOURCE_ORDER` en `animeSources.js`):

| Capacidad | Orden de fuentes |
|---|---|
| `airing` (en emisión) | AnimeFLV → TioAnime → Jikan (MyAnimeList) |
| `recent` (últimos episodios) | AnimeFLV → TioAnime → MonosChinos |
| `info` (detalle + episodios) | AnimeFLV → TioAnime → Jikan |
| `videos` (servidores de un episodio) | TioAnime → JKAnime → MonosChinos → AnimeFLV |

Protecciones automáticas:

- **Rotación de dominios**: cada fuente tiene una lista `domains`; si el primero
  falla (red/403/5xx), se prueba el siguiente. Un 404 NO rota dominio (significa
  "la página no existe", no "el sitio está caído").
- **Circuit breaker**: 3 fallos seguidos → la fuente se salta durante 4 minutos.
- **Slugs con variantes**: `one-piece-tv` ↔ `one-piece` ↔ `one-piece-sub-espanol`
  se prueban automáticamente entre sitios (`slugCandidates`).
- **Búsqueda fuzzy**: si el slug directo no existe, se busca en el sitio y se
  elige el mejor match por similitud de título (`pickBestMatch`), no el primero.
- **Caché stale**: si TODAS las fuentes fallan, se sirve la última respuesta
  buena de hasta 24h (solo mientras la función serverless siga "caliente").
- **User-Agents rotativos** y headers realistas (`scraperGet` en `shared.js`).
  Proxy opcional vía variable de entorno `PROXY_URL`.

## Monitoreo

- **`GET /api/anime/status`** — chequeo en vivo de todas las fuentes: viva/caída,
  latencia, dominio activo, último error, fallos consecutivos y para qué se usa
  cada una. Ábrelo en el navegador cuando algo falle: te dice exactamente qué
  fuente murió.
- Las respuestas de la API incluyen un campo `source` que indica qué fuente
  sirvió los datos (el frontend lo ignora, es solo para depurar).

## Cuando un sitio cambia de dominio

Edita el array `domains` de esa fuente en `SOURCES` (animeSources.js):

```js
animeflv: {
    name: 'AnimeFLV',
    domains: ['https://www3.animeflv.net', 'https://www4.animeflv.net', 'https://animeflv.net'],
},
```

Pon el dominio nuevo primero (o simplemente añádelo: la rotación encuentra el
que funcione). Los redirects se siguen automáticamente, por eso www3 → www4
sigue funcionando sin tocar nada.

## Cuando un sitio cambia su HTML

Cada fuente tiene una función por capacidad (`airingProviders.animeflv`,
`videoProviders.jkanime`, etc.). Solo hay que actualizar los selectores CSS de
esa función. Referencia rápida de lo que se parsea hoy (julio 2026):

| Fuente | Página | Qué se parsea |
|---|---|---|
| AnimeFLV | `/browse?status=1&order=rating` | `.ListAnimes li article` → `.Title` (usar `.first()`, hay 2 por card), `img[src]`, `.Description p` (último `<p>`), `.Vts` |
| AnimeFLV | `/` (home) | `.ListEpisodios li` → `.Title`, `.Capi`, `img`, href `/ver/{slug}-{ep}` |
| AnimeFLV | `/anime/{slug}` | `var episodes = [[num,id],...]` en un `<script>`, `.Description p`, `.Nvgnrs a`, `.AnmStts`, `.vtprmd` |
| AnimeFLV | `/ver/{slug}-{ep}` | `var videos` (hoy llega `[]` — cargan por AJAX; el proveedor queda por si lo restauran) |
| TioAnime | `/directorio?status=2&sort=recent` | `<article>` → `h3`, `a[href*=/anime/]`, `img` (status=2 = en emisión) |
| TioAnime | `/` (home) | `ul.episodes li article` → `h3` ("Título N", el número de episodio va al final) |
| TioAnime | `/anime/{slug}` | `var episodes = [nums]`, `var anime_info = [id, slug, título]`, `.sinopsis`, `.genres a` |
| TioAnime | `/ver/{slug}-{ep}` | `var videos = [[nombre, url], ...]` |
| JKAnime | `/buscar/{q}/` | `.anime__item` → `h5`, href |
| JKAnime | `/{slug}/{ep}/` | `var servers = [{server, remote(base64), lang}]` (lang 2 = latino) |
| MonosChinos | `/` (home) | `article a[href*=/ver/]` → href `/ver/{slug}-episodio-{n}`, `img[alt]` (las imágenes son lazy y suelen venir vacías) |
| MonosChinos | `/buscar?q=` | `<article>` → `h3`/`h2`, href `/anime/{slug}` (slugs terminan en `-sub-espanol`) |
| MonosChinos | `/ver/{slug}-episodio-{n}` | `[data-player]` con URL del embed en base64 |
| Jikan | `api.jikan.moe/v4/...` | API JSON oficial de MyAnimeList (sin scraping); metadata en inglés, último recurso |

Truco para diagnosticar: guarda el HTML y mira qué cambió —

```bash
node -e "require('axios').get('https://www3.animeflv.net/', {headers:{'User-Agent':'Mozilla/5.0'}}).then(r => require('fs').writeFileSync('dump.html', r.data))"
```

## Cómo añadir una fuente nueva

1. Añádela a `SOURCES` con su(s) dominio(s).
2. Implementa las funciones que pueda cubrir en `airingProviders` /
   `recentProviders` / `searchProviders` / `infoProviders` / `videoProviders`
   (no hace falta implementarlas todas — JKAnime solo tiene search y videos).
3. Añádela a `SOURCE_ORDER` en la posición de preferencia.
4. Los shapes de retorno están documentados encima de cada bloque de proveedores.

Candidata ya explorada: **AnimeFenix (animefenix2.tv)** — viva, con enlaces
`/ver/{slug}-{ep}` en el home (markup Tailwind). **AnimeAV1** es una SPA
(SvelteKit): requeriría parsear su JSON embebido, no HTML.

## Despliegue (Vercel serverless)

- La caché y el estado de salud viven **en memoria**: sobreviven mientras la
  función esté caliente (~5-15 min entre visitas) y se reinician en cada cold
  start. Para 3 usuarios es suficiente y gratis. Si algún día quieres caché
  persistente, Vercel KV o Upstash Redis (gratis) se enchufan en
  `getCache`/`setCache` de `shared.js` sin tocar nada más.
- `vercel.json` da 30s de `maxDuration` para que la cadena de fallbacks tenga
  margen en el peor caso (el caso normal responde en 1-3s).
- Si Cloudflare bloqueara los IPs de Vercel para alguna fuente (hoy no pasa),
  las opciones son: poner esa fuente al final del orden, o configurar
  `PROXY_URL` con un proxy residencial barato. Evita puppeteer: no cabe bien
  en serverless gratuito.

## Recordatorio legal

Este proyecto scrapea sitios de terceros y reproduce sus embeds. Úsalo solo de
forma personal/privada (tú + tus amigos), no lo publicites ni lo monetices, y
respeta los términos de los sitios de origen. Los enlaces de video pertenecen
a los hosts de terceros y pueden caducar.
