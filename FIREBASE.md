# Guía: conectar Firebase (Firestore) — actualizada julio 2026

**¿Es gratis?** Sí. El plan **Spark** de Firebase cuesta $0, **no pide tarjeta**
y no puede generar cargos (si un día superas la cuota, simplemente deja de
responder hasta el día siguiente — no te cobra). La cuota gratis de Firestore:

| Recurso | Gratis al día |
|---|---|
| Lecturas | 50.000 |
| Escrituras | 20.000 |
| Almacenamiento | 1 GiB total |

Para ti + 2 amigos es imposible acercarse a eso (un comentario = 1 escritura;
cargar los comentarios de un episodio = unas pocas lecturas).

**¿Qué gana la página con esto?** Ahora mismo los comentarios en producción
viven "en memoria" del servidor de Vercel: **se borran solos** cada vez que la
función se reinicia (cada pocos minutos sin visitas). Con Firestore quedan
guardados para siempre. El código ya está preparado — solo faltan 3 variables.

---

## Paso 1 — Crear el proyecto

1. Entra en **https://console.firebase.google.com** con tu cuenta de Google.
2. Botón **"Crear un proyecto"** (o "Add project" / a veces aparece como
   "Comenzar con un proyecto de Firebase").
3. Nombre: `aninova` (da igual). Acepta los términos.
4. Si te ofrece **Google Analytics** o funciones de **Gemini/IA**, puedes
   **desactivarlo todo** — no lo necesitas.
5. Espera a que cree el proyecto y pulsa "Continuar".

> No toques nada de "actualizar plan" — el proyecto nace en Spark (gratis).
> Arriba a la izquierda, junto al nombre, verás "Spark" o "Plan Spark".

## Paso 2 — Crear la base de datos Firestore

1. En el menú lateral izquierdo: **Compilación** (Build) → **Firestore Database**.
   (Si el menú está colapsado, es el icono de base de datos. En consolas nuevas
   también aparece como tarjeta "Cloud Firestore" en la página principal del
   proyecto.)
2. Botón **"Crear base de datos"**.
3. Si te pregunta la **edición**: elige **Standard** (la Enterprise es de pago).
4. **Ubicación**: elige la más cercana (por ejemplo `us-east1` o
   `southamerica-east1` si estás en Sudamérica). *No se puede cambiar después,
   pero cualquiera funciona.*
5. **Modo de inicio**: elige **modo de producción** (bloqueado). Es el seguro.
   > ¿Por qué bloqueado no rompe nada? Porque tu API usa el **Admin SDK**
   > desde Vercel, que se salta las reglas de seguridad. Nadie más podrá
   > leer/escribir tu base directamente desde internet.
6. "Habilitar" y listo — verás una base de datos vacía.

## Paso 3 — Descargar la clave privada (cuenta de servicio)

1. Rueda dentada ⚙️ (arriba a la izquierda, junto a "Descripción general del
   proyecto") → **Configuración del proyecto**.
2. Pestaña **"Cuentas de servicio"** (Service accounts).
3. Con "Firebase Admin SDK" seleccionado, botón
   **"Generar nueva clave privada"** → confirmar.
4. Se descarga un archivo `aninova-firebase-adminsdk-xxxxx.json`.

> ⚠️ **Ese archivo es una llave maestra.** No lo subas nunca a GitHub, no lo
> pegues en el código, no lo compartas. Solo copiarás 3 valores de él a Vercel
> y luego puedes borrarlo de Descargas.

## Paso 4 — Poner las 3 variables en Vercel

Abre el `.json` descargado con el Bloc de notas. Necesitas 3 campos:
`project_id`, `client_email` y `private_key`.

1. Entra en **https://vercel.com** → tu proyecto **pagina-ver-anime**.
2. **Settings** → **Environment Variables**.
3. Crea estas 3 variables (aplícalas a "All Environments"):

| Nombre (exacto) | Valor |
|---|---|
| `FIREBASE_PROJECT_ID` | el `project_id` del json (ej. `aninova-a1b2c`) |
| `FIREBASE_CLIENT_EMAIL` | el `client_email` (ej. `firebase-adminsdk-...@....iam.gserviceaccount.com`) |
| `FIREBASE_PRIVATE_KEY` | el `private_key` COMPLETO, desde `-----BEGIN PRIVATE KEY-----` hasta `-----END PRIVATE KEY-----\n` |

> Sobre `FIREBASE_PRIVATE_KEY`: cópialo tal cual está en el json (una sola
> línea larga llena de `\n`). El código ya convierte esos `\n` en saltos
> reales, así que pégalo sin miedo, comillas fuera.

## Paso 5 — Redesplegar y comprobar

1. En Vercel: **Deployments** → menú `⋯` del último deploy → **Redeploy**
   (las variables nuevas solo se aplican en un deploy nuevo).
2. Cuando termine, entra a un anime en la página y **escribe un comentario**.
3. Vuelve a la consola de Firebase → Firestore Database: debería haber
   aparecido una colección **`comments`** con tu comentario dentro.
4. Prueba final: recarga la página al día siguiente — el comentario sigue ahí.
   (Antes se borraba en minutos.)

## Problemas típicos

- **"Error posting comment" tras configurar** → casi siempre es la
  `FIREBASE_PRIVATE_KEY` mal pegada (le falta el BEGIN/END o se coló una
  comilla). Bórrala y pégala de nuevo.
- **Sigue sin guardar** → mira los logs: Vercel → proyecto → Deployments →
  deploy activo → Functions. Si dice "⚠ Firebase env vars not set", las
  variables no llegaron (¿redeployaste?). Si dice "✓ Firebase Firestore
  connected", el problema es otro y los logs dirán cuál.
- La consola cambia de diseño cada poco, pero los nombres clave no:
  **"Firestore Database"**, **"Configuración del proyecto"**,
  **"Cuentas de servicio"**, **"Generar nueva clave privada"**.

## Siguiente paso opcional

Con esto conectado, los **favoritos/vistos/historial** (hoy en localStorage,
por dispositivo) se pueden sincronizar entre tu PC y tu móvil usando esta
misma base — las funciones ya existen en `api/_lib/firebase.js`
(`getUserFavorites`, `markAsWatched`, etc.); solo falta exponer el endpoint y
conectar `mi-lista.js`. Pídelo cuando quieras.
