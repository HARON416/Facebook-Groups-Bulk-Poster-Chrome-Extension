import type { UiPostingStatusMessage } from "./config";

export const DIAGNOSTIC_KEYS = [
  "postikaDiagnostics:background",
  "postikaDiagnostics:panel",
] as const;
const MAX_ENTRIES = 100;
const HEARTBEAT_MS = 30_000;

type DiagnosticEntry = {
  at: number;
  session: string;
  event: string;
  status?: string;
  current?: number;
  total?: number;
  successCount?: number;
  failedCount?: number;
  processedCount?: number;
  pendingRequestCount?: number;
  logEntryCount?: number;
  imageBytes?: number;
  heapUsedBytes?: number;
  heapLimitBytes?: number;
  errorName?: string;
  errorMessage?: string;
};
type Snapshot = { schema: 1; version: string; entries: DiagnosticEntry[] };
type Storage = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
};

export function createPostingDiagnostics(
  context: "background" | "panel",
  options: { storage?: Storage; now?: () => number; version?: string } = {},
) {
  const storage = options.storage ?? chrome.storage.local;
  const now = options.now ?? Date.now;
  const version = options.version ?? chrome.runtime.getManifest?.().version ?? "unknown";
  const key = `postikaDiagnostics:${context}`;
  const session = `${now()}-${Math.random().toString(36).slice(2, 10)}`;
  const entries: DiagnosticEntry[] = [];
  let signature = "";
  let lastCheckpointAt = -Infinity;
  let dirty = false;
  let writer: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let storageError: string | undefined;
  // Do not turn missing/unavailable diagnostic storage into a posting failure.
  const ready = Promise.resolve().then(async () => {
    const values = await storage.get([key]);
    const previous = values[key] as Partial<Snapshot> | undefined;
    if (previous?.schema !== 1 || !Array.isArray(previous.entries)) return;
    // Only retain fields written by this schema; never copy arbitrary storage.
    const allowed = new Set([
      "at", "session", "event", "status", "current", "total", "successCount",
      "failedCount", "processedCount", "pendingRequestCount", "logEntryCount",
      "imageBytes", "heapUsedBytes", "heapLimitBytes", "errorName", "errorMessage",
    ]);
    const restored = previous.entries.slice(-MAX_ENTRIES).map((entry) =>
      Object.fromEntries(Object.entries(entry ?? {}).filter(([name, value]) =>
        allowed.has(name) && (typeof value === "number" || typeof value === "string"),
      ).map(([name, value]) => [name, typeof value === "string" ? value.slice(0, 256) : value])),
    ) as DiagnosticEntry[];
    entries.unshift(...restored);
    entries.splice(0, Math.max(0, entries.length - MAX_ENTRIES));
  }).catch(() => { storageError = "Could not read previous diagnostics"; });

  const snapshot = (): Snapshot => ({ schema: 1, version, entries: entries.map(entry => ({ ...entry })) });
  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (writer) return writer;
    writer = (async () => {
      await ready;
      while (dirty) {
        dirty = false;
        try { await storage.set({ [key]: snapshot() }); storageError = undefined; }
        catch { dirty = true; storageError = "Could not save diagnostics"; break; }
      }
    })().finally(() => { writer = undefined; });
    return writer;
  };
  const record = (event: string, detail: Omit<DiagnosticEntry, "at" | "session" | "event"> = {}) => {
    const memory = (globalThis.performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    } | undefined)?.memory;
    entries.push({
      at: now(), session, event,
      ...(memory ? { heapUsedBytes: memory.usedJSHeapSize, heapLimitBytes: memory.jsHeapSizeLimit } : {}),
      ...detail,
    });
    entries.splice(0, Math.max(0, entries.length - MAX_ENTRIES));
    dirty = true;
    if (!timer) timer = setTimeout(() => { void flush(); }, 250);
  };
  const checkpoint = (
    status: UiPostingStatusMessage,
    counters: Pick<DiagnosticEntry, "pendingRequestCount" | "logEntryCount" | "imageBytes"> = {},
  ) => {
    const nextSignature = [status.status, status.current, status.total, status.processedCount, status.successCount, status.failedCount].join(":");
    if (signature === nextSignature && now() - lastCheckpointAt < HEARTBEAT_MS) return;
    signature = nextSignature;
    lastCheckpointAt = now();
    record("checkpoint", {
      status: status.status, current: status.current, total: status.total,
      successCount: status.successCount, failedCount: status.failedCount,
      processedCount: status.processedCount, ...counters,
    });
  };
  const captureError = (event: string, error: unknown) => {
    record(event, {
      errorName: error instanceof Error ? error.name.slice(0, 80) : typeof error,
      errorMessage: error instanceof Error ? error.message.slice(0, 256) : typeof error === "string" ? error.slice(0, 256) : "Non-text error",
    });
  };
  record("context-start");
  return { checkpoint, record, captureError, flush, snapshot, storageError: () => storageError };
}

export function listenForDiagnosticErrors(reporter: ReturnType<typeof createPostingDiagnostics>) {
  globalThis.addEventListener?.("error", (event: ErrorEvent) => {
    reporter.captureError("runtime-error", event.error ?? event.message);
  });
  globalThis.addEventListener?.("unhandledrejection", (event: PromiseRejectionEvent) => {
    reporter.captureError("unhandled-rejection", event.reason);
  });
}
