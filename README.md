# 🥋 Cronômetro de Jiu-Jitsu para TV

Cronômetro para a TV da academia, **controlado pelo celular**. A TV só exibe; quem
manda é o celular (vários celulares podem controlar a mesma TV ao mesmo tempo).

## Funcionalidades

**Treino em rounds** (combates, drills, circuitos)
- Rounds × tempo de round × descanso × preparação inicial
- Modelos prontos: Combate 5×5, Combate 6×6, Combate rápido 8×3, Drill 10×2, Tabata 8×20s, Circuito 10×45s
- Tela muda de cor por fase: 🟧 preparar · 🟩 combate · 🟦 descanso · 🟥 fim
- "Pular fase" (ex.: encerrar o descanso antes)

**Luta com placar**
- Pontos (+2 / +3 / +4), vantagens e punições para cada atleta, com nomes
- Tempo por faixa (referência IBJJF adulto): branca 5 · azul 6 · roxa 7 · marrom 8 · preta 10 min
- Ajuste de tempo (−10s / +10s / +1 min) durante a luta
- No fim, destaca o vencedor (pontos → vantagens → menos punições)

**Timer** (contagem regressiva) e **Cronômetro livre** (conta para cima)

**Sons** gerados no navegador: bip de 10 segundos, contagem 3-2-1 antes de cada
round, sinal de início, sinal de descanso e buzina de fim. Dá para desligar pelo celular.

**TV**: tela cheia, impede a tela de apagar (quando o navegador permite) e
aceita o botão **OK/Play** do controle remoto da TV para iniciar/pausar.

## Como funciona

```
 Celular ──POST /api/rooms/1234/command──▶ Servidor ──SSE (tempo real)──▶ TV
   ▲                                          │
   └──────────────── SSE ─────────────────────┘
```

- A TV abre `/` e recebe um **código de sala** de 4 dígitos (fica salvo na TV).
- O celular escaneia o QR code da TV (ou abre `/controle` e digita o código).
- O servidor guarda o estado de cada sala e envia atualizações em tempo real.
  O relógio é calculado localmente a partir do horário do servidor, então TV e
  celular ficam sincronizados mesmo com a rede oscilando.

## Rodando

Precisa só do **Node.js 18+** (não há dependências para instalar).

```bash
npm start            # porta 3000 (ou defina PORT=8080)
npm test             # testes automatizados
```

### Opção 1 — Computador na rede da academia
1. Rode `npm start` em um computador/notebook ligado no Wi-Fi da academia.
2. O terminal mostra o endereço na rede local, ex.: `http://192.168.0.10:3000`.
3. Abra esse endereço no navegador da TV e pressione **OK** para ativar.
4. No celular (mesmo Wi-Fi), escaneie o QR code que aparece na TV.

### Opção 2 — Hospedado na internet (recomendado)
Funciona de qualquer rede, inclusive no 4G do celular.
- **Render**: o arquivo `render.yaml` já está pronto (New → Blueprint → este repositório,
  branch `claude/jiu-jitsu-timer-tv-dxyr6t`). Também funciona em Railway, Fly.io etc.
- Observação: no plano gratuito do Render o servidor "dorme" sem uso e leva alguns
  segundos para acordar; o estado das salas fica em memória e é zerado quando o
  servidor reinicia.

> ⚠️ Plataformas só de arquivos estáticos (Vercel estático, GitHub Pages) **não**
> servem, porque o app precisa do servidor para sincronizar TV e celular.

## Dicas para a TV
- Use o navegador da Smart TV, um Chromecast/Fire TV Stick com navegador ou um
  notebook ligado no HDMI.
- O som só é liberado depois do primeiro **OK/clique** na TV (regra dos navegadores).
- O QR code é carregado do cdnjs; sem internet a TV mostra só o endereço e o código.

## Estrutura

```
server.js              servidor HTTP + SSE (sem dependências)
lib/state.js           estado da sala e validação dos comandos
public/shared/timer.js lógica pura do cronômetro (usada no servidor, TV e celular)
public/shared/sync.js  conexão em tempo real (SSE, com polling de reserva)
public/shared/sound.js sons com Web Audio
public/index.html      tela da TV
public/controle.html   controle pelo celular
test/                  testes (node:test)
```

## API (para quem quiser integrar)

`POST /api/rooms/:codigo/command` com JSON, por exemplo:

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

`GET /api/rooms/:codigo/state` devolve o estado; `GET /api/rooms/:codigo/events` é o stream SSE.
