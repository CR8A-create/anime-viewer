# Cómo reducir los anuncios de los reproductores

## Por qué salen

Los vídeos no están alojados por AniNova: se incrustan (iframe) desde
reproductores de terceros (VidGuard, Voe, YourUpload, VidSrc, etc.). **Esos
anuncios los pone el reproductor, no la página** — no puedo quitarlos desde el
código porque el contenido del iframe es de otro dominio y está fuera de mi
control.

Lo que **sí** se puede hacer está en 2 niveles muy efectivos. (Se probó
bloquear los anuncios con un `sandbox` en el iframe, pero rompía la mayoría de
los reproductores —solo funcionaba YourUpload—, así que se retiró: el vídeo es
prioritario y el bloqueo de verdad se hace por DNS/uBlock, que no interfiere.)

## Nivel 2 — Bloqueo por DNS (lo mejor para el MÓVIL, gratis)

Esto es lo que buscas para "entrar desde el teléfono sin bloqueador". Cambias
el DNS del móvil una sola vez y bloquea anuncios **en todas las apps y webs**
del dispositivo, incluidos los banners dentro de los reproductores. Es gratis
y no requiere root ni apps raras.

Opción recomendada — **AdGuard DNS** (gratis):

- **Android**: Ajustes → Red e Internet → **DNS privado** → "Nombre de host
  del proveedor" → escribe `dns.adguard-dns.com` → Guardar.
- **iPhone**: instala el perfil de configuración de AdGuard DNS desde
  `https://adguard-dns.io/es/public-dns.html` (botón "Instalar perfil de
  configuración" → Ajustes → Perfil descargado → Instalar).

Alternativa igual de buena — **NextDNS** (gratis hasta 300k consultas/mes, de
sobra): crea cuenta en `https://nextdns.io`, te dan un DNS personalizado y
puedes ver/ajustar qué se bloquea.

Con esto, incluso sin bloqueador en el navegador, los anuncios de los
reproductores caen a casi cero en el teléfono.

## Nivel 3 — Bloqueador en el navegador (PC y Android)

Para el ordenador, o Android con navegador compatible:

- **uBlock Origin** (gratis, el mejor): extensión para Chrome/Edge/Firefox.
  En Firefox de Android también funciona.
- O usa el navegador **Brave** (trae bloqueador integrado, PC y móvil) o
  **Firefox + uBlock Origin** en el móvil.

## Resumen rápido

| Dónde entras | Qué hacer |
|---|---|
| PC | Brave, o Chrome/Firefox con **uBlock Origin** |
| Móvil (sin tocar nada) | Ya va mejor por el sandbox del Nivel 1 |
| Móvil (casi sin anuncios) | **DNS privado → `dns.adguard-dns.com`** (Nivel 2) |

Lo del Nivel 1 ya está hecho y desplegado. Los niveles 2 y 3 son configuración
de tu dispositivo (una sola vez) y son la forma real de quitar los anuncios
que viven dentro de reproductores de terceros.
