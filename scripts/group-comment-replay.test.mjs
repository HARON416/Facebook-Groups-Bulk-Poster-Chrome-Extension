import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/group-comment-replay.ts', import.meta.url), 'utf8');
const code = (await transform(source, { loader: 'ts', format: 'esm' })).code;
const replay = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const variables = {
  groupID: '100', scale: 2, input: {
    feedback_id: btoa('feedback:12345'), message: { text: 'First comment', ranges: [{ offset: 0 }] },
    tracking: ['source-story-tracking'], is_tracking_encrypted: true, attachments: ['source'],
    session_id: 'fresh-session', idempotence_token: 'old-token', client_mutation_id: '1',
  }, focusCommentID: 'old-focus',
};
const template = () => ({
  url: 'https://web.facebook.com/api/graphql/', method: 'POST', headers: { 'x-fb-lsd': 'fresh-lsd' }, body: '',
  formData: { __user: '1234567890', av: '1234567890', doc_id: '123456', fb_api_req_friendly_name: replay.COMMENT_MUTATION_FRIENDLY_NAME,
    fb_dtsg: 'fresh-dtsg', lsd: 'fresh-lsd', __req: 'a', variables: JSON.stringify(variables) },
});
const session = () => ({ template: template(), sourcePostId: '12345', sequence: 10, browserSession: { actorId: '1234567890', tabId: 7, storeId: '0', fingerprint: 'test', origin: 'https://web.facebook.com' } });

test('replay keeps captured session values and updates the target, text and deduplication values', () => {
  globalThis.crypto ??= webcrypto;
  const active = session();
  const original = JSON.stringify(active.template);
  const first = JSON.parse(replay.buildCommentVariables(active, '200', 'new-feedback', 'Option two'));
  const second = JSON.parse(replay.buildCommentVariables(active, '300', 'third-feedback', 'Option three'));
  assert.equal(first.groupID, '200');
  assert.equal(first.input.feedback_id, 'new-feedback');
  assert.deepEqual(first.input.message, { text: 'Option two', ranges: [] });
  assert.deepEqual(first.input.tracking, []);
  assert.equal(first.input.is_tracking_encrypted, false);
  assert.equal(first.input.session_id, 'fresh-session');
  assert.equal(first.input.attachments, null);
  assert.equal(first.focusCommentID, null);
  assert.notEqual(first.input.idempotence_token, second.input.idempotence_token);
  assert.notEqual(first.input.client_mutation_id, second.input.client_mutation_id);
  assert.equal(JSON.stringify(active.template), original);
});

test('a feedback ID is derived only after matching the format to the actual first UI comment', () => {
  const active = session();
  assert.equal(replay.commentFeedbackId(active, { feedbackId: 'server-feedback' }, '200'), 'server-feedback');
  assert.equal(atob(replay.commentFeedbackId(active, { postUrl: 'https://web.facebook.com/groups/200/permalink/67890/' }, '200')), 'feedback:67890');
  assert.equal(replay.commentFeedbackId(active, { postUrl: 'https://other.test/groups/200/permalink/67890/' }, '200'), undefined);
  assert.equal(replay.commentFeedbackId(active, { postUrl: 'https://web.facebook.com/groups/100/permalink/67890/' }, '200'), undefined);
  active.sourcePostId = 'different-source';
  assert.equal(replay.commentFeedbackId(active, { postId: '67890' }, '200'), undefined);
});

test('invalid mutations and missing fresh session tokens are rejected', () => {
  for (const mutate of [
    (t) => { t.url = 'https://other.test/api/graphql/'; },
    (t) => { t.formData.doc_id = ''; },
    (t) => { t.formData.fb_dtsg = ''; },
    (t) => { t.formData.fb_api_req_friendly_name = 'ComposerStoryCreateMutation'; },
  ]) {
    const t = template(); mutate(t);
    assert.throws(() => replay.validateCommentTemplate(t));
  }
});

