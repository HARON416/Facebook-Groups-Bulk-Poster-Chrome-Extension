// Controlled Chrome experiment: localhost only, disposable profile; no Facebook traffic.
// Run with node scripts/connectivity-memory-check.mjs. Chrome RSS is summed across
// browser child processes; JS heap is the test page, not total native memory.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/posting-connectivity.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "postikaProbe",
});
const probeSource = bundle.outputFiles[0].text;
const dir = await mkdtemp("/tmp/postika-probe-");
const server = createServer((req, res) => {
  if (req.url.startsWith("/robots")) {
    res.setHeader("Cache-Control", "no-store");
    res.end("x".repeat(32 * 1024));
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end("<html>Offline Postika probe stress fixture</html>");
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const url = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(
  "google-chrome",
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    `--user-data-dir=${dir}`,
    "--remote-debugging-port=0",
    url,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let s = "";
    let t = setTimeout(() => reject(new Error(s)), 15000);
    chrome.stderr.on("data", (c) => {
      s += c;
      let m = s.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    chrome.once("exit", () => {
      clearTimeout(t);
      reject(new Error(s));
    });
  });
  const tabs = await (
    await fetch(`http://${new URL(endpoint).host}/json`)
  ).json();
  ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(m.error) : p.resolve(m.result);
    }
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const rss = async () => {
    const children = (
      await readFile(`/proc/${chrome.pid}/task/${chrome.pid}/children`, "utf8")
    )
      .trim()
      .split(/\s+/);
    let pids = [chrome.pid, ...children];
    for (const pid of children) {
      try {
        pids.push(
          ...(await readFile(`/proc/${pid}/task/${pid}/children`, "utf8"))
            .trim()
            .split(/\s+/),
        );
      } catch {}
    }
    let sum = 0;
    for (const pid of new Set(pids)) {
      try {
        const s = await readFile(`/proc/${pid}/status`, "utf8");
        sum += Number(s.match(/VmRSS:\s+(\d+)/)?.[1] ?? 0);
      } catch {}
    }
    return Math.round(sum / 1024);
  };
  for (const cancel of [false, true]) {
    await call("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 300));
    await evaluate(probeSource);
    for (let batch = 0; batch < 6; batch++) {
      await evaluate(
        `(async()=>{for(let i=0;i<500;i++){${cancel ? "await Promise.all(['/robots?a','/robots?b'].map(url=>postikaProbe.probePostingUrl(url,new AbortController().signal)));" : "await Promise.all([fetch('/robots?a'),fetch('/robots?b')].map(async p=>{await p;}));"}}})()`,
      );
      const heap = await call("Runtime.getHeapUsage");
      console.log(
        JSON.stringify({
          cancel,
          requests: (batch + 1) * 1000,
          chromeRSSMiB: await rss(),
          heapMiB: Math.round(heap.usedSize / 1048576),
          backingMiB: Math.round((heap.backingStorageSize ?? 0) / 1048576),
        }),
      );
    }
  }
} finally {
  ws?.close();
  chrome.kill();
  server.close();
  await new Promise((r) => chrome.once("exit", r));
  await rm(dir, { recursive: true, force: true });
}
