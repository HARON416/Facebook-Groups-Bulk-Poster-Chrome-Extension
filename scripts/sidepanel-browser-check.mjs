// Run after npm run build. Uses a disposable Chrome profile and mocked extension
// APIs; it never loads Facebook or sends a posting request.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "postika-browser-check-"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const image =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#0056b3"/><text x="30" y="150" fill="white" font-size="32">Sample photo</text></svg>',
  ).toString("base64");
const groups = [
  "Nairobi Business Community",
  "Local Creators",
  "Neighbourhood Market",
].map((name, index) => ({
  id: String(index + 1),
  name,
  url: `https://www.facebook.com/groups/${index + 1}`,
}));
const seed = {
  sidePanelSession: {
    postBodyHtml:
      "<p>Handmade products available this week. Message us for details.</p>",
    loadedGroups: groups,
    selectedGroupIds: ["1", "2"],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 300,
    intervalSettingsVersion: 2,
  },
  sidePanelDraftImages: ["first.svg", "second.svg"].map((name) => ({
    name,
    type: "image/svg+xml",
    dataUrl: image,
  })),
};
const stub = `
localStorage.clear();
window.__stored = ${JSON.stringify(seed)};
window.__writes = [];
window.__failWrites = false;
window.chrome = {
  storage: { local: {
    get: async () => structuredClone(window.__stored),
    set: async values => {
      if (window.__failWrites) throw new Error('Storage quota exceeded');
      window.__writes.push(structuredClone(values));
      Object.assign(window.__stored, structuredClone(values));
    },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete window.__stored[key]; }
  } },
  runtime: {
    connect() { throw new Error('Posting is forbidden in this browser check'); },
    onMessage: { addListener(listener) { window.__receiveStatus = listener; } },
    sendMessage: async request => {
      if (request.type.startsWith('START_')) throw new Error('Posting is forbidden in this browser check');
      if (request.type === 'GET_POSTING_QUEUE_STATUS') return { groups: window.__queueStatus };
      return request.type === 'LOAD_GROUPS' ? { ok: true, groups: ${JSON.stringify(groups)} } : { ok: true };
    }
  }
};`;
let html = await readFile(join(root, "public/sidepanel.html"), "utf8");
html = html.replace(
  "<head>",
  `<head><base href="${pathToFileURL(join(root, "public/")).href}"><script>${stub}</script>`,
);
const fixture = join(temporary, "sidepanel.html");
await writeFile(fixture, html);

