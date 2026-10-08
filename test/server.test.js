'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../server');

async function startServer() {
  const app = createApp();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, close: () => new Promise((r) => { app.server.closeAllConnections(); app.server.close(r); }) };
}

function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** Abre um stream SSE e devolve uma função que espera o próximo evento. */
function openEvents(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let buf = '';
      const queue = [];
      const waiters = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          if (waiters.length) waiters.shift()(data);
          else queue.push(data);
        }
      });
      resolve({
        res,
        next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r))),
        close: () => req.destroy()
      });
    });
    req.on('error', reject);
  });
}

test('serve a tela da TV e o controle', async (t) => {
  const s = await startServer();
  t.after(s.close);
  for (const [path, needle] of [['/', 'tv.js'], ['/controle', 'controle.js'], ['/shared/timer.js', 'computeView']]) {
    const res = await fetch(s.base + path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), new RegExp(needle));
  }
  assert.equal((await fetch(s.base + '/nao-existe.html')).status, 404);
  assert.equal((await fetch(s.base + '/..%2fserver.js')).status, 404, 'não sai da pasta public');
});

test('comando do celular chega na TV em tempo real', async (t) => {
  const s = await startServer();
  t.after(s.close);

  const tv = await openEvents(`${s.base}/api/rooms/4321/events?role=tv`);
  t.after(tv.close);
  const first = await tv.next();
  assert.equal(first.state.code, '4321');
  assert.equal(first.peers.tv, 1);

  const res = await post(`${s.base}/api/rooms/4321/command`, { type: 'start' });
  assert.equal(res.status, 200);
  const update = await tv.next();
  assert.equal(update.state.clock.running, true);
  assert.equal(typeof update.serverNow, 'number');
});

test('controle conectado aparece para a TV', async (t) => {
  const s = await startServer();
  t.after(s.close);
  const tv = await openEvents(`${s.base}/api/rooms/1111/events?role=tv`);
  t.after(tv.close);
  await tv.next();
  const phone = await openEvents(`${s.base}/api/rooms/1111/events`);
  t.after(phone.close);
  const update = await tv.next();
  assert.deepEqual(update.peers, { tv: 1, remote: 1 });
});

test('salas são isoladas', async (t) => {
  const s = await startServer();
  t.after(s.close);
  await post(`${s.base}/api/rooms/1000/command`, { type: 'score', athlete: 'a', field: 'points', delta: 2 });
  const other = await (await fetch(`${s.base}/api/rooms/2000/state`)).json();
  assert.equal(other.state.match.a.points, 0);
  const same = await (await fetch(`${s.base}/api/rooms/1000/state`)).json();
  assert.equal(same.state.match.a.points, 2);
});

test('erros de entrada retornam 400/405', async (t) => {
  const s = await startServer();
  t.after(s.close);
  assert.equal((await fetch(`${s.base}/api/rooms/abc/state`)).status, 400);
  assert.equal((await post(`${s.base}/api/rooms/1234/command`, { type: 'nope' })).status, 400);
  const invalidJson = await fetch(`${s.base}/api/rooms/1234/command`, { method: 'POST', body: '{' });
  assert.equal(invalidJson.status, 400);
  const huge = await post(`${s.base}/api/rooms/1234/command`, { type: 'setNames', a: 'x'.repeat(20000) }).catch(() => null);
  assert.ok(!huge || huge.status === 400, 'corpo grande é recusado');
  assert.equal((await fetch(`${s.base}/api/rooms/1234/command`)).status, 405);
});
