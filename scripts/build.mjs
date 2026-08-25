import esbuild from "esbuild";
import { readFile, rm, writeFile } from "node:fs/promises";

const isProductionBuild = process.argv.includes("--production");
const authApiBaseUrl =
  process.env.AUTH_API_BASE_URL ??
  (isProductionBuild
    ? "https://api.facebook-groups-bulk-poster.softwrhq.com"
    : "http://localhost:4000");
const manifestTemplatePath = new URL("../manifest.base.json", import.meta.url);
const generatedManifestPath = new URL(
  "../public/manifest.json",
  import.meta.url,
);
const generatedBundlesPath = new URL("../public/dist/", import.meta.url);

function apiHostPermission(apiBaseUrl) {
  const url = new URL(apiBaseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported API URL protocol: ${url.protocol}`);
  }
  return `${url.protocol}//${url.hostname}/*`;
}

async function generateManifest() {
  const manifest = JSON.parse(await readFile(manifestTemplatePath, "utf8"));
  const existingManifest = await readExistingManifest();
  const extensionName =
    nonEmptyString(process.env.EXTENSION_NAME) ??
    nonEmptyString(existingManifest?.name);
  if (extensionName) {
    manifest.name = extensionName;
  }
  const apiHostname = new URL(authApiBaseUrl).hostname;
  const apiPermissions =
    !isProductionBuild &&
    (apiHostname === "localhost" || apiHostname === "127.0.0.1")
      ? ["http://localhost/*", "http://127.0.0.1/*"]
      : [apiHostPermission(authApiBaseUrl)];
  manifest.host_permissions = [...apiPermissions, ...manifest.host_permissions];
  await writeFile(
    generatedManifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function readExistingManifest() {
  try {
    return JSON.parse(await readFile(generatedManifestPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw new Error(`Unable to read the existing generated manifest: ${error}`);
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const sharedConfig = {
  entryPoints: {
    content: "src/content.ts",
    "marketplace-cleanup": "src/marketplace-cleanup.ts",
    "marketplace-item": "src/marketplace-item.ts",
    "service-worker": "src/background.ts",
    sidepanel: "src/sidepanel.ts",
  },
  bundle: true,
  outdir: "public/dist",
  platform: "browser",
  define: {
    __AUTH_API_BASE_URL__: JSON.stringify(authApiBaseUrl),
  },
};

await rm(generatedBundlesPath, { recursive: true, force: true });
await generateManifest();

if (process.argv.includes("--watch")) {
  const context = await esbuild.context(sharedConfig);
  await context.watch();
  console.log("Watching extension build...");
} else {
  await esbuild.build(sharedConfig);
  console.log(
    `Built ${isProductionBuild ? "production" : "development"} extension with API URL: ${authApiBaseUrl}`,
  );
}
