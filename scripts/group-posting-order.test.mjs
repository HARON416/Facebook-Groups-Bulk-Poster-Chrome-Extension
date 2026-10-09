import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const source = await readFile(new URL("../src/group-posting-order.ts", import.meta.url), "utf8");
const code = (await transform(source, { loader: "ts", format: "esm" })).code;
const { groupsInSelectionOrder, shuffleGroups } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("selected group lookup follows selection order while ignoring unavailable groups", () => {
  const groups = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const selected = new Set(["c", "missing", "a", "b"]);
  assert.deepEqual(groupsInSelectionOrder(groups, selected), [groups[2], groups[0], groups[1]]);
  selected.delete("c");
  selected.add("c");
  assert.deepEqual(groupsInSelectionOrder(groups, selected), groups);
  assert.deepEqual(groupsInSelectionOrder(groups, Array.from(selected)), groups);
});

test("shuffle preserves every selected group and does not mutate the source list", () => {
  const groups = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const shuffled = shuffleGroups(groups, () => 0);
  assert.deepEqual(shuffled, [groups[1], groups[2], groups[0]]);
  assert.deepEqual(groups.map(({ id }) => id), ["a", "b", "c"]);
  assert.equal(new Set(shuffled).size, groups.length);
  assert.deepEqual(shuffleGroups([]), []);
  assert.deepEqual(shuffleGroups([groups[0]]), [groups[0]]);
});
