import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

test('HTTP routes reserve the assistant tab and reject forged workflow purpose before dispatch', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mooz-assistant-http-'));
  const process = spawn(globalThis.process.execPath, [resolve('server.mjs')], { cwd: directory, env: { ...globalThis.process.env, PORT: '4217', HOST: '127.0.0.1', MOOZ_ACCESS_TOKEN: '' }, stdio: 'ignore' });
  const base = 'http://127.0.0.1:4217';
  const api = async (path, body) => {
    const response = await fetch(base + '/api/' + path, { method: body ? 'POST' : 'GET', headers: { 'x-mooz-client': 'web', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    return result;
  };
  let socket;
  try {
    let available = false;
    for (let i = 0; i < 100; i++) {
      try { await api('status'); available = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(available, 'server starts');
    const pair = await api('chrome/pair', {}), uri = new URL(pair.uri);
    socket = new WebSocket('ws://127.0.0.1:' + uri.port, { origin: 'chrome-extension://' + 'a'.repeat(32) });
    socket.on('error', () => {});
    const tabs = [8, 9].map(id => ({ id, title: 'Fixture ' + id, url: 'https://gemini.google.com/app/tab-' + id }));
    let sends = 0; const dispatched = [];
    socket.on('message', bytes => {
      const message = JSON.parse(bytes);
      if (message.type !== 'request') return;
      let result;
      if (message.operation === 'tabs.query') result = tabs;
      else if (message.operation === 'tabs.get') result = tabs.find(tab => tab.id === message.payload.id);
      else if (message.operation === 'tabs.message' && message.payload.message.type === 'WORKFLOW_AI_CHECK') result = { ok: true, composer: true, signedIn: true, sendProtocol: 1 };
      else if (message.operation === 'tabs.message') { sends++; dispatched.push(message.payload.id); result = { ok: true, text: 'Fixture assistant reply', requestId: message.payload.message.requestId }; }
      else result = [{ result: true }];
      socket.send(JSON.stringify({ type: 'response', id: message.id, result }));
    });
    await new Promise((resolve, reject) => {
      socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: uri.pathname.slice(1), protocol: 1, extensionVersion: '1.9.2' })));
      socket.on('message', bytes => { if (JSON.parse(bytes).type === 'ready') resolve(); });
      socket.once('error', reject);
    });
    await api('assistant/config', { tab: { provider: 'gemini', tabId: 8, chatURL: tabs[0].url } });
    assert.deepEqual((await api('tabs?provider=gemini')).map(tab => tab.id), [9]);
    assert.deepEqual((await api('tabs?provider=gemini&purpose=assistant-setup')).map(tab => tab.id), [8, 9]);
    for (const purpose of ['workflow', 'assistant']) {
      const blocked = await api('jobs', { requestId: crypto.randomUUID(), provider: 'gemini', tabId: 8, chatURL: tabs[0].url, mediaType: 'text', prompt: 'Must be blocked', purpose });
      assert.equal(blocked.status, 'error'); assert.match(blocked.error, /dành riêng/);
    }
    assert.equal(sends, 0);
    const reply = await api('assistant/messages', { requestId: crypto.randomUUID(), prompt: 'Use the assistant tab' });
    assert.equal(reply.status, 'success'); assert.equal(reply.result.text, 'Fixture assistant reply');
    assert.deepEqual(dispatched, [8]);
    const ordinary = await api('jobs', { requestId: crypto.randomUUID(), provider: 'gemini', tabId: 9, chatURL: tabs[1].url, mediaType: 'text', prompt: 'Use the work tab' });
    assert.equal(ordinary.status, 'success'); assert.deepEqual(dispatched, [8, 9]);
    await api('assistant/config', { tab: null });
    const released = await api('jobs', { requestId: crypto.randomUUID(), provider: 'gemini', tabId: 8, chatURL: tabs[0].url, mediaType: 'text', prompt: 'Released work tab' });
    assert.equal(released.status, 'success'); assert.deepEqual(dispatched, [8, 9, 8]);
  } finally {
    socket?.terminate();
    process.kill('SIGTERM'); await once(process, 'exit');
    await rm(directory, { recursive: true, force: true });
  }
});
