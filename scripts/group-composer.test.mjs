import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";

const source = await readFile(new URL("../src/group-composer.ts", import.meta.url), "utf8");
const code = (await transform(source, { loader: "ts", format: "cjs" })).code;
const context = vm.createContext({
  module: { exports: {} },
  getComputedStyle: (element) => ({ display: element.hidden ? "none" : "block", visibility: "visible" }),
});
vm.runInContext(code, context);
const { findGroupComposerButton, findGroupComposerDialog, findGroupComposerEditor, findGroupComposerMediaInput, findGroupComposerMediaButton, findGroupComposerPostButton } = context.module.exports;

function visibleElement(overrides = {}) {
  return {
    isConnected: true,
    hidden: false,
    getBoundingClientRect() { return { width: this.hidden ? 0 : 200, height: 40 }; },
    closest: () => null,
    querySelector: () => null,
    getAttribute: () => null,
    ...overrides,
  };
}

function composer(text, { clamped = true, originalClasses = true, inArticle = false, overlay = true, icon = false } = {}) {
  const label = { textContent: text, style: { webkitLineClamp: clamped ? "2" : "" }, matches: () => originalClasses };
  const button = visibleElement({
    textContent: text,
    closest: (selector) => inArticle && selector.startsWith("article,") ? {} : null,
    querySelector: (selector) => selector.startsWith("svg,") ? (icon ? {} : null) : overlay ? { parentElement: button } : null,
    querySelectorAll: () => [label],
  });
  return button;
}

const page = (buttons, dialogs = []) => ({
  querySelector: () => ({ querySelectorAll: () => buttons }),
  querySelectorAll: () => dialogs,
});

test("composer recognition accepts translated labels with the supplied button structure", () => {
  for (const text of ["Write something...", "Escribe algo...", "Écrivez quelque chose…", "اكتب شيئًا...", "andika kitu...", "何か書いてください…"]) {
    const button = composer(text);
    assert.equal(findGroupComposerButton(page([button])), button);
  }
});

test("a clamped label still works when Facebook changes its generated classes", () => {
  const button = composer("Escribe algo...", { originalClasses: false });
  assert.equal(findGroupComposerButton(page([button])), button);
});

test("generated label classes remain a fallback when the clamp is absent", () => {
  const button = composer("andika kitu...", { clamped: false });
  assert.equal(findGroupComposerButton(page([button])), button);
});

test("hidden, disabled, unrelated and existing-post buttons are excluded", () => {
  const hidden = composer("Write something..."); hidden.hidden = true;
  const disabled = composer("Escribe algo..."); disabled.getAttribute = () => "true";
  const valid = composer("andika kitu...");
  const unrelated = [hidden, disabled, composer("Comment", { inArticle: true }), composer("More", { overlay: false }), composer("Photos", { icon: true })];
  assert.equal(findGroupComposerButton(page([...unrelated, valid])), valid);
  assert.equal(findGroupComposerButton(page(unrelated)), null);
});

test("ambiguous composer candidates are not guessed", () => {
  assert.equal(findGroupComposerButton(page([composer("one"), composer("two") ])), null);
});

test("dialog and editor selection use roles and visibility without translated placeholders", () => {
  const hiddenEditor = visibleElement({ hidden: true });
  const editor = visibleElement();
  const dialog = visibleElement({ querySelectorAll: () => [hiddenEditor, editor] });
  const otherDialog = visibleElement({ querySelectorAll: () => [] });
  assert.equal(findGroupComposerEditor(dialog), editor);
  assert.equal(findGroupComposerDialog(page([], [otherDialog, dialog])), dialog);
  dialog.hidden = true;
  assert.equal(findGroupComposerDialog(page([], [dialog])), null);
});

test("the background preserves composer diagnostics when a later posting step fails", async () => {
  const background = await readFile(new URL("../src/background.ts", import.meta.url), "utf8");
  const start = background.indexOf("async function createPostInTab(");
  const end = background.indexOf("\nasync function injectPostingContentScript", start);
  const code = (await transform(background.slice(start, end), { loader: "ts", format: "cjs" })).code;
  const response = { ok: false, composerFound: true, composerClicked: true, spanCount: 1, error: "Could not find Post button." };
  const context = vm.createContext({
    injectPostingContentScript: async () => {},
    chrome: { tabs: { sendMessage: async () => response } },
  });
  vm.runInContext(code, context);
  assert.equal(await context.createPostInTab(1, [], "Test"), response);
});

function dialogControls() {
  const post = visibleElement({
    textContent: "Publicar",
    getAttribute: () => "true", // Disabled while Facebook prepares the post.
    getBoundingClientRect: () => ({ width: 468, height: 36 }),
    querySelector: (selector) => selector === "span" || selector.startsWith('[role="none"]') ? {} : null,
  });
  const mediaButton = visibleElement();
  const input = { isConnected: true, disabled: false, accept: "image/*,image/heif,video/*", parentElement: null };
  const buttons = [mediaButton, post];
  const inputs = [input];
  const form = {
    method: "post",
    getBoundingClientRect: () => ({ width: 500, height: 500 }),
    querySelector: () => ({}),
    querySelectorAll: (selector) => selector.startsWith("input") ? inputs : buttons,
  };
  input.parentElement = { parentElement: form, querySelectorAll: () => [mediaButton] };
  const editor = visibleElement({ closest: (selector) => selector === "form" ? form : null });
  const dialog = visibleElement({ contains: (element) => element === form, querySelectorAll: () => [editor] });
  return { dialog, post, mediaButton, input, form, buttons, inputs };
}

test("media selection uses image accept types and the input's own toolbar wrapper", () => {
  const { dialog, input, mediaButton, inputs } = dialogControls();
  inputs.unshift({ ...input, accept: "application/pdf" });
  assert.equal(findGroupComposerMediaInput(dialog), input);
  assert.equal(findGroupComposerMediaButton(dialog), mediaButton);
  input.disabled = true;
  assert.equal(findGroupComposerMediaInput(dialog), null);
});

test("ambiguous media inputs and toolbar wrappers are not guessed", () => {
  const { dialog, input, inputs } = dialogControls();
  inputs.push({ ...input });
  assert.equal(findGroupComposerMediaInput(dialog), null);
  inputs.pop();
  input.parentElement.querySelectorAll = () => [visibleElement(), visibleElement()];
  assert.equal(findGroupComposerMediaButton(dialog), null);
});

test("translated Post is recognized while disabled and must be the full-width final action", () => {
  const { dialog, post, buttons, form } = dialogControls();
  assert.equal(findGroupComposerPostButton(dialog), post);
  post.textContent = "نشر";
  assert.equal(findGroupComposerPostButton(dialog), post);
  buttons.push(visibleElement({ textContent: "More" }));
  assert.equal(findGroupComposerPostButton(dialog), null);
  buttons.pop();
  post.getBoundingClientRect = () => ({ width: 32, height: 32 });
  assert.equal(findGroupComposerPostButton(dialog), null);
  post.getBoundingClientRect = () => ({ width: 468, height: 36 });
  form.method = "get";
  assert.equal(findGroupComposerPostButton(dialog), null);
});
