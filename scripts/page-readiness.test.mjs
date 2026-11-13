import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";

const readiness = await readFile(new URL("../src/page-readiness.ts", import.meta.url), "utf8");
const background = await readFile(new URL("../src/background.ts", import.meta.url), "utf8");
const transpile = async (source) => (await transform(source, { loader: "ts", format: "cjs" })).code;
const readinessCode = await transpile(readiness);
const backgroundFunction = async (name, next) => transpile(background.slice(background.indexOf(`async function ${name}(`), background.indexOf(`\n${next}`, background.indexOf(`async function ${name}(`))));

function fixture() {
  let now = 0;
  let callback;
  let disconnected = 0;
  const busy = [];
  const target = { querySelectorAll: () => busy, getAttribute: () => null };
  const context = vm.createContext({
    exports: {}, module: { exports: {} },
    window: {}, location: { href: "https://www.facebook.com/groups/joins/" },
    document: { readyState: "complete", body: target, querySelector: () => target },
    Date: { now: () => now },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    MutationObserver: class {
      constructor(fn) { callback = fn; }
      observe() {}
      disconnect() { disconnected++; }
    },
  });
  vm.runInContext(readinessCode, context);
  return { context, busy, inspect: () => context.module.exports.inspectPageReadinessInPage("/groups/joins/"), time: (value) => { now = value; }, mutate: () => callback(), disconnected: () => disconnected };
}

test("readiness waits for complete load and a quiet DOM, even beyond old deadlines", () => {
  const page = fixture();
  page.context.document.readyState = "loading";
  assert.equal(page.inspect(), false);
  page.time(60_000);
  page.context.document.readyState = "complete";
  assert.equal(page.inspect(), false);
  page.time(61_000);
  page.mutate();
  page.time(62_000);
  assert.equal(page.inspect(), false);
  page.time(62_500);
  assert.equal(page.inspect(), true);
  assert.equal(page.disconnected(), 1);
  assert.equal(page.context.window.__postikaPageReadiness, undefined);
});

test("visible busy content blocks readiness; hidden busy content does not", () => {
  const page = fixture();
  page.busy.push({ getBoundingClientRect: () => ({ width: 10, height: 10 }) });
  assert.equal(page.inspect(), false);
  page.time(120_000);
  assert.equal(page.inspect(), false);
  page.busy[0].getBoundingClientRect = () => ({ width: 0, height: 0 });
  assert.equal(page.inspect(), true);
});

test("navigation replaces the DOM observer and starts a new stability interval", () => {
  const page = fixture();
  assert.equal(page.inspect(), false);
  page.time(1_400);
  page.context.location.href += "?ordering=name";
  assert.equal(page.inspect(), false);
  assert.equal(page.disconnected(), 1);
  page.time(2_900);
  assert.equal(page.inspect(), true);
});

test("joined-page and capture waits accept results after their former deadlines", async () => {
  let now = 0;
  const context = vm.createContext({
    capturedGroupsRequest: undefined,
    chrome: { tabs: { get: async () => ({ status: now >= 60_000 ? "complete" : "loading", url: "https://www.facebook.com/groups/joins/" }) } },
    sleep: async () => { now += 10_000; if (now >= 120_000) context.capturedGroupsRequest = { body: "fresh" }; },
  });
  vm.runInContext(await backgroundFunction("waitForJoinedGroupsPage", "async function waitForPageDomReady"), context);
  vm.runInContext(await backgroundFunction("waitForCapturedGroupsRequest", "function updateFetchGroupsConfigFromCapturedRequest"), context);
  await context.waitForJoinedGroupsPage(1);
  assert.equal(now, 60_000);
  const request = await context.waitForCapturedGroupsRequest(1);
  assert.equal(now, 120_000);
  assert.equal(request.body, "fresh");
});

test("group loading uses the active Facebook tab", async () => {
  let queryOptions;
  const context = vm.createContext({
    chrome: {
      tabs: {
        query: async (options) => {
          queryOptions = options;
          return [{ id: 42, url: "https://www.facebook.com/groups/1/" }];
        },
      },
    },
    isFacebookUrl: (url) => url.includes("facebook.com"),
  });
  vm.runInContext(
    await backgroundFunction(
      "getActiveTabForLoadingGroups",
      "async function getActiveTabForPosting",
    ),
    context,
  );

  const tab = await context.getActiveTabForLoadingGroups();
  assert.equal(tab.id, 42);
  assert.deepEqual(
    { ...queryOptions },
    { active: true, currentWindow: true },
  );
});

test("the joined-groups page navigates the existing tab", async () => {
  const calls = [];
  const context = vm.createContext({
    JOINED_GROUPS_URL: "https://web.facebook.com/groups/joins/",
    chrome: {
      tabs: {
        update: async (tabId, properties) => {
          calls.push(["update", tabId, properties]);
        },
      },
    },
    waitForJoinedGroupsPage: async (tabId) => calls.push(["loaded", tabId]),
    waitForPageDomReady: async (tabId, path) =>
      calls.push(["ready", tabId, path]),
  });
  vm.runInContext(
    await backgroundFunction(
      "navigateToJoinedGroups",
      "async function waitForJoinedGroupsPage",
    ),
    context,
  );

  await context.navigateToJoinedGroups(42);
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], "update");
  assert.equal(calls[0][1], 42);
  assert.equal(calls[0][2].url, "https://web.facebook.com/groups/joins/");
  assert.equal(calls[1][0], "loaded");
  assert.equal(calls[1][1], 42);
  assert.equal(calls[2][0], "ready");
  assert.equal(calls[2][1], 42);
  assert.equal(calls[2][2], "/groups/joins/");
});

