import { test } from "node:test";
import assert from "node:assert/strict";
import { overlappingTarget } from "../src/drag-target.ts";

const rect = (left, top, width = 100, height = 100) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});
const clip = rect(0, 0, 500, 500);
const target = (id, bounds) => ({ id, bounds });

test("overlap accepts edge contact but rejects a gap", () => {
  const tile = target("b", rect(110, 0));
  assert.equal(overlappingTarget(rect(11, 0), [tile], clip), tile);
  assert.equal(overlappingTarget(rect(10, 0), [tile], clip), tile);
  assert.equal(overlappingTarget(rect(9, 0), [tile], clip), undefined);
});

test("largest visible overlap wins, with distance breaking ties", () => {
  const a = target("a", rect(0, 0));
  const b = target("b", rect(110, 0));
  assert.equal(overlappingTarget(rect(60, 0), [a, b], clip), b);

  const far = target("far", rect(0, 0, 200, 100));
  const near = target("near", rect(100, 0));
  assert.equal(overlappingTarget(rect(100, 0), [far, near], clip), near);
});

test("offscreen target regions cannot receive a drop", () => {
  const tile = target("b", rect(110, 110));
  const cropped = rect(0, 0, 160, 160);
  assert.equal(overlappingTarget(rect(161, 110), [tile], cropped), undefined);
  assert.equal(overlappingTarget(rect(110, 161), [tile], cropped), undefined);
  assert.equal(
    overlappingTarget(rect(110, 110), [tile], rect(0, 0, 100, 100)),
    undefined,
  );
  assert.equal(overlappingTarget(rect(60, 60), [tile], cropped), tile);
});
