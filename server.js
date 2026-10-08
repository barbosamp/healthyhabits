'use strict';

/*
 * Servidor local só para desenvolvimento/uso na rede da academia sem a Vercel.
 * O app é 100% estático (pasta public/): a sincronização TV ⇄ celular é feita
 * direto entre os aparelhos (WebRTC), então este servidor apenas entrega arquivos.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8'
};

// Mesmas URLs "limpas" da Vercel (cleanUrls): /controle → controle.html.
function resolveFile(pathname) {
  if (pathname === '/' || pathname === '/tv') return path.join(PUBLIC_DIR, 'index.html');
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return null;
  return path.extname(file) ? file : file + '.html';
}

function createServer() {
  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (err) {
      res.writeHead(400).end('URL inválida');
      return;
    }
    const file = resolveFile(pathname);
    if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404).end('Não encontrado');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Não encontrado');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, '0.0.0.0', () => {
    console.log(`Cronômetro de Jiu-Jitsu rodando na porta ${port}`);
    console.log(`  Nesta máquina:  http://localhost:${port}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const addr of list || []) {
        if (addr.family === 'IPv4' && !addr.internal) console.log(`  Na rede local:  http://${addr.address}:${port}`);
      }
    }
  });
}

module.exports = { createServer };