test("a logged-out Facebook redirect ends the joined-page wait with guidance", async () => {
  const context = vm.createContext({
    URL,
    chrome: {
      tabs: {
        get: async () => ({
          status: "complete",
          url: "https://www.facebook.com/login/",
        }),
      },
    },
    isFacebookUrl: (url) => url.includes("facebook.com"),
  });
  vm.runInContext(
    await backgroundFunction(
      "waitForJoinedGroupsPage",
      "async function waitForPageDomReady",
    ),
    context,
  );

  await assert.rejects(
    context.waitForJoinedGroupsPage(42),
    /Check that you are signed in to Facebook/,
  );
});

test("a non-login Facebook redirect keeps waiting for the groups route", async () => {
  let reads = 0;
  const context = vm.createContext({
    URL,
    chrome: {
      tabs: {
        get: async () => ({
          status: "complete",
          url:
            reads++ === 0
              ? "https://www.facebook.com/"
              : "https://www.facebook.com/groups/joins/",
        }),
      },
    },
    isFacebookUrl: (url) => url.includes("facebook.com"),
    sleep: async () => {},
  });
  vm.runInContext(
    await backgroundFunction(
      "waitForJoinedGroupsPage",
      "async function waitForPageDomReady",
    ),
    context,
  );

  await context.waitForJoinedGroupsPage(42);
  assert.equal(reads, 2);
});

test("closing the tab ends a request wait with the actual tab error", async () => {
  const context = vm.createContext({ capturedGroupsRequest: undefined, chrome: { tabs: { get: async () => { throw new Error("No tab with id: 1"); } } } });
  vm.runInContext(await backgroundFunction("waitForCapturedGroupsRequest", "function updateFetchGroupsConfigFromCapturedRequest"), context);
  await assert.rejects(context.waitForCapturedGroupsRequest(1), /No tab with id/);
});

function sortFixture(label, { late = true, ambiguous = false } = {}) {
  let now = 0;
  let menuOpen = false;
  let selected = false;
  let disconnected = false;
  let clicks = 0;
  const visible = { getBoundingClientRect: () => ({ width: 10, height: 10 }), closest: () => null };
  const checked = { ...visible, getAttribute: () => "true", dispatchEvent: () => { throw new Error("Must change ordering"); } };
  const unchecked = { ...visible, getAttribute: () => "false", dispatchEvent: (event) => { if (event.type === "click") selected = true; } };
  const preexisting = { ...unchecked, dispatchEvent: () => { throw new Error("Must not click another menu's option"); } };
  const trigger = {
    ...visible, textContent: label, isConnected: true,
    getAttribute: (name) => name === "aria-expanded" ? String(menuOpen) : null,
    querySelector: (selector) => {
      if (selector.startsWith("svg,")) return null;
      if (selector.includes("x6prxxf")) return null;
      return selector === ":scope > span" ? { textContent: label } : {};
    },
    dispatchEvent: (event) => { if (event.type === "click") { menuOpen = true; clicks++; } },
  };
  const iconMenu = { ...trigger, querySelector: (selector) => selector.startsWith("svg,") ? {} : null, dispatchEvent: () => { throw new Error("Must not click an icon menu"); } };
  const context = vm.createContext({
    window: { getComputedStyle: () => ({ display: "block", visibility: "visible" }) },
    document: { readyState: "complete", body: {}, querySelector: () => null, querySelectorAll: (selector) => {
      if (selector.includes("aria-busy")) return [];
      if (selector.includes("menuitemradio")) return [preexisting, ...(menuOpen && (!late || now >= 65_000) ? [checked, unchecked] : [])];
      if (late && now < 60_000) return [];
      return [iconMenu, trigger, ...(ambiguous ? [{ ...trigger }] : [])];
    } },
    Date: { now: () => now },
    setTimeout: (resolve, duration) => { now += duration; if (ambiguous && now > 10_000) throw new Error("Test ended without guessing"); resolve(); },
    MouseEvent: class { constructor(type) { this.type = type; } },
    MutationObserver: class { observe() {} disconnect() { disconnected = true; } },
  });
  return { context, state: () => ({ now, selected, disconnected, clicks }) };
}

const sortCode = await backgroundFunction("triggerJoinedGroupsSortRequestInPage", "async function waitForCapturedGroupsRequest");

test("sort waits for late controls and options, clicks once, and ignores preexisting radio menus", async () => {
  const fixture = sortFixture("Trier");
  vm.runInContext(sortCode, fixture.context);
  const result = await fixture.context.triggerJoinedGroupsSortRequestInPage();
  assert.equal(result.ok, true);
  const state = fixture.state();
  assert.equal(state.selected, true);
  assert.ok(state.now >= 65_000);
  assert.equal(state.disconnected, true);
  assert.equal(state.clicks, 1);
});

test("sort trigger and radio options work with translated labels", async () => {
  for (const label of ["Sort", "Trier", "Ordenar", "並べ替え", "ترتيب"]) {
    const fixture = sortFixture(label, { late: false });
    vm.runInContext(sortCode, fixture.context);
    assert.equal((await fixture.context.triggerJoinedGroupsSortRequestInPage()).ok, true);
    assert.equal(fixture.state().selected, true);
  }
});

test("ambiguous sort triggers are not guessed", async () => {
  const fixture = sortFixture("Trier", { late: false, ambiguous: true });
  vm.runInContext(sortCode, fixture.context);
  await fixture.context.triggerJoinedGroupsSortRequestInPage();
  assert.equal(fixture.state().clicks, 0);
  assert.equal(fixture.state().disconnected, true);
});
