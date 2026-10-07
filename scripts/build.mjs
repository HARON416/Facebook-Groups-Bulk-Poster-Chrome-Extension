import esbuild from "esbuild";
import { rm } from "node:fs/promises";

const generatedBundlesPath = new URL("../public/dist/", import.meta.url);

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
};

await rm(generatedBundlesPath, { recursive: true, force: true });

if (process.argv.includes("--watch")) {
  const context = await esbuild.context(sharedConfig);
  await context.watch();
  console.log("Watching extension build...");
} else {
  await esbuild.build(sharedConfig);
  console.log("Built extension bundles.");
}
