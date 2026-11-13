import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidepanelHtml = await readFile(
  new URL("../public/sidepanel.html", import.meta.url),
  "utf8",
);
const postingWizardSource = await readFile(
  new URL("../src/posting-wizard.ts", import.meta.url),
  "utf8",
);
const sidepanelSource = await readFile(
  new URL("../src/sidepanel.ts", import.meta.url),
  "utf8",
);
const i18nSource = await readFile(
  new URL("../src/i18n.ts", import.meta.url),
  "utf8",
);
const sidepanelStyles = await readFile(
  new URL("../public/styles/sidepanel.css", import.meta.url),
  "utf8",
);
const richTextEditorSource = await readFile(
  new URL("../src/rich-text-editor.ts", import.meta.url),
  "utf8",
);
const contentSource = await readFile(
  new URL("../src/content.ts", import.meta.url),
  "utf8",
);

test("post editor keeps primary formatting actions visible and discloses the rest", () => {
  const toolbarFormats = Array.from(
    sidepanelHtml.matchAll(/data-format="([^"]+)"/g),
    ([, format]) => format,
  );
  assert.deepEqual(toolbarFormats, [
    "bold",
    "italic",
    "h1",
    "h2",
    "unordered-list",
    "ordered-list",
    "quote",
  ]);
  const toolbarStart = sidepanelHtml.indexOf('class="rich-text-toolbar"');
  const toolbarEnd = sidepanelHtml.indexOf(
    '<div class="rich-text-surface">',
    toolbarStart,
  );
  const toolbar = sidepanelHtml.slice(toolbarStart, toolbarEnd);
  const moreStart = toolbar.indexOf(
    '<details class="rich-text-toolbar__more">',
  );
  const moreFormatting = toolbar.slice(moreStart);
  const primaryControls = toolbar.slice(0, moreStart);
  assert.deepEqual(
    Array.from(
      primaryControls.matchAll(/data-history="([^"]+)"/g),
      ([, action]) => action,
    ),
    ["undo", "redo"],
  );
  assert.deepEqual(
    Array.from(
      primaryControls.matchAll(/data-format="([^"]+)"/g),
      ([, format]) => format,
    ),
    ["bold", "italic"],
  );
  assert.match(
    moreFormatting,
    /<summary class="rich-text-toolbar__more-trigger">/,
  );
  assert.match(moreFormatting, /id="rich-text-more-label">More formatting</);
  assert.doesNotMatch(moreFormatting, /<details[^>]*\bopen\b/);
  assert.match(
    sidepanelStyles,
    /\.rich-text-toolbar__more:not\(\[open\]\) > \.rich-text-toolbar__more-options\s*\{\s*display:\s*none;/,
  );
  assert.doesNotMatch(
    sidepanelHtml,
    /data-format="block-style"|rich-text-style-picker/,
  );
  assert.match(
    sidepanelHtml,
    /data-format="h1"[\s\S]*?aria-label="Heading 1"[\s\S]*?aria-pressed="false"/,
  );
  assert.match(
    sidepanelHtml,
    /data-format="h2"[\s\S]*?aria-label="Heading 2"[\s\S]*?aria-pressed="false"/,
  );
  assert.equal(
    (sidepanelHtml.match(/<svg[\s\S]*?<\/svg>/g) ?? []).length >= 5,
    true,
    "all formatting buttons should use inline SVG icons",
  );
  assert.equal(
    (toolbar.match(/aria-pressed="false"/g) ?? []).length,
    7,
    "formatting buttons should expose toggle state to assistive technology",
  );
});

test("heading controls report and toggle the active heading level", () => {
  assert.match(
    richTextEditorSource,
    /h1: \$isHeadingNode\(topLevel\) && topLevel\.getTag\(\) === "h1"/,
  );
  assert.match(
    richTextEditorSource,
    /h2: \$isHeadingNode\(topLevel\) && topLevel\.getTag\(\) === "h2"/,
  );
  assert.match(
    richTextEditorSource,
    /isSameHeading\s*\?\s*\$createParagraphNode\(\)\s*:\s*\$createHeadingNode\(format\)/,
  );
  assert.doesNotMatch(richTextEditorSource, /block-style|stylePicker/);
});

