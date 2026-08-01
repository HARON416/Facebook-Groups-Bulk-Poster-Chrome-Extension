import esbuild from "esbuild";

const authWebBaseUrl =
  process.env.AUTH_WEB_BASE_URL ??
  "https://facebook-groups-bulk-poster-chrome-extension.softwrhq.com";
const authApiBaseUrl =
  process.env.AUTH_API_BASE_URL ??
  "https://api.facebook-groups-bulk-poster.softwrhq.com";

const sharedConfig = {
  entryPoints: {
    content: "src/content.ts",
    "service-worker": "src/background.ts",
    sidepanel: "src/sidepanel.ts",
  },
  bundle: true,
  outdir: "public/dist",
  platform: "browser",
  define: {
    __AUTH_WEB_BASE_URL__: JSON.stringify(authWebBaseUrl),
    __AUTH_API_BASE_URL__: JSON.stringify(authApiBaseUrl),
  },
};

if (process.argv.includes("--watch")) {
  const context = await esbuild.context(sharedConfig);
  await context.watch();
  console.log("Watching extension build...");
} else {
  await esbuild.build(sharedConfig);
}
