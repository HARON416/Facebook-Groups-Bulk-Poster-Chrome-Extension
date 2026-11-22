import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { transform } from "esbuild";

test("long runs bound both activity DOM and retained responses", async () => {
  const source = await readFile(new URL("../src/sidepanel.ts", import.meta.url), "utf8");
  const start = source.indexOf("function appendPostingProgressLog(");
  const end = source.indexOf("function getPostingStatusLabel(", start);
  const constants = source.match(/const MAX_POSTING_(?:LOG_ENTRIES|RESPONSE_LENGTH) = [\d_]+;/g).join("\n");
  class Element {
    children = [];
    dataset = {};
    append(...children) { this.children.push(...children); }
    prepend(child) { child.parent = this; this.children.unshift(child); }
    replaceChildren(...children) { this.children = children; }
    querySelector() { return undefined; }
    get lastElementChild() { return this.children.at(-1); }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  }
  const log = new Element();
  const { code } = await transform(`
    ${constants}
    let postingLogMessages = [];
    ${source.slice(start, end)}
    globalThis.fixture = { append: appendPostingProgressLog, messages: () => postingLogMessages };
  `, { loader: "ts" });
  const context = vm.createContext({
    postingProgressLog: log,
    document: { createElement: () => new Element() },
    getPostingStatusLabel: status => status,
    displayPostingMessage: message => message.message,
    localizePostingText: text => text,
    localizeAppText: text => text,
    postingTimingLogMeta: () => "",
    createFacebookResponseCopyButton: response => ({ response }),
    shouldShowPostingLogEntry: () => true,
    groupsPostingLogFilter: "all",
  });
  vm.runInContext(code, context);
  for (let i = 0; i < 1500; i += 1) {
    context.fixture.append({ status: "failed", groupId: String(i), message: "Failed", responseBody: "x".repeat(20000) });
  }
  assert.equal(log.children.length, 300);
  const retained = context.fixture.messages();
  assert.equal(retained.length, 300);
  assert.equal(retained[0].groupId, "1499");
  assert.equal(retained.at(-1).groupId, "1200");
  assert.ok(retained.every(message => message.responseBody.length < 16500));
  assert.ok(log.children.every(item => item.children.at(-1).response.length < 16500));
});
