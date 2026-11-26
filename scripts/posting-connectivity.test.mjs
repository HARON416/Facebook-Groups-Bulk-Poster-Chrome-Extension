import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/posting-connectivity.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { probePostingUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("an eight-hour run closes every unused probe body", async () => {
  let opened = 0;
  let closed = 0;
  const signal = new AbortController().signal;
  const fetcher = async (_url, options) => {
    assert.equal(options.signal, signal);
    assert.equal(options.credentials, "omit");
    opened += 1;
    return {
      type: "basic",
      body: {
        cancel: async () => {
          closed += 1;
        },
      },
    };
  };
  for (let sample = 0; sample < 9600; sample += 1) {
    assert.deepEqual(
      await Promise.all([
        probePostingUrl("https://www.facebook.com/robots.txt", signal, fetcher),
        probePostingUrl("https://web.facebook.com/robots.txt", signal, fetcher),
      ]),
      [true, true],
    );
    assert.equal(opened, closed);
  }
  assert.equal(closed, 19200);
});

test("redirect and rejected requests remain offline; body cleanup failures do not hide reachable headers", async () => {
  const signal = new AbortController().signal;
  let cancelled = false;
  assert.equal(
    await probePostingUrl("url", signal, async () => ({
      type: "opaqueredirect",
      body: {
        cancel: async () => {
          cancelled = true;
        },
      },
    })),
    false,
  );
  assert.equal(cancelled, true);
  assert.equal(
    await probePostingUrl("url", signal, async () => {
      throw new TypeError("Failed to fetch");
    }),
    false,
  );
  assert.equal(
    await probePostingUrl("url", signal, async () => ({
      type: "basic",
      body: null,
    })),
    true,
  );
  assert.equal(
    await probePostingUrl("url", signal, async () => ({
      type: "basic",
      body: {
        cancel: async () => {
          throw new Error("aborted");
        },
      },
    })),
    true,
  );
});
