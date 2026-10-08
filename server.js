'use strict';

/*
 * Servidor do Cronômetro de Jiu-Jitsu.
 * - Serve a tela da TV (/) e o controle remoto (/controle).
 * - Mantém o estado de cada sala em memória.
 * - Envia atualizações em tempo real via Server-Sent Events (compatível com
 *   navegadores de Smart TV) e recebe comandos por POST.
 * Sem dependências externas: só Node.js >= 18.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRoomState, applyCommand, CommandError } = require('./lib/state');

const PUBLIC_DIR = path.join(__dirname, 'public');
const CODE_RE = /^[0-9]{4,6}$/;
const MAX_BODY = 8 * 1024;
const KEEPALIVE_MS = 15000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

const PAGES = { '/': 'index.html', '/tv': 'index.html', '/controle': 'controle.html' };

function createApp(options = {}) {
  const now = options.now || Date.now;
  const rooms = new Map();

  function getRoom(code) {
    let room = rooms.get(code);
    if (!room) {
      room = { state: createRoomState(code), clients: new Set(), touchedAt: now() };
      rooms.set(code, room);
    }
    room.touchedAt = now();
    return room;
  }

  function peersOf(room) {
    const peers = { tv: 0, remote: 0 };
    for (const c of room.clients) peers[c.role] += 1;
    return peers;
  }

  function payload(room) {
    return JSON.stringify({ state: room.state, peers: peersOf(room), serverNow: now() });
  }

  function broadcast(room) {
    const data = `data: ${payload(room)}\n\n`;
    for (const c of room.clients) c.res.write(data);
  }

  function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new CommandError('corpo da requisição muito grande'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function handleEvents(req, res, room, role) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');
    const client = { res, role };
    room.clients.add(client);
    broadcast(room);

    const keepalive = setInterval(() => res.write(': ping\n\n'), KEEPALIVE_MS);
    req.on('close', () => {
      clearInterval(keepalive);
      room.clients.delete(client);
      room.touchedAt = now();
      broadcast(room);
    });
  }

  async function handleCommand(req, res, room) {
    let cmd;
    try {
      cmd = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof CommandError ? err.message : 'JSON inválido' });
    }
    try {
      room.state = applyCommand(room.state, cmd, now());
    } catch (err) {
      if (err instanceof CommandError) return sendJson(res, 400, { error: err.message });
      throw err;
    }
    broadcast(room);
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(payload(room));
  }

  function serveStatic(req, res, pathname) {
    const rel = PAGES[pathname] || pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: 'não encontrado' });
    fs.readFile(file, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'não encontrado' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch (err) {
      return sendJson(res, 400, { error: 'URL inválida' });
    }

    if (pathname === '/healthz') return sendJson(res, 200, { ok: true, rooms: rooms.size });

    const m = pathname.match(/^\/api\/rooms\/([^/]+)\/(state|events|command)$/);
    if (m) {
      const [, code, action] = m;
      if (!CODE_RE.test(code)) return sendJson(res, 400, { error: 'código de sala inválido' });
      const room = getRoom(code);
      if (action === 'state' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        return res.end(payload(room));
      }
      if (action === 'events' && req.method === 'GET') {
        const role = url.searchParams.get('role') === 'tv' ? 'tv' : 'remote';
        return handleEvents(req, res, room, role);
      }
      if (action === 'command' && req.method === 'POST') return handleCommand(req, res, room);
      return sendJson(res, 405, { error: 'método não permitido' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'método não permitido' });
    return serveStatic(req, res, pathname);
  }

  // Remove salas sem ninguém conectado há mais de 24h.
  function sweep() {
    const limit = now() - ROOM_TTL_MS;
    for (const [code, room] of rooms) {
      if (room.clients.size === 0 && room.touchedAt < limit) rooms.delete(code);
    }
  }

  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'erro interno' });
      else res.end();
    });
  });
  const sweeper = setInterval(sweep, 60 * 60 * 1000);
  sweeper.unref();
  server.on('close', () => clearInterval(sweeper));

  return { server, rooms, sweep };
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createApp();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Cronômetro de Jiu-Jitsu rodando na porta ${port}`);
    console.log(`  Nesta máquina:  http://localhost:${port}`);
    for (const ip of lanAddresses()) {
      console.log(`  Na rede local:  http://${ip}:${port}   (abra este na TV)`);
    }
  });
}

module.exports = { createApp };
