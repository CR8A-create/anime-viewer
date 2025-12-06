# 🎬 Anime Viewer Project
    -   `Express`: Framework para el servidor web.
    -   `Cheerio`: Librería para *web scraping* (parseo de HTML).
    -   `Axios`: Cliente HTTP para realizar peticiones a la fuente de datos.
    -   `Cors`: Middleware para permitir peticiones desde el cliente.
-   **Frontend**:
    -   `HTML5`, `CSS3`, `JavaScript (Vanilla)`: Estructura y lógica del cliente.
-   **Móvil**:
    -   `Capacitor`: Puente para convertir la web app en una app nativa (Android).

## 📂 Estructura del Proyecto

A continuación se describe el propósito de los archivos principales:

| Archivo / Carpeta | Descripción |
| :--- | :--- |
| `server.js` | **Núcleo del Backend**. Define los endpoints de la API (`/api/anime`, `/api/videos`) y la lógica de scraping. |
| `index.html` | Página de inicio. Muestra la lista de animes o resultados de búsqueda. |
| `directorio.html` | Página del directorio de animes. |
| `emision.html` | Página para ver animes en emisión. |
| `script.js` | **Lógica del Frontend**. Maneja las peticiones a la API, la navegación y la renderización del DOM. |
| `style.css` | Estilos globales de la aplicación. |
| `package.json` | Define las dependencias del proyecto (`express`, `cheerio`, etc.) y scripts de inicio. |
| `android/` | Carpeta generada por Capacitor que contiene el proyecto nativo de Android Studio. |
| `capacitor.config.json` | Configuración de Capacitor (ID de la app, nombre, directorio web). |

## ⚙️ Instalación y Uso

### Prerrequisitos
-   Tener instalado [Node.js](https://nodejs.org/).

### Pasos
1.  **Clonar el repositorio** (o descargar los archivos):
    ```bash
    git clone <tu-url-del-repo>
    cd <nombre-de-la-carpeta>
    ```

2.  **Instalar dependencias**:
    ```bash
    npm install
    ```

3.  **Iniciar el servidor**:
    ```bash
    node server.js
    # O si tienes configurado el script start:
    npm start
    ```
    El servidor correrá por defecto en `http://localhost:3000`.

4.  **Ver la aplicación**:
    Abre `index.html` en tu navegador o configura un servidor de desarrollo local (como Live Server) para servir los archivos estáticos.

## 🔌 API Endpoints

El backend expone las siguientes rutas:

-   **`GET /api/anime/:title`**:
    -   Busca un anime por título.
    -   Devuelve: Información del anime y lista de episodios.
-   **`GET /api/videos/:slug/:episode`**:
    -   Obtiene los servidores de video para un episodio específico.
    -   Devuelve: Lista de servidores con sus URLs.

## ⚠️ Aviso Legal
Este proyecto es con fines educativos y de aprendizaje. El contenido es obtenido de fuentes de terceros mediante scraping.
