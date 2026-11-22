import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const source = await readFile(
  new URL("../src/draft-storage.ts", import.meta.url),
  "utf8",
);
const { code } = await transform(source, { loader: "ts", format: "esm" });
const { createDraftSaver } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

test("failed image preparation leaves the previous complete draft untouched", async () => {
  const stored = { text: "Original", images: ["original-image"] };
  let writes = 0;
  const save = createDraftSaver(
    async () => {
      throw new Error("Image could not be read");
    },
    async (values) => {
      writes++;
      Object.assign(stored, values);
    },
  );
  await assert.rejects(save({ text: "Replacement" }), /could not be read/);
  assert.equal(writes, 0);
  assert.deepEqual(stored, { text: "Original", images: ["original-image"] });
});

test("a rejected storage write retains the draft and a retry can succeed", async () => {
  const stored = { text: "Original", images: ["original-image"] };
  let failWrite = true;
  const save = createDraftSaver(
    async (snapshot) => snapshot,
    async (values) => {
      if (failWrite) throw new Error("Storage quota exceeded");
      Object.assign(stored, values);
    },
  );
  const replacement = { text: "Replacement", images: ["new-image"] };
  await assert.rejects(save(replacement), /quota/);
  assert.equal(stored.images[0], "original-image");
  failWrite = false;
  await save(replacement);
  assert.deepEqual(stored, replacement);
});

test("a slow older image save cannot overwrite a newer draft", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const writes = [];
  const save = createDraftSaver(
    async (snapshot) => {
      if (snapshot.text === "Older") await gate;
      return snapshot;
    },
    async (values) => {
      writes.push(values);
    },
  );
  const older = save({ text: "Older", images: ["old"] });
  const newer = save({ text: "Newer", images: ["new"] });
  assert.equal(writes.length, 0);
  release();
  await Promise.all([older, newer]);
  assert.deepEqual(
    writes.map((value) => value.text),
    ["Older", "Newer"],
  );
  assert.equal(writes.at(-1).images[0], "new");
});

test("clearing images commits an empty replacement alongside the text", async () => {
  let stored = { text: "Original", images: ["original"] };
  const save = createDraftSaver(
    async (snapshot) => snapshot,
    async (values) => {
      stored = values;
    },
  );
  await save({ text: "Updated", images: [] });
  assert.deepEqual(stored, { text: "Updated", images: [] });
});
