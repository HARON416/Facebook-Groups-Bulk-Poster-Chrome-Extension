import esbuild from "esbuild";
import { watch } from "node:fs";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { cleanWuchaleSource, prepareWuchaleSource } from "./wuchale.mjs";

const generatedBundlesPath = new URL("../public/dist/", import.meta.url);

const localizedI18nPlugin = {
  name: "localized-i18n",
  setup(build) {
    build.onResolve({ filter: /^\.\/i18n$/ }, (args) => {
      if (
        args.importer === resolve("src/sidepanel.ts") ||
        args.importer === resolve("src/schedule-picker.ts")
      ) {
        return { path: resolve(".wuchale-build/i18n.ts") };
      }
    });
  },
};

const sharedConfig = {
  entryPoints: {
    content: "src/content.ts",
    "service-worker": "src/background.ts",
    sidepanel: "src/sidepanel.ts",
  },
  bundle: true,
  outdir: "public/dist",
  platform: "browser",
  plugins: [localizedI18nPlugin],
};

await rm(generatedBundlesPath, { recursive: true, force: true });
await prepareWuchaleSource();

if (process.argv.includes("--watch")) {
  const context = await esbuild.context(sharedConfig);
  await context.watch();
  const sourceWatcher = watch(new URL("../src/i18n.ts", import.meta.url));
  let rebuildTimer;
  sourceWatcher.on("change", () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(async () => {
      try {
        await prepareWuchaleSource();
        await context.rebuild();
      } catch (error) {
        console.error("Could not rebuild localized extension bundles.", error);
      }
    }, 200);
  });
  const stop = async () => {
    sourceWatcher.close();
    clearTimeout(rebuildTimer);
    await context.dispose();
    await cleanWuchaleSource();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  console.log("Watching extension build...");
} else {
  try {
    await esbuild.build(sharedConfig);
    console.log("Built extension bundles.");
  } finally {
    await cleanWuchaleSource();
  }
}
