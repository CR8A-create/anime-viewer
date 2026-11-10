# Anuncios: de dónde salen y cómo quitarlos

AniNova no pone ningún anuncio. Los anuncios vienen de los **reproductores de
terceros** (los iframes de Streamtape, VOE, Filemoon, Embed69…): pop-ups al
tocar el vídeo, pestañas nuevas, redirecciones a casas de apuestas, etc. Como
el reproductor vive dentro de un iframe de otro dominio, la web no puede
"limpiarlo" por dentro. Hay que bloquearlo desde fuera.

## 1. En la app de Android (AniNova.apk) — ya incluido

Desde la versión 3.0 la app lleva su propio bloqueador
(`android/app/src/main/java/com/aninova/app/MainActivity.java`):

| Qué hace | Cómo |
| --- | --- |
| Bloquea las peticiones a redes de anuncios, también dentro de los reproductores | Lista de dominios en `android/app/src/main/res/raw/adblock_hosts.txt` (bloquea dominio + subdominios) |
| Bloquea pop-ups y pestañas nuevas | `window.open()` desactivado en el WebView |
| Bloquea las redirecciones que te sacan de la app | Toda navegación de la página principal fuera de AniNova se cancela (solo se abren en el navegador ZonaTMO, TMDB y GitHub) |
| Bloquea los anuncios que abren otras apps | Se ignoran los enlaces `intent://`, `market://`, etc. |
| Pantalla completa real | El botón de pantalla completa del reproductor gira a apaisado y oculta las barras; "Atrás" sale |

**Para tenerlo hay que instalar el APK nuevo** (el que tenías instalado es de
diciembre de 2025 y solo bloqueaba 15 dominios):

```bash
npm run app:build
```

El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`. Pásalo al
móvil e instálalo encima del anterior.

A partir de esta versión la app carga la web publicada
(`https://aninova.netlify.app`, ver `capacitor.config.json` → `server.url`),
así que **los cambios de la web llegan solos** sin recompilar. Solo hay que
recompilar si cambias algo nativo (por ejemplo, la lista de bloqueo).

### Extra de la app: JKAnime (Desu) y manga que la web no puede cargar

JKAnime y Manga Oni rechazan (403) a nuestro servidor, pero no a un móvil.
Dentro de la app esas páginas se piden desde el propio teléfono
(`public/assets/js/native-sources.js`, HTTP nativo de Capacitor), así que en
la app aparecen los servidores de JKAnime —**Desu** primero, que recuerda el
minuto por sí solo— y los capítulos de mangas como Solo Leveling. En el
navegador normal eso no es posible. Vale con el APK 3.0; no hay que recompilar.

### Si aún se cuela algún anuncio en la app

1. Fíjate en el dominio al que intenta llevarte (o conéctalo por USB y mira
   `chrome://inspect` → pestaña Network).
2. Añádelo en una línea nueva de `adblock_hosts.txt`.
3. `npm run app:build` e instala el APK.

No añadas dominios de reproductores (streamtape, voe, filemoon, mp4upload…):
se quedarían sin vídeo. Si un servidor concreto es insufrible, cambia a otro
con los botones de servidor.

## 2. En el navegador del móvil (sin la app)

Lo más eficaz, de más a menos:

1. **DNS privado de AdGuard (Android 9+, 1 minuto, afecta a todo el móvil)**
   Ajustes → Redes e Internet → DNS privado → "Nombre de host del proveedor"
   → `dns.adguard-dns.com`. Bloquea la mayoría de redes de anuncios en todas
   las apps y navegadores. Para quitarlo, vuelve a "Automático".
2. **Brave** (Android/iOS): bloquea anuncios y pop-ups de serie.
3. **Firefox para Android + uBlock Origin**: el bloqueo más fino (también
   elimina los huecos de los anuncios).
4. **iPhone/iPad**: Safari + un bloqueador de contenido (AdGuard para iOS), o
   Brave. También vale el DNS de AdGuard instalando su perfil desde
   adguard-dns.io.

El DNS privado (opción 1) también refuerza la app: lo que no esté en la lista
de la app lo para el DNS.

## 3. En el ordenador

uBlock Origin (Firefox) o uBlock Origin Lite (Chrome), o Brave.

## Lo que NO se hace (y por qué)

- **`sandbox` en los iframes**: se probó y se revirtió; varios reproductores
  detectan el sandbox y se niegan a cargar el vídeo.
- **Reordenar servidores por "limpieza"**: se probó y se revirtió; solo movía
  el problema.

El bloqueo va en el contenedor (app o navegador), no en la web.