test('confirmation requires a created comment and rejects GraphQL errors even on HTTP success', () => {
  assert.deepEqual(replay.parseCommentResponse('for (;;);' + JSON.stringify({ data: { comment_create: { feedback_comment_edge: { node: { id: 'created' } } } } })), { success: true, commentId: 'created' });
  assert.equal(replay.parseCommentResponse('{}').success, false);
  assert.equal(replay.parseCommentResponse('').success, false);
  assert.equal(replay.parseCommentResponse('<html>login</html>').success, false);
  const created = JSON.stringify({ data: { comment_create: { comment: { id: 'created' } } } });
  assert.equal(replay.parseCommentResponse(created + '\n' + JSON.stringify({ errors: [{ message: 'Blocked' }] })).success, false);
});

async function captureHarness() {
  const calls = [];
  class FakeXHR {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    addEventListener(name, listener) { this.listener = listener; }
    send(body) {
      calls.push({ method: this.method, url: this.url, body });
      this.status = 200;
      this.responseType = '';
      this.responseText = JSON.stringify({ data: { comment_create: { comment: { id: 'xhr-created' } } } });
      this.listener?.();
    }
  }
  const fetch = async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify({ data: { comment_create: { comment: { id: 'fetch-created' } } } }), { status: 200 });
  };
  const originalOpen = FakeXHR.prototype.open;
  const context = vm.createContext({ URL, URLSearchParams, Request, Response, XMLHttpRequest: FakeXHR, WeakMap, atob,
    location: { href: 'https://web.facebook.com/groups/100/permalink/12345/', origin: 'https://web.facebook.com' }, fetch });
  const script = (await transform(source.replace(/^export /gm, ''), { loader: 'ts' })).code;
  vm.runInContext(script, context);
  context.installCommentRequestCaptureInPage('100', 'First comment', '12345');
  return { context, calls, fetch, FakeXHR, originalOpen };
}

test('fetch interception captures the matching request and response, forwards once and restores fetch', async () => {
  const h = await captureHarness();
  const body = new URLSearchParams(template().formData).toString();
  await h.context.fetch(template().url, { method: 'POST', body, headers: { 'x-fb-lsd': 'fresh-lsd' } });
  await new Promise((resolve) => setImmediate(resolve));
  const captured = h.context.readCommentRequestCaptureInPage(false);
  assert.equal(captured.template.formData.fb_dtsg, 'fresh-dtsg');
  assert.equal(captured.template.formData.doc_id, '123456');
  assert.equal(captured.template.headers['x-fb-lsd'], 'fresh-lsd');
  assert.equal(captured.status, 200);
  assert.equal(replay.parseCommentResponse(captured.responseText).commentId, 'fetch-created');
  assert.equal(h.calls.length, 1);
  h.context.readCommentRequestCaptureInPage(true);
  assert.equal(h.context.fetch, h.fetch);
  assert.equal(h.context.readCommentRequestCaptureInPage(false).template, undefined);
});

test('XHR interception ignores a different comment and captures the matching mutation without resending', async () => {
  const h = await captureHarness();

  const request = new h.FakeXHR();
  request.open('POST', template().url);
  request.setRequestHeader('X-FB-LSD', 'fresh-lsd');
  const wrong = template();
  wrong.formData.variables = JSON.stringify({ ...variables, groupID: '200' });
  request.send(new URLSearchParams(wrong.formData).toString());
  assert.equal(h.context.readCommentRequestCaptureInPage(false).template, undefined);
  const matched = new h.FakeXHR();
  matched.open('POST', template().url);
  matched.setRequestHeader('X-FB-LSD', 'fresh-lsd');
  matched.send(new URLSearchParams(template().formData).toString());
  const captured = h.context.readCommentRequestCaptureInPage(false);
  assert.equal(captured.template.formData.lsd, 'fresh-lsd');
  assert.equal(captured.template.headers['x-fb-lsd'], 'fresh-lsd');
  assert.equal(replay.parseCommentResponse(captured.responseText).commentId, 'xhr-created');
  assert.equal(h.calls.length, 2);
  h.context.readCommentRequestCaptureInPage(true);
  assert.equal(h.FakeXHR.prototype.open, h.originalOpen);
});

