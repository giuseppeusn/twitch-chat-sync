# Twitch Chat Sync for YouTube

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-9146FF?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![100% Client-Side](https://img.shields.io/badge/Arquitectura-100%25%20client--side-blue?style=flat-square)](#cómo-funciona)

[English](README.md) | [Português (BR)](README.pt-BR.md) | **Español**

Una extensión de Chrome (Manifest V3) que descubre automáticamente el minuto exacto de un video de YouTube dentro de un VOD de Twitch y muestra el chat sincronizado junto al reproductor — **100% client-side y sin backend**.

---

## Características

- **Sincronización visual automática:** compara los storyboards de YouTube y Twitch mediante una firma visual híbrida (NCC `16×16` + dHash `8×8` H+V + RGB L1) con normalización z-score doble.
- **Detección de cortes editados:** utiliza programación dinámica de Viterbi disperso para detectar cortes en videos de YouTube y mantener el chat alineado en cada segmento.
- **Refinamiento multi-ancla (±1s):** refina la alineación directamente contra los fotogramas del reproductor `<video>` de YouTube.
- **Chat fiel a Twitch:** compatible con insignias globales y de canal de Twitch, emotes nativos de Twitch, **BetterTTV (BTTV)** y **7TV**.
- **Ajuste fino y controles:** ajuste manual (`-30s`, `-5s`, `-1s`, `+1s`, `+5s`, `+30s`), pausa inteligente de desplazamiento automático y carga bajo demanda.
- **Interfaz personalizable:** modo oscuro inspirado en Twitch con tamaño de texto ajustable, vista previa en vivo, marcas de tiempo y filtro de suscripciones.
- **Caché de 7 días:** recuerda automáticamente el VOD vinculado y el ajuste manual para cada video de YouTube.
- **Soporte multilingüe:** internacionalización nativa de Chrome (`en`, `pt_BR`, `es`).

---

## Instalación (modo desarrollador / load unpacked)

1. Clona o descarga este repositorio:
   ```bash
   git clone https://github.com/<tu-usuario>/twtyt-chat.git
   ```
2. Abre Google Chrome y ve a `chrome://extensions`.
3. Activa el **Modo de desarrollador** en la esquina superior derecha.
4. Haz clic en **Cargar descomprimida** (*Load unpacked*) y selecciona la carpeta raíz del proyecto (`twtyt-chat`).

---

## Cómo usar

1. Abre cualquier video de YouTube (`/watch?v=...`).
2. Haz clic en el icono de **Twitch Chat Sync** en la barra de Chrome para abrir el panel.
3. Pega el enlace del VOD de Twitch (ej.: `https://www.twitch.tv/videos/123456789`) o su ID.
4. Haz clic en **Sincronizar** (o presiona `Enter`) y espera unos segundos mientras se alinean los storyboards.
5. Disfruta del chat sincronizado. Usa los botones `-30s` / `+30s` si necesitas ajustes manuales.

---

## Cómo funciona

1. **Service worker (`src/background/`):** realiza las peticiones cross-origin a Twitch GraphQL (`gql.twitch.tv/gql`), páginas de YouTube, BTTV y 7TV, convirtiendo sprites e imágenes en data URLs para evitar restricciones CORS/CSP.
2. **Content script (`src/content/`):** extrae firmas visuales anti-aliasing de los storyboards, ejecuta alineación global Stouffer + segmentación Viterbi, refina el desplazamiento en `<video>` y renderiza el chat en sincronía con `timeupdate` y `seeked`.

Para más detalles técnicos, consulta [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y [docs/SYNC_ALGORITHM.md](docs/SYNC_ALGORITHM.md).

---

## Privacidad

Esta extensión funciona **100% client-side**. No se recopilan ni envían datos de usuario, historial ni telemetría a ningún servidor externo.

---

## Licencia

Distribuido bajo la [Licencia MIT](LICENSE).
