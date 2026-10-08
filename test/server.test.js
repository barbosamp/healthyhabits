'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

test('servidor local entrega a TV, o controle e os scripts', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const pages = [
    ['/', 'tv.js'],
    ['/tv', 'tv.js'],
    ['/controle', 'controle.js'],
    ['/controle.html', 'controle.js'],
    ['/shared/state.js', 'applyCommand'],
    ['/vendor/peerjs-1.5.4.min.js', 'Peer']
  ];
  for (const [path, needle] of pages) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), new RegExp(needle), path);
  }
  assert.equal((await fetch(base + '/nao-existe')).status, 404);
  assert.equal((await fetch(base + '/..%2fserver.js')).status, 404, 'não sai da pasta public');
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
});

test('vercel.json publica a pasta public com URLs limpas', () => {
  const cfg = require('../vercel.json');
  assert.equal(cfg.outputDirectory, 'public');
  assert.equal(cfg.cleanUrls, true);
});
