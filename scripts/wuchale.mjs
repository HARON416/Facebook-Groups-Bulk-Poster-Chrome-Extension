import { execFileSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const sourcePath = new URL("../src/i18n.ts", import.meta.url);
const temporaryDirectory = new URL("../.wuchale-build/", import.meta.url);
const temporarySourcePath = new URL(
  "../.wuchale-build/i18n.ts",
  import.meta.url,
);
const cliPath = new URL(
  "../node_modules/wuchale/dist/cli/index.js",
  import.meta.url,
);

export async function prepareWuchaleSource(cliArgs = []) {
  await mkdir(temporaryDirectory, { recursive: true });
  await copyFile(sourcePath, temporarySourcePath);
  execFileSync(
    process.execPath,
    [fileURLToPath(cliPath), ...cliArgs, "--modify", "main"],
    { cwd: fileURLToPath(projectRoot), stdio: "inherit" },
  );
}

export async function cleanWuchaleSource() {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await prepareWuchaleSource(process.argv.slice(2));
  } finally {
    await cleanWuchaleSource();
  }
}
