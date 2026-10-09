import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/sidepanel.ts', import.meta.url), 'utf8');
const settingsSource = source.slice(source.indexOf('function setGroupCommentSyncStatus('), source.indexOf('groupCommentRetryButton?.addEventListener'));
const defaultSource = source.slice(source.indexOf('const DEFAULT_GROUP_COMMENT_OPTIONS ='), source.indexOf('type GroupCommentSettings ='));
const code = (await transform(defaultSource + settingsSource, { loader: 'ts' })).code;
const account = (id) => ({ active: true, user: { id }, sessionToken: `token-${id}` });

function harness(records = new Map()) {
  const writes = [];
  const context = vm.createContext({
    Error, AUTH_API_BASE_URL: 'https://api.example', currentExtensionAccess: account('a'),
    groupCommentSettingsGeneration: 0, groupCommentSettingsLoaded: true,
    groupCommentOptions: ['Previous account draft'], groupCommentEnabledToggle: { checked: true },
    groupCommentSaveQueue: Promise.resolve(), groupCommentSavedVersion: 0, groupCommentEditVersion: 0,
    groupCommentSyncStatus: { textContent: '' }, groupCommentRetryButton: { hidden: true },
    legacyGroupCommentSettings: undefined,
    renderGroupCommentOptions() {}, saveSidePanelSession: async () => {},
    fetch: async (url, options) => {
      const owner = options.headers.Authorization.replace('Bearer token-', '');
      if (options.method === 'POST') {
        const settings = JSON.parse(options.body);
        writes.push({ owner, settings });
        if (!records.has(owner)) records.set(owner, settings);
      }
      return { ok: true, json: async () => ({ settings: records.get(owner) ?? null }) };
    },
  });
  vm.runInContext(code, context);
  return { context, records, writes, load: () => context.loadCloudGroupCommentSettings() };
}

test('different Google accounts load their own comments, and new accounts start empty', async () => {
  const h = harness(new Map([['a', { enabled: true, options: ['Private A comment'] }]]));
  await h.load();
  assert.equal(h.context.groupCommentOptions[0], 'Private A comment');
  h.context.currentExtensionAccess = account('b');
  await h.load();
  assert.deepEqual(h.records.get('b'), { enabled: false, options: [''] });
  assert.equal(h.context.groupCommentOptions[0], '');
  assert.equal(h.context.groupCommentEnabledToggle.checked, false);
  assert.deepEqual(h.records.get('a'), { enabled: true, options: ['Private A comment'] });
  h.context.currentExtensionAccess = account('a');
  await h.load();
  assert.equal(h.context.groupCommentOptions[0], 'Private A comment');
});

test('previous account comments disappear immediately while the next account is still loading', async () => {
  const h = harness();
  let release;
  h.context.groupCommentSaveQueue = new Promise((resolve) => { release = resolve; });
  const loading = h.load();
  assert.equal(h.context.groupCommentOptions[0], '');
  assert.equal(h.context.groupCommentEnabledToggle.checked, false);
  assert.equal(h.context.groupCommentSettingsLoaded, false);
  release();
  await loading;
});

test('unowned legacy comments are retained locally but never assigned to a new account', async () => {
  const h = harness();
  h.context.legacyGroupCommentSettings = { enabled: true, options: ['Unowned private comment'] };
  await h.load();
  assert.deepEqual(h.records.get('a'), { enabled: false, options: [''] });
  assert.equal(h.context.legacyGroupCommentSettings.options[0], 'Unowned private comment');
  assert.equal(h.context.groupCommentOptions[0], '');
});

test('owned legacy comments migrate only when their Google account signs in', async () => {
  const h = harness();
  h.context.legacyGroupCommentSettings = { enabled: true, options: ['Private B comment'], ownerUserId: 'b' };
  await h.load();
  assert.deepEqual(h.records.get('a'), { enabled: false, options: [''] });
  assert.equal(h.context.legacyGroupCommentSettings.ownerUserId, 'b');
  h.context.currentExtensionAccess = account('b');
  await h.load();
  assert.deepEqual(h.records.get('b'), { enabled: true, options: ['Private B comment'] });
  assert.equal(h.context.legacyGroupCommentSettings, undefined);
});

test('failed loading never leaves another account comments visible or enabled', async () => {
  const h = harness();
  h.context.fetch = async () => { throw new Error('Offline'); };
  await h.load();
  assert.equal(h.context.groupCommentOptions[0], '');
  assert.equal(h.context.groupCommentEnabledToggle.checked, false);
  assert.equal(h.context.groupCommentSettingsLoaded, false);
});

test('a stale account response cannot replace the new account settings', async () => {
  const h = harness();
  let release;
  const fetch = h.context.fetch;
  h.context.fetch = async (url, options) => {
    if (options.headers.Authorization === 'Bearer token-a') return new Promise((resolve) => { release = () => resolve({ ok: true, json: async () => ({ settings: { enabled: true, options: ['Private A comment'] } }) }); });
    return fetch(url, options);
  };
  const first = h.load();
  await new Promise((resolve) => setImmediate(resolve));
  h.context.currentExtensionAccess = account('b');
  await h.load();
  release();
  await first;
  assert.equal(h.context.groupCommentOptions[0], '');
  assert.equal(h.context.groupCommentEnabledToggle.checked, false);
});