const chrome = spawn(
  process.env.CHROME_BIN || "google-chrome",
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--user-data-dir=${join(temporary, "profile")}`,
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
let checkCount = 0;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Chrome did not expose DevTools")),
      15000,
    );
    let stderr = "";
    chrome.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    chrome.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    chrome.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited ${code}: ${stderr.slice(0, 1000)}`));
    });
  });
  const browserUrl = new URL(endpoint);
  const tabs = await (await fetch(`http://${browserUrl.host}/json`)).json();
  ws = new WebSocket(
    tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers.reject(message.error);
      else handlers.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      );
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const callId = ++id;
      pending.set(callId, { resolve, reject });
      ws.send(JSON.stringify({ id: callId, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const check = async (expression, label) => {
    assert.equal(await evaluate(expression), true, label);
    checkCount++;
    console.log(`PASS ${label}`);
  };
  const key = async (key, code, modifiers = 0) => {
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: key,
      windowsVirtualKeyCode: code,
      modifiers,
    });
    await call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: code,
      modifiers,
    });
  };
  const screenshot = async (name) => {
    const result = await call("Page.captureScreenshot");
    const path = `/tmp/postika-fixed-${name}.png`;
    await writeFile(path, Buffer.from(result.data, "base64"));
    console.log(`Screenshot ${path}`);
  };
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setFocusEmulationEnabled", { enabled: true });
  await call("Emulation.setDeviceMetricsOverride", {
    width: 380,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url: pathToFileURL(fixture).href });
  await waitFor(
    `document.querySelector('#draft-save-feedback')?.dataset.state === 'saved' && document.querySelectorAll('.photo-preview').length === 2`,
  );
  await check(
    `document.querySelector('#photo-lightbox').open === false && getComputedStyle(document.querySelector('#photo-lightbox')).display === 'none'`,
    "native dialog starts closed",
  );
  await evaluate(`document.querySelector('[data-posting-step="3"]').click()`);
  await check(
    `document.querySelectorAll('#review-images button').length === 2 && document.querySelector('#review-images button').getAttribute('aria-label').includes('first.svg')`,
    "review displays ordered, labeled photo previews",
  );
  await evaluate(`document.querySelector('#review-images button').click()`);
  await check(
    `document.querySelector('#photo-lightbox').matches(':modal') && document.activeElement.id === 'photo-lightbox-close'`,
    "photo preview uses native modal focus",
  );
  await evaluate(`document.querySelector('#app-menu-trigger').focus()`);
  await check(
    `document.querySelector('#photo-lightbox').contains(document.activeElement)`,
    "modal makes background controls unfocusable",
  );
  await evaluate(
    `document.querySelector('#photo-lightbox-thumbnails button:last-child').focus()`,
  );
  for (let n = 0; n < 4; n++) {
    await key("Tab", 9);
    await check(
      `!['app-menu-trigger','language-trigger'].includes(document.activeElement.id) && (document.activeElement === document.body || document.querySelector('#photo-lightbox').contains(document.activeElement))`,
      `Tab ${n + 1} stays out of background controls`,
    );
  }
  await key("Escape", 27);
  await waitFor(
    `!document.querySelector('#photo-lightbox').open && !document.querySelector('#photo-lightbox-image').hasAttribute('src')`,
  );
  await check(
    `document.activeElement === document.querySelector('#review-images button') && !document.querySelector('#photo-lightbox-image').hasAttribute('src')`,
    "Escape restores invoker focus and releases preview resources",
  );
  await evaluate(
    `document.querySelector('[data-posting-step="2"]').click();document.querySelector('#groups-list input[value="3"]').focus()`,
  );
  await key(" ", 32);
  await check(
    `document.activeElement.matches('#groups-list input[value="3"]') && document.activeElement.checked`,
    "selecting a group preserves checkbox focus",
  );
  await key(" ", 32);
  await check(
    `document.activeElement.matches('#groups-list input[value="3"]') && !document.activeElement.checked`,
    "deselecting a reordered group preserves focus",
  );
  await evaluate(
    `document.querySelector('[data-posting-step="3"]').click();var input=document.querySelector('#post-interval-min-input');input.value='30';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))`,
  );
  await check(
    `document.querySelector('#post-interval-min-input').value === '30' && document.querySelector('#post-interval-min-input').getAttribute('aria-invalid') === 'true' && !document.querySelector('#post-interval-min-error').hidden && document.querySelector('#start-posting-btn').disabled`,
    "invalid wait remains visible with an inline error and posting disabled",
  );
  await evaluate(
    `document.querySelector('#post-interval-min-input').value='400';document.querySelector('#post-interval-min-input').dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await check(
    `document.querySelector('#post-interval-max-input').getAttribute('aria-invalid') === 'true'`,
    "wait range ordering is validated",
  );
  await evaluate(
    `document.querySelector('#post-interval-min-input').value='60';document.querySelector('#post-interval-min-input').dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await check(
    `!document.querySelector('#start-posting-btn').disabled && document.querySelector('#post-interval-summary').textContent.includes('1 minute') && document.querySelector('#post-interval-summary').textContent.includes('5 minutes')`,
    "correcting waits enables posting and shows readable units",
  );
  await evaluate(
    `document.querySelector('#open-schedule-btn').click();var input=document.querySelector('[data-focus-key="hour-input"]');input.focus();input.value='99';input.dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await check(
    `document.querySelector('[data-focus-key="hour-input"]').value === '99' && document.querySelector('[data-focus-key="hour-input"]').getAttribute('aria-invalid') === 'true' && !document.querySelector('#schedule-hour-error').hidden && document.querySelector('#confirm-schedule-btn').disabled`,
    "invalid schedule time remains editable and blocks confirmation",
  );
  await screenshot("validation");
  await evaluate(
    `var input=document.querySelector('[data-focus-key="hour-input"]');input.value='٢٣';input.dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await check(
    `document.querySelector('[data-focus-key="hour-input"]').getAttribute('aria-invalid') === 'false' && !document.querySelector('#confirm-schedule-btn').disabled`,
    "Arabic digits are accepted without resetting the input",
  );
  await evaluate(
    `document.querySelector('#cancel-schedule-btn').click();window.__failWrites=true;document.querySelector('[data-posting-step="2"]').click();document.querySelector('#groups-list input[value="3"]').click()`,
  );
  await waitFor(
    `document.querySelector('#draft-save-feedback').dataset.state === 'error'`,
  );
  await check(
    `!document.querySelector('#retry-draft-save').hidden && !window.__stored.sidePanelSession.selectedGroupIds.includes('3')`,
    "storage failures leave the previous draft and show persistent Retry",
  );
  await evaluate(
    `window.__failWrites=false;document.querySelector('#retry-draft-save').click()`,
  );
  await waitFor(
    `document.querySelector('#draft-save-feedback').dataset.state === 'saved'`,
  );
  await check(
    `window.__stored.sidePanelSession.selectedGroupIds.includes('3')`,
    "Retry saves current changes",
  );
  await evaluate(
    `document.querySelector('[data-posting-step="1"]').click();window.__originalReader=window.FileReader;window.FileReader=class extends window.__originalReader { readAsDataURL(){ queueMicrotask(()=>this.dispatchEvent(new ProgressEvent('error'))) } };document.querySelectorAll('.photo-preview__remove')[1].click()`,
  );
  await waitFor(
    `document.querySelector('#draft-save-feedback').dataset.state === 'error'`,
  );
  await check(
    `window.__stored.sidePanelDraftImages.length === 2`,
    "failed image conversion retains the previous saved images",
  );
  await evaluate(
    `window.FileReader=window.__originalReader;document.querySelector('#retry-draft-save').click()`,
  );
  await waitFor(
    `document.querySelector('#draft-save-feedback').dataset.state === 'saved'`,
  );
  await check(
    `window.__stored.sidePanelDraftImages.length === 1 && window.__writes.at(-1).sidePanelDraftImages.length === 1 && !!window.__writes.at(-1).sidePanelSession`,
    "image Retry writes the complete replacement together",
  );
  await evaluate(`document.querySelector('[data-posting-step="3"]').click()`);
  await screenshot("review");
  for (const locale of ["es", "ro", "vi", "ar"]) {
    await evaluate(
      `document.querySelector('#language-trigger').click();document.querySelector('[data-locale="${locale}"]').click()`,
    );
    await waitFor(`document.documentElement.lang === '${locale}'`);
    await check(
      `!document.querySelector('#draft-save-status').textContent.includes('Draft saved') && document.querySelectorAll('#review-images button').length === 1`,
      `${locale} translations preserve photo previews and localize new status`,
    );
    if (locale === "ro" || locale === "vi") {
      const expectedPost = locale === "ro" ? "Publică acum" : "Đăng ngay";
      const expectedPosted = locale === "ro" ? "publicate" : "đã đăng";
      await check(
        `document.documentElement.dir === 'ltr' && document.querySelector('#start-posting-btn').textContent === ${JSON.stringify(expectedPost)} && localStorage.getItem('postika:language') === '${locale}'`,
        `${locale} selection applies and saves the complete locale`,
      );
      await check(
        `document.querySelector('#posting-progress-filter-posted').textContent.includes(${JSON.stringify(expectedPosted)}) && !document.querySelector('#compose-next-guidance').textContent.includes('Add post')`,
        `${locale} short status labels and compose hints are translated`,
      );
      await screenshot(`${locale}-review`);
    }
    await evaluate(
      `document.querySelector('#open-schedule-btn').click();var input=document.querySelector('[data-focus-key="minute-input"]');input.value='99';input.dispatchEvent(new Event('input',{bubbles:true}))`,
    );
    await check(
      `!document.querySelector('#schedule-minute-error').textContent.includes('Enter minutes')`,
      `${locale} validation messages are translated`,
    );
    await evaluate(`document.querySelector('#cancel-schedule-btn').click()`);
  }
  await evaluate(`document.documentElement.dataset.theme='dark'`);
  await call("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await check(
    `document.documentElement.scrollWidth === innerWidth`,
    "320px Arabic dark layout has no horizontal overflow",
  );
  await screenshot("arabic-dark");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 200,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await check(
    `document.documentElement.scrollWidth === innerWidth`,
    "200px layout reflows without horizontal page overflow",
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 380,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(`document.documentElement.style.fontSize='125%'`);
  await check(
    `['#app-menu-trigger','#language-trigger','#start-posting-btn','#open-schedule-btn'].every(selector=>{var r=document.querySelector(selector).getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})`,
    "essential controls remain within the panel at twice the text size",
  );
  await screenshot("large-text");
  await evaluate(`document.documentElement.style.removeProperty('font-size')`);
  await evaluate(`window.dispatchEvent(new Event('postika:locale-error'))`);
  await delay(8500);
  await check(
    `!!document.querySelector('.toast-card--error:not(.toast-card--closing)')`,
    "unresolved error notifications remain beyond eight seconds",
  );
  const warningFixture = join(temporary, "warning.html");
  const terminalStatus = {
    type: "UI_POSTING_STATUS",
    status: "rate_limited",
    message:
      "Facebook temporarily blocked posting on this account. Queue stopped. Try again later.",
    error: "Test restriction: posting is temporarily blocked.",
    responseBody: '{"error":"test restriction"}',
    current: 2,
    total: 3,
    groupId: "2",
    groupName: "Local Creators",
    successCount: 1,
    failedCount: 1,
    processedCount: 2,
  };
  await evaluate(
    `document.documentElement.dataset.theme='light';document.querySelector('#language-trigger').click();document.querySelector('[data-locale="en"]').click()`,
  );
  await waitFor(`document.documentElement.lang === 'en'`);
  await evaluate(
    `window.__receiveStatus({type:'UI_POSTING_STATUS',status:'posting',message:'Posting to group.',current:1,total:3});window.__receiveStatus({type:'UI_POSTING_STATUS',status:'posted',message:'First group posted.',current:1,total:3,groupId:'1',successCount:1});document.querySelector('#posting-progress-filter-posted').click();window.__receiveStatus(${JSON.stringify(terminalStatus)})`,
  );
  await check(
    `document.querySelector('#posting-step-3').classList.contains('posting-step--posting') && !document.querySelector('#posting-progress').hidden && !document.querySelector('#close-posting-activity').hidden`,
    "stopped queues retain the full activity view",
  );
  await check(
    `document.querySelector('#posting-progress-current').textContent.includes('Test restriction') && !document.querySelector('#posting-progress-log [data-status="rate_limited"]').hidden && !!document.querySelector('#posting-progress-log .posting-progress__copy-response')`,
    "stop reason and response remain available even under a result filter",
  );
  await screenshot("stopped-log");
  await evaluate(`document.querySelector('#close-posting-activity').click()`);
  await check(
    `document.querySelector('#posting-progress').hidden && !document.querySelector('#view-posting-activity').hidden && document.querySelectorAll('#posting-progress-log li').length === 3`,
    "returning to review retains the session log",
  );
  await evaluate(`document.querySelector('#view-posting-activity').click()`);
  await check(
    `!document.querySelector('#posting-progress').hidden && document.querySelector('#posting-progress-log').textContent.includes('First group posted.')`,
    "retained activity can be reopened",
  );
  await evaluate(
    `document.querySelector('#close-posting-activity').click();document.querySelector('[data-posting-step="1"]').click();document.querySelector('#view-posting-activity').click()`,
  );
  await check(
    `!document.querySelector('#posting-progress').hidden`,
    "retained activity remains reachable from the create step",
  );
  await evaluate(`document.querySelector('#close-posting-activity').click()`);
  await check(
    `!document.querySelector('#posting-step-1').hidden`,
    "leaving activity returns to the previous workflow step",
  );
  await evaluate(
    `document.querySelector('[data-posting-step="3"]').click();document.querySelector('#view-posting-activity').click()`,
  );
  await evaluate(
    `window.__receiveStatus({type:'UI_POSTING_STATUS',status:'done',message:'Posting finished.',current:3,total:3,successCount:2,failedCount:1});document.querySelector('#close-posting-activity').click();document.querySelector('#start-posting-btn').click()`,
  );
  await waitFor(
    `document.querySelector('#posting-progress-current').textContent.includes('Posting is forbidden')`,
  );
  await check(
    `document.querySelectorAll('#posting-progress-log li').length === 1 && document.querySelector('#posting-progress-log li').dataset.status === 'stopped'`,
    "a new queue resets old logs and retains startup failures",
  );
  const reopenedFixture = join(temporary, "reopened.html");
  await writeFile(
    reopenedFixture,
    html.replace(
      "window.__failWrites = false;",
      `window.__failWrites = false;window.__queueStatus=${JSON.stringify(terminalStatus)};`,
    ),
  );
  await call("Page.navigate", { url: pathToFileURL(reopenedFixture).href });
  await waitFor(
    `document.querySelector('#draft-save-feedback')?.dataset.state === 'saved'`,
  );
  await check(
    `document.querySelector('#posting-progress').hidden && document.querySelectorAll('#posting-progress-log li').length === 0`,
    "closing and reopening does not restore a finished queue's activity",
  );
  const activeFixture = join(temporary, "active.html");
  await writeFile(
    activeFixture,
    html.replace(
      "window.__failWrites = false;",
      `window.__failWrites = false;window.__queueStatus=${JSON.stringify({ ...terminalStatus, status: "posting", message: "Queue still running.", error: undefined, responseBody: undefined })};`,
    ),
  );
  await call("Page.navigate", { url: pathToFileURL(activeFixture).href });
  await waitFor(
    `document.querySelector('#posting-step-3')?.classList.contains('posting-step--posting')`,
  );
  await check(
    `!document.querySelector('#posting-progress').hidden && !document.querySelector('#stop-posting-btn').hidden && document.querySelector('#close-posting-activity').hidden`,
    "reopening while a queue runs restores its activity and stop control",
  );
  await writeFile(
    warningFixture,
    html.replace(
      "localStorage.clear();",
      `localStorage.clear();var originalGet=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='postika:theme')throw new Error('Test preference read failure');return originalGet.call(this,key)};`,
    ),
  );
  await call("Page.navigate", { url: pathToFileURL(warningFixture).href });
  await call("Emulation.setFocusEmulationEnabled", { enabled: true });
  await waitFor(
    `!!document.querySelector('.toast-card--warning') && document.querySelector('#draft-save-feedback').dataset.state === 'saved'`,
  );
  await delay(100);
  await evaluate(
    `document.querySelector('.toast-card--warning button').focus()`,
  );
  await check(
    `document.activeElement === document.querySelector('.toast-card--warning button')`,
    "notification has keyboard focus before testing its timer",
  );
  await check(
    `document.hasFocus()`,
    "notification timing is tested in a focused browser page",
  );
  await delay(5300);
  await check(
    `!!document.querySelector('.toast-card--warning:not(.toast-card--closing)')`,
    "transient notifications pause while keyboard focus is inside",
  );
  const toastBounds = await evaluate(
    `document.querySelector('.toast-card--warning').getBoundingClientRect().toJSON()`,
  );
  await call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: toastBounds.x + 20,
    y: toastBounds.y + 20,
  });
  await evaluate(`document.querySelector('#app-menu-trigger').focus()`);
  await delay(5300);
  await check(
    `!!document.querySelector('.toast-card--warning:not(.toast-card--closing)')`,
    "transient notifications pause while hovered",
  );
  await call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 370,
    y: 840,
  });
  await delay(5300);
  await check(
    `!document.querySelector('.toast-card--warning')`,
    "transient notification expiry resumes after leaving",
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const [locale, browserLocale, query] of [
    ["ro", "ro-RO", "romana"],
    ["vi", "vi-VN", "tieng viet"],
  ]) {
    const localizedFixture = join(temporary, `locale-${locale}.html`);
    const browserOverride = `Object.defineProperty(navigator,'languages',{get:()=>['${browserLocale}','en-US']});`;
    const localizedHtml = html.replace(
      "localStorage.clear();",
      `localStorage.clear();${browserOverride}`,
    );
    await writeFile(localizedFixture, localizedHtml);
    await call("Page.navigate", { url: pathToFileURL(localizedFixture).href });
    await waitFor(
      `document.documentElement.lang === '${locale}' && document.querySelector('#draft-save-feedback')?.dataset.state === 'saved'`,
    );
    await check(
      `document.documentElement.dir === 'ltr' && document.querySelectorAll('.language-option').length === 5`,
      `${browserLocale} selects ${locale} automatically on first launch`,
    );
    await check(
      `document.documentElement.scrollWidth === innerWidth && document.querySelector('.rich-text-toolbar').scrollWidth <= document.querySelector('.rich-text-toolbar').clientWidth`,
      `${locale} compose layout fits the narrow side panel`,
    );
    await screenshot(`${locale}-create`);
    for (const search of [query, locale === "ro" ? "Romanian" : "Vietnamese"]) {
      await evaluate(
        `document.querySelector('#language-trigger').click();var search=document.querySelector('#language-search');search.value=${JSON.stringify(search)};search.dispatchEvent(new Event('input',{bubbles:true}))`,
      );
      await check(
        `document.querySelectorAll('.language-option').length === 1 && document.querySelector('.language-option').dataset.locale === '${locale}'`,
        `${locale} is searchable by ${search}`,
      );
      await key("Escape", 27);
    }
    const otherLocale = locale === "ro" ? "vi" : "ro";
    await evaluate(
      `document.querySelector('#language-trigger').click();document.querySelector('[data-locale="${otherLocale}"]').click()`,
    );
    await waitFor(
      `localStorage.getItem('postika:language') === '${otherLocale}'`,
    );
    await writeFile(
      localizedFixture,
      localizedHtml.replace("localStorage.clear();", ""),
    );
    const previousTimeOrigin = await evaluate("performance.timeOrigin");
    await call("Page.reload");
    await waitFor(
      `performance.timeOrigin !== ${previousTimeOrigin} && document.documentElement.lang === '${otherLocale}' && document.querySelector('#draft-save-feedback')?.dataset.state === 'saved'`,
    );
    await check(
      `document.querySelector('#language-name').textContent === ${JSON.stringify(otherLocale === "ro" ? "Română" : "Tiếng Việt")}`,
      `saved ${otherLocale} choice overrides ${browserLocale} after reopening`,
    );
  }
  assert.deepEqual(exceptions, [], "no uncaught browser exceptions");
  console.log(
    `${checkCount} browser checks passed; Facebook posting was not exercised.`,
  );
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    delay(3000),
  ]);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
