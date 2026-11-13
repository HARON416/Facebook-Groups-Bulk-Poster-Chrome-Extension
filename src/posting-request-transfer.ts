import type { StartUiPostingRequest, UiPostingResponse } from "./config";

const PORT_NAME = "postika-group-posting";
const CHUNK_SIZE = 1024 * 1024;
const MAX_REQUEST_SIZE = 512 * 1024 * 1024;
const TRANSFER_TIMEOUT = 30_000;

// Chunk the handoff to stay below Chrome's message limit. Content lives only
// in the two processes' memory; no post text or images are written to storage.
export function sendPostingRequest(request: StartUiPostingRequest): Promise<UiPostingResponse> {
  const serialized = JSON.stringify(request);
  if (serialized.length > MAX_REQUEST_SIZE) return Promise.reject(new Error("The selected images are too large to post together."));
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: PORT_NAME });
    let offset = 0;
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result?: UiPostingResponse, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      port.disconnect();
      if (error) reject(error);
      else resolve(result!);
    };
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(undefined, new Error("The posting queue transfer timed out. Please try again.")), TRANSFER_TIMEOUT);
    };
    port.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError?.message;
      finish(undefined, new Error(message ?? "The posting queue transfer was interrupted. Please try again."));
    });
    port.onMessage.addListener((message) => {
      if (finished) return;
      resetTimer();
      if (message.type === "result") {
        finish({ ok: message.ok === true, error: typeof message.error === "string" ? message.error : undefined });
      } else if (message.type === "ack") {
        try {
          if (offset < serialized.length) {
            const chunk = serialized.slice(offset, offset + CHUNK_SIZE);
            offset += chunk.length;
            port.postMessage({ type: "chunk", chunk });
          } else {
            port.postMessage({ type: "end" });
          }
        } catch {
          finish(undefined, new Error("Could not transfer the posting queue. Please try again."));
        }
      }
    });
    resetTimer();
    try { port.postMessage({ type: "begin", length: serialized.length }); }
    catch { finish(undefined, new Error("Could not transfer the posting queue. Please try again.")); }
  });
}

export function listenForPostingRequests(
  start: (
    request: StartUiPostingRequest,
  ) => UiPostingResponse | Promise<UiPostingResponse>,
) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME || port.sender?.id !== chrome.runtime.id) return;
    receivePostingRequest(port, start);
  });
}

export function receivePostingRequest(
  port: chrome.runtime.Port,
  start: (
    request: StartUiPostingRequest,
  ) => UiPostingResponse | Promise<UiPostingResponse>,
) {
  let chunks: string[] = [];
  let expected = 0;
  let received = 0;
  let finished = false;
  let timer: ReturnType<typeof setTimeout>;
  const clear = () => { clearTimeout(timer); chunks = []; finished = true; };
  const respond = (result: UiPostingResponse) => {
    clear();
    try { port.postMessage({ type: "result", ...result }); } catch { /* Panel closed. */ }
  };
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { clear(); port.disconnect(); }, TRANSFER_TIMEOUT);
  };
  port.onDisconnect.addListener(clear);
  port.onMessage.addListener((message) => {
    if (finished) return;
    resetTimer();
    try {
      if (message.type === "begin" && expected === 0 && Number.isSafeInteger(message.length) && message.length > 0 && message.length <= MAX_REQUEST_SIZE) {
        expected = message.length;
      } else if (message.type === "chunk" && expected > 0 && typeof message.chunk === "string" && message.chunk.length > 0 && message.chunk.length <= CHUNK_SIZE && received + message.chunk.length <= expected) {
        chunks.push(message.chunk);
        received += message.chunk.length;
      } else if (message.type === "end" && expected > 0 && received === expected) {
        const request = JSON.parse(chunks.join("")) as StartUiPostingRequest;
        clear();
        if (request.type !== "START_UI_POSTING" || !Array.isArray(request.groups) || !Array.isArray(request.posts)) throw new Error("Invalid posting queue.");
        void Promise.resolve(start(request))
          .then(respond)
          .catch((error: unknown) =>
            respond({
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Could not start posting.",
            }),
          );
        return;
      } else {
        throw new Error("Invalid or incomplete posting queue transfer.");
      }
      port.postMessage({ type: "ack" });
    } catch (error) {
      respond({ ok: false, error: error instanceof Error ? error.message : "Could not start posting." });
    }
  });
  resetTimer();
}
