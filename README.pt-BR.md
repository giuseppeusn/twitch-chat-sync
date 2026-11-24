# Twitch Chat Sync for YouTube

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-9146FF?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![100% Client-Side](https://img.shields.io/badge/Arquitetura-100%25%20client--side-blue?style=flat-square)](#como-funciona)

[English](README.md) | **Português (BR)** | [Español](README.es.md)

Extensão para Google Chrome (Manifest V3) que descobre automaticamente a minutagem exata de um corte do YouTube dentro de um VOD da Twitch e exibe o chat sincronizado ao lado do player — **100% client-side, sem backend**.

---

## Funcionalidades

- **Sincronização visual automática:** compara os storyboards do YouTube e da Twitch usando assinatura visual híbrida (NCC `16×16` + dHash `8×8` H+V + RGB L1) com normalização por z-score duplo.
- **Detecção de cortes editados:** usa programação dinâmica de Viterbi esparso para detectar cortes no vídeo do YouTube e manter o chat alinhado em cada segmento.
- **Refinamento multi-âncora (±1s):** refina o alinhamento diretamente nos frames do player `<video>` do YouTube para precisão de ±1 segundo.
- **Chat fiel à Twitch:** suporte a badges globais e do canal da Twitch, emotes nativos da Twitch, **BetterTTV (BTTV)** e **7TV**.
- **Ajuste fino e controles:** botões de ajuste manual (`-30s`, `-5s`, `-1s`, `+1s`, `+5s`, `+30s`), pausa inteligente de auto-scroll e carregamento sob demanda ao avançar ou retroceder.
- **Interface personalizável:** tema escuro inspirado na Twitch com ajuste de tamanho de fonte, preview ao vivo, opção de ocultar minutagem e filtro de mensagens de inscrição.
- **Cache de 7 dias:** salva automaticamente o VOD vinculado e o ajuste manual por vídeo do YouTube.
- **Suporte a múltiplos idiomas:** internacionalização nativa do Chrome (`en`, `pt_BR`, `es`).

---

## Instalação (modo desenvolvedor / load unpacked)

1. Clone ou baixe este repositório:
   ```bash
   git clone https://github.com/giuseppeusn/twitch-chat-sync
   ```
2. Abra o Google Chrome e acesse `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** no canto superior direito.
4. Clique em **Carregar sem compactação** (_Load unpacked_) e selecione a pasta raiz do projeto (`twitch-chat-sync`).

---

## Como usar

1. Abra qualquer vídeo no YouTube (`/watch?v=...`).
2. Clique no ícone da extensão **Twitch Chat Sync** na barra do Chrome para abrir o painel.
3. Cole o link do VOD da Twitch (ex.: `https://www.twitch.tv/videos/123456789`) ou o ID do VOD.
4. Clique em **Sincronizar** (ou pressione `Enter`) e aguarde alguns segundos enquanto os storyboards são alinhados.
5. Aproveite o chat sincronizado. Use os botões `-30s` / `+30s` caso precise de pequenos ajustes manuais.

---

## Como funciona

1. **Service worker (`src/background/`):** realiza requisições cross-origin para a API GraphQL da Twitch (`gql.twitch.tv/gql`), páginas do YouTube, BTTV e 7TV, convertendo sprites e emotes/badges em data URLs para evitar bloqueios de CORS/CSP.
2. **Content script (`src/content/`):** extrai assinaturas visuais anti-aliasing dos storyboards, executa alinhamento global de Stouffer + segmentação Viterbi, refina o offset no `<video>` e renderiza o chat sincronizado aos eventos `timeupdate` e `seeked`.

Para detalhes técnicos, consulte [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [docs/SYNC_ALGORITHM.md](docs/SYNC_ALGORITHM.md).

---

## Privacidade

Esta extensão opera **100% client-side**. Nenhum dado de usuário, histórico ou telemetria é coletado ou enviado a servidores externos. Configurações e cache ficam armazenados apenas localmente no navegador.

---

## Licença

Distribuído sob a [Licença MIT](LICENSE).
