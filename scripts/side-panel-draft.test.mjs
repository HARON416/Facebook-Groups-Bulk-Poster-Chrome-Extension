import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidepanelSource = await readFile(
  new URL("../src/sidepanel.ts", import.meta.url),
  "utf8",
);
const editorSource = await readFile(
  new URL("../src/rich-text-editor.ts", import.meta.url),
  "utf8",
);
const i18nSource = await readFile(
  new URL("../src/i18n.ts", import.meta.url),
  "utf8",
);

test("side panel restores its post body and selected groups", () => {
  assert.match(
    sidepanelSource,
    /postBodyHtml: postEditor\.getContent\(\)\.html/,
  );
  assert.match(
    sidepanelSource,
    /if \(typeof session\.postBodyHtml === "string"\)\s*\{\s*postEditor\.setContent\(session\.postBodyHtml\)/,
  );
  assert.match(
    sidepanelSource,
    /selectedGroupIds: Array\.from\(selectedGroupIds\)/,
  );
  assert.match(
    sidepanelSource,
    /session\.selectedGroupIds\.filter\([\s\S]*?typeof groupId === "string"/,
  );
  assert.match(editorSource, /setContent\(html: string\): void/);
  assert.match(editorSource, /\$generateNodesFromDOM\(editor, document\)/);
});

test("draft images are saved and restored through Chrome extension storage", () => {
  assert.match(
    sidepanelSource,
    /SIDE_PANEL_DRAFT_IMAGES_STORAGE_KEY = "sidePanelDraftImages"/,
  );
  assert.match(sidepanelSource, /SIDE_PANEL_DRAFT_IMAGES_STORAGE_KEY,\s*\]\);/);
  assert.match(
    sidepanelSource,
    /\[SIDE_PANEL_DRAFT_IMAGES_STORAGE_KEY\]: images/,
  );
  assert.match(
    sidepanelSource,
    /selectedImageFiles = await Promise\.all\([\s\S]*storedImages\.filter\(isRestorablePostImage\)\.map\(uiPostImageToFile\)/,
  );
  assert.match(sidepanelSource, /return new File\(\[blob\], image\.name/);
  assert.match(sidepanelSource, /fetch\(image\.dataUrl\)/);
  assert.match(sidepanelSource, /scheduleSaveSidePanelSession\(true\)/);
  assert.doesNotMatch(sidepanelSource, /loadDraftImages|saveDraftImages/);
});

test("loaded groups expose refresh without discarding the current selection", () => {
  assert.match(i18nSource, /refreshGroups: "Refresh groups"/);
  assert.match(
    sidepanelSource,
    /loadedGroups\.length > 0 \? "refreshGroups" : "findMyGroups"/,
  );
  assert.match(sidepanelSource, /const isRefresh = loadedGroups\.length > 0/);
  assert.match(
    sidepanelSource,
    /if \(!isRefresh\) \{\s*selectedGroupIds\.clear\(\)/,
  );
});
