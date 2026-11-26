"use strict";
(() => {
  // src/posting-diagnostics.ts
  var MAX_ENTRIES = 100;
  var HEARTBEAT_MS = 3e4;
  function createPostingDiagnostics(context, options = {}) {
    const storage = options.storage ?? chrome.storage.local;
    const now = options.now ?? Date.now;
    const version = options.version ?? chrome.runtime.getManifest?.().version ?? "unknown";
    const key = `postikaDiagnostics:${context}`;
    const session = `${now()}-${Math.random().toString(36).slice(2, 10)}`;
    const entries = [];
    let signature = "";
    let lastCheckpointAt = -Infinity;
    let dirty = false;
    let writer;
    let timer;
    let storageError;
    const ready = Promise.resolve().then(async () => {
      const values = await storage.get([key]);
      const previous = values[key];
      if (previous?.schema !== 1 || !Array.isArray(previous.entries)) return;
      const allowed = /* @__PURE__ */ new Set([
        "at",
        "session",
        "event",
        "status",
        "current",
        "total",
        "successCount",
        "failedCount",
        "processedCount",
        "pendingRequestCount",
        "logEntryCount",
        "imageBytes",
        "heapUsedBytes",
        "heapLimitBytes",
        "errorName",
        "errorMessage"
      ]);
      const restored = previous.entries.slice(-MAX_ENTRIES).map(
        (entry) => Object.fromEntries(Object.entries(entry ?? {}).filter(
          ([name, value]) => allowed.has(name) && (typeof value === "number" || typeof value === "string")
        ).map(([name, value]) => [name, typeof value === "string" ? value.slice(0, 256) : value]))
      );
      entries.unshift(...restored);
      entries.splice(0, Math.max(0, entries.length - MAX_ENTRIES));
    }).catch(() => {
      storageError = "Could not read previous diagnostics";
    });
    const snapshot = () => ({ schema: 1, version, entries: entries.map((entry) => ({ ...entry })) });
    const flush = () => {
      clearTimeout(timer);
      timer = void 0;
      if (writer) return writer;
      writer = (async () => {
        await ready;
        while (dirty) {
          dirty = false;
          try {
            await storage.set({ [key]: snapshot() });
            storageError = void 0;
          } catch {
            dirty = true;
            storageError = "Could not save diagnostics";
            break;
          }
        }
      })().finally(() => {
        writer = void 0;
      });
      return writer;
    };
    const record = (event, detail = {}) => {
      const memory = globalThis.performance?.memory;
      entries.push({
        at: now(),
        session,
        event,
        ...memory ? { heapUsedBytes: memory.usedJSHeapSize, heapLimitBytes: memory.jsHeapSizeLimit } : {},
        ...detail
      });
      entries.splice(0, Math.max(0, entries.length - MAX_ENTRIES));
      dirty = true;
      if (!timer) timer = setTimeout(() => {
        void flush();
      }, 250);
    };
    const checkpoint = (status, counters = {}) => {
      const nextSignature = [status.status, status.current, status.total, status.processedCount, status.successCount, status.failedCount].join(":");
      if (signature === nextSignature && now() - lastCheckpointAt < HEARTBEAT_MS) return;
      signature = nextSignature;
      lastCheckpointAt = now();
      record("checkpoint", {
        status: status.status,
        current: status.current,
        total: status.total,
        successCount: status.successCount,
        failedCount: status.failedCount,
        processedCount: status.processedCount,
        ...counters
      });
    };
    const captureError = (event, error) => {
      record(event, {
        errorName: error instanceof Error ? error.name.slice(0, 80) : typeof error,
        errorMessage: error instanceof Error ? error.message.slice(0, 256) : typeof error === "string" ? error.slice(0, 256) : "Non-text error"
      });
    };
    record("context-start");
    return { checkpoint, record, captureError, flush, snapshot, storageError: () => storageError };
  }
  function listenForDiagnosticErrors(reporter) {
    globalThis.addEventListener?.("error", (event) => {
      reporter.captureError("runtime-error", event.error ?? event.message);
    });
    globalThis.addEventListener?.("unhandledrejection", (event) => {
      reporter.captureError("unhandled-rejection", event.reason);
    });
  }

  // src/posting-connectivity.ts
  async function probePostingUrl(url, signal, fetcher = fetch) {
    try {
      const response = await fetcher(url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "manual",
        signal
      });
      const reachable = response.type !== "opaqueredirect";
      try {
        await response.body?.cancel();
      } catch {
      }
      return reachable;
    } catch {
      return false;
    }
  }

  // src/group-posting-order.ts
  function shuffleGroups(groups, random = Math.random) {
    const shuffled = [...groups];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  // src/page-readiness.ts
  function inspectPageReadinessInPage(expectedUrlPart) {
    const page = window;
    const cleanup = () => {
      page.__postikaPageReadiness?.observer.disconnect();
      delete page.__postikaPageReadiness;
    };
    if (!location.href.includes(expectedUrlPart) || document.readyState !== "complete" || !document.body) {
      cleanup();
      return false;
    }
    const target = document.querySelector('[role="main"]') ?? document.body;
    let observation = page.__postikaPageReadiness;
    if (!observation || observation.target !== target || observation.url !== location.href) {
      cleanup();
      observation = {
        target,
        url: location.href,
        lastChangedAt: Date.now(),
        observer: new MutationObserver(() => {
          if (page.__postikaPageReadiness) {
            page.__postikaPageReadiness.lastChangedAt = Date.now();
          }
        })
      };
      observation.observer.observe(target, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-busy", "aria-hidden", "hidden", "disabled"]
      });
      page.__postikaPageReadiness = observation;
    }
    const busy = Array.from(target.querySelectorAll('[aria-busy="true"]'));
    if (target.getAttribute("aria-busy") === "true") busy.push(target);
    const visiblyBusy = busy.some((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    if (visiblyBusy || Date.now() - observation.lastChangedAt < 1500) return false;
    cleanup();
    return true;
  }

  // src/config.ts
  var JOINED_GROUPS_URL = "https://web.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added";
  var GROUPS_QUERY_FRIENDLY_NAME = "GroupsCometAllJoinedGroupsSectionPaginationQuery";

  // src/posting-request-transfer.ts
  var PORT_NAME = "postika-group-posting";
  var CHUNK_SIZE = 1024 * 1024;
  var MAX_REQUEST_SIZE = 512 * 1024 * 1024;
  var TRANSFER_TIMEOUT = 3e4;
  function listenForPostingRequests(start) {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== PORT_NAME || port.sender?.id !== chrome.runtime.id) return;
      receivePostingRequest(port, start);
    });
  }
  function receivePostingRequest(port, start) {
    let chunks = [];
    let expected = 0;
    let received = 0;
    let finished = false;
    let timer;
    const clear = () => {
      clearTimeout(timer);
      chunks = [];
      finished = true;
    };
    const respond = (result) => {
      clear();
      try {
        port.postMessage({ type: "result", ...result });
      } catch {
      }
    };
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        clear();
        port.disconnect();
      }, TRANSFER_TIMEOUT);
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
          const request = JSON.parse(chunks.join(""));
          clear();
          if (request.type !== "START_UI_POSTING" || !Array.isArray(request.groups) || !Array.isArray(request.posts)) throw new Error("Invalid posting queue.");
          void Promise.resolve(start(request)).then(respond).catch(
            (error) => respond({
              ok: false,
              error: error instanceof Error ? error.message : "Could not start posting."
            })
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

  // src/scheduled-posting.ts
  var DATABASE_NAME = "postika-scheduled-posting";
  var STORE_NAME = "queues";
  var ACTIVE_QUEUE_KEY = "active";
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open scheduled queue storage."));
      request.onblocked = () => reject(new Error("Scheduled queue storage is blocked by another page."));
    });
  }
  async function saveScheduledPosting(posting) {
    const database = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(posting, ACTIVE_QUEUE_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(
          transaction.error ?? new Error("Could not save the scheduled posting queue.")
        );
        transaction.onabort = () => reject(
          transaction.error ?? new Error("Saving the scheduled posting queue was interrupted.")
        );
      });
    } finally {
      database.close();
    }
  }
  async function getScheduledPosting() {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(ACTIVE_QUEUE_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Could not read the scheduled queue."));
        transaction.onabort = () => reject(
          transaction.error ?? new Error("Reading the scheduled queue was interrupted.")
        );
      });
    } finally {
      database.close();
    }
  }
  async function takeScheduledPosting() {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(ACTIVE_QUEUE_KEY);
        let posting;
        request.onsuccess = () => {
          posting = request.result;
          if (posting) store.delete(ACTIVE_QUEUE_KEY);
        };
        request.onerror = () => reject(request.error ?? new Error("Could not claim the scheduled queue."));
        transaction.oncomplete = () => resolve(posting);
        transaction.onerror = () => reject(
          transaction.error ?? new Error("Could not claim the scheduled queue.")
        );
        transaction.onabort = () => reject(
          transaction.error ?? new Error("Claiming the scheduled queue was interrupted.")
        );
      });
    } finally {
      database.close();
    }
  }
  async function removeScheduledPosting() {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(ACTIVE_QUEUE_KEY);
        let existed = false;
        request.onsuccess = () => {
          existed = request.result !== void 0;
          if (existed) store.delete(ACTIVE_QUEUE_KEY);
        };
        request.onerror = () => reject(request.error ?? new Error("Could not cancel the scheduled queue."));
        transaction.oncomplete = () => resolve(existed);
        transaction.onerror = () => reject(
          transaction.error ?? new Error("Could not cancel the scheduled queue.")
        );
        transaction.onabort = () => reject(
          transaction.error ?? new Error("Cancelling the scheduled queue was interrupted.")
        );
      });
    } finally {
      database.close();
    }
  }

  // src/background.ts
  var POST_MUTATION_FRIENDLY_NAME = "ComposerStoryCreateMutation";
  var UPLOAD_CANDIDATE_MATCHES = [
    "upload.facebook.com/ajax/react_composer/attachments/photo/upload",
    "www.facebook.com/ajax/react_composer/attachments/photo/upload",
    "web.facebook.com/ajax/react_composer/attachments/photo/upload",
    "/ajax/react_composer/attachments/photo/upload"
  ];
  var MIN_POSTING_DELAY_SECONDS = 60;
  var LOG_PREFIX = "[Facebook Groups Bulk Poster]";
  var VERBOSE_POSTING_LOGS = false;
  var SCHEDULED_POSTING_ALARM = "postika-scheduled-posting";
  var MissingFirstGroupComposerError = class extends Error {
    constructor(groupName) {
      super(
        `Postika could not find the post composer in ${groupName}. Postika will skip it and try the next selected Group.`
      );
      this.name = "MissingFirstGroupComposerError";
    }
  };
  var FacebookPostResponseError = class extends Error {
    constructor(message, responseBody) {
      super(message);
      this.name = "FacebookPostResponseError";
      this.responseBody = responseBody;
    }
  };
  function isMissingFirstGroupComposerError(error) {
    return error instanceof Error && (error instanceof MissingFirstGroupComposerError || /write something(?:\.\.\.)?.*(?:not found|could not find)/i.test(
      error.message
    ));
  }
  var FACEBOOK_HOSTS = /* @__PURE__ */ new Set([
    "www.facebook.com",
    "web.facebook.com",
    "upload.facebook.com"
  ]);
  function normalizeFacebookActorId(value) {
    const actorId = value?.trim() ?? "";
    return /^\d{5,32}$/.test(actorId) ? actorId : "";
  }
  async function getFacebookActorId(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !isFacebookUrl(tab.url)) {
      throw new Error("Open Facebook and sign in before starting to post.");
    }
    const cookie = await chrome.cookies.get({
      url: tab.url,
      name: "c_user"
    });
    const actorId = normalizeFacebookActorId(cookie?.value);
    if (!actorId) {
      throw new Error(
        "Postika could not identify the Facebook account signed in to this Chrome profile. Refresh Facebook, sign in again, and retry."
      );
    }
    return actorId;
  }
  var pendingRequests = /* @__PURE__ */ new Map();
  var postingDiagnostics = createPostingDiagnostics("background");
  listenForDiagnosticErrors(postingDiagnostics);
  var capturedGroupsRequest;
  var captureTabId;
  var activePosting = false;
  var postingRequestStartInProgress = false;
  var scheduledQueueStartPromise;
  var activePostingSuccessTarget;
  var activePostingPendingCount = 0;
  var stopPostingRequested = false;
  var pausePostingRequested = false;
  var pauseNotificationSent = false;
  var postingNetworkOffline = false;
  var queuePauseApplied = false;
  var latestUiPostingStatus;
  var activePostingTabId;
  var postingCaptureTabId;
  var capturedUploadTemplate;
  var capturedPostTemplate;
  var uploadImageCacheKeys = /* @__PURE__ */ new WeakMap();
  var groupsPostingTimer;
  function createQueueTimer(requestedStartedAt) {
    const now = Date.now();
    const startedAt = typeof requestedStartedAt === "number" && Number.isFinite(requestedStartedAt) && requestedStartedAt <= now ? Math.max(0, requestedStartedAt) : now;
    return {
      startedAt,
      totalActiveMs: now - startedAt,
      totalActiveSince: now,
      itemActiveMs: now - startedAt,
      itemActiveSince: now,
      pausedMs: 0,
      complete: false
    };
  }
  function commitQueueTimer(timer, now = Date.now()) {
    if (timer.totalActiveSince !== void 0) {
      timer.totalActiveMs += Math.max(0, now - timer.totalActiveSince);
      timer.totalActiveSince = void 0;
    }
    if (timer.itemActiveSince !== void 0) {
      timer.itemActiveMs += Math.max(0, now - timer.itemActiveSince);
      timer.itemActiveSince = void 0;
    }
  }
  function pauseQueueTimer(timer) {
    if (!timer || timer.complete || timer.pausedAt !== void 0) {
      return;
    }
    const now = Date.now();
    commitQueueTimer(timer, now);
    timer.pausedAt = now;
  }
  function resumeQueueTimer(timer) {
    if (!timer || timer.complete || timer.pausedAt === void 0) {
      return;
    }
    const now = Date.now();
    timer.pausedMs += Math.max(0, now - timer.pausedAt);
    timer.pausedAt = void 0;
    timer.totalActiveSince = now;
    timer.itemActiveSince = now;
  }
  function finishQueueTimer(timer) {
    if (!timer || timer.complete) {
      return;
    }
    const now = Date.now();
    commitQueueTimer(timer, now);
    if (timer.pausedAt !== void 0) {
      timer.pausedMs += Math.max(0, now - timer.pausedAt);
      timer.pausedAt = void 0;
    }
    timer.complete = true;
  }
  function queueTimingSnapshot(timer, itemKey) {
    if (!timer) {
      return void 0;
    }
    const now = Date.now();
    if (itemKey && itemKey !== timer.itemKey) {
      if (timer.itemKey === void 0) {
        timer.itemKey = itemKey;
      } else {
        if (timer.itemActiveSince !== void 0) {
          timer.itemActiveMs += Math.max(0, now - timer.itemActiveSince);
        }
        timer.itemKey = itemKey;
        timer.itemActiveMs = 0;
        timer.itemActiveSince = timer.pausedAt === void 0 && !timer.complete ? now : void 0;
      }
    }
    const running = timer.pausedAt === void 0 && !timer.complete;
    return {
      startedAt: timer.startedAt,
      updatedAt: now,
      elapsedMs: timer.totalActiveMs + (running && timer.totalActiveSince !== void 0 ? Math.max(0, now - timer.totalActiveSince) : 0),
      itemElapsedMs: timer.itemActiveMs + (running && timer.itemActiveSince !== void 0 ? Math.max(0, now - timer.itemActiveSince) : 0),
      pausedMs: timer.pausedMs + (timer.pausedAt !== void 0 ? Math.max(0, now - timer.pausedAt) : 0),
      isPaused: timer.pausedAt !== void 0,
      isComplete: timer.complete
    };
  }
  var loggedUploadCandidateRequestIds = /* @__PURE__ */ new Set();
  var MANUAL_STOP_MESSAGE = "Posting stopped by user.";
  var FACEBOOK_POST_LIMIT_PATTERN = /\bwe\s+limit\s+how\s+often\s+you\b/i;
  var FACEBOOK_OTHER_POSTING_RESTRICTION_PATTERN = /\b(?:temporarily\s+(?:blocked|restricted)|posting\s+(?:has\s+been\s+)?(?:limited|restricted)|posting\s+limit|rate\s+limit)\b/i;
  var FACEBOOK_RATE_LIMIT_ERROR_CODE_PATTERN = /"code"\s*:\s*1390008\b/;
  var FACEBOOK_RATE_LIMIT_API_ERROR_CODE_PATTERN = /"api_error_code"\s*:\s*368\b/;
  var FACEBOOK_PENDING_CONTENT_LIMIT_PATTERN = /limit\s+for\s+pending\s+content\s+in\s+this\s+group/i;
  var FACEBOOK_PENDING_CONTENT_LIMIT_ERROR_CODE_PATTERN = /"code"\s*:\s*1357006\b/;
  var FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE = "You're at the limit for pending content in this group.";
  var FACEBOOK_RATE_LIMIT_MESSAGE = "Facebook has temporarily limited posting. Stop and try again later.";
  var FACEBOOK_UNCONFIRMED_POST_MESSAGE = "Facebook did not confirm whether the first post was submitted. Check Facebook before trying again.";
  var LAST_GROUP_POSTING_STATUS_STORAGE_KEY = "lastGroupPostingStatus";
  void chrome.storage.local.remove(LAST_GROUP_POSTING_STATUS_STORAGE_KEY);
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });
  void syncSidePanelForCurrentTab();
  chrome.tabs.onActivated.addListener(() => {
    void syncSidePanelForCurrentTab();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.status && !changeInfo.url) {
      return;
    }
    void updateSidePanelAccessForTab(tabId, tab.url);
  });
  chrome.action.onClicked.addListener((tab) => {
    if (!tab.windowId || !isFacebookUrl(tab.url)) {
      return;
    }
    void chrome.sidePanel.open({ windowId: tab.windowId });
  });
  function debugLog(message, data) {
    if (!VERBOSE_POSTING_LOGS) return;
    if (data === void 0) {
      console.log(`${LOG_PREFIX} ${message}`);
      return;
    }
    console.log(`${LOG_PREFIX} ${message}`, data);
  }
  function debugWarn(message, data) {
    postingDiagnostics.record("warning", { errorMessage: message.slice(0, 256) });
    if (data === void 0) {
      console.warn(`${LOG_PREFIX} ${message}`);
      return;
    }
    console.warn(`${LOG_PREFIX} ${message}`, data);
  }
  function isFacebookUrl(url) {
    if (!url) {
      return false;
    }
    try {
      return FACEBOOK_HOSTS.has(new URL(url).hostname);
    } catch {
      return false;
    }
  }
  async function syncSidePanelForCurrentTab() {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!activeTab?.id) {
      return;
    }
    await updateSidePanelAccessForTab(activeTab.id, activeTab.url);
  }
  async function updateSidePanelAccessForTab(tabId, url) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: isFacebookUrl(url)
    });
  }
  function extractCookieNamesFromHeader(cookieHeader) {
    if (!cookieHeader) {
      return [];
    }
    return cookieHeader.split(";").map((part) => part.trim()).filter(Boolean).map((part) => part.split("=")[0]?.trim()).filter((name) => Boolean(name));
  }
  async function logCookieDiagnostics(label, url, requestHeaders) {
    try {
      const cookieHeader = requestHeaders?.cookie;
      const headerCookieNames = extractCookieNamesFromHeader(cookieHeader);
      const browserCookies = await chrome.cookies.getAll({ url });
      debugLog(`${label} cookie diagnostics.`, {
        url,
        requestCookieHeaderPresent: Boolean(cookieHeader),
        requestCookieCount: headerCookieNames.length,
        requestCookieNames: headerCookieNames,
        browserCookieCount: browserCookies.length,
        browserCookieNames: browserCookies.map((cookie) => cookie.name)
      });
    } catch (error) {
      debugWarn(`${label} cookie diagnostics failed.`, {
        url,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.method !== "POST" || !details.requestBody) {
        return void 0;
      }
      const shouldCaptureGroups = captureTabId !== void 0 && details.tabId === captureTabId;
      const shouldCapturePosting = postingCaptureTabId !== void 0 && details.tabId === postingCaptureTabId;
      if (!shouldCaptureGroups && !shouldCapturePosting) {
        return void 0;
      }
      const { body, formData } = readRequestBody(
        details.requestBody
      );
      const pending = pendingRequests.get(details.requestId) ?? {};
      pending.url = details.url;
      pending.method = details.method;
      pending.body = body;
      pending.formData = formData;
      pendingRequests.set(details.requestId, pending);
      maybeCaptureRequest(details.requestId, details.tabId);
      return void 0;
    },
    {
      urls: [
        "https://www.facebook.com/api/graphql/*",
        "https://web.facebook.com/api/graphql/*",
        "https://upload.facebook.com/ajax/react_composer/attachments/photo/upload*",
        "https://www.facebook.com/ajax/react_composer/attachments/photo/upload*",
        "https://web.facebook.com/ajax/react_composer/attachments/photo/upload*"
      ]
    },
    ["requestBody"]
  );
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const shouldCaptureGroups = captureTabId !== void 0 && details.tabId === captureTabId;
      const shouldCapturePosting = postingCaptureTabId !== void 0 && details.tabId === postingCaptureTabId;
      if (!shouldCaptureGroups && !shouldCapturePosting) {
        return void 0;
      }
      const pending = pendingRequests.get(details.requestId) ?? {};
      pending.url = details.url;
      pending.method = details.method;
      pending.headers = normalizeHeaders(details.requestHeaders ?? []);
      pendingRequests.set(details.requestId, pending);
      maybeCaptureRequest(details.requestId, details.tabId);
      return void 0;
    },
    {
      urls: [
        "https://www.facebook.com/api/graphql/*",
        "https://web.facebook.com/api/graphql/*",
        "https://upload.facebook.com/ajax/react_composer/attachments/photo/upload*",
        "https://www.facebook.com/ajax/react_composer/attachments/photo/upload*",
        "https://web.facebook.com/ajax/react_composer/attachments/photo/upload*"
      ]
    },
    ["requestHeaders", "extraHeaders"]
  );
  var captureRequestFilter = {
    urls: [
      "https://www.facebook.com/api/graphql/*",
      "https://web.facebook.com/api/graphql/*",
      "https://upload.facebook.com/ajax/react_composer/attachments/photo/upload*",
      "https://www.facebook.com/ajax/react_composer/attachments/photo/upload*",
      "https://web.facebook.com/ajax/react_composer/attachments/photo/upload*"
    ]
  };
  function releaseCapturedRequest(details) {
    pendingRequests.delete(details.requestId);
    loggedUploadCandidateRequestIds.delete(details.requestId);
  }
  chrome.webRequest.onCompleted.addListener(releaseCapturedRequest, captureRequestFilter);
  chrome.webRequest.onErrorOccurred.addListener(releaseCapturedRequest, captureRequestFilter);
  listenForPostingRequests(startUiPostingRequest);
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SCHEDULED_POSTING_ALARM) {
      void startScheduledPosting().catch(handleScheduledPostingFailure);
    }
  });
  void restoreScheduledPosting().catch(handleScheduledPostingFailure);
  async function startUiPostingRequest(request) {
    if (activePosting || postingRequestStartInProgress) {
      return { ok: false, error: "Posting is already in progress." };
    }
    postingRequestStartInProgress = true;
    try {
      const pending = await getScheduledPosting();
      if (pending) {
        return { ok: false, error: "Posting is already in progress." };
      }
      if (request.scheduledAt !== void 0) {
        const scheduledAt = Date.parse(request.scheduledAt);
        if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
          return {
            ok: false,
            error: "Choose a future date and time for your post."
          };
        }
        const scheduled = { request, scheduledAt };
        try {
          await chrome.alarms.create(SCHEDULED_POSTING_ALARM, {
            when: scheduledAt
          });
          await saveScheduledPosting(scheduled);
        } catch (error) {
          await chrome.alarms.clear(SCHEDULED_POSTING_ALARM);
          throw error;
        }
        try {
          await chrome.storage.session.remove(
            LAST_GROUP_POSTING_STATUS_STORAGE_KEY
          );
        } catch (error) {
          debugWarn("Could not clear the previous posting status.", error);
        }
        notifyUiPostingStatus(createScheduledStatus(scheduled));
        return { ok: true };
      }
      void runGraphqlPostingQueue(request);
      return { ok: true };
    } catch (error) {
      if (request.scheduledAt !== void 0) {
        debugWarn("Could not schedule the posting queue.", error);
        return {
          ok: false,
          error: "Could not schedule this queue. Check that Chrome storage is available and try again."
        };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Could not start posting."
      };
    } finally {
      postingRequestStartInProgress = false;
    }
  }
  function createScheduledStatus(scheduled) {
    const total = new Set(scheduled.request.groups.map((group) => group.id)).size;
    return {
      status: "scheduled",
      message: "Your queue is scheduled.",
      scheduledAt: new Date(scheduled.scheduledAt).toISOString(),
      current: 0,
      total,
      successCount: 0,
      failedCount: 0,
      processedCount: 0,
      successTarget: total
    };
  }
  async function restoreScheduledPosting() {
    const scheduled = await getScheduledPosting();
    if (!scheduled) return;
    if (scheduled.scheduledAt <= Date.now()) {
      await startScheduledPosting();
      return;
    }
    const alarm = await chrome.alarms.get(SCHEDULED_POSTING_ALARM);
    if (!alarm || Math.abs(alarm.scheduledTime - scheduled.scheduledAt) > 1e3) {
      await chrome.alarms.create(SCHEDULED_POSTING_ALARM, {
        when: scheduled.scheduledAt
      });
    }
    notifyUiPostingStatus(createScheduledStatus(scheduled));
  }
  function startScheduledPosting() {
    if (scheduledQueueStartPromise) return scheduledQueueStartPromise;
    scheduledQueueStartPromise = startScheduledPostingQueue().finally(() => {
      scheduledQueueStartPromise = void 0;
    });
    return scheduledQueueStartPromise;
  }
  async function startScheduledPostingQueue() {
    const scheduled = await getScheduledPosting();
    if (!scheduled) {
      await chrome.alarms.clear(SCHEDULED_POSTING_ALARM);
      return;
    }
    if (scheduled.scheduledAt > Date.now()) {
      await chrome.alarms.create(SCHEDULED_POSTING_ALARM, {
        when: scheduled.scheduledAt
      });
      return;
    }
    if (activePosting || postingRequestStartInProgress) {
      await chrome.alarms.create(SCHEDULED_POSTING_ALARM, {
        when: Date.now() + 6e4
      });
      return;
    }
    postingRequestStartInProgress = true;
    try {
      const claimed = await takeScheduledPosting();
      if (!claimed) return;
      if (activePosting) {
        await saveScheduledPosting(claimed);
        await chrome.alarms.create(SCHEDULED_POSTING_ALARM, {
          when: Date.now() + 6e4
        });
        return;
      }
      void chrome.alarms.clear(SCHEDULED_POSTING_ALARM);
      void runGraphqlPostingQueue({
        ...claimed.request,
        startedAt: Date.now(),
        scheduledAt: void 0
      });
    } finally {
      postingRequestStartInProgress = false;
    }
  }
  async function cancelScheduledPosting() {
    const scheduled = await getScheduledPosting();
    if (!scheduled || !await removeScheduledPosting()) return false;
    try {
      await chrome.alarms.clear(SCHEDULED_POSTING_ALARM);
    } catch (error) {
      debugWarn("Could not clear the scheduled posting alarm.", error);
    }
    notifyUiPostingStatus({
      status: "stopped",
      message: "Scheduled posting cancelled.",
      current: 0,
      total: new Set(scheduled.request.groups.map((group) => group.id)).size,
      successCount: 0,
      failedCount: 0,
      processedCount: 0
    });
    return true;
  }
  async function stopUiPosting() {
    try {
      if (await cancelScheduledPosting()) return { ok: true };
    } catch (error) {
      if (!activePosting) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unable to stop posting."
        };
      }
    }
    if (!activePosting) {
      return { ok: false, error: "Posting is not running." };
    }
    stopPostingRequested = true;
    pausePostingRequested = false;
    sendContentPostingControl("STOP_CREATE_POST");
    notifyPostingControlStatus(
      "posting",
      "Stopping posting after the current Facebook action finishes..."
    );
    return { ok: true };
  }
  function handleScheduledPostingFailure(error) {
    const detail = error instanceof Error ? error.message : String(error);
    debugWarn("Could not restore or start the scheduled queue.", detail);
    void removeScheduledPosting().then(async (removed) => {
      await chrome.alarms.clear(SCHEDULED_POSTING_ALARM);
      if (!removed) return;
      notifyUiPostingStatus({
        status: "stopped",
        message: "The scheduled queue could not be started. Please schedule it again.",
        current: 0,
        total: 0
      });
    }).catch((cleanupError) => {
      debugWarn(
        "Could not clear the failed scheduled queue.",
        cleanupError instanceof Error ? cleanupError.message : cleanupError
      );
    });
  }
  chrome.runtime.onMessage.addListener(
    (request, _sender, sendResponse) => {
      if (request.type === "POSTING_HEARTBEAT") {
        sendResponse({ ok: true });
        return;
      }
      if (request.type === "GET_POSTING_QUEUE_STATUS") {
        void Promise.all([
          chrome.storage.session.get(LAST_GROUP_POSTING_STATUS_STORAGE_KEY),
          getScheduledPosting()
        ]).then(([storage, scheduled]) => {
          const storedStatus = storage[LAST_GROUP_POSTING_STATUS_STORAGE_KEY];
          const groups = scheduled ? {
            type: "UI_POSTING_STATUS",
            ...createScheduledStatus(scheduled)
          } : latestUiPostingStatus ?? storedStatus;
          sendResponse({
            groups: groups ? {
              ...groups,
              timing: queueTimingSnapshot(groupsPostingTimer, groups.groupId) ?? groups.timing
            } : void 0
          });
        }).catch((error) => {
          debugWarn(
            "Could not read the posting queue status.",
            error instanceof Error ? error.message : error
          );
          sendResponse({ groups: latestUiPostingStatus });
        });
        return true;
      }
      if (request.type === "LOAD_GROUPS") {
        void loadGroups().then((groups) => sendResponse({ ok: true, groups })).catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Unable to load groups."
          });
        });
        return true;
      }
      if (request.type === "START_UI_POSTING") {
        void startUiPostingRequest(request).then(sendResponse);
        return true;
      }
      if (request.type === "STOP_UI_POSTING") {
        void stopUiPosting().then(sendResponse);
        return true;
      }
      if (request.type === "PAUSE_UI_POSTING") {
        if (!activePosting) {
          sendResponse({ ok: false, error: "Posting is not running." });
          return false;
        }
        pausePostingRequested = true;
        applyPostingPauseState(
          postingNetworkOffline ? "Internet connection lost. Posting paused until the connection returns." : "Posting paused."
        );
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "RESUME_UI_POSTING") {
        if (!activePosting) {
          sendResponse({ ok: false, error: "Posting is not running." });
          return false;
        }
        pausePostingRequested = false;
        applyPostingPauseState(
          postingNetworkOffline ? "Internet connection lost. Posting paused until the connection returns." : "Posting resumed."
        );
        sendResponse({ ok: true });
        return false;
      }
      return false;
    }
  );
  function readRequestBody(requestBody) {
    const normalizedFormData = {};
    if (requestBody.formData) {
      const params = new URLSearchParams();
      for (const [key, values] of Object.entries(requestBody.formData)) {
        const firstValue = values?.[0] ?? "";
        normalizedFormData[key] = firstValue;
        for (const value of values ?? []) {
          params.append(key, value);
        }
      }
      return {
        body: params.toString(),
        formData: normalizedFormData
      };
    }
    const rawBody = requestBody.raw?.[0]?.bytes;
    if (!rawBody) {
      return { body: "", formData: normalizedFormData };
    }
    return {
      body: new TextDecoder().decode(rawBody),
      formData: normalizedFormData
    };
  }
  function normalizeHeaders(headers) {
    const normalized = {};
    for (const header of headers) {
      if (!header.name || !header.value) {
        continue;
      }
      normalized[header.name.toLowerCase()] = header.value;
    }
    return normalized;
  }
  function maybeCaptureRequest(requestId, tabId) {
    const pending = pendingRequests.get(requestId);
    if (!pending?.url || !pending?.method || !pending?.headers) {
      return;
    }
    const body = pending.body ?? "";
    const formData = pending.formData ?? {};
    const params = new URLSearchParams(body);
    const friendlyName = pending.headers["x-fb-friendly-name"] ?? formData.fb_api_req_friendly_name ?? params.get("fb_api_req_friendly_name") ?? "";
    if (tabId === captureTabId && friendlyName === GROUPS_QUERY_FRIENDLY_NAME && body.length > 0) {
      capturedGroupsRequest = {
        url: pending.url,
        method: pending.method,
        body,
        headers: pending.headers,
        formData: formDataFromBody(body, formData)
      };
      debugLog("Captured joined groups GraphQL request.", {
        url: pending.url,
        friendlyName
      });
      void logCookieDiagnostics(
        "Captured joined groups request",
        pending.url,
        pending.headers
      );
      pendingRequests.delete(requestId);
      return;
    }
    if (tabId !== postingCaptureTabId) {
      return;
    }
    const isUploadCandidate = matchesUploadCandidateUrl(pending.url);
    if (isUploadCandidate && !loggedUploadCandidateRequestIds.has(requestId)) {
      loggedUploadCandidateRequestIds.add(requestId);
      debugLog("Saw upload candidate request.", {
        url: pending.url,
        method: pending.method,
        contentType: pending.headers["content-type"],
        friendlyName,
        hasBody: body.length > 0,
        formKeys: Object.keys(formData)
      });
    }
    if (isUploadCandidate && pending.method === "POST" && !capturedUploadTemplate) {
      capturedUploadTemplate = {
        url: pending.url,
        method: pending.method,
        body,
        headers: pending.headers,
        formData: formDataFromBody(body, formData)
      };
      debugLog("Captured upload template request.", {
        url: pending.url,
        formKeys: Object.keys(capturedUploadTemplate.formData)
      });
      void logCookieDiagnostics(
        "Captured upload template",
        pending.url,
        pending.headers
      );
    }
    if (friendlyName === POST_MUTATION_FRIENDLY_NAME && pending.method === "POST" && body.length > 0 && !capturedPostTemplate) {
      capturedPostTemplate = {
        url: pending.url,
        method: pending.method,
        body,
        headers: pending.headers,
        formData: formDataFromBody(body, formData)
      };
      debugLog("Captured post mutation template request.", {
        url: pending.url,
        friendlyName,
        formKeys: Object.keys(capturedPostTemplate.formData)
      });
      void logCookieDiagnostics(
        "Captured post mutation template",
        pending.url,
        pending.headers
      );
    }
    if ((capturedUploadTemplate || !isUploadCandidate) && (capturedPostTemplate || friendlyName !== POST_MUTATION_FRIENDLY_NAME)) {
      pendingRequests.delete(requestId);
    }
  }
  function matchesUploadCandidateUrl(url) {
    return UPLOAD_CANDIDATE_MATCHES.some((candidate) => url.includes(candidate));
  }
  function formDataFromBody(body, explicitFormData) {
    if (Object.keys(explicitFormData).length > 0) {
      return explicitFormData;
    }
    const formData = {};
    const params = new URLSearchParams(body);
    for (const [key, value] of params.entries()) {
      formData[key] = value;
    }
    return formData;
  }
  async function loadGroups() {
    capturedGroupsRequest = void 0;
    pendingRequests.clear();
    notifyGroupsStatus("Starting group extraction...", 0);
    try {
      notifyGroupsStatus("Preparing current tab...", 0);
      const tab = await getActiveTabForLoadingGroups();
      captureTabId = tab.id;
      notifyGroupsStatus("Opening Facebook joined groups page...", 0);
      await navigateToJoinedGroups(tab.id);
      notifyGroupsStatus("Facebook joined groups page loaded.", 0);
      notifyGroupsStatus(
        "Changing joined groups sort to trigger Facebook groups request...",
        0
      );
      capturedGroupsRequest = void 0;
      await triggerJoinedGroupsSortRequest(tab.id);
      notifyGroupsStatus("Waiting for fresh Facebook groups request...", 0);
      const capturedRequest = await waitForCapturedGroupsRequest(tab.id);
      notifyGroupsStatus("Captured groups request. Preparing extraction...", 0);
      const config = updateFetchGroupsConfigFromCapturedRequest(capturedRequest);
      notifyGroupsStatus("Fetching groups page 1...", 0);
      const groups = await extractAllGroups(tab.id, config);
      const uniqueGroups = shuffleGroups(dedupeGroups(groups));
      notifyGroupsStatus(
        `Finished loading ${uniqueGroups.length} groups.`,
        uniqueGroups.length,
        true
      );
      return uniqueGroups;
    } finally {
      captureTabId = void 0;
      if (postingCaptureTabId === void 0) pendingRequests.clear();
    }
  }
  async function getActiveTabForLoadingGroups() {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (activeTab?.id !== void 0 && isFacebookUrl(activeTab.url)) {
      return activeTab;
    }
    throw new Error(
      "Open Facebook first. This extension only works on facebook.com."
    );
  }
  async function getActiveTabForPosting() {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!activeTab?.id) {
      throw new Error("Unable to find the active tab for posting.");
    }
    if (!isFacebookUrl(activeTab.url)) {
      throw new Error(
        "Open Facebook first. This extension only works on facebook.com."
      );
    }
    return activeTab;
  }
  async function navigateToJoinedGroups(tabId) {
    if (!tabId) {
      throw new Error("Unable to open joined groups in the current tab.");
    }
    await chrome.tabs.update(tabId, { url: JOINED_GROUPS_URL });
    await waitForJoinedGroupsPage(tabId);
    await waitForPageDomReady(tabId, "/groups/joins/");
  }
  async function waitForJoinedGroupsPage(tabId) {
    while (true) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        if (tab.url?.includes("/groups/joins/")) {
          return;
        }
        if (tab.url && isFacebookUrl(tab.url) && /^\/(?:login|checkpoint)(?:\/|$)/.test(new URL(tab.url).pathname)) {
          throw new Error(
            "Could not find your groups. Check that you are signed in to Facebook and try again."
          );
        }
      }
      await sleep(250);
    }
  }
  async function waitForPageDomReady(tabId, urlIncludes) {
    while (true) {
      await chrome.tabs.get(tabId);
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: inspectPageReadinessInPage,
          args: [urlIncludes]
        });
        if (result?.result) {
          return;
        }
      } catch {
      }
      await sleep(250);
    }
  }
  async function triggerJoinedGroupsSortRequest(tabId) {
    if (!tabId) {
      throw new Error("Unable to trigger joined groups sort.");
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: triggerJoinedGroupsSortRequestInPage
    });
    const value = result?.result;
    if (!value?.ok) {
      throw new Error(value?.error ?? "Unable to trigger joined groups sort.");
    }
  }
  async function triggerJoinedGroupsSortRequestInPage() {
    const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const clickElement = (element) => {
      element.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window
        })
      );
      element.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window
        })
      );
      element.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window
        })
      );
    };
    let lastChangedAt = Date.now();
    const observer = new MutationObserver(() => {
      lastChangedAt = Date.now();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "aria-busy",
        "aria-expanded",
        "aria-hidden",
        "aria-checked",
        "hidden",
        "disabled"
      ]
    });
    const waitForStableDom = async () => {
      while (document.readyState !== "complete" || Array.from(document.querySelectorAll('[aria-busy="true"]')).some(
        isVisible
      ) || Date.now() - lastChangedAt < 1500) {
        await wait(250);
      }
    };
    const findSortTrigger = () => {
      const root = document.querySelector('[role="main"]') ?? document;
      const candidates = Array.from(
        root.querySelectorAll(
          '[role="button"][tabindex="0"][aria-haspopup="menu"][aria-expanded]'
        )
      ).filter((button) => {
        if (!isVisible(button) || button.getAttribute("aria-disabled") === "true" || button.closest(
          'article, [role="article"], [role="dialog"], [role="navigation"], [role="banner"]'
        ) || button.querySelector('svg, img, i, a, input, [contenteditable="true"]'))
          return false;
        const label = button.querySelector(":scope > span");
        const overlay = button.querySelector(
          ':scope > [role="none"][data-visualcompletion="ignore"]'
        );
        return Boolean(label?.textContent?.trim()) && Boolean(overlay) && label?.textContent?.trim() === button.textContent?.trim();
      });
      if (candidates.length === 1) return candidates[0];
      const matches = candidates.filter(
        (button) => button.querySelector(":scope > span.x6prxxf.xvq8zen.xo1l8bm.x1fey0fg")
      );
      return matches.length === 1 ? matches[0] : void 0;
    };
    const visibleOptions = () => Array.from(
      document.querySelectorAll('[role="menuitemradio"]')
    ).filter(isVisible);
    try {
      let trigger;
      while (!trigger) {
        await waitForStableDom();
        trigger = findSortTrigger();
        if (!trigger) await wait(250);
      }
      const previousOptions = new Set(visibleOptions());
      clickElement(trigger);
      lastChangedAt = Date.now();
      while (true) {
        await waitForStableDom();
        if (!trigger.isConnected) {
          throw new Error(
            "The joined groups sort control changed. Please load groups again."
          );
        }
        const options = visibleOptions().filter(
          (option) => !previousOptions.has(option)
        );
        const menus = new Set(
          options.map((option) => option.closest('[role="menu"]'))
        );
        if (trigger.getAttribute("aria-expanded") === "true" && options.length >= 2 && menus.size === 1) {
          const sortOption = options.find(
            (option) => option.getAttribute("aria-checked") === "false"
          );
          if (sortOption) {
            clickElement(sortOption);
            return { ok: true };
          }
        }
        await wait(250);
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to trigger joined groups sort."
      };
    } finally {
      observer.disconnect();
    }
  }
  async function waitForCapturedGroupsRequest(tabId) {
    while (true) {
      if (capturedGroupsRequest) {
        return capturedGroupsRequest;
      }
      await chrome.tabs.get(tabId);
      await sleep(250);
    }
  }
  function updateFetchGroupsConfigFromCapturedRequest(capturedRequest) {
    const formData = { ...capturedRequest.formData };
    if (!formData.fb_api_req_friendly_name) {
      formData.fb_api_req_friendly_name = GROUPS_QUERY_FRIENDLY_NAME;
    }
    return {
      formData,
      headers: capturedRequest.headers
    };
  }
  async function extractAllGroups(tabId, config) {
    if (!tabId) {
      throw new Error("Unable to read groups from joined groups tab.");
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: fetchAllGroupsInPage,
      args: [config, GROUPS_QUERY_FRIENDLY_NAME]
    });
    const value = result?.result;
    if (!value) {
      throw new Error("Facebook did not return group data.");
    }
    if (!Array.isArray(value) && "error" in value) {
      throw new Error(value.error);
    }
    return value;
  }
  async function fetchAllGroupsInPage(config, groupsQueryFriendlyName) {
    try {
      const notifyGroupsStatus2 = (message, loadedCount, done = false) => {
        void chrome.runtime.sendMessage({
          type: "GROUP_EXTRACTION_STATUS",
          message,
          loadedCount,
          done
        });
      };
      const buildReplayHeaders = (headers) => {
        const allowedHeaders = [
          "accept",
          "accept-language",
          "content-type",
          "x-asbd-id",
          "x-fb-friendly-name",
          "x-fb-lsd"
        ];
        const replayHeaders = {};
        for (const header of allowedHeaders) {
          if (headers[header]) {
            replayHeaders[header] = headers[header];
          }
        }
        replayHeaders["content-type"] = replayHeaders["content-type"] ?? "application/x-www-form-urlencoded";
        replayHeaders["x-fb-friendly-name"] = groupsQueryFriendlyName;
        return replayHeaders;
      };
      const allGroups = [];
      let cursor = null;
      for (let page = 0; page < 100; page += 1) {
        notifyGroupsStatus2(
          `Fetching groups page ${page + 1}...`,
          allGroups.length
        );
        const params = new URLSearchParams(config.formData);
        params.set(
          "variables",
          JSON.stringify({
            count: 20,
            cursor,
            ordering: ["name"],
            scale: 1
          })
        );
        const response = await fetch("https://web.facebook.com/api/graphql/", {
          method: "POST",
          credentials: "include",
          headers: buildReplayHeaders(config.headers),
          body: params.toString()
        });
        if (!response.ok) {
          throw new Error(
            `Facebook groups request failed with ${response.status}.`
          );
        }
        const json = await response.json();
        const tabGroupsList = json?.data?.viewer?.all_joined_groups?.tab_groups_list;
        const edges = tabGroupsList?.edges ?? [];
        for (const edge of edges) {
          const node = edge?.node;
          if (!node?.id || !node?.name) {
            continue;
          }
          allGroups.push({
            id: node.id,
            name: node.name,
            url: node.url ?? `https://web.facebook.com/groups/${node.id}`,
            viewer_join_state: node.viewer_join_state,
            viewer_last_visited_time: node.viewer_last_visited_time
          });
        }
        notifyGroupsStatus2(
          `Loaded ${allGroups.length} groups so far.`,
          allGroups.length
        );
        if (!tabGroupsList?.page_info?.has_next_page) {
          break;
        }
        cursor = tabGroupsList.page_info.end_cursor;
        notifyGroupsStatus2(
          `Fetching next page. ${allGroups.length} groups loaded.`,
          allGroups.length
        );
      }
      notifyGroupsStatus2(
        `Finished loading ${allGroups.length} groups.`,
        allGroups.length,
        true
      );
      return allGroups;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Unable to fetch groups."
      };
    }
  }
  function dedupeGroups(groups) {
    const seen = /* @__PURE__ */ new Set();
    return groups.filter((group) => {
      const key = group.id || group.url;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  function notifyGroupsStatus(message, loadedCount, done = false) {
    const status = {
      type: "GROUP_EXTRACTION_STATUS",
      message,
      loadedCount,
      done
    };
    void chrome.runtime.sendMessage(status).catch(() => {
    });
  }
  function sleep(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
  }
  function currentPostingStatusContext() {
    const latest = latestUiPostingStatus;
    return {
      current: latest?.current ?? 0,
      total: latest?.total ?? 0,
      groupId: latest?.groupId,
      groupName: latest?.groupName,
      successCount: latest?.successCount ?? 0,
      failedCount: latest?.failedCount ?? 0,
      processedCount: latest?.processedCount ?? 0
    };
  }
  function applyPostingPauseState(message) {
    if (!activePosting) return;
    const shouldPause = pausePostingRequested || postingNetworkOffline;
    const wasPaused = queuePauseApplied;
    if (shouldPause !== wasPaused) {
      if (shouldPause) {
        pauseQueueTimer(groupsPostingTimer);
        sendContentPostingControl("PAUSE_CREATE_POST");
      } else {
        resumeQueueTimer(groupsPostingTimer);
        sendContentPostingControl("RESUME_CREATE_POST");
      }
      queuePauseApplied = shouldPause;
    }
    if (shouldPause) {
      if (message || !pauseNotificationSent) {
        notifyPostingControlStatus(
          "paused",
          message ?? (postingNetworkOffline ? "Internet connection lost. Posting paused until the connection returns." : "Posting paused.")
        );
      }
      pauseNotificationSent = true;
    } else if (wasPaused || message) {
      notifyPostingControlStatus("posting", message ?? "Posting resumed.");
      pauseNotificationSent = false;
    }
  }
  function setPostingNetworkOffline(offline) {
    if (postingNetworkOffline === offline) return;
    postingNetworkOffline = offline;
    if (!activePosting) return;
    applyPostingPauseState(
      offline ? "Internet connection lost. Posting paused until the connection returns." : pausePostingRequested ? "Internet connection restored. Posting remains paused until you resume." : "Internet connection restored. Resuming posting."
    );
  }
  function startPostingConnectivityMonitor() {
    if (typeof fetch !== "function") {
      return { ready: Promise.resolve(), stop: () => {
      } };
    }
    let stopped = false;
    let controller;
    let wakeMonitor;
    let failures = 0;
    let sampled = false;
    let resolveReady;
    const ready = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const sample = async () => {
      let online = false;
      if (typeof navigator === "undefined" || navigator.onLine) {
        const probeController = new AbortController();
        controller = probeController;
        const timeout = setTimeout(() => probeController.abort(), 3e3);
        try {
          const responses = await Promise.all(
            [
              "https://www.facebook.com/robots.txt",
              "https://web.facebook.com/robots.txt"
            ].map((url) => probePostingUrl(url, probeController.signal))
          );
          online = responses.some(Boolean);
        } finally {
          clearTimeout(timeout);
          controller = void 0;
        }
      }
      if (stopped) return;
      if (online) {
        failures = 0;
        sampled = true;
        setPostingNetworkOffline(false);
      } else {
        failures += 1;
        if (!sampled || failures >= 2) {
          sampled = true;
          setPostingNetworkOffline(true);
        }
      }
    };
    const monitor = async () => {
      try {
        await sample();
        resolveReady();
        while (!stopped && activePosting) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, postingNetworkOffline ? 3e3 : 3e4);
            wakeMonitor = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wakeMonitor = void 0;
          if (!stopped) await sample();
        }
      } catch (error) {
        resolveReady();
        debugWarn("Posting connectivity monitor failed.", error);
      }
    };
    void monitor();
    return {
      ready,
      stop: () => {
        stopped = true;
        controller?.abort();
        wakeMonitor?.();
        resolveReady();
      }
    };
  }
  function isNetworkTransportFailure(error) {
    if (typeof navigator !== "undefined" && !navigator.onLine) return true;
    return /failed to fetch|network(?:error| request failed)|load failed|err_(?:network|internet_disconnected|connection|name_not_resolved|address_unreachable|timed_out)|connection (?:reset|closed|lost|refused|timed out)/i.test(
      error ?? ""
    );
  }
  function throwIfPostingStopped() {
    if (activePosting && stopPostingRequested) {
      throw new Error(MANUAL_STOP_MESSAGE);
    }
  }
  async function waitWhilePostingPaused(statusContext = currentPostingStatusContext()) {
    while (activePosting && (pausePostingRequested || postingNetworkOffline)) {
      throwIfPostingStopped();
      if (!pauseNotificationSent) {
        notifyUiPostingStatus({
          status: "paused",
          message: postingNetworkOffline ? "Internet connection lost. Posting paused until the connection returns." : statusContext.groupName ? `Posting paused before ${statusContext.groupName}.` : "Posting paused.",
          current: statusContext.current,
          total: statusContext.total,
          groupId: statusContext.groupId,
          groupName: statusContext.groupName,
          successCount: statusContext.successCount,
          failedCount: statusContext.failedCount,
          processedCount: statusContext.processedCount
        });
        pauseNotificationSent = true;
      }
      await sleep(250);
    }
    throwIfPostingStopped();
  }
  async function sleepWithStopChecks(durationMs, statusContext, intervalMs = 250) {
    let remaining = durationMs;
    while (remaining > 0) {
      throwIfPostingStopped();
      await waitWhilePostingPaused(statusContext);
      const step = Math.min(intervalMs, remaining);
      await sleep(step);
      remaining -= step;
    }
  }
  async function sleepWithPostingCountdown(durationSeconds, statusContext) {
    for (let remaining = durationSeconds; remaining > 0; remaining -= 1) {
      throwIfPostingStopped();
      await waitWhilePostingPaused(statusContext);
      notifyUiPostingStatus({
        status: "waiting",
        message: `Next post in ${formatPostingCountdown(remaining)}`,
        current: statusContext.current,
        total: statusContext.total,
        groupId: statusContext.groupId,
        groupName: statusContext.groupName,
        successCount: statusContext.successCount,
        failedCount: statusContext.failedCount,
        processedCount: statusContext.processedCount
      });
      await sleepWithStopChecks(1e3, statusContext);
    }
  }
  function formatPostingCountdown(durationSeconds) {
    const totalSeconds = Math.max(0, Math.floor(durationSeconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    const minuteText = String(minutes).padStart(2, "0");
    const secondText = String(seconds).padStart(2, "0");
    return hours > 0 ? `${hours}:${minuteText}:${secondText}` : `${minuteText}:${secondText}`;
  }
  function randomIntegerBetween(minimum, maximum) {
    return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
  }
  async function runGraphqlPostingQueue(request) {
    const selectedGroups = shuffleGroups([
      ...new Map(request.groups.map((group) => [group.id, group])).values()
    ]);
    const targetGroupCount = selectedGroups.length;
    let groups = [...selectedGroups];
    const requestedPosts = request.posts.filter(
      (post) => post.body.trim().length > 0 && post.images.length > 0
    );
    const firstPostWithImagesIndex = requestedPosts.findIndex(
      (post) => post.images.length > 0
    );
    const posts = firstPostWithImagesIndex > 0 ? [
      ...requestedPosts.slice(firstPostWithImagesIndex),
      ...requestedPosts.slice(0, firstPostWithImagesIndex)
    ] : requestedPosts;
    const requestedMinimumDelay = Number(request.minimumDelaySeconds);
    const minimumDelaySeconds = Number.isInteger(requestedMinimumDelay) && requestedMinimumDelay >= MIN_POSTING_DELAY_SECONDS ? requestedMinimumDelay : MIN_POSTING_DELAY_SECONDS;
    const requestedMaximumDelay = Number(request.maximumDelaySeconds);
    const maximumDelaySeconds = Number.isInteger(requestedMaximumDelay) && requestedMaximumDelay >= minimumDelaySeconds ? requestedMaximumDelay : minimumDelaySeconds;
    debugLog("Starting posting queue.", {
      mode: "UI capture followed by GraphQL posting",
      requestedGroups: request.groups.length,
      groups: groups.length,
      targetGroupCount,
      posts: posts.length,
      images: posts.reduce((count, post) => count + post.images.length, 0),
      minimumDelaySeconds,
      maximumDelaySeconds,
      rotationStartedWithImagePost: firstPostWithImagesIndex > 0
    });
    if (activePosting) {
      notifyUiPostingStatus({
        status: "failed",
        message: "Posting is already in progress.",
        current: 0,
        total: groups.length,
        successCount: 0,
        failedCount: 0,
        processedCount: 0,
        error: "Wait for the current posts to finish, or stop posting before starting again."
      });
      return;
    }
    activePosting = true;
    uploadImageCacheKeys = /* @__PURE__ */ new WeakMap();
    groupsPostingTimer = createQueueTimer(request.startedAt);
    void chrome.storage.session.remove(LAST_GROUP_POSTING_STATUS_STORAGE_KEY);
    activePostingSuccessTarget = targetGroupCount;
    activePostingPendingCount = 0;
    latestUiPostingStatus = void 0;
    stopPostingRequested = false;
    pausePostingRequested = false;
    pauseNotificationSent = false;
    postingNetworkOffline = false;
    queuePauseApplied = false;
    let successCount = 0;
    let failedCount = 0;
    const failedGroupIds = /* @__PURE__ */ new Set();
    const total = groups.length;
    let postingTabId;
    const connectivityMonitor = startPostingConnectivityMonitor();
    try {
      throwIfPostingStopped();
      if (total === 0) {
        throw new Error("Select at least one group before posting.");
      }
      if (posts.length === 0) {
        throw new Error("Select at least one post before posting.");
      }
      await connectivityMonitor.ready;
      await waitWhilePostingPaused();
      const postingTab = await getActiveTabForPosting();
      postingTabId = postingTab.id;
      if (!postingTabId) {
        throw new Error("Unable to find the active tab for posting.");
      }
      activePostingTabId = postingTabId;
      const facebookActorId = await getFacebookActorId(postingTabId);
      notifyUiPostingStatus({
        status: "posting",
        message: "Preparing the first post...",
        current: 1,
        total,
        groupId: groups[0].id,
        groupName: groups[0].name,
        successCount,
        failedCount,
        processedCount: 0
      });
      const firstPostBody = posts[0].body;
      const firstPostHtml = posts[0].html;
      throwIfPostingStopped();
      let templates;
      while (true) {
        try {
          templates = await ensurePostingTemplates(
            postingTabId,
            groups,
            posts[0].body,
            firstPostBody,
            firstPostHtml,
            posts[0].images,
            total
          );
          break;
        } catch (error) {
          if (!isMissingFirstGroupComposerError(error)) {
            throw error;
          }
          const incompatibleStarter = groups[0];
          failedGroupIds.add(incompatibleStarter.id);
          failedCount += 1;
          groups = groups.slice(1);
          if (groups.length === 0) {
            throw new Error(
              "None of the selected Groups has a visible post composer. Select another standard Group and try again."
            );
          }
          notifyUiPostingStatus({
            status: "posting",
            message: `${incompatibleStarter.name} does not allow Postika to start posting. Trying ${groups[0].name} instead...`,
            current: 0,
            total,
            groupId: groups[0].id,
            groupName: groups[0].name,
            successCount,
            failedCount,
            processedCount: 0,
            successTarget: targetGroupCount
          });
        }
      }
      if (templates.firstGroupPosted) {
        if (templates.firstPostResult?.actorId && templates.firstPostResult.actorId !== facebookActorId) {
          debugWarn(
            "First post actor did not match the signed-in Facebook account."
          );
        }
        successCount += 1;
        const firstPostPending = templates.firstPostResult?.pendingApproval === true;
        if (firstPostPending) {
          activePostingPendingCount += 1;
        }
        notifyUiPostingStatus({
          status: firstPostPending ? "pending" : "posted",
          message: firstPostPending ? "Your post is pending" : `Posted to ${groups[0].name}.`,
          detail: [
            firstPostPending ? "Your post is awaiting admin approval. If the admin team approves it, it'll become visible in the group." : void 0
          ].filter(Boolean).join(" ") || void 0,
          current: 1,
          total,
          groupId: groups[0].id,
          groupName: groups[0].name,
          successCount,
          failedCount,
          processedCount: 1
        });
        throwIfPostingStopped();
        if (successCount >= targetGroupCount) {
          notifyUiPostingStatus({
            status: "done",
            message: `Posting finished: ${successCount} posts were submitted.`,
            current: 1,
            total,
            successCount,
            failedCount,
            processedCount: 1,
            successTarget: targetGroupCount
          });
          return;
        }
      }
      const startIndex = templates.firstGroupPosted ? 1 : 0;
      notifyUiPostingStatus({
        status: "posting",
        message: "Continuing to post automatically...",
        current: startIndex,
        total,
        successCount,
        failedCount,
        processedCount: startIndex
      });
      if (templates.firstGroupPosted) {
        const nextGroupIndex = startIndex % groups.length;
        const nextGroup = groups[nextGroupIndex];
        const delaySeconds = randomIntegerBetween(
          minimumDelaySeconds,
          maximumDelaySeconds
        );
        await sleepWithPostingCountdown(delaySeconds, {
          current: nextGroupIndex + 1,
          total,
          groupId: nextGroup.id,
          groupName: nextGroup.name,
          successCount,
          failedCount,
          processedCount: startIndex
        });
      }
      for (let attemptIndex = startIndex; attemptIndex < groups.length; attemptIndex += 1) {
        throwIfPostingStopped();
        const groupIndex = attemptIndex % groups.length;
        const group = groups[groupIndex];
        if (failedGroupIds.has(group.id)) {
          if (failedGroupIds.size >= selectedGroups.length) {
            break;
          }
          continue;
        }
        const preparedPost = posts[attemptIndex % posts.length];
        const preparedPostNumber = attemptIndex % posts.length + 1;
        const hasImages = preparedPost.images.length > 0;
        const current = groupIndex + 1;
        const statusContext = {
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount,
          failedCount,
          processedCount: attemptIndex
        };
        await waitWhilePostingPaused(statusContext);
        debugLog("Processing group.", {
          attempt: attemptIndex + 1,
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          preparedPostId: preparedPost.id,
          preparedPostNumber
        });
        await waitWhilePostingPaused(statusContext);
        notifyUiPostingStatus({
          status: "posting",
          message: `Preparing post ${preparedPostNumber}/${posts.length} for ${group.name}...`,
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount,
          failedCount,
          processedCount: attemptIndex
        });
        const postBody = preparedPost.body;
        throwIfPostingStopped();
        await waitWhilePostingPaused(statusContext);
        debugLog("Post body prepared for group.", {
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          originalLength: preparedPost.body.length,
          finalLength: postBody.length
        });
        await waitWhilePostingPaused(statusContext);
        let photoIds = [];
        if (hasImages) {
          notifyUiPostingStatus({
            status: "posting",
            message: `Uploading images from post ${preparedPostNumber}/${posts.length} for ${group.name}...`,
            current,
            total,
            groupId: group.id,
            groupName: group.name,
            successCount,
            failedCount,
            processedCount: attemptIndex
          });
          if (!templates.uploadTemplate) {
            throw new Error(
              "Could not set up photo uploads from your first post. Please start posting again."
            );
          }
          photoIds = await uploadImagesForGroup(
            postingTabId,
            templates.uploadTemplate,
            preparedPost.images,
            statusContext
          );
        } else {
          notifyUiPostingStatus({
            status: "posting",
            message: `Preparing text-only post ${preparedPostNumber}/${posts.length} for ${group.name}...`,
            current,
            total,
            groupId: group.id,
            groupName: group.name,
            successCount,
            failedCount,
            processedCount: attemptIndex
          });
        }
        throwIfPostingStopped();
        await waitWhilePostingPaused(statusContext);
        debugLog("Media phase complete.", {
          groupId: group.id,
          hasImages,
          uploadedPhotoCount: photoIds.length
        });
        await waitWhilePostingPaused(statusContext);
        notifyUiPostingStatus({
          status: "posting",
          message: `Posting post ${preparedPostNumber}/${posts.length} to ${group.name}...`,
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount,
          failedCount,
          processedCount: attemptIndex
        });
        const postResult = await createGraphqlPost(
          postingTabId,
          templates.postTemplate,
          postBody,
          photoIds,
          group.id,
          templates.firstGroupPosted && preparedPost === posts[0],
          statusContext
        );
        debugLog("GraphQL post result received.", {
          groupId: group.id,
          success: postResult.success,
          pendingApproval: postResult.pendingApproval,
          postId: postResult.postId,
          postUrl: postResult.postUrl,
          error: postResult.error
        });
        if (postResult.actorId && postResult.actorId !== facebookActorId) {
          debugWarn("Post actor did not match the signed-in Facebook account.", {
            groupId: group.id
          });
        }
        if (postResult.success) {
          successCount += 1;
          if (postResult.pendingApproval) {
            activePostingPendingCount += 1;
          }
          notifyUiPostingStatus({
            status: postResult.pendingApproval ? "pending" : "posted",
            message: postResult.pendingApproval ? "Your post is pending" : `Posted successfully to ${group.name}.`,
            detail: [
              postResult.pendingApproval ? "Your post is awaiting admin approval. If the admin team approves it, it'll become visible in the group." : void 0
            ].filter(Boolean).join(" ") || void 0,
            current,
            total,
            groupId: group.id,
            groupName: group.name,
            successCount,
            failedCount,
            processedCount: attemptIndex + 1
          });
          if (successCount >= targetGroupCount) {
            notifyUiPostingStatus({
              status: "done",
              message: `Posting finished: ${successCount} posts were submitted.`,
              current,
              total,
              successCount,
              failedCount,
              processedCount: attemptIndex + 1,
              successTarget: targetGroupCount
            });
            return;
          }
        } else {
          failedCount += 1;
          failedGroupIds.add(group.id);
          if (isRateLimitError(postResult.error, postResult.responseBody)) {
            notifyUiPostingStatus({
              status: "rate_limited",
              message: "Facebook temporarily blocked posting on this account. Queue stopped. Try again later.",
              current,
              total,
              groupId: group.id,
              groupName: group.name,
              successCount,
              failedCount,
              processedCount: attemptIndex + 1,
              error: postResult.error,
              responseBody: postResult.responseBody
            });
            return;
          }
          notifyUiPostingStatus({
            status: "failed",
            message: postResult.error === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE ? FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE : `Failed to post to ${group.name}.`,
            detail: postResult.error === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE ? `Facebook rejected the post to ${group.name} because this Group cannot accept more pending content from your account.` : void 0,
            current,
            total,
            groupId: group.id,
            groupName: group.name,
            successCount,
            failedCount,
            processedCount: attemptIndex + 1,
            error: postResult.error,
            responseBody: postResult.responseBody
          });
        }
        const nextAttemptIndex = attemptIndex + 1;
        if (nextAttemptIndex >= groups.length) break;
        if (failedGroupIds.size >= selectedGroups.length) {
          break;
        }
        const nextGroupIndex = nextAttemptIndex % groups.length;
        const nextGroup = groups[nextGroupIndex];
        const nextCurrent = nextGroupIndex + 1;
        const delaySeconds = randomIntegerBetween(
          minimumDelaySeconds,
          maximumDelaySeconds
        );
        await sleepWithPostingCountdown(delaySeconds, {
          current: nextCurrent,
          total,
          groupId: nextGroup.id,
          groupName: nextGroup.name,
          successCount,
          failedCount,
          processedCount: nextAttemptIndex
        });
      }
      notifyUiPostingStatus({
        status: "done",
        message: successCount >= targetGroupCount ? `Posting finished: ${successCount} posts were submitted.` : `Posting finished: ${successCount} posts were submitted and ${failedCount} groups failed.`,
        current: Math.min(successCount + failedCount, total),
        total,
        successCount,
        failedCount,
        processedCount: Math.min(successCount + failedCount, total),
        successTarget: targetGroupCount
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      debugWarn("Posting queue stopped with error.", { error: errorMessage });
      const responseBody = error instanceof FacebookPostResponseError ? error.responseBody : void 0;
      const rateLimited = isRateLimitError(errorMessage, responseBody);
      if (rateLimited) {
        failedCount += 1;
        notifyUiPostingStatus({
          status: "rate_limited",
          message: "Facebook temporarily blocked posting on this account. Queue stopped. Try again later.",
          current: groups.length > 0 ? 1 : 0,
          total,
          groupId: groups[0]?.id,
          groupName: groups[0]?.name,
          successCount,
          failedCount,
          processedCount: 1,
          error: errorMessage,
          responseBody
        });
      } else {
        if (error instanceof FacebookPostResponseError) {
          failedCount += 1;
          notifyUiPostingStatus({
            status: "failed",
            message: errorMessage === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE ? FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE : `Failed to post to ${groups[0]?.name ?? "the first Group"}.`,
            detail: errorMessage === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE ? `Facebook rejected the post to ${groups[0]?.name ?? "the first Group"} because this Group cannot accept more pending content from your account.` : void 0,
            current: groups.length > 0 ? 1 : 0,
            total,
            groupId: groups[0]?.id,
            groupName: groups[0]?.name,
            successCount,
            failedCount,
            processedCount: 1,
            error: errorMessage,
            responseBody: error.responseBody
          });
        }
        notifyUiPostingStatus({
          status: errorMessage === MANUAL_STOP_MESSAGE ? "stopped" : "done",
          message: errorMessage === MANUAL_STOP_MESSAGE ? MANUAL_STOP_MESSAGE : "Automatic posting stopped.",
          current: Math.min(successCount + failedCount, total),
          total,
          successCount,
          failedCount,
          processedCount: Math.min(successCount + failedCount, total),
          error: errorMessage
        });
      }
    } finally {
      connectivityMonitor.stop();
      stopPostingTemplateCapture();
      if (postingTabId) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: postingTabId },
            func: () => {
              delete globalThis.__postikaUploadBlobs;
            }
          });
        } catch {
        }
        await readFirstPostResponseCapture(postingTabId, true);
      }
      uploadImageCacheKeys = /* @__PURE__ */ new WeakMap();
      capturedUploadTemplate = void 0;
      capturedPostTemplate = void 0;
      debugLog("Posting queue finished.", {
        total,
        successCount,
        pendingCount: activePostingPendingCount,
        failedCount
      });
      activePosting = false;
      activePostingSuccessTarget = void 0;
      activePostingPendingCount = 0;
      stopPostingRequested = false;
      pausePostingRequested = false;
      pauseNotificationSent = false;
      postingNetworkOffline = false;
      queuePauseApplied = false;
      activePostingTabId = void 0;
    }
  }
  async function ensurePostingTemplates(tabId, groups, originalBody, body, html, images, total, progress) {
    const requiresUploadTemplate = images.length > 0;
    const firstGroup = groups[0];
    if (!firstGroup) {
      throw new Error("Select at least one group before posting.");
    }
    const statusContext = {
      current: 1,
      total,
      groupId: firstGroup.id,
      groupName: firstGroup.name,
      successCount: 0,
      failedCount: 0,
      processedCount: 0,
      ...progress
    };
    debugLog("Capturing fresh templates from UI group post.", {
      groupId: firstGroup.id,
      groupName: firstGroup.name,
      requiresUploadTemplate
    });
    throwIfPostingStopped();
    debugLog("Post body prepared for UI group post.", {
      current: statusContext.current,
      total,
      groupId: firstGroup.id,
      groupName: firstGroup.name,
      originalLength: originalBody.length,
      finalLength: body.length
    });
    notifyUiPostingStatus({
      status: "posting",
      message: "Setting up automatic posting using your first Facebook post...",
      ...statusContext
    });
    beginPostingTemplateCapture(tabId);
    throwIfPostingStopped();
    const groupUrl = normalizeGroupUrl(firstGroup.id);
    await chrome.tabs.update(tabId, { url: groupUrl, active: true });
    await waitForTabComplete(tabId, "/groups/");
    await sleepWithStopChecks(5e3, statusContext);
    await installFirstPostResponseCapture(tabId);
    const postResult = await createPostInTab(tabId, images, body, html);
    if (!postResult.ok && postResult.composerFound === false && postResult.error === "Group composer button not found.") {
      stopPostingTemplateCapture();
      throw new MissingFirstGroupComposerError(firstGroup.name);
    }
    if (!postResult.ok) {
      stopPostingTemplateCapture();
      throw new Error(postResult.error ?? "Unable to create the first post.");
    }
    const capturedTemplates = await waitForPostingTemplatesInternal(
      requiresUploadTemplate,
      statusContext
    );
    const firstResponseText = await waitForFirstPostResponseCapture(
      tabId,
      statusContext
    );
    let firstPostResult = firstResponseText ? parsePostResponse(firstResponseText) : void 0;
    throwIfPostingStopped();
    if (!firstResponseText) {
      const capturedVariables = capturedTemplates.postTemplate.formData.variables;
      if (!capturedVariables) {
        throw new FacebookPostResponseError(
          FACEBOOK_UNCONFIRMED_POST_MESSAGE,
          ""
        );
      }
      firstPostResult = await createGraphqlPost(
        tabId,
        capturedTemplates.postTemplate,
        body,
        [],
        firstGroup.id,
        true,
        statusContext,
        capturedVariables
      );
      throwIfPostingStopped();
      if (!firstPostResult.success && isNetworkTransportFailure(firstPostResult.error)) {
        throw new FacebookPostResponseError(
          FACEBOOK_UNCONFIRMED_POST_MESSAGE,
          firstPostResult.responseBody ?? ""
        );
      }
    }
    if (firstPostResult?.success === false) {
      const message = classifyFacebookPostFailure(
        firstResponseText ?? "",
        firstPostResult.error
      );
      throw new FacebookPostResponseError(
        message,
        firstResponseText ?? firstPostResult.responseBody ?? ""
      );
    }
    notifyUiPostingStatus({
      status: "posting",
      message: `Fresh ${requiresUploadTemplate ? "upload and post" : "post"} request values captured from ${firstGroup.name}.`,
      ...statusContext
    });
    return {
      uploadTemplate: capturedTemplates.uploadTemplate,
      postTemplate: capturedTemplates.postTemplate,
      firstGroupPosted: true,
      firstPostResult
    };
  }
  async function installFirstPostResponseCapture(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: installStoryCreateResponseCaptureInPage
    });
  }
  async function waitForFirstPostResponseCapture(tabId, statusContext) {
    let activeWaitMs = 0;
    try {
      while (true) {
        throwIfPostingStopped();
        const responseText = await readFirstPostResponseCapture(tabId, false);
        if (responseText) return responseText;
        await waitWhilePostingPaused(statusContext);
        await sleep(200);
        activeWaitMs += 200;
        if (activeWaitMs >= 3e4) return void 0;
      }
    } finally {
      await readFirstPostResponseCapture(tabId, true);
    }
  }
  async function readFirstPostResponseCapture(tabId, cleanup) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: readStoryCreateResponseCaptureInPage,
        args: [cleanup]
      });
      return typeof result?.result === "string" && result.result.length > 0 ? result.result : void 0;
    } catch (error) {
      debugWarn("Unable to read the UI post response capture.", error);
      return void 0;
    }
  }
  function installStoryCreateResponseCaptureInPage() {
    const key = "__kundiPostStoryCreateResponseCapture";
    const scope = globalThis;
    const previous = scope[key];
    if (previous?.restore instanceof Function) {
      previous.restore();
    }
    const responses = [];
    const capture = (text) => {
      if (text.includes('"story_create"')) {
        responses.push(text);
      }
    };
    const originalFetch = scope.fetch;
    const wrappedFetch = async (...args) => {
      const response = await Reflect.apply(
        originalFetch,
        scope,
        args
      );
      if (response.url.includes("/api/graphql/")) {
        void response.clone().text().then(capture).catch(() => void 0);
      }
      return response;
    };
    scope.fetch = wrappedFetch;
    const xhrPrototype = scope.XMLHttpRequest?.prototype;
    const originalOpen = xhrPrototype?.open;
    const originalSend = xhrPrototype?.send;
    if (xhrPrototype && originalOpen && originalSend) {
      xhrPrototype.open = function(...args) {
        this.__kundiPostRequestUrl = String(args[1] ?? "");
        return originalOpen.apply(this, args);
      };
      xhrPrototype.send = function(...args) {
        if (String(this.__kundiPostRequestUrl).includes("/api/graphql/")) {
          this.addEventListener(
            "loadend",
            () => {
              try {
                if (!this.responseType || this.responseType === "text") {
                  capture(String(this.responseText ?? ""));
                }
              } catch {
              }
            },
            { once: true }
          );
        }
        return originalSend.apply(this, args);
      };
    }
    const restore = () => {
      if (scope.fetch === wrappedFetch) {
        scope.fetch = originalFetch;
      }
      if (xhrPrototype && originalOpen && originalSend) {
        xhrPrototype.open = originalOpen;
        xhrPrototype.send = originalSend;
      }
    };
    scope[key] = { responses, restore };
  }
  function readStoryCreateResponseCaptureInPage(cleanup) {
    const key = "__kundiPostStoryCreateResponseCapture";
    const scope = globalThis;
    const state = scope[key];
    const response = Array.isArray(state?.responses) ? state.responses.shift() : void 0;
    if (cleanup && state) {
      if (state.restore instanceof Function) {
        state.restore();
      }
      delete scope[key];
    }
    return typeof response === "string" ? response : void 0;
  }
  function beginPostingTemplateCapture(tabId) {
    postingCaptureTabId = tabId;
    capturedUploadTemplate = void 0;
    capturedPostTemplate = void 0;
    loggedUploadCandidateRequestIds.clear();
    debugLog("Template capture started.", { tabId });
  }
  function stopPostingTemplateCapture() {
    loggedUploadCandidateRequestIds.clear();
    debugLog("Template capture stopped.");
    postingCaptureTabId = void 0;
    if (captureTabId === void 0) pendingRequests.clear();
  }
  async function waitForPostingTemplatesInternal(requiresUploadTemplate, statusContext = currentPostingStatusContext()) {
    let activeWaitMs = 0;
    try {
      while (true) {
        throwIfPostingStopped();
        if (capturedPostTemplate && (!requiresUploadTemplate || capturedUploadTemplate)) {
          const uploadTemplate = requiresUploadTemplate && capturedUploadTemplate ? finalizeUploadTemplate(
            capturedUploadTemplate,
            capturedPostTemplate
          ) : void 0;
          const postTemplate = capturedPostTemplate;
          debugLog("Template capture complete.", {
            hasUploadTemplate: Boolean(uploadTemplate),
            hasPostTemplate: true
          });
          return { uploadTemplate, postTemplate };
        }
        await waitWhilePostingPaused(statusContext);
        await sleep(250);
        activeWaitMs += 250;
        if (activeWaitMs >= 3e4) {
          throw new Error(
            "Facebook did not provide the request values needed to continue. Try again."
          );
        }
      }
    } finally {
      stopPostingTemplateCapture();
    }
  }
  function finalizeUploadTemplate(uploadTemplate, postTemplate) {
    const formData = { ...uploadTemplate.formData };
    const userId = extractUserIdFromFormData(postTemplate.formData);
    if (!formData.source) {
      formData.source = "8";
    }
    if (!formData.profile_id && userId) {
      formData.profile_id = userId;
    }
    if (!formData.waterfallxapp) {
      formData.waterfallxapp = "comet";
    }
    if (!formData.upload_id) {
      formData.upload_id = `jsc_${crypto.randomUUID()}`;
    }
    return {
      ...uploadTemplate,
      formData
    };
  }
  function normalizeGroupUrl(groupUrlOrId) {
    if (groupUrlOrId.startsWith("http://") || groupUrlOrId.startsWith("https://")) {
      return groupUrlOrId;
    }
    return `https://www.facebook.com/groups/${groupUrlOrId}/`;
  }
  function isRateLimitError(error, responseBody) {
    const message = error?.trim() ?? "";
    const combined = `${message}
${responseBody ?? ""}`;
    if (message === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE || FACEBOOK_PENDING_CONTENT_LIMIT_PATTERN.test(combined) || FACEBOOK_PENDING_CONTENT_LIMIT_ERROR_CODE_PATTERN.test(combined)) {
      return false;
    }
    return isRateLimitBody(combined);
  }
  async function createPostInTab(tabId, images, body, html) {
    const request = {
      type: "CREATE_POST",
      body,
      html,
      images
    };
    try {
      await injectPostingContentScript(tabId);
    } catch (error) {
      return {
        ok: false,
        composerFound: false,
        composerClicked: false,
        spanCount: 0,
        error: error instanceof Error ? error.message : "Unable to load the posting helper on the Facebook page."
      };
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await chrome.tabs.sendMessage(
          tabId,
          request
        );
        if (response) {
          return response;
        }
        return {
          ok: false,
          composerFound: false,
          composerClicked: false,
          spanCount: 0,
          error: "Unable to inspect Facebook page."
        };
      } catch (error) {
        if (attempt === 19) {
          return {
            ok: false,
            composerFound: false,
            composerClicked: false,
            spanCount: 0,
            error: error instanceof Error ? error.message : "Content script did not respond."
          };
        }
        await sleepWithStopChecks(250);
      }
    }
    return {
      ok: false,
      composerFound: false,
      composerClicked: false,
      spanCount: 0,
      error: "Content script did not respond."
    };
  }
  async function injectPostingContentScript(tabId) {
    let lastError;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status !== "complete" || !isFacebookUrl(tab.url)) {
          await sleepWithStopChecks(250);
          continue;
        }
        const [markerResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (marker) => globalThis[marker] === true,
          args: ["__facebookGroupsBulkPosterContentScriptLoaded"]
        });
        if (markerResult?.result === true) {
          return;
        }
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["dist/content.js"]
        });
        return;
      } catch (error) {
        lastError = error;
        await sleepWithStopChecks(250);
      }
    }
    throw new Error(
      lastError instanceof Error ? `Unable to load the posting helper: ${lastError.message}` : "Unable to load the posting helper on the Facebook page."
    );
  }
  async function waitForTabComplete(tabId, urlIncludes) {
    while (true) {
      throwIfPostingStopped();
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" && tab.url?.includes(urlIncludes)) {
        return;
      }
      await sleepWithStopChecks(250);
    }
  }
  async function uploadImagesForGroup(tabId, uploadTemplate, images, statusContext) {
    const photoIds = [];
    debugLog("Starting image uploads.", { imageCount: images.length });
    for (const image of images) {
      let transportFailures = 0;
      while (true) {
        await waitWhilePostingPaused(statusContext);
        try {
          debugLog("Uploading image.", {
            name: image.name,
            type: image.type
          });
          const response = await uploadImage(tabId, uploadTemplate, image);
          if (response.success && response.photoId) {
            photoIds.push(response.photoId);
            debugLog("Image uploaded successfully.", {
              name: image.name,
              photoId: response.photoId
            });
            break;
          }
          if (response.error && isNetworkTransportFailure(response.error) && transportFailures < 3) {
            transportFailures += 1;
            debugWarn("Image upload lost its network connection.", {
              image: image.name,
              attempt: transportFailures
            });
            setPostingNetworkOffline(true);
            await waitWhilePostingPaused(statusContext);
            continue;
          }
          if (response.error) {
            debugWarn("Image upload failed.", {
              image: image.name,
              error: response.error
            });
          }
          break;
        } catch (error) {
          debugWarn("Image upload crashed.", {
            image: image.name,
            error
          });
          break;
        }
      }
    }
    return photoIds;
  }
  async function uploadImage(tabId, uploadTemplate, image) {
    const existingCacheKey = uploadImageCacheKeys.get(image);
    const cacheKey = existingCacheKey ?? crypto.randomUUID();
    let result;
    try {
      const { url, headers } = uploadTemplate;
      const { farr: _originalMedia, ...formData } = uploadTemplate.formData;
      const template = { url, headers, formData };
      [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: uploadImageInPage,
        args: [template, existingCacheKey ? { name: image.name } : image, cacheKey]
      });
      if (result?.result?.mediaCacheMiss) {
        [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: uploadImageInPage,
          args: [template, image, cacheKey]
        });
      }
      if (result?.result && !result.result.mediaCacheMiss) {
        uploadImageCacheKeys.set(image, cacheKey);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Upload replay script failed to execute."
      };
    }
    const payload = result?.result ?? {
      status: 0,
      ok: false,
      responseText: "",
      contentType: "",
      error: "Upload replay returned no result."
    };
    debugLog("Upload response received.", {
      image: image.name,
      status: payload.status,
      ok: payload.ok,
      contentType: payload.contentType,
      error: payload.error,
      preview: payload.responseText.slice(0, 200)
    });
    if (payload.error) {
      return {
        success: false,
        error: payload.error
      };
    }
    setPostingNetworkOffline(false);
    return parseUploadResponse(payload.responseText);
  }
  function parseUploadResponse(responseText) {
    const normalized = responseText.trim().replace(/^for\s*\(;;\);\s*/, "");
    try {
      const parsed = JSON.parse(normalized);
      const photoId = parsed.payload?.photoID;
      if (parsed.__ar === 1 && photoId) {
        return { success: true, photoId };
      }
      return {
        success: false,
        error: "Upload failed - no photo ID returned."
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to parse Facebook upload response."
      };
    }
  }
  async function createGraphqlPost(tabId, postTemplate, text, photoIds, groupId, preserveCapturedFormatting = false, statusContext = currentPostingStatusContext(), capturedVariables) {
    const variables = capturedVariables ?? buildPostVariables(
      postTemplate.formData,
      text,
      photoIds,
      groupId,
      preserveCapturedFormatting
    );
    debugLog("Sending GraphQL post request.", {
      groupId,
      photoCount: photoIds.length,
      variableLength: variables.length
    });
    let transportFailures = 0;
    while (true) {
      await waitWhilePostingPaused(statusContext);
      let result;
      let executionError;
      try {
        [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: createGraphqlPostInPage,
          args: [postTemplate, variables]
        });
      } catch (error) {
        executionError = error instanceof Error ? error.message : "Could not send the post to Facebook.";
      }
      const payload = result?.result ?? {
        status: 0,
        ok: false,
        responseText: "",
        contentType: "",
        error: executionError ?? "Facebook did not confirm whether the post was submitted."
      };
      const transportFailure = payload.status === 0 && (isNetworkTransportFailure(payload.error) || payload.error === "Facebook did not confirm whether the post was submitted.");
      if (transportFailure) {
        const outageAlreadyDetected = postingNetworkOffline || typeof navigator !== "undefined" && !navigator.onLine;
        transportFailures += outageAlreadyDetected ? 0 : 1;
        setPostingNetworkOffline(true);
        debugWarn("Facebook post request lost its network connection.", {
          groupId,
          attempt: transportFailures
        });
        await waitWhilePostingPaused(statusContext);
        if (transportFailures > 3) {
          return {
            success: false,
            responseBody: payload.responseText || void 0,
            error: payload.error
          };
        }
        continue;
      }
      if (payload.status > 0) {
        setPostingNetworkOffline(false);
      }
      debugLog("GraphQL post response received.", {
        groupId,
        status: payload.status,
        ok: payload.ok,
        contentType: payload.contentType,
        error: payload.error,
        preview: payload.responseText.slice(0, 300)
      });
      if (payload.error) {
        return {
          success: false,
          responseBody: payload.responseText || void 0,
          error: payload.error
        };
      }
      if (isRateLimitBody(payload.responseText)) {
        debugWarn("Facebook rate limit detected in GraphQL response.", {
          groupId
        });
        return {
          success: false,
          responseBody: payload.responseText,
          error: "Facebook returned a posting limit response."
        };
      }
      const postResult = parsePostResponse(payload.responseText);
      if (!postResult.success) {
        postResult.responseBody = payload.responseText;
        postResult.error = classifyFacebookPostFailure(
          payload.responseText,
          postResult.error
        );
      }
      return postResult;
    }
  }
  function classifyFacebookPostFailure(responseText, fallback) {
    if (FACEBOOK_PENDING_CONTENT_LIMIT_PATTERN.test(responseText) || FACEBOOK_PENDING_CONTENT_LIMIT_ERROR_CODE_PATTERN.test(responseText)) {
      return FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE;
    }
    if (isRateLimitBody(responseText)) {
      return FACEBOOK_RATE_LIMIT_MESSAGE;
    }
    return fallback ?? "Facebook rejected the Group post.";
  }
  function buildPostVariables(templateFormData, text, photoIds, groupId, preserveCapturedFormatting = false) {
    text = text.replace(/\r\n?/g, "\n");
    const hasImages = photoIds.length > 0;
    const attachments = photoIds.map((photoId) => ({
      photo: {
        id: photoId
      }
    }));
    const templateVariables = cloneJsonRecord(
      safeParseJson(templateFormData.variables)
    );
    if (!templateVariables || !isRecord(templateVariables.input)) {
      return buildFallbackPostVariables(
        templateFormData,
        text,
        attachments,
        groupId
      );
    }
    const input = templateVariables.input;
    const originalText = isRecord(input.message) && typeof input.message.text === "string" ? input.message.text : void 0;
    const normalizedOriginalText = originalText?.replace(/\r\n?/g, "\n");
    const originalGroupId = getTemplateGroupId(input);
    if (isRecord(input.logging)) {
      input.logging.composer_session_id = generateSessionId();
    }
    if (isRecord(input.message)) {
      if (!preserveCapturedFormatting) {
        if (normalizedOriginalText !== text) {
          input.message.ranges = [];
        }
        input.message.text = text;
      }
      if (!Array.isArray(input.message.ranges)) {
        input.message.ranges = [];
      }
    } else {
      input.message = { ranges: [], text };
    }
    if (hasImages) {
      input.attachments = attachments;
    } else {
      delete input.attachments;
    }
    input.audience = {
      ...isRecord(input.audience) ? input.audience : {},
      to_id: groupId
    };
    input.client_mutation_id = String(Date.now());
    if (!preserveCapturedFormatting && (normalizedOriginalText !== text || !isRecord(input.composed_text))) {
      input.composed_text = buildComposedText(text);
    } else if (!isRecord(input.composed_text)) {
      input.composed_text = buildComposedText(text);
    }
    if (!preserveCapturedFormatting) {
      replaceStringValue(templateVariables, originalText, text);
    }
    replaceStringValue(templateVariables, originalGroupId, groupId);
    return JSON.stringify(templateVariables);
  }
  function buildFallbackPostVariables(templateFormData, text, attachments, groupId) {
    const actorId = extractUserIdFromFormData(templateFormData) ?? "61553861467726";
    const variables = {
      input: {
        composer_entry_point: "inline_composer",
        composer_source_surface: "group",
        composer_type: "group",
        logging: {
          composer_session_id: generateSessionId()
        },
        source: "WWW",
        message: {
          ranges: [],
          text
        },
        composed_text: buildComposedText(text),
        audience: {
          to_id: groupId
        },
        actor_id: actorId,
        client_mutation_id: String(Date.now()),
        ...attachments.length > 0 ? { attachments } : {}
      },
      feedLocation: "GROUP",
      renderLocation: "group",
      isGroup: true
    };
    return JSON.stringify(variables);
  }
  function buildComposedText(text) {
    const normalizedText = text.replace(/\r\n?/g, "\n");
    return {
      block_data: ["{}"],
      block_depths: [0],
      block_types: [0],
      blocks: [normalizedText],
      entities: ["[]"],
      entity_map: "{}",
      inline_styles: ["[]"]
    };
  }
  function getTemplateGroupId(input) {
    if (isRecord(input.audience) && typeof input.audience.to_id === "string") {
      return input.audience.to_id;
    }
    if (typeof input.group_id === "string") {
      return input.group_id;
    }
    if (typeof input.groupID === "string") {
      return input.groupID;
    }
    return void 0;
  }
  function parsePostResponse(responseText) {
    const normalized = responseText.trim().replace(/^for\s*\(;;\);\s*/, "");
    if (!normalized) {
      return {
        success: true,
        postId: "unknown-empty-response"
      };
    }
    try {
      const decoder = new JsonObjectDecoder(normalized);
      const objects = decoder.decodeAll();
      const firstObject = objects[0];
      if (!firstObject) {
        return {
          success: false,
          error: "Facebook returned an empty response. The post could not be confirmed."
        };
      }
      if (isRecord(firstObject) && typeof firstObject.errorSummary === "string") {
        return {
          success: false,
          error: typeof firstObject.errorDescription === "string" ? `${firstObject.errorSummary}: ${firstObject.errorDescription}` : firstObject.errorSummary
        };
      }
      const storyCreateMatch = findStoryCreateResult(firstObject);
      if (storyCreateMatch) {
        return {
          success: true,
          pendingApproval: storyCreateMatch.pendingApproval,
          actorId: storyCreateMatch.actorId,
          postId: storyCreateMatch.postId,
          postUrl: storyCreateMatch.url
        };
      }
      const matches = findPostRecords(firstObject);
      const lastMatch = matches.length > 0 ? matches[matches.length - 1] : void 0;
      if (!lastMatch) {
        return {
          success: false,
          error: "Facebook did not provide a link to the post."
        };
      }
      return {
        success: true,
        postId: lastMatch.postId,
        postUrl: lastMatch.url
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to parse Facebook post response."
      };
    }
  }
  function findStoryCreateResult(value) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const nested = findStoryCreateResult(entry);
        if (nested) {
          return nested;
        }
      }
      return void 0;
    }
    if (!isRecord(value)) {
      return void 0;
    }
    const storyCreate = value.story_create;
    if (isRecord(storyCreate)) {
      const directUrl = typeof storyCreate.url === "string" ? storyCreate.url : void 0;
      const directPostId = typeof storyCreate.post_id === "string" ? storyCreate.post_id : void 0;
      const story = isRecord(storyCreate.story) ? storyCreate.story : void 0;
      const storyUrl = story && typeof story.url === "string" ? story.url : void 0;
      const storyId = story && typeof story.id === "string" ? story.id : void 0;
      const defaultActor = story && isRecord(story.default_actor) ? story.default_actor : void 0;
      const actorId = defaultActor && typeof defaultActor.id === "string" ? defaultActor.id : void 0;
      const fallbackUrl = directUrl ?? storyUrl;
      const fallbackId = directPostId ?? storyId;
      const pendingApproval = Boolean(fallbackUrl?.includes("/pending_posts/")) || Boolean(story?.if_viewer_can_learn_more_about_pending_post) || Boolean(story?.to?.if_viewer_can_see_pending_post_in_mall);
      if (pendingApproval || fallbackId || fallbackUrl && (fallbackUrl.includes("/permalink/") || fallbackUrl.includes("/posts/"))) {
        return {
          postId: fallbackId ?? "unknown-story-id",
          url: fallbackUrl,
          pendingApproval,
          actorId
        };
      }
    }
    for (const nestedValue of Object.values(value)) {
      const nested = findStoryCreateResult(nestedValue);
      if (nested) {
        return nested;
      }
    }
    return void 0;
  }
  function findPostRecords(value) {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => findPostRecords(entry));
    }
    if (!isRecord(value)) {
      return [];
    }
    const matches = [];
    if (typeof value.post_id === "string" && typeof value.url === "string" && value.url.includes("permalink")) {
      matches.push({ postId: value.post_id, url: value.url });
    }
    for (const nestedValue of Object.values(value)) {
      matches.push(...findPostRecords(nestedValue));
    }
    return matches;
  }
  function isRateLimitBody(responseText) {
    const normalized = responseText.replace(/\\u0020/gi, " ").replace(/\\[nrt]/g, " ");
    return FACEBOOK_RATE_LIMIT_ERROR_CODE_PATTERN.test(normalized) || FACEBOOK_RATE_LIMIT_API_ERROR_CODE_PATTERN.test(normalized) || FACEBOOK_POST_LIMIT_PATTERN.test(normalized) || FACEBOOK_OTHER_POSTING_RESTRICTION_PATTERN.test(normalized);
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function cloneJsonRecord(value) {
    if (!isRecord(value)) {
      return void 0;
    }
    return JSON.parse(JSON.stringify(value));
  }
  function replaceStringValue(value, from, to) {
    if (!from || from === to) {
      return;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (value[index] === from) {
          value[index] = to;
        } else {
          replaceStringValue(value[index], from, to);
        }
      }
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue === from) {
        value[key] = to;
      } else {
        replaceStringValue(nestedValue, from, to);
      }
    }
  }
  function extractUserIdFromFormData(formData) {
    const userId = formData.__user || formData.av;
    if (userId) {
      return userId;
    }
    const variables = safeParseJson(formData.variables);
    if (isRecord(variables) && isRecord(variables.input)) {
      const actorId = variables.input.actor_id;
      if (typeof actorId === "string" && actorId) {
        return actorId;
      }
    }
    return void 0;
  }
  function generateSessionId() {
    return crypto.randomUUID();
  }
  function safeParseJson(value) {
    if (!value) {
      return void 0;
    }
    try {
      return JSON.parse(value);
    } catch {
      return void 0;
    }
  }
  async function uploadImageInPage(uploadTemplate, image, cacheKey) {
    try {
      const scope = globalThis;
      const blobs = scope.__postikaUploadBlobs ??= /* @__PURE__ */ new Map();
      let blob = blobs.get(cacheKey);
      if (!blob) {
        if (!image.dataUrl) {
          return { status: 0, ok: false, responseText: "", contentType: "", mediaCacheMiss: true };
        }
        const response = await fetch(image.dataUrl);
        blob = await response.blob();
        blobs.set(cacheKey, blob);
      }
      const buildHeaders = (headers) => {
        const replayHeaders = {};
        const allowedHeaders = [
          "accept",
          "accept-language",
          "priority",
          "sec-fetch-dest",
          "sec-fetch-mode",
          "sec-fetch-site",
          "x-asbd-id",
          "x-fb-lsd"
        ];
        for (const header of allowedHeaders) {
          const value = headers[header];
          if (value) {
            replayHeaders[header] = value;
          }
        }
        return replayHeaders;
      };
      const formData = new FormData();
      for (const [key, value] of Object.entries(uploadTemplate.formData)) {
        if (!value || key === "farr") {
          continue;
        }
        formData.append(key, value);
      }
      formData.append("farr", blob, image.name);
      const uploadResponse = await fetch(uploadTemplate.url, {
        method: "POST",
        credentials: "include",
        headers: buildHeaders(uploadTemplate.headers),
        body: formData
      });
      return {
        status: uploadResponse.status,
        ok: uploadResponse.ok,
        responseText: await uploadResponse.text(),
        contentType: uploadResponse.headers.get("content-type") ?? ""
      };
    } catch (error) {
      return {
        status: 0,
        ok: false,
        responseText: "",
        contentType: "",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async function createGraphqlPostInPage(postTemplate, variables) {
    try {
      const buildHeaders = (headers) => {
        const replayHeaders = {};
        const allowedHeaders = [
          "accept",
          "accept-language",
          "content-type",
          "priority",
          "sec-fetch-dest",
          "sec-fetch-mode",
          "sec-fetch-site",
          "x-asbd-id",
          "x-fb-friendly-name",
          "x-fb-lsd"
        ];
        for (const header of allowedHeaders) {
          const value = headers[header];
          if (value) {
            replayHeaders[header] = value;
          }
        }
        replayHeaders["content-type"] = replayHeaders["content-type"] ?? "application/x-www-form-urlencoded";
        replayHeaders["x-fb-friendly-name"] = replayHeaders["x-fb-friendly-name"] ?? postTemplate.formData.fb_api_req_friendly_name ?? "ComposerStoryCreateMutation";
        if (!replayHeaders["x-fb-lsd"] && postTemplate.formData.lsd)
          replayHeaders["x-fb-lsd"] = postTemplate.formData.lsd;
        return replayHeaders;
      };
      const formData = new URLSearchParams(postTemplate.formData);
      formData.set("variables", variables);
      const response = await fetch(postTemplate.url, {
        method: "POST",
        credentials: "include",
        headers: buildHeaders(postTemplate.headers),
        body: formData.toString()
      });
      return {
        status: response.status,
        ok: response.ok,
        responseText: await response.text(),
        contentType: response.headers.get("content-type") ?? ""
      };
    } catch (error) {
      return {
        status: 0,
        ok: false,
        responseText: "",
        contentType: "",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  function notifyUiPostingStatus(partial) {
    if (partial.status === "done" || partial.status === "stopped" || partial.status === "rate_limited") {
      finishQueueTimer(groupsPostingTimer);
    }
    const status = {
      type: "UI_POSTING_STATUS",
      successTarget: activePostingSuccessTarget,
      pendingCount: activePostingPendingCount,
      ...partial,
      timing: queueTimingSnapshot(groupsPostingTimer, partial.groupId)
    };
    latestUiPostingStatus = status;
    postingDiagnostics.checkpoint(status, { pendingRequestCount: pendingRequests.size });
    if (status.status === "done" || status.status === "stopped") {
      const { responseBody: _responseBody, ...storedStatus } = status;
      void chrome.storage.session.set({
        [LAST_GROUP_POSTING_STATUS_STORAGE_KEY]: storedStatus
      });
    } else if (status.status === "rate_limited") {
      void chrome.storage.session.remove(LAST_GROUP_POSTING_STATUS_STORAGE_KEY);
    }
    void chrome.runtime.sendMessage(status).catch(() => {
    });
  }
  function notifyPostingControlStatus(status, message) {
    const latest = latestUiPostingStatus;
    notifyUiPostingStatus({
      status,
      message,
      current: latest?.current ?? 0,
      total: latest?.total ?? 0,
      groupId: latest?.groupId,
      groupName: latest?.groupName,
      successCount: latest?.successCount ?? 0,
      failedCount: latest?.failedCount ?? 0,
      processedCount: latest?.processedCount ?? 0
    });
  }
  function sendContentPostingControl(type) {
    if (activePostingTabId === void 0) {
      return;
    }
    void chrome.tabs.sendMessage(activePostingTabId, { type }).catch(() => {
    });
  }
  var JsonObjectDecoder = class {
    constructor(input) {
      this.index = 0;
      this.input = input;
    }
    decodeAll() {
      const results = [];
      while (this.index < this.input.length) {
        this.skipWhitespace();
        if (this.index >= this.input.length) {
          break;
        }
        const start = this.index;
        let depth = 0;
        let inString = false;
        let escaped = false;
        while (this.index < this.input.length) {
          const character = this.input[this.index];
          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (character === "\\") {
              escaped = true;
            } else if (character === '"') {
              inString = false;
            }
            this.index += 1;
            continue;
          }
          if (character === '"') {
            inString = true;
            this.index += 1;
            continue;
          }
          if (character === "{") {
            depth += 1;
          } else if (character === "}") {
            depth -= 1;
            if (depth === 0) {
              this.index += 1;
              const segment = this.input.slice(start, this.index);
              results.push(JSON.parse(segment));
              break;
            }
          }
          this.index += 1;
        }
      }
      return results;
    }
    skipWhitespace() {
      while (this.index < this.input.length && /\s/.test(this.input[this.index])) {
        this.index += 1;
      }
    }
  };
})();
