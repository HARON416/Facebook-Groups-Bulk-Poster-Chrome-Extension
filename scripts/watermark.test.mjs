import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";

const source = await readFile(new URL("../src/watermark.ts", import.meta.url), "utf8");
const code = (await transform(source, { loader: "ts", format: "cjs" })).code;

function harness({ decodeFails = false, exportFails = false } = {}) {
  const calls = [];
  const context = {
    fillRect: (...args) => calls.push(["band", ...args]),
    measureText: (text) => ({ width: text.length * 100 }),
    fillText: (...args) => calls.push(["text", ...args]),
    drawImage: (...args) => calls.push(["image", ...args]),
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    getComputedStyle: () => ({ fontSize: "10px", fontFamily: '"Inter"' }),
    Image: class {
      naturalWidth = 1000;
      naturalHeight = 600;
      set src(_) { decodeFails ? this.onerror() : this.onload(); }
    },
    document: { fonts: { load: async () => [] }, createElement: () => ({
      getContext: () => context,
      toDataURL: (type) => exportFails ? "data:," : `data:${type};base64,watermarked`,
    }) },
  });
  return { ...module.exports, calls, context };
}

test("bands cover the requested percentage at top, center, and bottom", () => {
  const h = harness();
  for (const [position, y] of [["top", 0], ["center", 270], ["bottom", 540]]) {
    h.drawWatermark(h.context, 1000, 600, { ...h.DEFAULT_WATERMARK, text: "Brand", position });
    assert.deepEqual(h.calls.at(-2), ["band", 0, y, 1000, 60]);
    assert.deepEqual(h.calls.at(-1), ["text", "Brand", 500, y + 30, 920]);
    assert.equal(h.context.fillStyle, "#ffffff");
  }
});

test("long text is resized to fit and custom height and colors reach the renderer", () => {
  const h = harness();
  h.drawWatermark(h.context, 1000, 600, {
    ...h.DEFAULT_WATERMARK, text: "A long business name with contact details",
    backgroundColor: "#123456", textColor: "#fedcba", height: 20,
  });
  assert.deepEqual(h.calls[0], ["band", 0, 480, 1000, 120]);
  assert.equal(h.context.fillStyle, "#fedcba");
  assert.ok(parseFloat(h.context.font.split(" ")[1]) < 6.6);
  assert.match(h.context.font, /rem "Inter"$/);
});

test("invalid stored settings fall back safely and heights stay bounded", () => {
  const h = harness();
  const result = h.normalizeWatermark({ enabled: "yes", height: -3, backgroundColor: "invalid", textColor: "#abcdef", position: "left" });
  assert.equal(result.enabled, false);
  assert.equal(result.height, 1);
  assert.equal(result.backgroundColor, "#000000");
  assert.equal(result.textColor, "#abcdef");
  assert.equal(result.position, "bottom");
  assert.equal(h.normalizeWatermark({ height: Infinity }).height, 10);
  assert.equal(h.normalizeWatermark({ height: 90 }).height, 50);
  assert.equal(h.normalizeWatermark(null).height, 10);
});

test("disabled watermark returns the original without decoding or converting", async () => {
  const h = harness({ decodeFails: true });
  const original = { name: "photo.webp", type: "image/webp", dataUrl: "original" };
  assert.equal(await h.watermarkImage(original, h.DEFAULT_WATERMARK), original);
  assert.equal(h.calls.length, 0);
});

test("posting gets converted image metadata while saved originals remain intact", async () => {
  const h = harness();
  for (const [inputType, outputType, extension] of [["image/jpeg", "image/jpeg", "jpg"], ["image/webp", "image/png", "png"]]) {
    const original = { name: "photo.original", type: inputType, dataUrl: "original" };
    const output = await h.watermarkImage(original, { ...h.DEFAULT_WATERMARK, enabled: true, text: "Brand" });
    assert.equal(output.name, `photo.${extension}`);
    assert.equal(output.type, outputType);
    assert.equal(output.dataUrl, `data:${outputType};base64,watermarked`);
    assert.equal(original.dataUrl, "original");
  }
});

test("blank text, broken images, and failed canvas exports prevent posting", async () => {
  const original = { name: "photo.png", type: "image/png", dataUrl: "original" };
  const settings = { ...harness().DEFAULT_WATERMARK, enabled: true, text: "Brand" };
  await assert.rejects(harness().watermarkImage(original, { ...settings, text: "  " }), /Enter watermark text/);
  await assert.rejects(harness({ decodeFails: true }).watermarkImage(original, settings), /Unable to load/);
  await assert.rejects(harness({ exportFails: true }).watermarkImage(original, settings), /Unable to export/);
});