test('the real comment replay function sends captured tokens and document ID with browser cookies and the new target', async () => {
  globalThis.crypto ??= webcrypto;
  const background = await readFile(new URL('../src/background.ts', import.meta.url), 'utf8');
  const helpers = background.slice(background.indexOf('async function createGraphqlComment('), background.indexOf('async function createGraphqlPost(')) +
    background.slice(background.indexOf('async function createGraphqlPostInPage('), background.indexOf('async function maybeRewriteDescription('));
  const requests = [];
  const context = vm.createContext({
    URLSearchParams, assertCommentBrowserSession: async () => {}, buildCommentVariables: replay.buildCommentVariables, parseCommentResponse: replay.parseCommentResponse,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ data: { comment_create: { comment: { id: 'confirmed' } } } }), { status: 200 });
    },
    chrome: { scripting: { executeScript: async ({ func, args }) => [{ result: await func(...args) }] } },
  });
  vm.runInContext((await transform(helpers, { loader: 'ts' })).code, context);
  const active = session();
  const v = JSON.parse(active.template.formData.variables);
  v.input.idempotence_token = 'client:11111111-1111-4111-8111-111111111111';
  active.template.formData.variables = JSON.stringify(v);
  await context.createGraphqlComment(7, active, '200', 'new-feedback', 'Second comment');
  await context.createGraphqlComment(7, active, '300', 'third-feedback', 'Third comment');
  const request = requests[0];
  const form = new URLSearchParams(request.init.body);
  const updated = JSON.parse(form.get('variables'));
  assert.equal(request.init.credentials, 'include');
  assert.equal(request.init.headers['x-fb-friendly-name'], replay.COMMENT_MUTATION_FRIENDLY_NAME);
  assert.equal(request.init.headers['x-fb-lsd'], 'fresh-lsd');
  assert.equal(form.get('fb_dtsg'), 'fresh-dtsg');
  assert.equal(form.get('doc_id'), '123456');
  assert.equal(form.get('__req'), 'b');
  assert.equal(new URLSearchParams(requests[1].init.body).get('__req'), 'c');
  assert.equal(updated.groupID, '200');
  assert.equal(updated.input.feedback_id, 'new-feedback');
  assert.equal(updated.input.message.text, 'Second comment');
  assert.match(updated.input.idempotence_token, /^client:[0-9a-f-]{36}$/);
});


test('actor and token mismatches are rejected before building a replay', () => {
  for (const mutate of [
    (t) => { t.formData.__user = '9876543210'; },
    (t) => { t.formData.av = '9876543210'; },
    (t) => { const v = JSON.parse(t.formData.variables); v.input.actor_id = '9876543210'; t.formData.variables = JSON.stringify(v); },
    (t) => { t.headers['x-fb-lsd'] = 'different-lsd'; },
    (t) => { t.headers['x-fb-friendly-name'] = 'different-mutation'; },
  ]) {
    const active = session(); mutate(active.template);
    assert.throws(() => replay.buildCommentVariables(active, '200', 'new-feedback', 'Next comment'));
  }
});

test('a same-group same-text request for a different post is forwarded but never used as a template', async () => {
  const h = await captureHarness();
  const wrong = template();
  const v = JSON.parse(wrong.formData.variables);
  v.input.feedback_id = btoa('feedback:99999');
  wrong.formData.variables = JSON.stringify(v);
  await h.context.fetch(wrong.url, { method: 'POST', body: new URLSearchParams(wrong.formData).toString() });
  const captured = h.context.readCommentRequestCaptureInPage(false);
  assert.equal(captured.template, undefined);
  assert.match(captured.error, /different or unverifiable post/);
  assert.equal(h.calls.length, 1);
  h.context.readCommentRequestCaptureInPage(true);
});

