"use strict";
(() => {
  // src/config.ts
  var JOINED_GROUPS_URL = "https://web.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added";
  var GROUPS_QUERY_FRIENDLY_NAME = "GroupsCometAllJoinedGroupsSectionPaginationQuery";

  // src/auth-config.ts
  var AUTH_API_BASE_URL = "https://api.facebook-groups-bulk-poster.softwrhq.com";

  // src/background.ts
  var POST_MUTATION_FRIENDLY_NAME = "ComposerStoryCreateMutation";
  var MARKETPLACE_SELLING_PAGINATION_FRIENDLY_NAME = "MarketplaceYouSellingFastActiveSectionPaginationQuery";
  var UPLOAD_CANDIDATE_MATCHES = [
    "upload.facebook.com/ajax/react_composer/attachments/photo/upload",
    "www.facebook.com/ajax/react_composer/attachments/photo/upload",
    "web.facebook.com/ajax/react_composer/attachments/photo/upload",
    "/ajax/react_composer/attachments/photo/upload"
  ];
  var GEMINI_API_KEY_STORAGE_KEYS = ["geminiApiKey", "GEMINI_API_KEY"];
  var GEMINI_REWRITE_ENABLED_STORAGE_KEY = "geminiRewriteEnabled";
  var GEMINI_CUSTOM_PROMPT_STORAGE_KEY = "geminiCustomPrompt";
  var GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY = "geminiIncludeHashtags";
  var GEMINI_MODEL = "gemini-2.5-flash";
  var GEMINI_TIMEOUT_MS = 3e4;
  var MIN_POSTING_DELAY_SECONDS = 60;
  var AUTH_SESSION_STORAGE_KEY = "googleAuthSession";
  var LOG_PREFIX = "[Facebook Groups Bulk Poster]";
  var PostingAccessError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "PostingAccessError";
    }
  };
  async function updatePostingUsage(action, kind, operationId) {
    const storage = await chrome.storage.local.get(AUTH_SESSION_STORAGE_KEY);
    const session = storage[AUTH_SESSION_STORAGE_KEY];
    const sessionToken = typeof session?.sessionToken === "string" ? session.sessionToken.trim() : "";
    if (!sessionToken) {
      throw new PostingAccessError("Sign in with Google to continue posting.");
    }
    const response = await fetch(
      `${AUTH_API_BASE_URL}/api/posting-usage/${action}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ kind, operation_id: operationId })
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reset = payload.reset_at ? ` The next slot becomes available ${new Date(payload.reset_at).toLocaleString()}.` : "";
      throw new PostingAccessError(
        `${payload.error ?? "Unable to verify your posting allowance."}${reset}`
      );
    }
    if (payload.access) {
      void chrome.runtime.sendMessage({
        type: "ACCESS_ENTITLEMENTS_UPDATED",
        access: payload.access
      }).catch(() => void 0);
    }
  }
  async function claimPostingUsage(kind) {
    const operationId = crypto.randomUUID();
    await updatePostingUsage("claim", kind, operationId);
    return operationId;
  }
  async function finalizePostingUsage(action, kind, operationId) {
    try {
      await updatePostingUsage(action, kind, operationId);
    } catch (error) {
      console.warn(LOG_PREFIX, `Unable to ${action} posting allowance.`, error);
    }
  }
  var FACEBOOK_HOSTS = /* @__PURE__ */ new Set([
    "www.facebook.com",
    "web.facebook.com",
    "upload.facebook.com"
  ]);
  var pendingRequests = /* @__PURE__ */ new Map();
  var capturedGroupsRequest;
  var captureTabId;
  var marketplaceCleanupCaptureTabId;
  var capturedMarketplaceSellingRequest;
  var marketplaceCleanupActive = false;
  var marketplaceCleanupCompletions = /* @__PURE__ */ new Map();
  var activePosting = false;
  var activePostingSuccessTarget;
  var stopPostingRequested = false;
  var pausePostingRequested = false;
  var pauseNotificationSent = false;
  var activeGeminiRequestController;
  var latestUiPostingStatus;
  var activePostingTabId;
  var postingCaptureTabId;
  var capturedUploadTemplate;
  var capturedPostTemplate;
  var activeMarketplaceItemPosting = false;
  var marketplaceStopPostingRequested = false;
  var marketplacePausePostingRequested = false;
  var latestMarketplacePostingStatus;
  var activeMarketplacePostingTabId;
  var loggedUploadCandidateRequestIds = /* @__PURE__ */ new Set();
  var MANUAL_STOP_MESSAGE = "Posting stopped by user.";
  var FACEBOOK_POST_LIMIT_PATTERN = /we\s+limit\s+how\s+often\s+you\s+can\s+post,\s+comment\s+or\s+do\s+other\s+things\s+in\s+a\s+given\s+amount\s+of\s+time\s+in\s+order\s+to\s+help\s+protect\s+the\s+community\s+from\s+spam\.\s+you\s+can\s+try\s+again\s+later/i;
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
    if (data === void 0) {
      console.log(`${LOG_PREFIX} ${message}`);
      return;
    }
    console.log(`${LOG_PREFIX} ${message}`, data);
  }
  function debugWarn(message, data) {
    if (data === void 0) {
      console.log(`${LOG_PREFIX} ${message}`);
      return;
    }
    console.log(`${LOG_PREFIX} ${message}`, data);
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
      const shouldCaptureMarketplaceCleanup = marketplaceCleanupCaptureTabId !== void 0 && details.tabId === marketplaceCleanupCaptureTabId;
      if (!shouldCaptureGroups && !shouldCapturePosting && !shouldCaptureMarketplaceCleanup) {
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
      const shouldCaptureMarketplaceCleanup = marketplaceCleanupCaptureTabId !== void 0 && details.tabId === marketplaceCleanupCaptureTabId;
      if (!shouldCaptureGroups && !shouldCapturePosting && !shouldCaptureMarketplaceCleanup) {
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
  chrome.runtime.onMessage.addListener(
    (request, _sender, sendResponse) => {
      if (request.type === "MARKETPLACE_CLEANUP_FINISHED") {
        marketplaceCleanupCompletions.get(request.runId)?.({
          ok: request.ok,
          deletedCount: request.deletedCount,
          error: request.error
        });
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "MARKETPLACE_SELLING_REQUEST_CAPTURED") {
        if (marketplaceCleanupCaptureTabId !== void 0 && request.request.body) {
          capturedMarketplaceSellingRequest = {
            ...request.request,
            formData: formDataFromBody(request.request.body, {})
          };
          debugLog("Captured raw Marketplace request from the Facebook page.", {
            url: request.request.url
          });
        }
        sendResponse({ ok: true });
        return false;
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
        if (activePosting) {
          sendResponse({
            ok: false,
            error: "A posting queue is already running."
          });
          return false;
        }
        void runGraphqlPostingQueue(request);
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "START_MARKETPLACE_POSTING") {
        if (activeMarketplaceItemPosting || activePosting) {
          sendResponse({
            ok: false,
            error: "Another Facebook posting action is already running."
          });
          return false;
        }
        activeMarketplaceItemPosting = true;
        marketplaceStopPostingRequested = false;
        marketplacePausePostingRequested = false;
        void runMarketplaceItemPostingQueue(request).catch((error) => {
          notifyMarketplaceItemPostingStatus({
            status: "done",
            message: "Marketplace posting queue stopped.",
            current: 0,
            total: request.listings.length,
            successCount: 0,
            failedCount: request.listings.length,
            error: error instanceof Error ? error.message : "Unable to run Marketplace posting queue."
          });
        }).finally(() => {
          activeMarketplaceItemPosting = false;
          marketplaceStopPostingRequested = false;
          marketplacePausePostingRequested = false;
          activeMarketplacePostingTabId = void 0;
        });
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "DELETE_OLD_MARKETPLACE_LISTINGS") {
        if (marketplaceCleanupActive || activeMarketplaceItemPosting || activePosting) {
          sendResponse({
            ok: false,
            error: "Another Facebook posting or cleanup action is already running."
          });
          return false;
        }
        if (!Number.isSafeInteger(request.daysOld) || request.daysOld < 0) {
          sendResponse({
            ok: false,
            error: "Days old must be a whole number of 0 or greater."
          });
          return false;
        }
        marketplaceCleanupActive = true;
        void runMarketplaceCleanupInSellingPage(request.daysOld).catch((error) => {
          notifyMarketplaceCleanupStatus({
            status: "failed",
            message: "Marketplace cleanup failed.",
            processed: 0,
            total: 0,
            deletedCount: 0,
            failedCount: 0,
            error: error instanceof Error ? error.message : String(error)
          });
        }).finally(() => {
          marketplaceCleanupActive = false;
          marketplaceCleanupCaptureTabId = void 0;
          capturedMarketplaceSellingRequest = void 0;
        });
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "STOP_MARKETPLACE_POSTING") {
        if (!activeMarketplaceItemPosting) {
          sendResponse({ ok: false, error: "No Marketplace queue is running." });
          return false;
        }
        marketplaceStopPostingRequested = true;
        marketplacePausePostingRequested = false;
        activeGeminiRequestController?.abort();
        sendMarketplacePostingControl("STOP_MARKETPLACE_POSTING");
        notifyMarketplacePostingControlStatus(
          "posting",
          "Stopping Marketplace posting after the current Facebook action\u2026"
        );
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "PAUSE_MARKETPLACE_POSTING") {
        if (!activeMarketplaceItemPosting) {
          sendResponse({ ok: false, error: "No Marketplace queue is running." });
          return false;
        }
        marketplacePausePostingRequested = true;
        sendMarketplacePostingControl("PAUSE_MARKETPLACE_POSTING");
        notifyMarketplacePostingControlStatus(
          "paused",
          "Marketplace posting paused."
        );
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "RESUME_MARKETPLACE_POSTING") {
        if (!activeMarketplaceItemPosting) {
          sendResponse({ ok: false, error: "No Marketplace queue is running." });
          return false;
        }
        marketplacePausePostingRequested = false;
        sendMarketplacePostingControl("RESUME_MARKETPLACE_POSTING");
        notifyMarketplacePostingControlStatus(
          "posting",
          "Marketplace posting resumed."
        );
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "STOP_UI_POSTING") {
        if (!activePosting) {
          sendResponse({ ok: false, error: "No posting queue is running." });
          return false;
        }
        stopPostingRequested = true;
        pausePostingRequested = false;
        activeGeminiRequestController?.abort();
        sendContentPostingControl("STOP_CREATE_POST");
        notifyPostingControlStatus(
          "posting",
          "Stopping posting after the current Facebook action finishes..."
        );
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "PAUSE_UI_POSTING") {
        if (!activePosting) {
          sendResponse({ ok: false, error: "No posting queue is running." });
          return false;
        }
        pausePostingRequested = true;
        pauseNotificationSent = true;
        sendContentPostingControl("PAUSE_CREATE_POST");
        notifyPostingControlStatus("paused", "Posting queue paused.");
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "RESUME_UI_POSTING") {
        if (!activePosting) {
          sendResponse({ ok: false, error: "No posting queue is running." });
          return false;
        }
        pausePostingRequested = false;
        pauseNotificationSent = false;
        sendContentPostingControl("RESUME_CREATE_POST");
        notifyPostingControlStatus("posting", "Posting queue resumed.");
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
    if (tabId === marketplaceCleanupCaptureTabId && friendlyName === MARKETPLACE_SELLING_PAGINATION_FRIENDLY_NAME && body.length > 0) {
      capturedMarketplaceSellingRequest = {
        url: pending.url,
        method: pending.method,
        body,
        headers: pending.headers,
        formData: formDataFromBody(body, formData)
      };
      debugLog("Captured Marketplace selling pagination request.", {
        url: pending.url,
        friendlyName
      });
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
      await triggerJoinedGroupsSortRequest(tab.id);
      notifyGroupsStatus("Waiting for fresh Facebook groups request...", 0);
      const capturedRequest = await waitForCapturedGroupsRequest();
      notifyGroupsStatus("Captured groups request. Preparing extraction...", 0);
      const config = updateFetchGroupsConfigFromCapturedRequest(capturedRequest);
      notifyGroupsStatus("Fetching groups page 1...", 0);
      const groups = await extractAllGroups(tab.id, config);
      const uniqueGroups = dedupeGroups(groups);
      notifyGroupsStatus(
        `Finished loading ${uniqueGroups.length} groups.`,
        uniqueGroups.length,
        true
      );
      return uniqueGroups;
    } finally {
      captureTabId = void 0;
    }
  }
  async function getActiveTabForLoadingGroups() {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (activeTab?.id && isFacebookUrl(activeTab.url)) {
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
    await sleep(2e3);
  }
  async function waitForJoinedGroupsPage(tabId) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 3e4) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" && tab.url?.includes("/groups/joins/")) {
        return;
      }
      await sleep(250);
    }
    throw new Error("Facebook joined groups page took too long to load.");
  }
  async function waitForPageDomReady(tabId, urlIncludes) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 3e4) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (expectedUrlPart) => window.location.href.includes(expectedUrlPart) && document.readyState === "complete" && Boolean(document.body),
          args: [urlIncludes]
        });
        if (result?.result) {
          return;
        }
      } catch {
      }
      await sleep(250);
    }
    throw new Error("Facebook page DOM took too long to finish loading.");
  }
  async function prepareMarketplacePostingPage(listing) {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!activeTab?.id || !isFacebookUrl(activeTab.url)) {
      throw new Error("Open Facebook in the active tab before posting an item.");
    }
    const tabId = activeTab.id;
    activeMarketplacePostingTabId = tabId;
    const createPath = listing.listingType === "vehicle" ? "/marketplace/create/vehicle" : "/marketplace/create/item";
    await chrome.tabs.update(tabId, {
      url: `https://www.facebook.com${createPath}`
    });
    await waitForPageDomReady(tabId, createPath);
    await waitWhileMarketplacePostingPaused();
    throwIfMarketplacePostingStopped();
    await sleep(1500);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/marketplace-item.js"]
    });
    await waitWhileMarketplacePostingPaused();
    throwIfMarketplacePostingStopped();
    return tabId;
  }
  async function showMarketplaceDescriptionGenerating(tabId) {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "SHOW_MARKETPLACE_DESCRIPTION_GENERATING"
    });
    if (!response?.ok) {
      console.info(
        LOG_PREFIX,
        response?.error ?? "Facebook's Description field is unavailable; continuing AI rewrite."
      );
    }
  }
  async function runMarketplaceItemPosting(listing, tabId, shareToSuggestedGroups) {
    const response = await withTimeout(
      chrome.tabs.sendMessage(tabId, {
        type: listing.listingType === "vehicle" ? "CREATE_MARKETPLACE_VEHICLE_LISTING" : "CREATE_MARKETPLACE_ITEM_LISTING",
        listing,
        shareToSuggestedGroups
      }),
      3e5,
      "Marketplace listing posting timed out."
    );
    const result = response;
    if (!result?.ok) {
      throw new Error(result?.error ?? "Unable to publish Marketplace item.");
    }
    return result;
  }
  async function runMarketplaceItemPostingQueue(request) {
    const listings = request.listings;
    const total = listings.length;
    if (total === 0) {
      throw new Error("Select at least one Marketplace item before posting.");
    }
    const minimumDelaySeconds = Math.max(
      MIN_POSTING_DELAY_SECONDS,
      Math.floor(request.minimumDelaySeconds)
    );
    const maximumDelaySeconds = Math.max(
      minimumDelaySeconds,
      Math.floor(request.maximumDelaySeconds)
    );
    let successCount = 0;
    let failedCount = 0;
    for (let index = 0; index < total; index += 1) {
      await waitWhileMarketplacePostingPaused();
      if (marketplaceStopPostingRequested) {
        notifyMarketplaceItemPostingStatus({
          status: "stopped",
          message: "Marketplace posting stopped by user.",
          current: index,
          total,
          successCount,
          failedCount
        });
        return;
      }
      const listing = listings[index];
      const listingTitle = marketplacePostingListingTitle(listing);
      const current = index + 1;
      notifyMarketplaceItemPostingStatus({
        status: "preparing",
        message: `Preparing \u201C${listingTitle}\u201D\u2026`,
        current,
        total,
        listingId: listing.id,
        listingTitle,
        successCount,
        failedCount
      });
      let postingUsageOperationId;
      try {
        await waitWhileMarketplacePostingPaused();
        throwIfMarketplacePostingStopped();
        const tabId = await prepareMarketplacePostingPage(listing);
        if (request.rewriteDescriptions) {
          notifyMarketplaceItemPostingStatus({
            status: "preparing",
            message: `Generating description with Gemini AI for \u201C${listingTitle}\u201D\u2026`,
            current,
            total,
            listingId: listing.id,
            listingTitle,
            successCount,
            failedCount
          });
          await showMarketplaceDescriptionGenerating(tabId);
        }
        const description = await rewriteDescriptionWithGemini(
          listing.description,
          {
            enabled: request.rewriteDescriptions,
            apiKey: request.geminiApiKey,
            customPrompt: request.customPrompt,
            includeHashtags: request.includeHashtags,
            destination: `Facebook Marketplace ${listing.listingType}`
          }
        );
        notifyMarketplaceItemPostingStatus({
          status: "posting",
          message: `Posting \u201C${listingTitle}\u201D (${current}/${total})\u2026`,
          current,
          total,
          listingId: listing.id,
          listingTitle,
          successCount,
          failedCount
        });
        await waitWhileMarketplacePostingPaused();
        throwIfMarketplacePostingStopped();
        postingUsageOperationId = await claimPostingUsage("marketplace_listing");
        await runMarketplaceItemPosting(
          { ...listing, description },
          tabId,
          request.shareToSuggestedGroups
        );
        await finalizePostingUsage(
          "complete",
          "marketplace_listing",
          postingUsageOperationId
        );
        postingUsageOperationId = void 0;
        throwIfMarketplacePostingStopped();
        successCount += 1;
        notifyMarketplaceItemPostingStatus({
          status: "posted",
          message: `Posted \u201C${listingTitle}\u201D (${current}/${total}).`,
          current,
          total,
          listingId: listing.id,
          listingTitle,
          successCount,
          failedCount
        });
      } catch (error) {
        if (postingUsageOperationId) {
          await finalizePostingUsage(
            "release",
            "marketplace_listing",
            postingUsageOperationId
          );
        }
        if (marketplaceStopPostingRequested) {
          notifyMarketplaceItemPostingStatus({
            status: "stopped",
            message: "Marketplace posting stopped by user.",
            current,
            total,
            listingId: listing.id,
            listingTitle,
            successCount,
            failedCount
          });
          return;
        }
        if (error instanceof PostingAccessError) {
          notifyMarketplaceItemPostingStatus({
            status: "done",
            message: "Marketplace posting stopped by your account limit.",
            current,
            total,
            listingId: listing.id,
            listingTitle,
            successCount,
            failedCount,
            error: error.message
          });
          return;
        }
        failedCount += 1;
        notifyMarketplaceItemPostingStatus({
          status: "failed",
          message: `Failed to post \u201C${listingTitle}\u201D (${current}/${total}).`,
          current,
          total,
          listingId: listing.id,
          listingTitle,
          successCount,
          failedCount,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      if (current < total) {
        const waitSeconds = randomIntegerBetween(
          minimumDelaySeconds,
          maximumDelaySeconds
        );
        for (let remaining = waitSeconds; remaining > 0; remaining -= 1) {
          await waitWhileMarketplacePostingPaused();
          if (marketplaceStopPostingRequested) {
            notifyMarketplaceItemPostingStatus({
              status: "stopped",
              message: "Marketplace posting stopped by user.",
              current,
              total,
              listingId: listing.id,
              listingTitle,
              successCount,
              failedCount
            });
            return;
          }
          notifyMarketplaceItemPostingStatus({
            status: "waiting",
            message: `Next post in ${formatPostingCountdown(remaining)}`,
            current,
            total,
            listingId: listing.id,
            listingTitle,
            successCount,
            failedCount,
            waitSeconds: remaining
          });
          await sleep(1e3);
        }
      }
    }
    notifyMarketplaceItemPostingStatus({
      status: "done",
      message: `Marketplace queue complete: ${successCount} posted, ${failedCount} failed.`,
      current: total,
      total,
      successCount,
      failedCount
    });
  }
  function throwIfMarketplacePostingStopped() {
    if (marketplaceStopPostingRequested) {
      throw new Error("Marketplace posting stopped by user.");
    }
  }
  async function waitWhileMarketplacePostingPaused() {
    while (marketplacePausePostingRequested && !marketplaceStopPostingRequested) {
      await sleep(250);
    }
  }
  function marketplacePostingListingTitle(listing) {
    return listing.listingType === "item" ? listing.title : [listing.year, listing.make, listing.model].filter(Boolean).join(" ");
  }
  function notifyMarketplaceCleanupStatus(partial) {
    void chrome.runtime.sendMessage({
      type: "MARKETPLACE_CLEANUP_STATUS",
      ...partial
    });
  }
  async function runMarketplaceCleanupInSellingPage(daysOld) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isFacebookUrl(tab.url)) {
      throw new Error("Open Facebook in the active tab before cleanup.");
    }
    const sellingUrl = "https://www.facebook.com/marketplace/you/selling?action=delete";
    notifyMarketplaceCleanupStatus({
      status: "preparing",
      message: "Opening your Facebook Marketplace selling listings\u2026",
      processed: 0,
      total: 0,
      deletedCount: 0,
      failedCount: 0
    });
    capturedMarketplaceSellingRequest = void 0;
    marketplaceCleanupCaptureTabId = tab.id;
    await navigateTabAndWaitForComplete(
      tab.id,
      sellingUrl,
      "/marketplace/you/selling"
    );
    const capturedDuringLoad = Boolean(capturedMarketplaceSellingRequest);
    const needsFallback = !capturedMarketplaceSellingRequest;
    if (needsFallback) {
      notifyMarketplaceCleanupStatus({
        status: "scanning",
        message: "Scrolling Marketplace to capture the active listings request\u2026",
        processed: 0,
        total: 0,
        deletedCount: 0,
        failedCount: 0
      });
      await scrollForMarketplaceCleanupRequest(tab.id);
    }
    debugLog("Marketplace cleanup capture completed.", {
      capturedDuringLoad,
      captured: Boolean(capturedMarketplaceSellingRequest)
    });
    marketplaceCleanupCaptureTabId = void 0;
    const activeSession = capturedMarketplaceSellingRequest ? marketplaceSessionFromCapturedRequest(capturedMarketplaceSellingRequest) : void 0;
    const refreshedTab = await chrome.tabs.get(tab.id);
    const refreshedUrl = new URL(refreshedTab.url ?? "");
    if (refreshedUrl.pathname !== "/marketplace/you/selling" || refreshedUrl.searchParams.get("action") !== "delete") {
      throw new Error(`Marketplace cleanup only works on ${sellingUrl}`);
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["dist/marketplace-cleanup.js"]
    });
    if (!activeSession) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        files: ["marketplace-graphql-capture.js"]
      });
    }
    const runId = crypto.randomUUID();
    const completion = new Promise((resolve) => {
      marketplaceCleanupCompletions.set(runId, resolve);
    });
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "RUN_MARKETPLACE_CLEANUP_IN_PAGE",
        runId,
        daysOld,
        activeSession
      });
      if (!response?.ok) {
        throw new Error(
          response?.error ?? "Marketplace cleanup did not start in the page."
        );
      }
      const result = await withTimeout(
        completion,
        20 * 60 * 1e3,
        "Marketplace cleanup timed out."
      );
      if (!result.ok) {
        throw new Error(result.error ?? "Marketplace cleanup failed.");
      }
      if ((result.deletedCount ?? 0) > 0) {
        await chrome.tabs.reload(tab.id);
      }
    } finally {
      marketplaceCleanupCompletions.delete(runId);
    }
  }
  async function scrollForMarketplaceCleanupRequest(tabId) {
    let stableBottomPasses = 0;
    let previousHeight = -1;
    while (true) {
      if (capturedMarketplaceSellingRequest) return;
      const [scrollResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const scrollingElement = document.scrollingElement ?? document.documentElement;
          const height = scrollingElement.scrollHeight;
          window.scrollTo({ top: height, behavior: "auto" });
          return { height };
        }
      });
      await sleep(1500);
      const [metricsResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const scrollingElement = document.scrollingElement ?? document.documentElement;
          return {
            top: scrollingElement.scrollTop,
            height: scrollingElement.scrollHeight,
            viewportHeight: scrollingElement.clientHeight
          };
        }
      });
      const metrics = metricsResult?.result;
      if (!metrics) continue;
      const atBottom = metrics.top + metrics.viewportHeight >= metrics.height - 4;
      const heightDidNotGrow = previousHeight === metrics.height || scrollResult?.result?.height === metrics.height;
      stableBottomPasses = atBottom && heightDidNotGrow ? stableBottomPasses + 1 : 0;
      previousHeight = metrics.height;
      if (stableBottomPasses >= 5) return;
    }
  }
  function marketplaceSessionFromCapturedRequest(request) {
    const body = new URLSearchParams(request.body);
    const value = (name) => body.get(name) ?? request.formData[name] ?? "";
    return {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body,
      cookie: request.headers.cookie ?? "",
      fbDtsg: value("fb_dtsg"),
      lsd: value("lsd"),
      userId: value("__user") || value("av"),
      aaid: value("__aaid"),
      rev: value("__rev"),
      hsi: value("__hsi"),
      hs: value("__hs"),
      s: value("__s"),
      jazoest: value("jazoest"),
      docId: value("doc_id")
    };
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
    const waitForElement = async (selector, timeoutMs = 1e4) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const element = Array.from(document.querySelectorAll(selector)).find(
          isVisible
        );
        if (element) {
          return element;
        }
        await wait(250);
      }
      return void 0;
    };
    try {
      const menuTriggers = Array.from(
        document.querySelectorAll('div[aria-haspopup="menu"]')
      ).filter(isVisible);
      if (menuTriggers.length === 0) {
        return {
          ok: false,
          error: "Could not find the joined groups sort menu button."
        };
      }
      let sortCard;
      for (const menuTrigger of menuTriggers) {
        clickElement(menuTrigger);
        await wait(3e3);
        sortCard = await waitForElement(
          'div[aria-label="Sort joined groups"]',
          1500
        );
        if (sortCard) {
          break;
        }
      }
      if (!sortCard) {
        return {
          ok: false,
          error: "Could not find the joined groups sort menu."
        };
      }
      const sortOption = Array.from(
        sortCard.querySelectorAll('div[role="menuitemradio"]')
      ).find(isVisible);
      if (!sortOption) {
        return {
          ok: false,
          error: "Could not find a joined groups sort option."
        };
      }
      clickElement(sortOption);
      await wait(2e3);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to trigger joined groups sort."
      };
    }
  }
  async function waitForCapturedGroupsRequest() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 2e4) {
      if (capturedGroupsRequest) {
        return capturedGroupsRequest;
      }
      await sleep(250);
    }
    throw new Error(
      "Could not capture Facebook groups request. Try again while logged into Facebook."
    );
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
          `Waiting before next page. ${allGroups.length} groups loaded.`,
          allGroups.length
        );
        await new Promise((resolve) => setTimeout(resolve, 2e3));
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
    void chrome.runtime.sendMessage(status);
  }
  function sleep(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
  }
  function throwIfPostingStopped() {
    if (activePosting && stopPostingRequested) {
      throw new Error(MANUAL_STOP_MESSAGE);
    }
  }
  async function waitWhilePostingPaused(statusContext) {
    while (activePosting && pausePostingRequested) {
      throwIfPostingStopped();
      if (!pauseNotificationSent) {
        notifyUiPostingStatus({
          status: "paused",
          message: statusContext.groupName ? `Posting paused before ${statusContext.groupName}.` : "Posting queue paused.",
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
      if (statusContext) {
        await waitWhilePostingPaused(statusContext);
      }
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
    const maxPosts = Number.isInteger(request.maxPosts) ? Math.max(request.maxPosts, 1) : request.groups.length;
    const groups = request.groups;
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
      requestedGroups: request.groups.length,
      groups: groups.length,
      maxPosts,
      posts: posts.length,
      images: posts.reduce((count, post) => count + post.images.length, 0),
      minimumDelaySeconds,
      maximumDelaySeconds,
      rotationStartedWithImagePost: firstPostWithImagesIndex > 0
    });
    if (activePosting) {
      notifyUiPostingStatus({
        status: "failed",
        message: "A posting queue is already running.",
        current: 0,
        total: groups.length,
        successCount: 0,
        failedCount: 0,
        processedCount: 0,
        error: "Wait for the current queue to finish before starting another."
      });
      return;
    }
    activePosting = true;
    activePostingSuccessTarget = maxPosts;
    latestUiPostingStatus = void 0;
    stopPostingRequested = false;
    pausePostingRequested = false;
    pauseNotificationSent = false;
    let successCount = 0;
    let failedCount = 0;
    const total = groups.length;
    let postingTabId;
    try {
      throwIfPostingStopped();
      if (total === 0) {
        throw new Error("Select at least one group before posting.");
      }
      if (posts.length === 0) {
        throw new Error("Select at least one prepared post before posting.");
      }
      const postingTab = await getActiveTabForPosting();
      postingTabId = postingTab.id;
      if (!postingTabId) {
        throw new Error("Unable to find the active tab for posting.");
      }
      activePostingTabId = postingTabId;
      const firstPostingUsageOperationId = await claimPostingUsage("group_post");
      let templates;
      try {
        templates = await ensurePostingTemplates(
          postingTabId,
          groups,
          posts[0].body,
          posts[0].images,
          total
        );
      } catch (error) {
        await finalizePostingUsage(
          "release",
          "group_post",
          firstPostingUsageOperationId
        );
        throw error;
      }
      if (templates.firstGroupPosted) {
        await finalizePostingUsage(
          "complete",
          "group_post",
          firstPostingUsageOperationId
        );
        successCount += 1;
        notifyUiPostingStatus({
          status: "posted",
          message: `Posted to ${groups[0].name}.`,
          current: 1,
          total,
          groupId: groups[0].id,
          groupName: groups[0].name,
          successCount,
          failedCount,
          processedCount: 1
        });
        throwIfPostingStopped();
        if (successCount >= maxPosts) {
          notifyUiPostingStatus({
            status: "done",
            message: `Maximum of ${maxPosts} successful posts reached. Queue stopped.`,
            current: 1,
            total,
            successCount,
            failedCount,
            processedCount: 1,
            successTarget: maxPosts
          });
          return;
        }
      } else {
        await finalizePostingUsage(
          "release",
          "group_post",
          firstPostingUsageOperationId
        );
      }
      const startIndex = templates.firstGroupPosted ? 1 : 0;
      notifyUiPostingStatus({
        status: "posting",
        message: "Starting GraphQL posting queue...",
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
      for (let attemptIndex = startIndex; successCount < maxPosts; attemptIndex += 1) {
        throwIfPostingStopped();
        const groupIndex = attemptIndex % groups.length;
        const cycleNumber = Math.floor(attemptIndex / groups.length) + 1;
        const group = groups[groupIndex];
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
          cycle: cycleNumber,
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
        const postBody = await maybeRewriteDescription(preparedPost.body);
        const postBodyWasRewritten = postBody !== preparedPost.body;
        throwIfPostingStopped();
        await waitWhilePostingPaused(statusContext);
        debugLog("Post body prepared for group.", {
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          originalLength: preparedPost.body.length,
          finalLength: postBody.length,
          rewritten: postBodyWasRewritten
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
            throw new Error("Image upload template was not captured.");
          }
          photoIds = await uploadImagesForGroup(
            postingTabId,
            templates.uploadTemplate,
            preparedPost.images
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
          message: `Posting prepared post ${preparedPostNumber}/${posts.length} to ${group.name}...`,
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount,
          failedCount,
          processedCount: attemptIndex
        });
        const postingUsageOperationId = await claimPostingUsage("group_post");
        let postResult;
        try {
          postResult = await createGraphqlPost(
            postingTabId,
            templates.postTemplate,
            postBody,
            photoIds,
            group.id,
            postBodyWasRewritten
          );
        } catch (error) {
          await finalizePostingUsage(
            "release",
            "group_post",
            postingUsageOperationId
          );
          throw error;
        }
        debugLog("GraphQL post result received.", {
          groupId: group.id,
          success: postResult.success,
          postId: postResult.postId,
          postUrl: postResult.postUrl,
          error: postResult.error
        });
        if (postResult.success) {
          await finalizePostingUsage(
            "complete",
            "group_post",
            postingUsageOperationId
          );
          successCount += 1;
          notifyUiPostingStatus({
            status: "posted",
            message: `Posted successfully to ${group.name}.`,
            current,
            total,
            groupId: group.id,
            groupName: group.name,
            successCount,
            failedCount,
            processedCount: attemptIndex + 1
          });
          if (successCount >= maxPosts) {
            notifyUiPostingStatus({
              status: "done",
              message: `Maximum of ${maxPosts} successful posts reached. Queue stopped.`,
              current,
              total,
              successCount,
              failedCount,
              processedCount: attemptIndex + 1,
              successTarget: maxPosts
            });
            return;
          }
        } else {
          await finalizePostingUsage(
            "release",
            "group_post",
            postingUsageOperationId
          );
          failedCount += 1;
          if (isRateLimitError(postResult.error)) {
            notifyUiPostingStatus({
              status: "rate_limited",
              message: "Facebook rate limit detected. Stopping.",
              current,
              total,
              groupId: group.id,
              groupName: group.name,
              successCount,
              failedCount,
              processedCount: attemptIndex + 1,
              error: postResult.error
            });
            return;
          }
          notifyUiPostingStatus({
            status: "failed",
            message: `Failed to post to ${group.name}.`,
            current,
            total,
            groupId: group.id,
            groupName: group.name,
            successCount,
            failedCount,
            processedCount: attemptIndex + 1,
            error: postResult.error
          });
        }
        const nextAttemptIndex = attemptIndex + 1;
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      debugWarn("Posting queue stopped with error.", { error: errorMessage });
      notifyUiPostingStatus({
        status: errorMessage === MANUAL_STOP_MESSAGE ? "stopped" : "done",
        message: errorMessage === MANUAL_STOP_MESSAGE ? MANUAL_STOP_MESSAGE : "GraphQL posting stopped.",
        current: Math.min(successCount + failedCount, total),
        total,
        successCount,
        failedCount,
        processedCount: Math.min(successCount + failedCount, total),
        error: errorMessage
      });
    } finally {
      debugLog("Posting queue finished.", {
        total,
        successCount,
        failedCount
      });
      activePosting = false;
      activePostingSuccessTarget = void 0;
      stopPostingRequested = false;
      pausePostingRequested = false;
      pauseNotificationSent = false;
      activePostingTabId = void 0;
    }
  }
  async function ensurePostingTemplates(tabId, groups, originalBody, images, total) {
    const requiresUploadTemplate = images.length > 0;
    const firstGroup = groups[0];
    if (!firstGroup) {
      throw new Error("Select at least one group before posting.");
    }
    debugLog("Capturing fresh templates from first group post.", {
      groupId: firstGroup.id,
      groupName: firstGroup.name,
      requiresUploadTemplate
    });
    notifyUiPostingStatus({
      status: "posting",
      message: `Rewriting description for ${firstGroup.name}...`,
      current: 1,
      total,
      groupId: firstGroup.id,
      groupName: firstGroup.name,
      successCount: 0,
      failedCount: 0,
      processedCount: 0
    });
    const body = await maybeRewriteDescription(originalBody);
    throwIfPostingStopped();
    debugLog("Post body prepared for first group.", {
      current: 1,
      total,
      groupId: firstGroup.id,
      groupName: firstGroup.name,
      originalLength: originalBody.length,
      finalLength: body.length,
      rewritten: body !== originalBody
    });
    notifyUiPostingStatus({
      status: "posting",
      message: "Capturing fresh Facebook request templates from the first post...",
      current: 1,
      total,
      groupId: firstGroup.id,
      groupName: firstGroup.name,
      successCount: 0,
      failedCount: 0,
      processedCount: 0
    });
    beginPostingTemplateCapture(tabId);
    throwIfPostingStopped();
    const groupUrl = normalizeGroupUrl(firstGroup.id);
    await chrome.tabs.update(tabId, { url: groupUrl, active: true });
    await waitForTabComplete(tabId, "/groups/");
    await sleepWithStopChecks(5e3, {
      current: 1,
      total,
      groupId: firstGroup.id,
      groupName: firstGroup.name,
      successCount: 0,
      failedCount: 0,
      processedCount: 0
    });
    const postResult = await createPostInTab(tabId, images, body);
    throwIfPostingStopped();
    if (!postResult.ok) {
      stopPostingTemplateCapture();
      throw new Error(postResult.error ?? "Unable to create the first post.");
    }
    const capturedTemplates = await waitForPostingTemplatesInternal(
      requiresUploadTemplate
    );
    return {
      uploadTemplate: capturedTemplates.uploadTemplate,
      postTemplate: capturedTemplates.postTemplate,
      firstGroupPosted: true
    };
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
  }
  async function waitForPostingTemplatesInternal(requiresUploadTemplate) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 3e4) {
      throwIfPostingStopped();
      if (capturedPostTemplate && (!requiresUploadTemplate || capturedUploadTemplate)) {
        const uploadTemplate = requiresUploadTemplate && capturedUploadTemplate ? finalizeUploadTemplate(capturedUploadTemplate, capturedPostTemplate) : void 0;
        const postTemplate = capturedPostTemplate;
        stopPostingTemplateCapture();
        debugLog("Template capture complete.", {
          hasUploadTemplate: Boolean(uploadTemplate),
          hasPostTemplate: true
        });
        return { uploadTemplate, postTemplate };
      }
      await sleepWithStopChecks(250);
    }
    stopPostingTemplateCapture();
    const missing = [];
    if (requiresUploadTemplate && !capturedUploadTemplate) {
      missing.push("upload template");
    }
    if (!capturedPostTemplate) {
      missing.push("post mutation template");
    }
    throw new Error(
      `The first post completed, but these templates were not captured in time: ${missing.join(", ")}.`
    );
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
  function isRateLimitError(error) {
    return /limit|temporarily blocked/i.test(error ?? "");
  }
  async function createPostInTab(tabId, images, body) {
    const request = {
      type: "CREATE_POST",
      body,
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
        if (response?.ok) {
          return response;
        }
        return {
          ok: false,
          composerFound: false,
          composerClicked: false,
          spanCount: 0,
          error: response?.error ?? "Unable to inspect Facebook page."
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
  async function navigateTabAndWaitForComplete(tabId, url, urlIncludes) {
    let listener;
    const navigationComplete = new Promise((resolve) => {
      listener = (updatedTabId, changeInfo, updatedTab) => {
        if (updatedTabId === tabId && changeInfo.status === "complete" && updatedTab.url?.includes(urlIncludes)) {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    try {
      const currentTab = await chrome.tabs.get(tabId);
      if (currentTab.url === url) {
        await chrome.tabs.reload(tabId);
      } else {
        await chrome.tabs.update(tabId, { url });
      }
      await navigationComplete;
    } catch (error) {
      if (listener) chrome.tabs.onUpdated.removeListener(listener);
      throw error;
    }
  }
  async function uploadImagesForGroup(tabId, uploadTemplate, images) {
    const photoIds = [];
    debugLog("Starting image uploads.", { imageCount: images.length });
    for (const image of images) {
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
        } else if (response.error) {
          debugWarn("Image upload failed.", {
            image: image.name,
            error: response.error
          });
        }
      } catch (error) {
        debugWarn("Image upload crashed.", {
          image: image.name,
          error
        });
      }
    }
    return photoIds;
  }
  async function uploadImage(tabId, uploadTemplate, image) {
    await logPageCookieDiagnostics(tabId, "Before upload replay");
    let result;
    try {
      [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: uploadImageInPage,
        args: [uploadTemplate, image]
      });
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
  async function createGraphqlPost(tabId, postTemplate, text, photoIds, groupId, textWasRewritten) {
    await logPageCookieDiagnostics(tabId, "Before GraphQL replay");
    const variables = buildPostVariables(
      postTemplate.formData,
      text,
      photoIds,
      groupId,
      textWasRewritten
    );
    debugLog("Sending GraphQL post request.", {
      groupId,
      photoCount: photoIds.length,
      variableLength: variables.length
    });
    let result;
    try {
      [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: createGraphqlPostInPage,
        args: [postTemplate, variables]
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "GraphQL replay script failed to execute."
      };
    }
    const payload = result?.result ?? {
      status: 0,
      ok: false,
      responseText: "",
      contentType: "",
      error: "GraphQL replay returned no result."
    };
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
        error: payload.error
      };
    }
    if (isRateLimitBody(payload.responseText)) {
      debugWarn("Facebook rate limit detected in GraphQL response.", {
        groupId
      });
      return {
        success: false,
        error: "Facebook returned a posting limit response."
      };
    }
    return parsePostResponse(payload.responseText);
  }
  function buildPostVariables(templateFormData, text, photoIds, groupId, textWasRewritten) {
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
        groupId,
        textWasRewritten
      );
    }
    const input = templateVariables.input;
    const originalText = isRecord(input.message) && typeof input.message.text === "string" ? input.message.text : void 0;
    const originalGroupId = getTemplateGroupId(input);
    if (isRecord(input.logging)) {
      input.logging.composer_session_id = generateSessionId();
    }
    if (isRecord(input.message)) {
      input.message.text = text;
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
    if (originalText !== text || !isRecord(input.composed_text)) {
      input.composed_text = buildComposedText(text, {
        preserveBlankLines: !textWasRewritten
      });
    }
    replaceStringValue(templateVariables, originalText, text);
    replaceStringValue(templateVariables, originalGroupId, groupId);
    return JSON.stringify(templateVariables);
  }
  function buildFallbackPostVariables(templateFormData, text, attachments, groupId, textWasRewritten) {
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
        composed_text: buildComposedText(text, {
          preserveBlankLines: !textWasRewritten
        }),
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
  function buildComposedText(text, { preserveBlankLines }) {
    const textBlocks = text.split(/\r?\n/);
    const blocks = (textBlocks.length > 0 ? textBlocks : [text]).map((block) => block.trimEnd()).filter((block) => preserveBlankLines || block.trim().length > 0).map((block) => block.length > 0 ? block : "\xA0");
    const normalizedBlocks = blocks.length > 0 ? blocks : [text.trim()];
    return {
      block_data: normalizedBlocks.map(() => "{}"),
      block_depths: normalizedBlocks.map(() => 0),
      block_types: normalizedBlocks.map(() => 0),
      blocks: normalizedBlocks,
      entities: normalizedBlocks.map(() => "[]"),
      entity_map: "{}",
      inline_styles: normalizedBlocks.map(() => "[]")
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
          error: "Facebook returned an empty JSON payload."
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
          postId: storyCreateMatch.postId,
          postUrl: storyCreateMatch.url
        };
      }
      const matches = findPostRecords(firstObject);
      const lastMatch = matches.length > 0 ? matches[matches.length - 1] : void 0;
      if (!lastMatch) {
        return {
          success: false,
          error: "Facebook did not return a post permalink."
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
      const fallbackUrl = directUrl ?? storyUrl;
      const fallbackId = directPostId ?? storyId;
      if (fallbackUrl && (fallbackUrl.includes("/pending_posts/") || fallbackUrl.includes("/permalink/") || fallbackUrl.includes("/posts/"))) {
        return {
          postId: fallbackId ?? "unknown-story-id",
          url: fallbackUrl
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
    return FACEBOOK_POST_LIMIT_PATTERN.test(responseText) || /temporarily blocked/i.test(responseText);
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
  async function logPageCookieDiagnostics(tabId, label) {
    try {
      const [tabInfo, result] = await Promise.all([
        chrome.tabs.get(tabId),
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const cookieNames = document.cookie.split(";").map((part) => part.trim()).filter(Boolean).map((part) => part.split("=")[0]?.trim()).filter((name) => Boolean(name));
            return {
              href: window.location.href,
              origin: window.location.origin,
              cookieCount: cookieNames.length,
              cookieNames
            };
          }
        })
      ]);
      const pageData = result[0]?.result;
      debugLog(`${label} page cookie diagnostics.`, {
        tabUrl: tabInfo.url,
        pageUrl: pageData?.href,
        pageOrigin: pageData?.origin,
        pageCookieCount: pageData?.cookieCount ?? 0,
        pageCookieNames: pageData?.cookieNames ?? []
      });
    } catch (error) {
      debugWarn(`${label} page cookie diagnostics failed.`, {
        tabId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  async function uploadImageInPage(uploadTemplate, image) {
    try {
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
      const response = await fetch(image.dataUrl);
      const blob = await response.blob();
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
        replayHeaders["x-fb-friendly-name"] = replayHeaders["x-fb-friendly-name"] ?? "ComposerStoryCreateMutation";
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
  async function maybeRewriteDescription(description) {
    const storage = await chrome.storage.local.get([
      ...GEMINI_API_KEY_STORAGE_KEYS,
      GEMINI_REWRITE_ENABLED_STORAGE_KEY,
      GEMINI_CUSTOM_PROMPT_STORAGE_KEY,
      GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY
    ]);
    const apiKey = GEMINI_API_KEY_STORAGE_KEYS.map((key) => storage[key]).find(
      (value) => typeof value === "string" && value.trim().length > 0
    );
    const customPromptValue = storage[GEMINI_CUSTOM_PROMPT_STORAGE_KEY];
    return rewriteDescriptionWithGemini(description, {
      enabled: storage[GEMINI_REWRITE_ENABLED_STORAGE_KEY] === true,
      apiKey: apiKey ?? "",
      customPrompt: typeof customPromptValue === "string" ? customPromptValue.trim() : "",
      includeHashtags: storage[GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY] !== false,
      destination: "Facebook Group"
    });
  }
  async function rewriteDescriptionWithGemini(description, settings) {
    const trimmed = description.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (!settings.enabled) {
      debugLog("Gemini rewrite skipped because the feature is disabled.");
      return trimmed;
    }
    const apiKey = settings.apiKey.trim();
    if (!apiKey) {
      debugLog("Gemini rewrite skipped because no API key was found.");
      return trimmed;
    }
    const customPrompt = settings.customPrompt.trim();
    const includeHashtags = settings.includeHashtags;
    const hashtagRules = includeHashtags ? "- Include exactly 6 relevant hashtags based on the original description.\n- Put all 6 hashtags together at the very bottom of the finished description, even if the custom instructions omit or forbid hashtags." : "- Do not include hashtags in the finished description, even if the original or custom instructions contain them.";
    const phoneNumberRules = `- Treat every phone number as immutable verbatim text and copy every occurrence exactly as it appears in the original description.
- Preserve the exact Unicode characters and formatting of each phone number, including ordinary digits, mathematical or styled digits, keycap emoji digits, leading zeros, country-code prefixes, spaces, punctuation, and separators.
- Never convert a styled or emoji phone number into ordinary digits, and never convert an ordinary-digit phone number into styled text or emojis. For example, 0\uFE0F\u20E37\uFE0F\u20E31\uFE0F\u20E38\uFE0F\u20E34\uFE0F\u20E34\uFE0F\u20E38\uFE0F\u20E34\uFE0F\u20E36\uFE0F\u20E31\uFE0F\u20E3 must remain exactly 0\uFE0F\u20E37\uFE0F\u20E31\uFE0F\u20E38\uFE0F\u20E34\uFE0F\u20E34\uFE0F\u20E38\uFE0F\u20E34\uFE0F\u20E36\uFE0F\u20E31\uFE0F\u20E3.
- These phone-number preservation rules are mandatory and override any conflicting custom rewrite instruction.`;
    const prompt = customPrompt ? `Rewrite the ${settings.destination} description using the custom instructions below.

Mandatory accuracy rules:
- Use the original description as the only source of facts.
- Preserve all important details and contact information exactly as provided.
- Do not invent, assume, or change facts, specifications, prices, terms, locations, or contact information.
${phoneNumberRules}
${hashtagRules}
- Return only the finished rewritten description, without explanations or notes.

The custom instructions control all other style and formatting choices, including structure, tone, emojis, and bullets.

Custom rewrite instructions:
${customPrompt}

Any placeholder in the custom instructions asking for the original advertisement refers to the actual original description supplied below. Do not reproduce placeholder text in the result.

Original description:
${trimmed}` : `Rewrite this ${settings.destination} description to be concise, clear, natural, and persuasive.

Rules:
- Return only the rewritten description.
- Keep important product details.
- Do not invent details.
- Always make the description easy to scan using short lines and natural paragraph breaks instead of one wall of text.
- Use a few appropriate, persuasive emojis where they make the listing feel more engaging.
- Do not use Markdown formatting, asterisks, bullet symbols, or decorative separator symbols.
- Keep emojis natural and relevant; do not overuse them.
${phoneNumberRules}
${hashtagRules}

Description:
${trimmed}`;
    try {
      debugLog("Sending Gemini rewrite request.", {
        model: GEMINI_MODEL,
        inputLength: trimmed.length,
        customPromptLength: customPrompt.length
      });
      const requestController = new AbortController();
      activeGeminiRequestController = requestController;
      const response = await withTimeout(
        (async () => {
          const apiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
              },
              signal: requestController.signal,
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  thinkingConfig: {
                    thinkingBudget: 0
                  }
                }
              })
            }
          );
          const payload = await apiResponse.json();
          if (!apiResponse.ok) {
            throw new Error(
              payload.error?.message ?? `Gemini request failed with status ${apiResponse.status}.`
            );
          }
          return payload;
        })(),
        GEMINI_TIMEOUT_MS,
        "Gemini rewrite timed out."
      );
      const rewritten = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
      debugLog("Gemini rewrite completed.", {
        outputLength: rewritten.length,
        changed: rewritten !== trimmed
      });
      return rewritten || trimmed;
    } catch (error) {
      debugWarn("Gemini rewrite failed.", error);
      return trimmed;
    } finally {
      activeGeminiRequestController = void 0;
    }
  }
  async function withTimeout(promise, timeoutMs, message) {
    let timeoutId = 0;
    return new Promise((resolve, reject) => {
      timeoutId = self.setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
      void promise.then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      }).catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }
  function notifyUiPostingStatus(partial) {
    const status = {
      type: "UI_POSTING_STATUS",
      successTarget: activePostingSuccessTarget,
      ...partial
    };
    latestUiPostingStatus = status;
    void chrome.runtime.sendMessage(status);
  }
  function notifyMarketplaceItemPostingStatus(partial) {
    const status = {
      type: "MARKETPLACE_ITEM_POSTING_STATUS",
      ...partial
    };
    latestMarketplacePostingStatus = status;
    void chrome.runtime.sendMessage(status);
  }
  function notifyMarketplacePostingControlStatus(status, message) {
    const latest = latestMarketplacePostingStatus;
    notifyMarketplaceItemPostingStatus({
      status,
      message,
      current: latest?.current ?? 0,
      total: latest?.total ?? 0,
      listingId: latest?.listingId,
      listingTitle: latest?.listingTitle,
      successCount: latest?.successCount ?? 0,
      failedCount: latest?.failedCount ?? 0
    });
  }
  function sendMarketplacePostingControl(type) {
    if (activeMarketplacePostingTabId === void 0) {
      return;
    }
    void chrome.tabs.sendMessage(activeMarketplacePostingTabId, { type }).catch(() => {
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
