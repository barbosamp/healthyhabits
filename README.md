# Cronômetro Blackbox Jiu-Jitsu para TV

Cronômetro para a TV da academia, na identidade visual da **Blackbox**. Funciona só com
o **controle remoto da TV** ou **controlado pelo celular** (vários celulares podem
controlar a mesma TV ao mesmo tempo).

## Funcionalidades

**Treino em rounds** (combates, drills, circuitos)
- Rounds × tempo de round × descanso × preparação inicial
- Modelos prontos: Combate 5×5, Combate 6×6, Combate rápido 8×3, Drill 10×2, Tabata 8×20s, Circuito 10×45s
- Moldura da tela na cor da fase: branco preparar · ouro combate · azul descanso ·
  fim pisca preto ⇄ branco. Nos últimos 10 s do combate o número fica ouro
- "Pular fase" (ex.: encerrar o descanso antes)

**Luta com placar**
- Pontos (+2 / +3 / +4), vantagens e punições para cada atleta, com nomes
- Tempo por faixa (referência IBJJF adulto): branca 5 · azul 6 · roxa 7 · marrom 8 · preta 10 min
- Ajuste de tempo (−10s / +10s / +1 min) durante a luta
- No fim, destaca o vencedor (pontos → vantagens → menos punições)

**Timer** (contagem regressiva) e **Cronômetro livre** (conta para cima)

**Sons** gerados no navegador: bip de 10 segundos, contagem 3-2-1 antes de cada
round, sinal de início, sinal de descanso e buzina de fim. Dá para desligar pelo celular.

**TV pelo controle remoto**
- **Menu inicial**: cronômetro, modelos de treino, zerar, som, **novo código de sala** e tela cheia
- **Modelos de treino** direto na TV (combate e drills, luta por faixa, timer), sem precisar do celular
- No cronômetro: **OK** inicia/pausa e **VOLTAR** retorna ao menu (o tempo continua correndo)
- Teclas: setas, OK/Enter, Play/Pause e VOLTAR (Backspace/Esc, Return do Tizen, Back do webOS);
  controles com ponteiro (Magic Remote da LG) funcionam com clique
- Quando o celular escolhe um treino ou dá início, a TV abre o cronômetro sozinha
- Tela cheia e tela sempre ligada (quando o navegador permite)

**Identidade Blackbox** (Brand Guidelines v1.0): preto #0A0A0A, branco #F5F5F0, ouro #E8B84B
só como destaque, tatame #1A1A1A e cinza #666; Bebas Neue (títulos e números), Space Mono
(labels) e DM Sans (texto), servidas pelo próprio app. O logo é o arquivo oficial, sem recriação.

## Como funciona

```
 Celular ──comandos──▶ TV (guarda o estado e aplica os comandos)
    ▲                   │
    └──── estado ◀──────┘        conexão direta via WebRTC (PeerJS)
```

- O site é **100% estático** (pasta `public/`), por isso roda na **Vercel** sem servidor.
- A TV abre `/` e ganha um **código de sala** de 4 dígitos (fica salvo na TV).
- O celular escaneia o QR code da TV (ou abre `/controle` e digita o código) e se
  conecta **direto na TV**. O servidor gratuito do PeerJS só ajuda os aparelhos a
  se encontrarem; se a rede não permitir conexão direta, o tráfego passa pelo TURN do PeerJS.
- O estado (tempo, round, placar) fica salvo na TV: recarregar a página não perde nada,
  e os celulares reconectam sozinhos.
- A TV guarda um token próprio e mantém sempre o mesmo código de sala, mesmo depois de
  standby ou queda do Wi-Fi. Só troca de código se outro aparelho estiver usando o mesmo
  por mais de 90 s. Ao lado da bolinha, a TV mostra "Conectando…", "Liberando a sala…" ou
  "Navegador sem suporte ao celular" enquanto o celular ainda não consegue encontrá-la.
