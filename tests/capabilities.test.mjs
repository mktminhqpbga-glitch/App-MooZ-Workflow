import test from 'node:test';
import assert from 'node:assert/strict';
import { availableImageTools, localImageTools } from '../core/capabilities.js';

test('advanced image tools require a ready connection and an implemented handler', () => {
  const handler = () => {};
  const operation = 'image.upscale';
  assert.deepEqual(availableImageTools(null), localImageTools);
  assert.deepEqual(availableImageTools({ providers: [{ ready: false, operations: [operation] }] }, { [operation]: handler }), localImageTools);
  assert.deepEqual(availableImageTools({ providers: [{ ready: true, operations: [operation] }] }), localImageTools);
  const enabled = availableImageTools({ providers: [{ ready: true, operations: [operation] }] }, { [operation]: handler });
  assert.equal(enabled.length, localImageTools.length + 1);
  assert.equal(enabled.at(-1).handler, handler);
});
