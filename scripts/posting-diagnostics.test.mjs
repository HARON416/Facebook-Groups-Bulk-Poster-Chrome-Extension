import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["src/posting-diagnostics.ts"], bundle: true, write: false, platform: "browser", format: "esm" });
const { createPostingDiagnostics } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
function fixture() {
  const values = {};
  const writes = [];
  const storage = {
    get: async () => structuredClone(values),
    set: async next => { Object.assign(values, structuredClone(next)); writes.push(next); },
  };
  let now = 0;
  const create = context => createPostingDiagnostics(context, { storage, now: () => now, version: "test-version" });
  return { values, writes, storage, create, tick: ms => { now += ms; } };
}
const status = processedCount => ({ type: "UI_POSTING_STATUS", status: "waiting", current: processedCount, total: 1000, processedCount });

test("an eight-hour countdown stores thirty-second heartbeats, not every tick", async () => {
  const f = fixture();
  const reporter = f.create("background");
  for (let second = 0; second < 8 * 60 * 60; second++) {
    reporter.checkpoint(status(250));
    f.tick(1000);
  }
  await reporter.flush();
  const entries = f.values["postikaDiagnostics:background"].entries;
  assert.equal(entries.length, 100);
  assert.ok(entries.every(entry => entry.event === "checkpoint"));
  assert.equal(entries.at(-1).at - entries[0].at, 99 * 30_000);
  assert.ok(JSON.stringify(f.values).length < 50_000);
});

test("checkpoints survive reloads without storing posts, photos, cookies or responses", async () => {
  const f = fixture();
  const first = f.create("background");
  first.checkpoint({ ...status(250), body: "private post", images: ["private photo"], responseBody: "private response", cookie: "private cookie" });
  await first.flush();
  f.tick(60_000);
  const restarted = f.create("background");
  await restarted.flush();
  const entries = f.values["postikaDiagnostics:background"].entries;
  assert.equal(entries.filter(entry => entry.event === "context-start").length, 2);
  assert.ok(entries.some(entry => entry.processedCount === 250));
  assert.ok(!JSON.stringify(f.values).includes("private"));
  assert.notEqual(entries[0].session, entries.at(-1).session);
});

test("slow storage coalesces writes rather than queueing a promise per event", async () => {
  const f = fixture();
  const originalSet = f.storage.set;
  let entered;
  let release;
  const saving = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  f.storage.set = async values => { entered(); await gate; return originalSet(values); };
  const reporter = f.create("panel");
  const flushing = reporter.flush();
  await saving;
  for (let i = 0; i < 1000; i++) reporter.checkpoint(status(i));
  release();
  await flushing;
  await reporter.flush();
  assert.ok(f.writes.length <= 2);
  assert.equal(reporter.snapshot().entries.length, 100);
  assert.equal(f.values["postikaDiagnostics:panel"].entries.at(-1).processedCount, 999);
});

test("storage failure is contained and a later write can recover", async () => {
  const f = fixture();
  const set = f.storage.set;
  f.storage.get = async () => { throw new Error("read denied"); };
  f.storage.set = async () => { throw new Error("quota exceeded"); };
  const reporter = f.create("background");
  reporter.checkpoint(status(250));
  await reporter.flush();
  assert.ok(reporter.storageError());
  f.storage.set = set;
  reporter.checkpoint(status(251));
  await reporter.flush();
  assert.equal(reporter.storageError(), undefined);
  assert.equal(f.values["postikaDiagnostics:background"].entries.at(-1).processedCount, 251);
});

test("error reports remain bounded during repeated failures", async () => {
  const f = fixture();
  const reporter = f.create("panel");
  for (let i = 0; i < 1000; i++) reporter.captureError("runtime-error", new Error("x".repeat(20_000)));
  await reporter.flush();
  assert.equal(reporter.snapshot().entries.length, 100);
  assert.ok(reporter.snapshot().entries.every(entry => entry.errorMessage.length === 256));
  assert.ok(JSON.stringify(f.values).length < 50_000);
});