test('conflicting post IDs, groups and feedback IDs never produce a replay target', () => {
  const active = session();
  assert.equal(replay.commentFeedbackId(active, { postId: '67890', postUrl: 'https://web.facebook.com/groups/100/permalink/67890/' }, '200'), undefined);
  assert.equal(replay.commentFeedbackId(active, { postId: '11111', postUrl: 'https://web.facebook.com/groups/200/permalink/67890/' }, '200'), undefined);
  assert.equal(replay.commentFeedbackId(active, { feedbackId: btoa('feedback:12345'), postUrl: 'https://web.facebook.com/groups/200/permalink/67890/' }, '200'), undefined);
});

test('all captured envelope and session variable fields survive replay except deliberate per-comment changes', async () => {
  globalThis.crypto ??= webcrypto;
  const background = await readFile(new URL('../src/background.ts', import.meta.url), 'utf8');
  const helpers = background.slice(background.indexOf('async function createGraphqlComment('), background.indexOf('async function createGraphqlPost('));
  const active = session();
  const fields = ['__a', '__aaid', '__ccg', '__comet_req', '__crn', '__csr', '__dyn', '__hblp', '__hs', '__hsdp', '__hsi', '__rev', '__s', '__sjsp', '__spin_b', '__spin_r', '__spin_t', 'dpr', 'fb_api_caller_class', 'jazoest', 'server_timestamps'];
  for (const field of fields) active.template.formData[field] = `captured-${field}`;
  const originalForm = { ...active.template.formData };
  const v = JSON.parse(active.template.formData.variables);
  Object.assign(v, { feedLocation: 'GROUP_PERMALINK', feedbackSource: 2, renderLocation: null, useDefaultActor: true, translationType: 'ORIGINAL', scale: 1, inviteShortLinkKey: null, renderLocation: null, canUseNicknameOnComet: false, __relay_internal__pv__IsWorkUserrelayprovider: false, __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: 'ORIGINAL' });
  Object.assign(v.input, { attribution_id_v2: 'current-page-context', feedback_source: 'GROUP_PERMALINK', formatting_style: null, vod_video_timestamp: null, is_inline_vote_enabled_for_qna: false });
  active.template.formData.variables = JSON.stringify(v);
  let sent;
  const context = vm.createContext({
    buildCommentVariables: replay.buildCommentVariables, parseCommentResponse: replay.parseCommentResponse,
    assertCommentBrowserSession: async () => {}, createGraphqlPostInPage() {},
    chrome: { scripting: { executeScript: async ({ args }) => { sent = args; return [{ result: { ok: true, responseText: JSON.stringify({ data: { comment_create: { comment: { id: 'confirmed' } } } }) } }]; } } },
  });
  vm.runInContext((await transform(helpers, { loader: 'ts' })).code, context);
  await context.createGraphqlComment(7, active, '200', 'new-feedback', 'Next comment');
  for (const [key, value] of Object.entries(originalForm)) {
    if (!['variables', '__req'].includes(key)) assert.equal(sent[0].formData[key], value, key);
  }
  assert.deepEqual(Object.keys(sent[0].formData).sort(), Object.keys(originalForm).sort());
  const updated = JSON.parse(sent[1]);
  for (const [key, value] of Object.entries(v)) {
    if (!['groupID', 'input', 'focusCommentID'].includes(key)) assert.deepEqual(updated[key], value, key);
  }
  for (const [key, value] of Object.entries(v.input)) {
    if (!['feedback_id', 'message', 'attachments', 'client_mutation_id', 'idempotence_token', 'tracking', 'is_tracking_encrypted'].includes(key)) assert.deepEqual(updated.input[key], value, key);
  }
  assert.equal(updated.input.feedback_id, 'new-feedback');
  assert.equal(updated.input.message.text, 'Next comment');
});