test("collapsed block formatting starts after existing text", () => {
  assert.match(richTextEditorSource, /function getToolbarSelection\(\)/);
  assert.match(richTextEditorSource, /function insertParagraphAfter\(/);
  assert.match(
    richTextEditorSource,
    /selection\.isCollapsed\(\) && topLevel\?\.getTextContent\(\)/,
  );
  assert.match(
    richTextEditorSource,
    /selection = insertParagraphAfter\(topLevel\)/,
  );
});

test("post editor exposes accessible undo and redo controls", () => {
  assert.deepEqual(
    Array.from(
      sidepanelHtml.matchAll(/data-history="([^"]+)"/g),
      ([, action]) => action,
    ),
    ["undo", "redo"],
  );
  assert.match(
    sidepanelHtml,
    /data-history="undo"[\s\S]*?aria-label="Undo"[\s\S]*?aria-keyshortcuts="Control\+Z Meta\+Z"[\s\S]*?disabled/,
  );
  assert.match(
    sidepanelHtml,
    /data-history="redo"[\s\S]*?aria-label="Redo"[\s\S]*?aria-keyshortcuts="Control\+Shift\+Z Meta\+Shift\+Z Control\+Y"[\s\S]*?disabled/,
  );
  assert.match(
    richTextEditorSource,
    /registerHistory\(editor, historyState, 300/,
  );
  assert.match(richTextEditorSource, /dispatchCommand\(command, undefined\)/);
  assert.match(richTextEditorSource, /CAN_UNDO_COMMAND/);
  assert.match(richTextEditorSource, /CAN_REDO_COMMAND/);
  assert.match(i18nSource, /undo: "Undo"/);
  assert.match(i18nSource, /redo: "Redo"/);
});

test("post editor avoids repeated helper and empty-image messages", () => {
  assert.doesNotMatch(
    sidepanelHtml,
    /No images selected\.|Add your post text and at least one image to continue\.|Write your post and add the images you want to share\.|>Post text</,
  );
  assert.match(
    sidepanelHtml,
    /id="post-body-input"[\s\S]*?aria-label="Post text"/,
  );
  assert.match(
    sidepanelHtml,
    /id="image-preview-list" class="image-preview-list"><\/div>/,
  );
  assert.doesNotMatch(
    postingWizardSource,
    /compose-step-guidance|Add your post text and at least one image to continue/,
  );
});

test("review step shows the full formatted post and every selected group", () => {
  assert.match(sidepanelHtml, /id="review-post-summary"/);
  assert.match(sidepanelHtml, /id="review-image-count"/);
  assert.match(sidepanelHtml, /id="review-groups-summary"/);
  assert.match(sidepanelHtml, /id="review-groups-list"/);
  assert.match(sidepanelHtml, /aria-label="Complete post text"/);
  assert.match(
    sidepanelHtml,
    /aria-label="Selected groups"[\s\S]*?tabindex="0"/,
  );
  assert.doesNotMatch(
    sidepanelHtml,
    /review-post-body|review-post-images/,
    "legacy preview surfaces should not be reintroduced",
  );
  assert.doesNotMatch(postingWizardSource, /excerptLimit|postExcerpt/);
  assert.match(postingWizardSource, /#review-post-summary[\s\S]*?state\.html/);
  assert.match(postingWizardSource, /reviewGroups\.replaceChildren/);
  assert.match(postingWizardSource, /item\.textContent = group\.name/);
  assert.match(postingWizardSource, /state\.images\.length/);
  assert.match(postingWizardSource, /state\.groups\.length/);
});

test("disabled compose action explains the missing post content", () => {
  assert.match(
    sidepanelHtml,
    /id="compose-next-guidance"[\s\S]*?role="status"/,
  );
  assert.match(
    postingWizardSource,
    /composeGuidance\.hidden = state\.busy \|\| composed/,
  );
  assert.match(postingWizardSource, /messages\.addTextAndImage/);
  assert.match(postingWizardSource, /messages\.addText/);
  assert.match(postingWizardSource, /messages\.addImage/);
  assert.match(i18nSource, /addTextAndImageToContinue:/);
  assert.match(i18nSource, /addPostTextToContinue:/);
  assert.match(i18nSource, /addImageToContinue:/);
});

test("group step explains the Facebook prerequisite before discovery", () => {
  assert.match(
    sidepanelHtml,
    /id="groups-prerequisite" class="section-note"[\s\S]*?Sign in to Facebook in a Chrome tab[\s\S]*?Postika\s+opens your\s+joined-groups page/,
  );
  assert.match(i18nSource, /groupsPrerequisite:/);
  assert.match(
    i18nSource,
    /findGroupsHelp: "Select the groups where you want to post\."/,
  );
  assert.match(i18nSource, /noGroupsToShow: "Your groups will appear here\."/);
  assert.match(i18nSource, /\["#groups-prerequisite", "groupsPrerequisite"\]/);
});

test("parameterized translations pass values into the Wuchale runtime", () => {
  assert.match(
    i18nSource,
    /imageCount: \(count: number\) => `\$\{count\} images`/,
  );
  assert.match(i18nSource, /Reflect\.apply\(message, undefined, values\)/);
});

test("formatting controls reveal labels on hover and keyboard focus", () => {
  assert.match(
    sidepanelStyles,
    /\.rich-text-toolbar button\[aria-label\]:hover::after,[\s\S]*?\.rich-text-toolbar button\[aria-label\]:focus-visible::after/,
  );
  assert.match(sidepanelStyles, /content: attr\(aria-label\)/);
  assert.match(
    sidepanelStyles,
    /\.rich-text-toolbar button\s*\{[^}]*min-width:\s*4\.4rem;[^}]*min-height:\s*4\.4rem;/,
  );
  assert.match(
    sidepanelStyles,
    /\.rich-text-toolbar__more-trigger\s*\{[^}]*min-height:\s*4\.4rem;/,
  );
});

test("primary button text meets WCAG AA contrast in each theme", () => {
  const colors = Array.from(
    sidepanelStyles.matchAll(/--btn-primary-bg:\s*(#[\da-f]{6})/gi),
    ([, color]) => color,
  );
  assert.equal(
    colors.length,
    2,
    "light and dark themes should define a primary fill",
  );
  const luminance = (hex) => {
    const channels = hex
      .slice(1)
      .match(/../g)
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  for (const color of colors) {
    const contrast = 1.05 / (luminance(color) + 0.05);
    assert.ok(
      contrast >= 4.5,
      `${color} with white text has contrast ${contrast.toFixed(2)}:1`,
    );
  }
});

test("dark-mode activity and group search surfaces use readable theme tokens", () => {
  const darkTheme = sidepanelStyles.match(
    /html\[data-theme="dark"\]\s*\{([^}]+)\}/,
  )?.[1];
  assert.ok(darkTheme, "dark-theme tokens should be defined");

  const token = (name) =>
    darkTheme.match(new RegExp(`${name}:\\s*(#[\\da-f]{6})`, "i"))?.[1];
  const luminance = (hex) => {
    const channels = hex
      .slice(1)
      .match(/../g)
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (foreground, background) => {
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    );
  };

  const timingStart = token("--posting-timing-bg-start");
  const timingEnd = token("--posting-timing-bg-end");
  const primaryText = token("--text-primary");
  const secondaryText = token("--text-secondary");
  assert.ok(timingStart && timingEnd && primaryText && secondaryText);
  assert.ok(contrast(primaryText, timingStart) >= 4.5);
  assert.ok(contrast(primaryText, timingEnd) >= 4.5);
  assert.ok(contrast(secondaryText, timingStart) >= 4.5);
  assert.ok(contrast(secondaryText, timingEnd) >= 4.5);
  assert.match(
    sidepanelStyles,
    /\.posting-timing\s*\{[^}]*--posting-timing-bg-start|\.posting-timing\s*\{[\s\S]*?var\(--posting-timing-bg-start\)/,
  );
  assert.match(
    sidepanelStyles,
    /textarea,\s*\.number-input-row input,\s*#groups-search-input\s*\{[^}]*background:\s*var\(--input-bg\);[^}]*color:\s*var\(--text-primary\);/,
  );
});

test("posting progress exposes updates and values to assistive technology", () => {
  assert.match(
    sidepanelHtml,
    /class="posting-progress__bar"[\s\S]*?role="progressbar"[\s\S]*?aria-labelledby="posting-progress-title"[\s\S]*?aria-valuemin="0"[\s\S]*?aria-valuemax="100"[\s\S]*?aria-valuenow="0"/,
  );
  assert.match(
    sidepanelHtml,
    /id="posting-progress-current"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/,
  );
  assert.match(
    sidepanelSource,
    /postingProgressTrack\?\.setAttribute\("aria-valuenow", String\(percent\)\)/,
  );
  assert.match(
    sidepanelSource,
    /postingProgressTrack\?\.setAttribute\("aria-valuenow", "0"\)/,
  );
});

test("short panels keep menus scrollable instead of clipping their contents", () => {
  assert.match(
    sidepanelStyles,
    /\.app-menu\s*\{[^}]*max-height:\s*calc\(100dvh - 5\.2rem\);[^}]*overflow-y:\s*auto;/,
  );
  assert.match(
    sidepanelStyles,
    /\.language-menu\s*\{[^}]*max-height:\s*calc\(100dvh - 5\.2rem\);[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/,
  );
  assert.match(
    sidepanelStyles,
    /#language-options\s*\{\s*max-height:\s*min\(18rem,\s*40dvh,\s*calc\(100dvh - 13rem\)\)/,
  );
});

test("new activity log rows honor the active filter without rescanning the log", () => {
  const appendStart = sidepanelSource.indexOf(
    "function appendPostingProgressLog(",
  );
  const appendEnd = sidepanelSource.indexOf(
    "function getPostingStatusLabel(",
    appendStart,
  );
  const appendFunction = sidepanelSource.slice(appendStart, appendEnd);
  assert.ok(appendStart >= 0 && appendEnd > appendStart);
  assert.doesNotMatch(appendFunction, /applyPostingLogFilter\(/);
  assert.match(appendFunction, /item\.hidden = !shouldShowPostingLogEntry\(/);
  assert.match(
    sidepanelSource,
    /function shouldShowPostingLogEntry\([\s\S]*?status === "rate_limited"/,
  );
});

test("corner styles use explicit shared radii instead of a forced global reset", () => {
  assert.doesNotMatch(
    sidepanelStyles,
    /border-radius:\s*0(?:rem)?\s*!important/,
  );
  assert.match(sidepanelStyles, /--radius-lg:\s*0\.8rem/);
  assert.match(sidepanelStyles, /--radius-md:\s*0\.55rem/);
  assert.match(sidepanelStyles, /border-radius:\s*var\(--radius-md\)/);
});

test("posting mode gives the activity log the available panel height", () => {
  assert.match(postingWizardSource, /posting-step--posting/);
  assert.match(
    sidepanelStyles,
    /\.posting-step--posting > \.post-review,[\s\S]*?\.posting-step--posting > \.step-actions/,
  );
  assert.match(
    sidepanelStyles,
    /\.posting-step--posting > \.posting-progress\s*\{[^}]*height:\s*auto;[^}]*max-height:\s*none;/,
  );
  assert.match(
    sidepanelStyles,
    /\.posting-progress__log\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*scroll;/,
  );
});

test("multiline text is inserted and serialized with explicit line breaks", () => {
  assert.match(richTextEditorSource, /\$createLineBreakNode/);
  assert.match(richTextEditorSource, /selection\.insertNodes\(nodes\)/);
  assert.match(richTextEditorSource, /\.setFormat\(selection\.format\)/);
  assert.match(richTextEditorSource, /\.setStyle\(selection\.style\)/);
  assert.match(
    richTextEditorSource,
    /\.map\(\(node\) => node\.getTextContent\(\)\)\s*\.join\("\\n"\)/,
  );
  assert.match(contentSource, /split\(\/\\r\\n\?\\|\\n\/\)/);
  assert.match(contentSource, /document\.createElement\("br"\)/);
});

test("rich clipboard paste is delegated to Lexical's rich-text importer", () => {
  const pasteHandlerStart = richTextEditorSource.indexOf(
    'root.addEventListener(\n    "paste"',
  );
  const richClipboardCheckIndex = richTextEditorSource.indexOf(
    'getData("text/html")',
    pasteHandlerStart,
  );
  const preventDefaultIndex = richTextEditorSource.indexOf(
    "event.preventDefault()",
    pasteHandlerStart,
  );

  assert.ok(pasteHandlerStart >= 0);
  assert.ok(
    richClipboardCheckIndex >= 0 &&
      richClipboardCheckIndex < preventDefaultIndex,
  );
  assert.match(
    richTextEditorSource,
    /getData\("application\/x-lexical-editor"\)/,
  );
  assert.match(richTextEditorSource, /registerRichText\(editor\)/);
});