- O relógio é calculado a partir do horário da TV, então TV e celular mostram o mesmo tempo.

## Publicando na Vercel

A configuração já está em `vercel.json` (publica a pasta `public/`, sem build).

1. Em [vercel.com/new](https://vercel.com/new), importe o repositório `healthyhabits`.
2. Framework Preset: **Other**. Não precisa mudar mais nada.
3. Cada push gera um deploy; a branch de produção (ex.: `develop`) vira o endereço oficial.

Na TV, abra `https://<seu-projeto>.vercel.app` e pressione **OK**. No celular, escaneie o QR code.

## Rodando localmente

Precisa só do **Node.js 18+** (não há dependências para instalar).

```bash
npm start            # serve a pasta public/ na porta 3000 (ou defina PORT=8080)
npm test             # testes automatizados
```

O terminal mostra o endereço na rede local (ex.: `http://192.168.0.10:3000`) para abrir na TV.
TV e celular precisam de internet para se encontrarem pelo PeerJS.

## Dicas para a TV
- Use o navegador da Smart TV, um Chromecast/Fire TV Stick com navegador ou um
  notebook ligado no HDMI. O navegador precisa suportar WebRTC (os navegadores de TV
  dos últimos anos suportam).
- O som só é liberado depois da primeira tecla/clique na TV (regra dos navegadores);
  enquanto isso o cronômetro mostra o aviso para apertar uma seta.
- Celular não encontra a TV? No menu da TV, **Novo código de sala** (pede um segundo OK
  para confirmar) e escaneie o QR code novo. Treino e placar continuam.
- Deixe a TV com o app aberto: é ela que mantém o estado. Se a aba fechar, os celulares
  ficam em "Procurando a TV…" até ela abrir de novo.
- Servidor PeerJS próprio (opcional): defina `window.BJJ_PEER_OPTIONS = {host, port, path, secure}`
  antes de carregar `shared/sync.js`.

## Estrutura

```
vercel.json            publicação na Vercel (site estático)
server.js              servidor local só para desenvolvimento (sem dependências)
public/index.html      tela da TV (menu, modelos e cronômetro)
public/controle.html   controle pelo celular
public/brand.css       paleta, fontes e elementos da identidade Blackbox
public/fonts/          Bebas Neue, DM Sans e Space Mono (SIL OFL)
public/img/            logo oficial Blackbox (versão branca)
public/shared/presets.js modelos prontos (TV e celular)
public/shared/timer.js lógica pura do cronômetro (usada na TV e no celular)
public/shared/state.js estado da sala e validação dos comandos (roda na TV)
public/shared/sync.js  conexão TV ⇄ celular via WebRTC (PeerJS)
public/shared/sound.js sons com Web Audio
public/vendor/         PeerJS e gerador de QR code (licença MIT)
test/                  testes (node:test)
```

## Comandos

O celular envia para a TV mensagens `{"kind":"cmd","id":1,"cmd":{...}}`. Comandos aceitos:

| Comando | Exemplo |
|---|---|
| Iniciar / pausar / alternar / zerar | `{"type":"start"}` · `pause` · `toggle` · `reset` |
| Configurar treino | `{"type":"configure","mode":"rounds","settings":{"work":300,"rest":60,"rounds":5,"prep":10}}` |
| Configurar luta / timer | `{"type":"configure","mode":"match","settings":{"duration":360}}` |
| Cronômetro livre | `{"type":"setMode","mode":"stopwatch"}` |
| Ajustar tempo | `{"type":"adjust","seconds":10}` |
| Pular fase | `{"type":"skip"}` |
| Placar | `{"type":"score","athlete":"a","field":"points","delta":2}` (`advantages`, `penalties`) |
| Nomes | `{"type":"setNames","a":"Marcos","b":"João"}` |
| Zerar placar / som | `{"type":"resetScore"}` · `{"type":"setSound","on":false}` |
