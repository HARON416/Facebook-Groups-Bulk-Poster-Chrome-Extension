import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/posting-request-transfer.ts'], bundle: true, write: false, platform: 'browser', format: 'esm' });
const { sendPostingRequest, receivePostingRequest } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function event() {
  const listeners = new Set();
  return { addListener: f => listeners.add(f), emit: value => { for (const f of listeners) f(value); } };
}
function ports() {
  let connected = true;
  const a = { onMessage: event(), onDisconnect: event() }, b = { onMessage: event(), onDisconnect: event() };
  a.postMessage = message => queueMicrotask(() => { if (connected) b.onMessage.emit(message); });
  b.postMessage = message => queueMicrotask(() => { if (connected) a.onMessage.emit(message); });
  a.disconnect = b.disconnect = () => { if (!connected) return; connected = false; a.onDisconnect.emit(); b.onDisconnect.emit(); };
  return [a, b];
}
const request = text => ({ type: 'START_UI_POSTING', groups: [{ id: '100' }], posts: [{ id: 'post', body: 'Unstored text', html: '<p><strong>Unstored text</strong></p>', images: [{ name: 'image', dataUrl: text }] }] });

test('a batch over 64 MiB transfers intact without persistent storage or oversized messages', async () => {
  const [sender, receiver] = ports();
  let starts = 0, largestChunk = 0;
  const largeImage = 'data:image/png;base64,' + 'x'.repeat(65 * 1024 * 1024);
  globalThis.chrome = { runtime: { connect: () => sender } };
  receiver.onMessage.addListener(message => { if (message.chunk) largestChunk = Math.max(largestChunk, message.chunk.length); });
  receivePostingRequest(receiver, batch => {
    starts++;
    assert.equal(batch.posts[0].images[0].dataUrl, largeImage);
    assert.equal(batch.posts[0].body, 'Unstored text');
    assert.equal(batch.posts[0].html, '<p><strong>Unstored text</strong></p>');
    return { ok: true };
  });
  assert.deepEqual(await sendPostingRequest(request(largeImage)), { ok: true, error: undefined });
  assert.equal(starts, 1);
  assert.ok(largestChunk <= 1024 * 1024);
});

test('an incomplete or duplicate transfer cannot start a queue', async () => {
  const [sender, receiver] = ports();
  let starts = 0;
  receivePostingRequest(receiver, () => { starts++; return { ok: true }; });
  const result = new Promise(resolve => sender.onMessage.addListener(message => { if (message.type === 'result') resolve(message); }));
  sender.postMessage({ type: 'begin', length: 10 });
  sender.postMessage({ type: 'chunk', chunk: '{}' });
  sender.postMessage({ type: 'end' });
  sender.postMessage({ type: 'end' });
  assert.equal((await result).ok, false);
  assert.equal(starts, 0);
  sender.disconnect();
});

test('a closed panel discards its partial transfer and sender reports interruption', async () => {
  const [sender, receiver] = ports();
  globalThis.chrome = { runtime: { connect: () => sender } };
  let starts = 0;
  receivePostingRequest(receiver, () => { starts++; return { ok: true }; });
  receiver.onMessage.addListener(() => receiver.disconnect());
  await assert.rejects(sendPostingRequest(request('original-image')), /interrupted/);
  assert.equal(starts, 0);
});

test('queue rejection reaches the panel without starting a second queue', async () => {
  const [sender, receiver] = ports();
  globalThis.chrome = { runtime: { connect: () => sender } };
  receivePostingRequest(receiver, () => ({ ok: false, error: 'Posting is already in progress.' }));
  assert.deepEqual(await sendPostingRequest(request('image')), { ok: false, error: 'Posting is already in progress.' });
});

test('the sender waits for asynchronous scheduled-queue persistence', async () => {
  const [sender, receiver] = ports();
  globalThis.chrome = { runtime: { connect: () => sender } };
  const scheduledAt = new Date(Date.now() + 60_000).toISOString();
  receivePostingRequest(receiver, async batch => {
    assert.equal(batch.scheduledAt, scheduledAt);
    await new Promise(resolve => setTimeout(resolve, 5));
    return { ok: true };
  });
  assert.deepEqual(
    await sendPostingRequest({ ...request('image'), scheduledAt }),
    { ok: true, error: undefined },
  );
});
