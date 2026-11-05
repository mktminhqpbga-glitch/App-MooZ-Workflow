import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPrompts, prepareBatch, tagName, parseScenes } from '../core/queue-plan.js';
const asset = (id, name, size = 10) => ({ id, name, kind: 'image', blob: new Blob([new Uint8Array(size)], { type: 'image/png' }) });
test('prompt splitting preserves multiline blocks, rejects incomplete or oversized batches', () => {
  assert.deepEqual(splitPrompts('[A\nB]\n[C]'), ['A\nB', 'C']);
  assert.deepEqual(splitPrompts('A\nB', 'whole'), ['A\nB']);
  assert.deepEqual(splitPrompts('A\n\nB', 'paragraphs'), ['A', 'B']);
  for (const text of ['[A', 'A]', 'outside[A]', '[ ]', Array(51).fill('[x]').join(''), '[' + 'a'.repeat(20001) + ']']) assert.throws(() => splitPrompts(text));
});
test('tags resolve the whole batch before creation; copies are independent plans and limits are strict', () => {
  assert.equal(tagName('Ảnh Sản Phẩm.JPG'), 'anh-san-pham');
  const assets = [asset('red', 'Sản phẩm.png'), asset('blue', 'Sản phẩm.png')];
  const result = prepareBatch({ prompts: ['A @san-pham', 'B @san-pham-2'], assets, copies: 2 });
  assert.equal(result.length, 4); assert.notEqual(result[0], result[1]); assert.match(result[0].prompt, /asset:red/); assert.equal(result[2].references[0].id, 'blue');
  assert.throws(() => prepareBatch({ prompts: ['valid', '@missing'], assets }), /missing/);
  assert.throws(() => prepareBatch({prompts:['x'],assets:Array.from({length:5},(_,i)=>({...asset('tag'+i,'tag'+i,7*1024*1024),batchTag:'tag'+i}))}),/32 MB/);
  assert.throws(() => prepareBatch({ prompts: ['x'], assets: [asset('large', 'large.png', 8*1024*1024+1)], sourceId: 'large' }), /8 MB/);
  assert.throws(() => prepareBatch({ prompts: ['x'], assets, copies: 2, existingJobs: Array(199).fill({}) }), /200/);
  assert.throws(() => prepareBatch({ prompts: ['x'], assets: Array.from({ length: 9 }, (_, i) => asset('a'+i, 'a'+i+'.png')), sourceId: 'a0', copies: 1, existingJobs: [{ inputAssets: { big: { kind: 'image', blob: { size: 32*1024*1024 } } } }] }), /32 MB/);
});
test('scene JSON rejects missing, wrong-count and noncontiguous scenes before generating media', () => {
  const scene = { title: 'Cảnh 1', voiceover: '', imagePrompt: 'Ảnh riêng', videoPrompt: 'Chuyển động riêng' };
  assert.equal(parseScenes(JSON.stringify({ scenes: [scene] }), 1)[0].imagePrompt, 'Ảnh riêng');
  for (const raw of ['not json', JSON.stringify({ scenes: [] }), JSON.stringify({ scenes: [{ ...scene, index: 2 }] }), JSON.stringify({ scenes: [{ title: 'only' }] })]) assert.throws(() => parseScenes(raw, 1));
});
