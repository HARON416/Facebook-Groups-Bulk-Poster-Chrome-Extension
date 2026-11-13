import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"),
);
const sidepanelHtml = await readFile(
  new URL("../public/sidepanel.html", import.meta.url),
  "utf8",
);
const sidepanelSource = await readFile(
  new URL("../src/sidepanel.ts", import.meta.url),
  "utf8",
);
const backgroundSource = await readFile(
  new URL("../src/background.ts", import.meta.url),
  "utf8",
);

test("extension does not require Google identity or a Postika API", () => {
  assert.equal("oauth2" in manifest, false);
  assert.equal(manifest.permissions.includes("identity"), false);
  assert.equal(
    manifest.host_permissions.some((origin) => origin.includes("softwrhq")),
    false,
  );
  assert.doesNotMatch(sidepanelHtml, /auth-panel|auth-login-btn|Continue with Google/);
  assert.doesNotMatch(sidepanelSource, /chrome\.identity|AUTH_API_BASE_URL|\/api\/auth|\/api\/me/);
  assert.doesNotMatch(backgroundSource, /getApplicationSessionToken|Sign in with Google/);
});
