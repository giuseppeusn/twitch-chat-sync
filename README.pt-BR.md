# Twitch Chat Sync for YouTube

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-9146FF?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![100% Client-Side](https://img.shields.io/badge/Arquitetura-100%25%20client--side-blue?style=flat-square)](#como-funciona)
[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?style=flat-square&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/giuseppeusn)

[English](README.md) | **Português (BR)** | [Español](README.es.md)

Extensão para Google Chrome (Manifest V3) que descobre automaticamente a minutagem exata de um corte do YouTube dentro de um VOD da Twitch e exibe o chat sincronizado ao lado do player — **100% client-side, sem backend**.

![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Em_breve-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
[![Download da Release](https://img.shields.io/badge/GitHub_Release-Baixar_ZIP-9146FF?style=for-the-badge&logo=github&logoColor=white)](https://github.com/giuseppeusn/twitch-chat-sync/releases/latest)

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

## Apoie o projeto

Esta extensão é gratuita, de código aberto e não possui anúncios nem rastreamento. Se você gosta de usá-la e quer ajudar a mantê-la ativa, atualizada com mudanças da Twitch e do YouTube e recebendo melhorias contínuas, considere apoiar através do [GitHub Sponsors](https://github.com/sponsors/giuseppeusn). Você também pode ajudar deixando uma estrela no repositório, reportando problemas ou compartilhando com outras pessoas.

[![Apoiar no GitHub Sponsors](https://img.shields.io/badge/Sponsor-giuseppeusn-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/giuseppeusn)

---

## Instalação

### Opção 1: Chrome Web Store (em breve)

Em breve a extensão estará disponível diretamente na Chrome Web Store.

### Opção 2: baixar a release pronta

1. Baixe o arquivo `.zip` mais recente em [GitHub Releases](https://github.com/giuseppeusn/twitch-chat-sync/releases/latest) e extraia a pasta.
2. Abra o Google Chrome e acesse `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** no canto superior direito.
4. Clique em **Carregar sem compactação** (_Load unpacked_) e selecione a pasta extraída.

### Opção 3: clonar o repositório

1. Clone este repositório:
   ```bash
   git clone https://github.com/giuseppeusn/twitch-chat-sync.git
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

## Problemas conhecidos

### Desvio de timeline do storyboard em VODs muito longas (diferença de 2–4 min)

- **Quando acontece:** Ocasionalmente, em VODs muito longas da Twitch (ex.: 10h–15h+), o chat sincronizado pode aparecer deslocado em alguns minutos mesmo quando a confiança visual do alinhamento é alta (90%+). Vídeos longos no YouTube (2h+) divididos em vários segmentos também podem demorar mais para sincronizar por baixarem ~800+ frames de storyboard e executarem *seeks* multi-âncora em cada segmento.
- **Por que acontece:** A Twitch limita o storyboard da VOD (`seekPreviewsURL`) a no máximo **200 frames**, independentemente da duração da live, assumindo espaçamento linear entre miniaturas. Em VODs de 10h–15h+, cada thumbnail fica espaçada por 3–4+ minutos, e descontinuidades na transmissão (quedas/reconexões, inserção de anúncios ou reprocessamento de trechos mutados por copyright) podem acumular um desvio entre o índice de tempo do storyboard e o relógio real do vídeo/chat. Como a extensão alinha o YouTube com o storyboard da Twitch, ela encontra o ponto visual exato do storyboard — que já está deslocado em relação ao chat.
- **Em que casos pode aparecer:** Trechos avançados (ex.: 10h+) em VODs muito longas, lives com quedas de conexão ou pausas para anúncios no meio da transmissão, e VODs com trechos mutados/reprocessados antes do momento assistido.
- **Por que não é viável adotar outra solução (validação via HLS):** Validar o offset contra o stream HLS bruto da Twitch (`.m3u8` / `.ts` via `PlaybackAccessToken`, `usher.ttvnw.net` e `WebCodecs VideoDecoder`) exigiria fazer *demux* de vídeo em JavaScript puro sem bibliotecas externas, baixar vários megabytes de segmentos `.ts` em vez de ~250–450 KB de *sprite sheets* (deixando a sincronização bem mais lenta e pesada), depender de tokens internos mais frágeis da Twitch e ainda falharia em VODs exclusivas para inscritos (*sub-only*).
- **Contorno:** Utilize o **ajuste manual** no painel da extensão; o valor ajustado fica salvo automaticamente para aquele vídeo do YouTube.

---

## Privacidade

Esta extensão opera **100% client-side**. Nenhum dado de usuário, histórico ou telemetria é coletado ou enviado a servidores externos. Configurações e cache ficam armazenados apenas localmente no navegador.

---

## Licença

Distribuído sob a [Licença MIT](LICENSE).
