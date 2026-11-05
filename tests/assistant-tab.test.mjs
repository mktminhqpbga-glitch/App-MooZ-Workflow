import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssistantTab } from '../server/assistant-tab.mjs';

test('assistant tab is exclusive, survives restart and cannot be moved while in use', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mooz-assistant-'));
  try {
    const roles = new AssistantTab(directory);
    await roles.init();
    let busy = false;
    const options = { check: async input => ({ id: input.tabId, title: 'Assistant fixture', url: 'https://grok.com/chat/assistant' }), isBusy: () => busy };
    await roles.configure({ provider: 'grok', tabId: 8 }, options);
    assert.throws(() => roles.assertJob({ provider: 'grok', tabId: 8, purpose: 'workflow' }), /dành riêng/);
    assert.doesNotThrow(() => roles.assertJob({ provider: 'grok', tabId: 9, purpose: 'workflow' }));
    assert.doesNotThrow(() => roles.assertJob({ provider: 'grok', tabId: 8, purpose: 'assistant' }));
    assert.throws(() => roles.assertJob({ provider: 'grok', tabId: 9, purpose: 'assistant' }), /thay đổi/);
    const restarted = new AssistantTab(directory); await restarted.init();
    assert.equal(restarted.snapshot().tabId, 8);
    busy = true;
    await assert.rejects(() => roles.configure(null, options), /đang có công việc/);
    await assert.rejects(() => roles.configure({ provider: 'grok', tabId: 9 }, options), /đang có công việc/);
    assert.equal(roles.snapshot().tabId, 8);
    busy = false;
    await roles.configure(null, options);
    assert.doesNotThrow(() => roles.assertJob({ provider: 'grok', tabId: 8, purpose: 'workflow' }));
    const cleared = new AssistantTab(directory); await cleared.init();
    assert.equal(cleared.snapshot(), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
