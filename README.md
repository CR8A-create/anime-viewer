# AniNova

Web personal (uso privado entre amigos) para **ver anime, películas y series, y
leer manga y novelas ligeras** en español. No aloja nada: muestra contenido de
fuentes de terceros.

- **Web**: https://aninova.netlify.app (carpeta `public/`, estático en Netlify)
- **API**: https://pagina-ver-anime.vercel.app/api (carpeta `api/`, serverless en Vercel)
- **App Android**: carpeta `android/` (Capacitor). Carga la web publicada y
  añade bloqueo de anuncios nativo.

## Desarrollo

```bash
npm install
npm run dev
```

Abre http://localhost:3000. El servidor local (`server.js`) sirve `public/` y
monta los mismos handlers de `api/` que producción.

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor local en el puerto 3000 |
| `npm run check` | Comprueba la sintaxis de todos los `.js` |
| `npm run app:build` | Sincroniza Capacitor y compila el APK (necesita Android Studio) |
| `npm run app:open` | Abre el proyecto Android en Android Studio |

## Ramas y despliegue

Se trabaja en `dev` y se fusiona a `main` cuando está verificado. Cada push a
`main` despliega la web (Netlify) y la API (Vercel) automáticamente.

## Documentación

| Archivo | Contenido |
| --- | --- |
| [PROYECTO.md](PROYECTO.md) | Arquitectura completa, fuentes, endpoints, decisiones y mantenimiento |
| [SOURCES.md](SOURCES.md) | Selectores de scraping por fuente de anime y cómo actualizarlos |
| [ANUNCIOS.md](ANUNCIOS.md) | Cómo quitar los anuncios en la app, el móvil y el PC |
| [FIREBASE.md](FIREBASE.md) | Conectar Firestore (cuentas, comentarios, sincronización) |

Estado de las fuentes en vivo: `/api/anime/status` y `/api/manga/status`.

## Aviso

Proyecto educativo y sin ánimo de lucro. Todos los derechos de las obras
pertenecen a sus legítimos propietarios.
