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
  var GROUP_STARTER_EXCLUSIONS_STORAGE_KEY = "balancedStarterExcludedGroupIds";
  var LOG_PREFIX = "[Facebook Groups Bulk Poster]";
  var PostingAccessError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "PostingAccessError";
    }
  };
  var MissingFirstGroupComposerError = class extends Error {
    constructor(groupName) {
      super(
        `Postika could not find \u201CWrite something...\u201D in ${groupName}. Start posting again and Postika will try another selected Group first.`
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
  async function updatePostingUsage(action, kind, operationId, facebookActorId) {
    const sessionToken = await getKundiPostSessionToken();
    const response = await fetch(
      `${AUTH_API_BASE_URL}/api/posting-usage/${action}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          kind,
          operation_id: operationId,
          ...action === "claim" && facebookActorId ? { facebook_actor_id: facebookActorId } : {}
        })
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
  async function getKundiPostSessionToken() {
    const storage = await chrome.storage.local.get(AUTH_SESSION_STORAGE_KEY);
    const session = storage[AUTH_SESSION_STORAGE_KEY];
    const sessionToken = typeof session?.sessionToken === "string" ? session.sessionToken.trim() : "";
    if (!sessionToken) {
      throw new PostingAccessError("Sign in with Google to continue posting.");
    }
    return sessionToken;
  }
  async function createBalancedGroupPostingPlan(groups, facebookActorId, maximumPosts, failedGroupIds, starterExcludedGroupIds) {
    const sessionToken = await getKundiPostSessionToken();
    const response = await fetch(
      `${AUTH_API_BASE_URL}/api/group-posting-stats/plan`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          facebook_actor_id: facebookActorId,
          groups: groups.map(({ id, name }) => ({ id, name })),
          maximum_posts: maximumPosts,
          failed_group_ids: failedGroupIds,
          starter_excluded_group_ids: starterExcludedGroupIds
        })
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload.code === "no_eligible_balanced_group") {
        return [];
      }
      throw new PostingAccessError(
        payload.error ?? "Unable to create a balanced Group posting plan."
      );
    }
    return payload.plan ?? [];
  }
  async function getGroupStarterExcludedIds(facebookActorId) {
    const actorKey = await hashLocalIdentifier(facebookActorId);
    const stored = await chrome.storage.session.get(
      GROUP_STARTER_EXCLUSIONS_STORAGE_KEY
    );
    const exclusions = stored[GROUP_STARTER_EXCLUSIONS_STORAGE_KEY];
    const values = exclusions?.[actorKey];
    return Array.isArray(values) ? values.filter(
      (value) => typeof value === "string" && /^\d{5,32}$/.test(value)
    ) : [];
  }
  async function rememberGroupStarterExclusion(facebookActorId, groupId) {
    const actorKey = await hashLocalIdentifier(facebookActorId);
    const stored = await chrome.storage.session.get(
      GROUP_STARTER_EXCLUSIONS_STORAGE_KEY
    );
    const exclusions = {
      ...stored[GROUP_STARTER_EXCLUSIONS_STORAGE_KEY] ?? {}
    };
    const existing = Array.isArray(exclusions[actorKey]) ? exclusions[actorKey].filter(
      (value) => typeof value === "string"
    ) : [];
    exclusions[actorKey] = Array.from(/* @__PURE__ */ new Set([...existing, groupId]));
    await chrome.storage.session.set({
      [GROUP_STARTER_EXCLUSIONS_STORAGE_KEY]: exclusions
    });
  }
  function moveFirstAvailableStarterToFront(groups, excludedGroupIds) {
    const excluded = new Set(excludedGroupIds);
    const starterIndex = groups.findIndex((group) => !excluded.has(group.id));
    if (starterIndex < 0) {
      return [];
    }
    if (starterIndex === 0) {
      return [...groups];
    }
    return [
      groups[starterIndex],
      ...groups.slice(0, starterIndex),
      ...groups.slice(starterIndex + 1)
    ];
  }
  async function hashLocalIdentifier(value) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value)
    );
    return Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("");
  }
  function isMissingFirstGroupComposerError(error) {
    return error instanceof Error && (error instanceof MissingFirstGroupComposerError || /write something(?:\.\.\.)?.*(?:not found|could not find)/i.test(
      error.message
    ));
  }
  async function recordAcceptedGroupPost(facebookActorId, group, operationId) {
    const sessionToken = await getKundiPostSessionToken();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(
          `${AUTH_API_BASE_URL}/api/group-posting-stats/accepted`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${sessionToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              facebook_actor_id: facebookActorId,
              group_id: group.id,
              group_name: group.name,
              operation_id: operationId
            })
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (response.ok) {
          return true;
        }
        if (response.status < 500 || attempt === 3) {
          debugWarn("Unable to update Group posting history.", {
            groupId: group.id,
            status: response.status,
            error: payload.error
          });
          return false;
        }
      } catch (error) {
        if (attempt === 3) {
          debugWarn("Unable to update Group posting history.", {
            groupId: group.id,
            error: error instanceof Error ? error.message : String(error)
          });
          return false;
        }
      }
    }
    return false;
  }
  async function claimPostingUsage(kind, facebookActorId) {
    const operationId = crypto.randomUUID();
    await updatePostingUsage("claim", kind, operationId, facebookActorId);
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
  function normalizeFacebookActorId(value) {
    const actorId = value?.trim() ?? "";
    return /^\d{5,32}$/.test(actorId) ? actorId : "";
  }
  async function getFacebookActorId(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !isFacebookUrl(tab.url)) {
      throw new PostingAccessError(
        "Open Facebook and sign in before starting a posting queue."
      );
    }
    const cookie = await chrome.cookies.get({
      url: tab.url,
      name: "c_user"
    });
    const actorId = normalizeFacebookActorId(cookie?.value);
    if (!actorId) {
      throw new PostingAccessError(
        "Postika could not identify the Facebook account signed in to this Chrome profile. Refresh Facebook, sign in again, and retry."
      );
    }
    return actorId;
  }
  var pendingRequests = /* @__PURE__ */ new Map();
  var capturedGroupsRequest;
  var captureTabId;
  var marketplaceCleanupCaptureTabId;
  var capturedMarketplaceSellingRequest;
  var marketplaceCleanupActive = false;
  var marketplaceCleanupCompletions = /* @__PURE__ */ new Map();
  var activePosting = false;
  var activePostingSuccessTarget;
  var activePostingPendingCount = 0;
  var stopPostingRequested = false;
  var pausePostingRequested = false;
  var pauseNotificationSent = false;
  var geminiBypassed = { groups: false, marketplace: false };
  var pendingGeminiPrompts = /* @__PURE__ */ new Map();
  function resolveGeminiPrompt(id, action) {
    const pending = pendingGeminiPrompts.get(id);
    if (!pending) return false;
    pendingGeminiPrompts.delete(id);
    pending.resolve(action);
    return true;
  }
  async function handleGeminiFailure(queue, error) {
    const stopped = () => queue === "groups" ? stopPostingRequested : marketplaceStopPostingRequested;
    if (stopped()) throw new Error(MANUAL_STOP_MESSAGE);
    const prompt = {
      type: "GEMINI_ERROR_PROMPT",
      id: crypto.randomUUID(),
      queue,
      error
    };
    const decision = new Promise((resolve) => {
      pendingGeminiPrompts.set(prompt.id, { prompt, resolve });
    });
    const log = (message) => {
      if (queue === "groups" && latestUiPostingStatus) {
        notifyUiPostingStatus({
          ...latestUiPostingStatus,
          status: "posting",
          message
        });
      } else if (queue === "marketplace" && latestMarketplacePostingStatus) {
        notifyMarketplaceItemPostingStatus({
          ...latestMarketplacePostingStatus,
          status: "posting",
          message
        });
      }
    };
    log(`Gemini rewrite failed: ${error} Waiting for your choice.`);
    void chrome.runtime.sendMessage(prompt).catch(() => {
    });
    const action = await decision;
    if (action === "stop" || stopped()) {
      if (queue === "groups") stopPostingRequested = true;
      else marketplaceStopPostingRequested = true;
      log("Stopped posting after Gemini rewrite failed.");
      throw new Error(MANUAL_STOP_MESSAGE);
    }
    geminiBypassed[queue] = true;
    log("Continuing without Gemini for this queue. Using original descriptions.");
  }
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
  var groupsPostingTimer;
  var marketplacePostingTimer;
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
  var LAST_GROUP_POSTING_STATUS_STORAGE_KEY = "lastGroupPostingStatus";
  var LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY = "lastMarketplacePostingStatus";
  void chrome.storage.local.remove([
    LAST_GROUP_POSTING_STATUS_STORAGE_KEY,
    LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY
  ]);
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
      if (request.type === "RESOLVE_GEMINI_ERROR") {
        sendResponse({
          ok: (request.action === "continue" || request.action === "stop") && resolveGeminiPrompt(request.id, request.action)
        });
        return false;
      }
      if (request.type === "GET_POSTING_QUEUE_STATUS") {
        void chrome.storage.session.get([
          LAST_GROUP_POSTING_STATUS_STORAGE_KEY,
          LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY
        ]).then((storage) => {
          const storedGroups = storage[LAST_GROUP_POSTING_STATUS_STORAGE_KEY];
          const storedGroupsIsTransientError = storedGroups?.status === "rate_limited";
          if (storedGroupsIsTransientError) {
            void chrome.storage.session.remove(
              LAST_GROUP_POSTING_STATUS_STORAGE_KEY
            );
          }
          const currentGroups = latestUiPostingStatus && (activePosting || latestUiPostingStatus.status !== "rate_limited") ? {
            ...latestUiPostingStatus,
            timing: queueTimingSnapshot(
              groupsPostingTimer,
              latestUiPostingStatus.groupId
            ) ?? latestUiPostingStatus.timing
          } : void 0;
          sendResponse({
            geminiPrompts: Array.from(
              pendingGeminiPrompts.values(),
              ({ prompt }) => prompt
            ),
            groups: currentGroups ?? (storedGroupsIsTransientError ? void 0 : storedGroups),
            marketplace: latestMarketplacePostingStatus ? {
              ...latestMarketplacePostingStatus,
              timing: queueTimingSnapshot(
                marketplacePostingTimer,
                latestMarketplacePostingStatus.listingId
              ) ?? latestMarketplacePostingStatus.timing
            } : storage[LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY]
          });
        });
        return true;
      }
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
        for (const [id, pending] of pendingGeminiPrompts) {
          if (pending.prompt.queue === "marketplace")
            resolveGeminiPrompt(id, "stop");
        }
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
        pauseQueueTimer(marketplacePostingTimer);
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
        resumeQueueTimer(marketplacePostingTimer);
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
        for (const [id, pending] of pendingGeminiPrompts) {
          if (pending.prompt.queue === "groups") resolveGeminiPrompt(id, "stop");
        }
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
        pauseQueueTimer(groupsPostingTimer);
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
        resumeQueueTimer(groupsPostingTimer);
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
    geminiBypassed.marketplace = false;
    marketplacePostingTimer = createQueueTimer(request.startedAt);
    latestMarketplacePostingStatus = void 0;
    void chrome.storage.session.remove(
      LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY
    );
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
        const facebookActorId = await getFacebookActorId(tabId);
        postingUsageOperationId = await claimPostingUsage(
          "marketplace_listing",
          facebookActorId
        );
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
    const requestedMaxPosts = Number.isInteger(request.maxPosts) ? Math.max(request.maxPosts, 1) : request.groups.length;
    const balancedPosting = request.postingStrategy === "balanced";
    const maxPosts = requestedMaxPosts;
    const selectedGroups = request.groups;
    let groups = selectedGroups;
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
    geminiBypassed.groups = false;
    groupsPostingTimer = createQueueTimer(request.startedAt);
    void chrome.storage.session.remove(LAST_GROUP_POSTING_STATUS_STORAGE_KEY);
    activePostingSuccessTarget = maxPosts;
    activePostingPendingCount = 0;
    latestUiPostingStatus = void 0;
    stopPostingRequested = false;
    pausePostingRequested = false;
    pauseNotificationSent = false;
    let successCount = 0;
    let failedCount = 0;
    const failedBalancedGroupIds = /* @__PURE__ */ new Set();
    const total = balancedPosting ? maxPosts : groups.length;
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
      const facebookActorId = await getFacebookActorId(postingTabId);
      const starterExcludedGroupIds = new Set(
        await getGroupStarterExcludedIds(facebookActorId)
      );
      if (balancedPosting) {
        groups = await createBalancedGroupPostingPlan(
          selectedGroups,
          facebookActorId,
          maxPosts,
          [],
          Array.from(starterExcludedGroupIds)
        );
        if (groups.length === 0) {
          throw new Error(
            "None of the selected Groups can start posting in this browser session. Select another standard Group with a visible \u201CWrite something...\u201D button."
          );
        }
        notifyUiPostingStatus({
          status: "posting",
          message: `Ready to spread ${groups.length} posts across ${selectedGroups.length} selected Groups, starting with Groups you have posted to the least.`,
          current: 0,
          total,
          successCount,
          failedCount,
          processedCount: 0,
          successTarget: maxPosts
        });
      } else {
        groups = moveFirstAvailableStarterToFront(
          selectedGroups,
          Array.from(starterExcludedGroupIds)
        );
        if (groups.length === 0) {
          throw new Error(
            "None of the selected Groups can start posting in this browser session. Select another standard Group with a visible \u201CWrite something...\u201D button."
          );
        }
      }
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
      const firstPostBody = await maybeRewriteDescription(posts[0].body);
      throwIfPostingStopped();
      let firstPostingUsageOperationId = "";
      let templates;
      while (true) {
        firstPostingUsageOperationId = await claimPostingUsage(
          "group_post",
          facebookActorId
        );
        try {
          templates = await ensurePostingTemplates(
            postingTabId,
            groups,
            posts[0].body,
            firstPostBody,
            posts[0].images,
            total
          );
          break;
        } catch (error) {
          await finalizePostingUsage(
            "release",
            "group_post",
            firstPostingUsageOperationId
          );
          if (!isMissingFirstGroupComposerError(error)) {
            throw error;
          }
          const incompatibleStarter = groups[0];
          starterExcludedGroupIds.add(incompatibleStarter.id);
          try {
            await rememberGroupStarterExclusion(
              facebookActorId,
              incompatibleStarter.id
            );
          } catch (storageError) {
            debugWarn("Unable to remember the incompatible starter Group.", {
              groupId: incompatibleStarter.id,
              error: storageError instanceof Error ? storageError.message : String(storageError)
            });
          }
          groups = balancedPosting ? await createBalancedGroupPostingPlan(
            selectedGroups,
            facebookActorId,
            maxPosts,
            [],
            Array.from(starterExcludedGroupIds)
          ) : moveFirstAvailableStarterToFront(
            selectedGroups,
            Array.from(starterExcludedGroupIds)
          );
          if (groups.length === 0) {
            throw new Error(
              "None of the selected Groups has a visible \u201CWrite something...\u201D button. Select another standard Group and try again."
            );
          }
          notifyUiPostingStatus({
            status: "posting",
            message: `${incompatibleStarter.name} cannot start the queue. Trying ${groups[0].name} instead...`,
            current: 0,
            total,
            groupId: groups[0].id,
            groupName: groups[0].name,
            successCount,
            failedCount,
            processedCount: 0,
            successTarget: maxPosts
          });
        }
      }
      if (templates.firstGroupPosted) {
        if (templates.firstPostResult?.actorId && templates.firstPostResult.actorId !== facebookActorId) {
          debugWarn(
            "First post actor did not match the signed-in Facebook account."
          );
        }
        await finalizePostingUsage(
          "complete",
          "group_post",
          firstPostingUsageOperationId
        );
        const firstHistoryRecorded = await recordAcceptedGroupPost(
          facebookActorId,
          groups[0],
          firstPostingUsageOperationId
        );
        successCount += 1;
        const firstPostPending = templates.firstPostResult?.pendingApproval === true;
        if (firstPostPending) {
          activePostingPendingCount += 1;
        }
        notifyUiPostingStatus({
          status: firstPostPending ? "pending" : "posted",
          message: firstPostPending ? "Your post is pending" : `Posted to ${groups[0].name}.`,
          detail: firstPostPending ? "Your post is awaiting admin approval. If the admin team approves it, it'll become visible in the group." : firstHistoryRecorded ? void 0 : "The post succeeded, but Postika could not update its Group balance history.",
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
            message: `Maximum of ${maxPosts} accepted submissions reached. Queue stopped.`,
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
      for (let attemptIndex = startIndex; successCount < maxPosts && (!balancedPosting || attemptIndex < groups.length); attemptIndex += 1) {
        throwIfPostingStopped();
        const groupIndex = balancedPosting ? attemptIndex : attemptIndex % groups.length;
        const cycleNumber = balancedPosting ? Math.floor(attemptIndex / selectedGroups.length) + 1 : Math.floor(attemptIndex / groups.length) + 1;
        const group = groups[groupIndex];
        if (balancedPosting && failedBalancedGroupIds.has(group.id)) {
          if (failedBalancedGroupIds.size >= selectedGroups.length) {
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
        const postingUsageOperationId = await claimPostingUsage(
          "group_post",
          facebookActorId
        );
        let postResult;
        try {
          postResult = await createGraphqlPost(
            postingTabId,
            templates.postTemplate,
            postBody,
            photoIds,
            group.id
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
          await finalizePostingUsage(
            "complete",
            "group_post",
            postingUsageOperationId
          );
          const historyRecorded = await recordAcceptedGroupPost(
            facebookActorId,
            group,
            postingUsageOperationId
          );
          successCount += 1;
          if (postResult.pendingApproval) {
            activePostingPendingCount += 1;
          }
          notifyUiPostingStatus({
            status: postResult.pendingApproval ? "pending" : "posted",
            message: postResult.pendingApproval ? "Your post is pending" : `Posted successfully to ${group.name}.`,
            detail: postResult.pendingApproval ? "Your post is awaiting admin approval. If the admin team approves it, it'll become visible in the group." : historyRecorded ? void 0 : "The post succeeded, but Postika could not update its Group balance history.",
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
              message: `Maximum of ${maxPosts} accepted submissions reached. Queue stopped.`,
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
          if (balancedPosting) {
            failedBalancedGroupIds.add(group.id);
          }
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
        if (balancedPosting && failedBalancedGroupIds.size >= selectedGroups.length) {
          break;
        }
        if (balancedPosting) {
          const currentPlan = groups.slice(0, nextAttemptIndex);
          const remainingPlan = groups.slice(nextAttemptIndex).filter(
            (plannedGroup) => !failedBalancedGroupIds.has(plannedGroup.id)
          );
          const remainingTarget = maxPosts - successCount;
          if (remainingPlan.length < remainingTarget) {
            const replacementPlan = await createBalancedGroupPostingPlan(
              selectedGroups,
              facebookActorId,
              remainingTarget,
              Array.from(failedBalancedGroupIds),
              []
            );
            groups = [...currentPlan, ...replacementPlan];
          } else {
            groups = [...currentPlan, ...remainingPlan];
          }
        }
        if (balancedPosting && nextAttemptIndex >= groups.length) {
          break;
        }
        const nextGroupIndex = balancedPosting ? nextAttemptIndex : nextAttemptIndex % groups.length;
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
      if (balancedPosting) {
        notifyUiPostingStatus({
          status: "done",
          message: successCount >= maxPosts ? `Balanced queue reached ${successCount} accepted posts.` : `Balanced queue stopped after every selected Group failed. ${successCount} posts were accepted.`,
          current: Math.min(successCount + failedCount, total),
          total,
          successCount,
          failedCount,
          processedCount: Math.min(successCount + failedCount, total),
          successTarget: maxPosts
        });
      }
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
          message: errorMessage === MANUAL_STOP_MESSAGE ? MANUAL_STOP_MESSAGE : "GraphQL posting stopped.",
          current: Math.min(successCount + failedCount, total),
          total,
          successCount,
          failedCount,
          processedCount: Math.min(successCount + failedCount, total),
          error: errorMessage
        });
      }
    } finally {
      if (postingTabId) {
        await readFirstPostResponseCapture(postingTabId, true);
      }
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
      activePostingTabId = void 0;
    }
  }
  async function ensurePostingTemplates(tabId, groups, originalBody, body, images, total) {
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
    await installFirstPostResponseCapture(tabId);
    const postResult = await createPostInTab(tabId, images, body);
    if (!postResult.ok && postResult.composerFound === false && /write something button not found/i.test(postResult.error ?? "")) {
      stopPostingTemplateCapture();
      throw new MissingFirstGroupComposerError(firstGroup.name);
    }
    const firstResponseText = await waitForFirstPostResponseCapture(tabId);
    const firstPostResult = firstResponseText ? parsePostResponse(firstResponseText) : void 0;
    throwIfPostingStopped();
    if (!postResult.ok || firstPostResult?.success === false) {
      stopPostingTemplateCapture();
      const message = firstResponseText ? classifyFacebookPostFailure(
        firstResponseText,
        firstPostResult?.error ?? postResult.error
      ) : postResult.error ?? "Unable to create the first post.";
      if (firstResponseText) {
        throw new FacebookPostResponseError(message, firstResponseText);
      }
      throw new Error(message);
    }
    const capturedTemplates = await waitForPostingTemplatesInternal(
      requiresUploadTemplate
    );
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
  async function waitForFirstPostResponseCapture(tabId) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 1e4) {
      throwIfPostingStopped();
      const responseText = await readFirstPostResponseCapture(tabId, false);
      if (responseText) {
        await readFirstPostResponseCapture(tabId, true);
        return responseText;
      }
      await sleepWithStopChecks(200);
    }
    await readFirstPostResponseCapture(tabId, true);
    debugWarn(
      "The first post response was not available for moderation classification."
    );
    return void 0;
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
      debugWarn("Unable to read the first post response capture.", error);
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
  function isRateLimitError(error, responseBody) {
    const message = error?.trim() ?? "";
    const combined = `${message}
${responseBody ?? ""}`;
    if (message === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE || FACEBOOK_PENDING_CONTENT_LIMIT_PATTERN.test(combined) || FACEBOOK_PENDING_CONTENT_LIMIT_ERROR_CODE_PATTERN.test(combined)) {
      return false;
    }
    return isRateLimitBody(combined);
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
  async function createGraphqlPost(tabId, postTemplate, text, photoIds, groupId) {
    await logPageCookieDiagnostics(tabId, "Before GraphQL replay");
    const variables = buildPostVariables(
      postTemplate.formData,
      text,
      photoIds,
      groupId
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
  function classifyFacebookPostFailure(responseText, fallback) {
    if (FACEBOOK_PENDING_CONTENT_LIMIT_PATTERN.test(responseText) || FACEBOOK_PENDING_CONTENT_LIMIT_ERROR_CODE_PATTERN.test(responseText)) {
      return FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE;
    }
    if (isRateLimitBody(responseText)) {
      return FACEBOOK_RATE_LIMIT_MESSAGE;
    }
    return fallback ?? "Facebook rejected the Group post.";
  }
  function buildPostVariables(templateFormData, text, photoIds, groupId) {
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
      input.composed_text = buildComposedText(text);
    }
    replaceStringValue(templateVariables, originalText, text);
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
      const defaultActor = story && isRecord(story.default_actor) ? story.default_actor : void 0;
      const actorId = defaultActor && typeof defaultActor.id === "string" ? defaultActor.id : void 0;
      const fallbackUrl = directUrl ?? storyUrl;
      const fallbackId = directPostId ?? storyId;
      if (fallbackUrl && (fallbackUrl.includes("/pending_posts/") || fallbackUrl.includes("/permalink/") || fallbackUrl.includes("/posts/"))) {
        return {
          postId: fallbackId ?? "unknown-story-id",
          url: fallbackUrl,
          pendingApproval: fallbackUrl.includes("/pending_posts/") || Boolean(story?.if_viewer_can_learn_more_about_pending_post) || Boolean(story?.to?.if_viewer_can_see_pending_post_in_mall),
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
    const queue = settings.destination === "Facebook Group" ? "groups" : "marketplace";
    if (!settings.enabled || geminiBypassed[queue]) {
      debugLog("Gemini rewrite skipped because the feature is disabled.");
      return trimmed;
    }
    const apiKey = settings.apiKey.trim();
    if (!apiKey) {
      await handleGeminiFailure(
        queue,
        "No Gemini API key is configured. Add a valid key in settings."
      );
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
    let requestController;
    try {
      debugLog("Sending Gemini rewrite request.", {
        model: GEMINI_MODEL,
        inputLength: trimmed.length,
        customPromptLength: customPrompt.length
      });
      requestController = new AbortController();
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
          const payload = await apiResponse.json().catch(() => ({}));
          if (!apiResponse.ok) {
            throw new Error(
              `Gemini request failed (HTTP ${apiResponse.status}): ${payload.error?.message ?? "No error details returned."}`
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
      if (!rewritten)
        throw new Error(
          "Gemini returned no rewritten text. The response may have been blocked."
        );
      return rewritten;
    } catch (error) {
      requestController?.abort();
      const rawError = error instanceof Error ? error.message : String(error);
      const safeError = rawError.split(apiKey).join("[redacted]");
      const detail = /failed to fetch/i.test(safeError) ? "Could not reach Gemini. Check this browser profile\u2019s connection, proxy, and extension permissions." : safeError;
      debugWarn("Gemini rewrite failed.", detail);
      await handleGeminiFailure(queue, detail);
      return trimmed;
    } finally {
      requestController?.abort();
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
    if (status.status === "done" || status.status === "stopped") {
      const { responseBody: _responseBody, ...storedStatus } = status;
      void chrome.storage.session.set({
        [LAST_GROUP_POSTING_STATUS_STORAGE_KEY]: storedStatus
      });
    } else if (status.status === "rate_limited") {
      void chrome.storage.session.remove(LAST_GROUP_POSTING_STATUS_STORAGE_KEY);
    }
    void chrome.runtime.sendMessage(status);
  }
  function notifyMarketplaceItemPostingStatus(partial) {
    if (partial.status === "done" || partial.status === "stopped") {
      finishQueueTimer(marketplacePostingTimer);
    }
    const status = {
      type: "MARKETPLACE_ITEM_POSTING_STATUS",
      ...partial,
      timing: queueTimingSnapshot(marketplacePostingTimer, partial.listingId)
    };
    latestMarketplacePostingStatus = status;
    if (status.status === "done" || status.status === "stopped") {
      void chrome.storage.session.set({
        [LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY]: status
      });
    }
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
