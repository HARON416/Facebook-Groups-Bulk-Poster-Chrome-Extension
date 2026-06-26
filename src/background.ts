import { GoogleGenAI } from "@google/genai";
import {
  GROUPS_QUERY_FRIENDLY_NAME,
  JOINED_GROUPS_URL,
  type CreatePostRequest,
  type CreatePostResponse,
  type ExtensionRequest,
  type FacebookGroup,
  type GroupExtractionStatusMessage,
  type SimpleGroup,
  type StartUiPostingRequest,
  type UiPostImage,
  type UiPostingStatusMessage,
} from "./config";

type CapturedRequest = {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  formData: Record<string, string>;
};

type PendingRequest = Partial<CapturedRequest>;

type FetchGroupsConfig = {
  formData: Record<string, string>;
  headers: Record<string, string>;
};

type WebRequestBody = {
  formData?: Record<string, string[]>;
  raw?: Array<{ bytes?: ArrayBuffer }>;
};

type UploadResponse = {
  success: boolean;
  photoId?: string;
  error?: string;
};

type GraphqlPostResult = {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
};

const POST_MUTATION_FRIENDLY_NAME = "ComposerStoryCreateMutation";
const UPLOAD_CANDIDATE_MATCHES = [
  "upload.facebook.com/ajax/react_composer/attachments/photo/upload",
  "www.facebook.com/ajax/react_composer/attachments/photo/upload",
  "web.facebook.com/ajax/react_composer/attachments/photo/upload",
  "/ajax/react_composer/attachments/photo/upload",
];
const GEMINI_API_KEY_STORAGE_KEYS = ["geminiApiKey", "GEMINI_API_KEY"] as const;
const GEMINI_REWRITE_ENABLED_STORAGE_KEY = "geminiRewriteEnabled";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 30_000;
const LOG_PREFIX = "[Facebook Groups Bulk Poster]";
const FACEBOOK_HOSTS = new Set([
  "www.facebook.com",
  "web.facebook.com",
  "upload.facebook.com",
]);

const pendingRequests = new Map<string, PendingRequest>();

let capturedGroupsRequest: CapturedRequest | undefined;
let captureTabId: number | undefined;

let activePosting = false;
let stopPostingRequested = false;
let pausePostingRequested = false;
let pauseNotificationSent = false;
let postingCaptureTabId: number | undefined;
let capturedUploadTemplate: CapturedRequest | undefined;
let capturedPostTemplate: CapturedRequest | undefined;
const loggedUploadCandidateRequestIds = new Set<string>();
const MANUAL_STOP_MESSAGE = "Posting stopped by user.";
const FACEBOOK_POST_LIMIT_PATTERN =
  /we\s+limit\s+how\s+often\s+you\s+can\s+post,\s+comment\s+or\s+do\s+other\s+things\s+in\s+a\s+given\s+amount\s+of\s+time\s+in\s+order\s+to\s+help\s+protect\s+the\s+community\s+from\s+spam\.\s+you\s+can\s+try\s+again\s+later/i;

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

function debugLog(message: string, data?: unknown) {
  if (data === undefined) {
    console.log(`${LOG_PREFIX} ${message}`);
    return;
  }

  console.log(`${LOG_PREFIX} ${message}`, data);
}

function debugWarn(message: string, data?: unknown) {
  if (data === undefined) {
    console.warn(`${LOG_PREFIX} ${message}`);
    return;
  }

  console.warn(`${LOG_PREFIX} ${message}`, data);
}

function isFacebookUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    return FACEBOOK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function syncSidePanelForCurrentTab(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!activeTab?.id) {
    return;
  }

  await updateSidePanelAccessForTab(activeTab.id, activeTab.url);
}

async function updateSidePanelAccessForTab(
  tabId: number,
  url: string | undefined,
): Promise<void> {
  await chrome.sidePanel.setOptions({
    tabId,
    path: "sidepanel.html",
    enabled: isFacebookUrl(url),
  });
}

function extractCookieNamesFromHeader(
  cookieHeader: string | undefined,
): string[] {
  if (!cookieHeader) {
    return [];
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split("=")[0]?.trim())
    .filter((name): name is string => Boolean(name));
}

async function logCookieDiagnostics(
  label: string,
  url: string,
  requestHeaders?: Record<string, string>,
): Promise<void> {
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
      browserCookieNames: browserCookies.map((cookie) => cookie.name),
    });
  } catch (error) {
    debugWarn(`${label} cookie diagnostics failed.`, {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details): chrome.webRequest.BlockingResponse | undefined => {
    if (details.method !== "POST" || !details.requestBody) {
      return undefined;
    }

    const shouldCaptureGroups =
      captureTabId !== undefined && details.tabId === captureTabId;
    const shouldCapturePosting =
      postingCaptureTabId !== undefined &&
      details.tabId === postingCaptureTabId;

    if (!shouldCaptureGroups && !shouldCapturePosting) {
      return undefined;
    }

    const { body, formData } = readRequestBody(
      details.requestBody as WebRequestBody,
    );
    const pending = pendingRequests.get(details.requestId) ?? {};
    pending.url = details.url;
    pending.method = details.method;
    pending.body = body;
    pending.formData = formData;
    pendingRequests.set(details.requestId, pending);
    maybeCaptureRequest(details.requestId, details.tabId);
    return undefined;
  },
  {
    urls: [
      "https://www.facebook.com/api/graphql/*",
      "https://web.facebook.com/api/graphql/*",
      "https://upload.facebook.com/ajax/react_composer/attachments/photo/upload*",
      "https://www.facebook.com/ajax/react_composer/attachments/photo/upload*",
      "https://web.facebook.com/ajax/react_composer/attachments/photo/upload*",
    ],
  },
  ["requestBody"],
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details): chrome.webRequest.BlockingResponse | undefined => {
    const shouldCaptureGroups =
      captureTabId !== undefined && details.tabId === captureTabId;
    const shouldCapturePosting =
      postingCaptureTabId !== undefined &&
      details.tabId === postingCaptureTabId;

    if (!shouldCaptureGroups && !shouldCapturePosting) {
      return undefined;
    }

    const pending = pendingRequests.get(details.requestId) ?? {};
    pending.url = details.url;
    pending.method = details.method;
    pending.headers = normalizeHeaders(details.requestHeaders ?? []);
    pendingRequests.set(details.requestId, pending);
    maybeCaptureRequest(details.requestId, details.tabId);
    return undefined;
  },
  {
    urls: [
      "https://www.facebook.com/api/graphql/*",
      "https://web.facebook.com/api/graphql/*",
      "https://upload.facebook.com/ajax/react_composer/attachments/photo/upload*",
      "https://www.facebook.com/ajax/react_composer/attachments/photo/upload*",
      "https://web.facebook.com/ajax/react_composer/attachments/photo/upload*",
    ],
  },
  ["requestHeaders", "extraHeaders"],
);

chrome.runtime.onMessage.addListener(
  (
    request: ExtensionRequest,
    _sender,
    sendResponse: (response: any) => void,
  ) => {
    if (request.type === "LOAD_GROUPS") {
      void loadGroups()
        .then((groups) => sendResponse({ ok: true, groups }))
        .catch((error: unknown) => {
          sendResponse({
            ok: false,
            error:
              error instanceof Error ? error.message : "Unable to load groups.",
          });
        });
      return true;
    }

    if (request.type === "START_UI_POSTING") {
      void runGraphqlPostingQueue(request);
      sendResponse({ ok: true });
      return false;
    }

    if (request.type === "STOP_UI_POSTING") {
      stopPostingRequested = true;
      sendResponse({ ok: true });
      return false;
    }

    if (request.type === "PAUSE_UI_POSTING") {
      pausePostingRequested = true;
      pauseNotificationSent = false;
      sendResponse({ ok: true });
      return false;
    }

    if (request.type === "RESUME_UI_POSTING") {
      pausePostingRequested = false;
      pauseNotificationSent = false;
      sendResponse({ ok: true });
      return false;
    }

    return false;
  },
);

function readRequestBody(requestBody: WebRequestBody): {
  body: string;
  formData: Record<string, string>;
} {
  const normalizedFormData: Record<string, string> = {};

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
      formData: normalizedFormData,
    };
  }

  const rawBody = requestBody.raw?.[0]?.bytes;
  if (!rawBody) {
    return { body: "", formData: normalizedFormData };
  }

  return {
    body: new TextDecoder().decode(rawBody),
    formData: normalizedFormData,
  };
}

function normalizeHeaders(
  headers: chrome.webRequest.HttpHeader[],
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const header of headers) {
    if (!header.name || !header.value) {
      continue;
    }

    normalized[header.name.toLowerCase()] = header.value;
  }

  return normalized;
}

function maybeCaptureRequest(requestId: string, tabId: number) {
  const pending = pendingRequests.get(requestId);

  if (!pending?.url || !pending?.method || !pending?.headers) {
    return;
  }

  const body = pending.body ?? "";
  const formData = pending.formData ?? {};
  const params = new URLSearchParams(body);
  const friendlyName =
    pending.headers["x-fb-friendly-name"] ??
    formData.fb_api_req_friendly_name ??
    params.get("fb_api_req_friendly_name") ??
    "";

  if (
    tabId === captureTabId &&
    friendlyName === GROUPS_QUERY_FRIENDLY_NAME &&
    body.length > 0
  ) {
    capturedGroupsRequest = {
      url: pending.url,
      method: pending.method,
      body,
      headers: pending.headers,
      formData: formDataFromBody(body, formData),
    };
    debugLog("Captured joined groups GraphQL request.", {
      url: pending.url,
      friendlyName,
    });
    void logCookieDiagnostics(
      "Captured joined groups request",
      pending.url,
      pending.headers,
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
      formKeys: Object.keys(formData),
    });
  }

  if (
    isUploadCandidate &&
    pending.method === "POST" &&
    !capturedUploadTemplate
  ) {
    capturedUploadTemplate = {
      url: pending.url,
      method: pending.method,
      body,
      headers: pending.headers,
      formData: formDataFromBody(body, formData),
    };
    debugLog("Captured upload template request.", {
      url: pending.url,
      formKeys: Object.keys(capturedUploadTemplate.formData),
    });
    void logCookieDiagnostics(
      "Captured upload template",
      pending.url,
      pending.headers,
    );
  }

  if (
    friendlyName === POST_MUTATION_FRIENDLY_NAME &&
    pending.method === "POST" &&
    body.length > 0 &&
    !capturedPostTemplate
  ) {
    capturedPostTemplate = {
      url: pending.url,
      method: pending.method,
      body,
      headers: pending.headers,
      formData: formDataFromBody(body, formData),
    };
    debugLog("Captured post mutation template request.", {
      url: pending.url,
      friendlyName,
      formKeys: Object.keys(capturedPostTemplate.formData),
    });
    void logCookieDiagnostics(
      "Captured post mutation template",
      pending.url,
      pending.headers,
    );
  }

  if (
    (capturedUploadTemplate || !isUploadCandidate) &&
    (capturedPostTemplate || friendlyName !== POST_MUTATION_FRIENDLY_NAME)
  ) {
    pendingRequests.delete(requestId);
  }
}

function matchesUploadCandidateUrl(url: string): boolean {
  return UPLOAD_CANDIDATE_MATCHES.some((candidate) => url.includes(candidate));
}

function formDataFromBody(
  body: string,
  explicitFormData: Record<string, string>,
): Record<string, string> {
  if (Object.keys(explicitFormData).length > 0) {
    return explicitFormData;
  }

  const formData: Record<string, string> = {};
  const params = new URLSearchParams(body);

  for (const [key, value] of params.entries()) {
    formData[key] = value;
  }

  return formData;
}

async function loadGroups(): Promise<FacebookGroup[]> {
  capturedGroupsRequest = undefined;
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
      0,
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
      true,
    );

    return uniqueGroups;
  } finally {
    captureTabId = undefined;
  }
}

async function getActiveTabForLoadingGroups(): Promise<chrome.tabs.Tab> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (activeTab?.id && isFacebookUrl(activeTab.url)) {
    return activeTab;
  }

  throw new Error(
    "Open Facebook first. This extension only works on facebook.com.",
  );
}

async function getActiveTabForPosting(): Promise<chrome.tabs.Tab> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!activeTab?.id) {
    throw new Error("Unable to find the active tab for posting.");
  }

  if (!isFacebookUrl(activeTab.url)) {
    throw new Error(
      "Open Facebook first. This extension only works on facebook.com.",
    );
  }

  return activeTab;
}

async function navigateToJoinedGroups(
  tabId: number | undefined,
): Promise<void> {
  if (!tabId) {
    throw new Error("Unable to open joined groups in the current tab.");
  }

  await chrome.tabs.update(tabId, { url: JOINED_GROUPS_URL });
  await waitForJoinedGroupsPage(tabId);
  await waitForPageDomReady(tabId, "/groups/joins/");
  await sleep(2_000);
}

async function waitForJoinedGroupsPage(tabId: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30_000) {
    const tab = await chrome.tabs.get(tabId);

    if (tab.status === "complete" && tab.url?.includes("/groups/joins/")) {
      return;
    }

    await sleep(250);
  }

  throw new Error("Facebook joined groups page took too long to load.");
}

async function waitForPageDomReady(
  tabId: number,
  urlIncludes: string,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30_000) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (expectedUrlPart: string) =>
          window.location.href.includes(expectedUrlPart) &&
          document.readyState === "complete" &&
          Boolean(document.body),
        args: [urlIncludes],
      });

      if (result?.result) {
        return;
      }
    } catch {
      // The page may still be swapping documents during navigation.
    }

    await sleep(250);
  }

  throw new Error("Facebook page DOM took too long to finish loading.");
}

async function triggerJoinedGroupsSortRequest(tabId: number | undefined) {
  if (!tabId) {
    throw new Error("Unable to trigger joined groups sort.");
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: triggerJoinedGroupsSortRequestInPage,
  });

  const value = result?.result as { ok: boolean; error?: string } | undefined;

  if (!value?.ok) {
    throw new Error(value?.error ?? "Unable to trigger joined groups sort.");
  }
}

async function triggerJoinedGroupsSortRequestInPage(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const wait = (duration: number) =>
    new Promise((resolve) => setTimeout(resolve, duration));
  const isVisible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  };

  const clickElement = (element: Element) => {
    element.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    element.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
  };

  const waitForElement = async (
    selector: string,
    timeoutMs = 10_000,
  ): Promise<Element | undefined> => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const element = Array.from(document.querySelectorAll(selector)).find(
        isVisible,
      );

      if (element) {
        return element;
      }

      await wait(250);
    }

    return undefined;
  };

  try {
    const menuTriggers = Array.from(
      document.querySelectorAll('div[aria-haspopup="menu"]'),
    ).filter(isVisible);

    if (menuTriggers.length === 0) {
      return {
        ok: false,
        error: "Could not find the joined groups sort menu button.",
      };
    }

    let sortCard: Element | undefined;

    for (const menuTrigger of menuTriggers) {
      clickElement(menuTrigger);
      await wait(3_000);
      sortCard = await waitForElement(
        'div[aria-label="Sort joined groups"]',
        1_500,
      );

      if (sortCard) {
        break;
      }
    }

    if (!sortCard) {
      return {
        ok: false,
        error: "Could not find the joined groups sort menu.",
      };
    }

    const sortOption = Array.from(
      sortCard.querySelectorAll('div[role="menuitemradio"]'),
    ).find(isVisible);

    if (!sortOption) {
      return {
        ok: false,
        error: "Could not find a joined groups sort option.",
      };
    }

    clickElement(sortOption);
    await wait(2_000);

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to trigger joined groups sort.",
    };
  }
}

async function waitForCapturedGroupsRequest(): Promise<CapturedRequest> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 20_000) {
    if (capturedGroupsRequest) {
      return capturedGroupsRequest;
    }

    await sleep(250);
  }

  throw new Error(
    "Could not capture Facebook groups request. Try again while logged into Facebook.",
  );
}

function updateFetchGroupsConfigFromCapturedRequest(
  capturedRequest: CapturedRequest,
): FetchGroupsConfig {
  const formData = { ...capturedRequest.formData };

  if (!formData.fb_api_req_friendly_name) {
    formData.fb_api_req_friendly_name = GROUPS_QUERY_FRIENDLY_NAME;
  }

  return {
    formData,
    headers: capturedRequest.headers,
  };
}

async function extractAllGroups(
  tabId: number | undefined,
  config: FetchGroupsConfig,
): Promise<FacebookGroup[]> {
  if (!tabId) {
    throw new Error("Unable to read groups from joined groups tab.");
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: fetchAllGroupsInPage,
    args: [config, GROUPS_QUERY_FRIENDLY_NAME],
  });

  const value = result?.result as
    | FacebookGroup[]
    | { error: string }
    | undefined;

  if (!value) {
    throw new Error("Facebook did not return group data.");
  }

  if (!Array.isArray(value) && "error" in value) {
    throw new Error(value.error);
  }

  return value;
}

async function fetchAllGroupsInPage(
  config: FetchGroupsConfig,
  groupsQueryFriendlyName: string,
): Promise<FacebookGroup[] | { error: string }> {
  try {
    const notifyGroupsStatus = (
      message: string,
      loadedCount: number,
      done = false,
    ) => {
      void chrome.runtime.sendMessage({
        type: "GROUP_EXTRACTION_STATUS",
        message,
        loadedCount,
        done,
      });
    };

    const buildReplayHeaders = (
      headers: Record<string, string>,
    ): HeadersInit => {
      const allowedHeaders = [
        "accept",
        "accept-language",
        "content-type",
        "x-asbd-id",
        "x-fb-friendly-name",
        "x-fb-lsd",
      ];
      const replayHeaders: Record<string, string> = {};

      for (const header of allowedHeaders) {
        if (headers[header]) {
          replayHeaders[header] = headers[header];
        }
      }

      replayHeaders["content-type"] =
        replayHeaders["content-type"] ?? "application/x-www-form-urlencoded";
      replayHeaders["x-fb-friendly-name"] = groupsQueryFriendlyName;

      return replayHeaders;
    };

    const allGroups: FacebookGroup[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 100; page += 1) {
      notifyGroupsStatus(
        `Fetching groups page ${page + 1}...`,
        allGroups.length,
      );

      const params = new URLSearchParams(config.formData);
      params.set(
        "variables",
        JSON.stringify({
          count: 20,
          cursor,
          ordering: ["name"],
          scale: 1,
        }),
      );

      const response = await fetch("https://web.facebook.com/api/graphql/", {
        method: "POST",
        credentials: "include",
        headers: buildReplayHeaders(config.headers),
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(
          `Facebook groups request failed with ${response.status}.`,
        );
      }

      const json = await response.json();
      const tabGroupsList =
        json?.data?.viewer?.all_joined_groups?.tab_groups_list;
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
          viewer_last_visited_time: node.viewer_last_visited_time,
        });
      }

      notifyGroupsStatus(
        `Loaded ${allGroups.length} groups so far.`,
        allGroups.length,
      );

      if (!tabGroupsList?.page_info?.has_next_page) {
        break;
      }

      cursor = tabGroupsList.page_info.end_cursor;
      notifyGroupsStatus(
        `Waiting before next page. ${allGroups.length} groups loaded.`,
        allGroups.length,
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    notifyGroupsStatus(
      `Finished loading ${allGroups.length} groups.`,
      allGroups.length,
      true,
    );
    return allGroups;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to fetch groups.",
    };
  }
}

function dedupeGroups(groups: FacebookGroup[]): FacebookGroup[] {
  const seen = new Set<string>();

  return groups.filter((group) => {
    const key = group.id || group.url;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function notifyGroupsStatus(
  message: string,
  loadedCount: number,
  done = false,
) {
  const status: GroupExtractionStatusMessage = {
    type: "GROUP_EXTRACTION_STATUS",
    message,
    loadedCount,
    done,
  };

  void chrome.runtime.sendMessage(status);
}

function sleep(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function throwIfPostingStopped() {
  if (activePosting && stopPostingRequested) {
    throw new Error(MANUAL_STOP_MESSAGE);
  }
}

async function waitWhilePostingPaused(statusContext: {
  current: number;
  total: number;
  groupId?: string;
  groupName?: string;
  successCount: number;
  failedCount: number;
  processedCount: number;
}) {
  while (activePosting && pausePostingRequested) {
    throwIfPostingStopped();

    if (!pauseNotificationSent) {
      notifyUiPostingStatus({
        status: "paused",
        message: statusContext.groupName
          ? `Posting paused before ${statusContext.groupName}.`
          : "Posting queue paused.",
        current: statusContext.current,
        total: statusContext.total,
        groupId: statusContext.groupId,
        groupName: statusContext.groupName,
        successCount: statusContext.successCount,
        failedCount: statusContext.failedCount,
        processedCount: statusContext.processedCount,
      });
      pauseNotificationSent = true;
    }

    await sleep(250);
  }
}

async function sleepWithStopChecks(
  durationMs: number,
  statusContext?: {
    current: number;
    total: number;
    groupId?: string;
    groupName?: string;
    successCount: number;
    failedCount: number;
    processedCount: number;
  },
  intervalMs = 250,
) {
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

async function sleepWithPostingCountdown(
  durationSeconds: number,
  statusContext: {
    current: number;
    total: number;
    groupId?: string;
    groupName?: string;
    successCount: number;
    failedCount: number;
    processedCount: number;
  },
): Promise<void> {
  for (let remaining = durationSeconds; remaining > 0; remaining -= 1) {
    throwIfPostingStopped();
    await waitWhilePostingPaused(statusContext);
    notifyUiPostingStatus({
      status: "waiting",
      message: `Waiting ${remaining} seconds before next group...`,
      current: statusContext.current,
      total: statusContext.total,
      groupId: statusContext.groupId,
      groupName: statusContext.groupName,
      successCount: statusContext.successCount,
      failedCount: statusContext.failedCount,
      processedCount: statusContext.processedCount,
    });
    await sleepWithStopChecks(1_000, statusContext);
  }
}

async function runGraphqlPostingQueue(
  request: StartUiPostingRequest,
): Promise<void> {
  debugLog("Starting posting queue.", {
    groups: request.groups.length,
    images: request.images.length,
    delaySeconds: request.delaySeconds,
  });

  if (activePosting) {
    notifyUiPostingStatus({
      status: "failed",
      message: "A posting queue is already running.",
      current: 0,
      total: request.groups.length,
      successCount: 0,
      failedCount: 0,
      processedCount: 0,
      error: "Wait for the current queue to finish before starting another.",
    });
    return;
  }

  activePosting = true;
  stopPostingRequested = false;
  pausePostingRequested = false;
  pauseNotificationSent = false;
  let successCount = 0;
  let failedCount = 0;
  const total = request.groups.length;
  const hasImages = request.images.length > 0;
  let postingTabId: number | undefined;

  try {
    throwIfPostingStopped();

    if (total === 0) {
      throw new Error("Select at least one group before posting.");
    }

    const postingTab = await getActiveTabForPosting();
    postingTabId = postingTab.id;

    if (!postingTabId) {
      throw new Error("Unable to find the active tab for posting.");
    }

    const templates = await ensurePostingTemplates(
      postingTabId,
      request.groups,
      request.body,
      request.images,
      total,
    );

    if (templates.firstGroupPosted) {
      throwIfPostingStopped();
      successCount += 1;
      notifyUiPostingStatus({
        status: "posted",
        message: `Posted to ${request.groups[0].name}.`,
        current: 1,
        total,
        groupId: request.groups[0].id,
        groupName: request.groups[0].name,
        successCount,
        failedCount,
        processedCount: 1,
      });
    }

    const startIndex = templates.firstGroupPosted ? 1 : 0;

    notifyUiPostingStatus({
      status: "posting",
      message: "Starting GraphQL posting queue...",
      current: startIndex,
      total,
      successCount,
      failedCount,
      processedCount: startIndex,
    });

    for (let index = startIndex; index < request.groups.length; index += 1) {
      throwIfPostingStopped();
      const group = request.groups[index];
      const current = index + 1;
      const statusContext = {
        current,
        total,
        groupId: group.id,
        groupName: group.name,
        successCount,
        failedCount,
        processedCount: index,
      };
      await waitWhilePostingPaused(statusContext);
      debugLog("Processing group.", {
        current,
        total,
        groupId: group.id,
        groupName: group.name,
      });

      await waitWhilePostingPaused(statusContext);
      notifyUiPostingStatus({
        status: "posting",
        message: `Rewriting description for ${group.name}...`,
        current,
        total,
        groupId: group.id,
        groupName: group.name,
        successCount,
        failedCount,
        processedCount: index,
      });

      const postBody = await maybeRewriteDescription(request.body);
      const postBodyWasRewritten = postBody !== request.body;
      throwIfPostingStopped();
      await waitWhilePostingPaused(statusContext);
      debugLog("Post body prepared for group.", {
        current,
        total,
        groupId: group.id,
        groupName: group.name,
        originalLength: request.body.length,
        finalLength: postBody.length,
        rewritten: postBodyWasRewritten,
      });

      await waitWhilePostingPaused(statusContext);
      let photoIds: string[] = [];

      if (hasImages) {
        notifyUiPostingStatus({
          status: "posting",
          message: `Uploading images for ${group.name}...`,
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount,
          failedCount,
          processedCount: index,
        });

        if (!templates.uploadTemplate) {
          throw new Error("Image upload template was not captured.");
        }

        photoIds = await uploadImagesForGroup(
          postingTabId,
          templates.uploadTemplate,
          request.images,
        );
      } else {
        notifyUiPostingStatus({
          status: "posting",
          message: `Preparing text-only post for ${group.name}...`,
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount,
          failedCount,
          processedCount: index,
        });
      }

      throwIfPostingStopped();
      await waitWhilePostingPaused(statusContext);
      debugLog("Media phase complete.", {
        groupId: group.id,
        hasImages,
        uploadedPhotoCount: photoIds.length,
      });

      await waitWhilePostingPaused(statusContext);
      notifyUiPostingStatus({
        status: "posting",
        message: `Posting to ${group.name}...`,
        current,
        total,
        groupId: group.id,
        groupName: group.name,
        successCount,
        failedCount,
        processedCount: index,
      });

      const postResult = await createGraphqlPost(
        postingTabId,
        templates.postTemplate,
        postBody,
        photoIds,
        group.id,
        postBodyWasRewritten,
      );
      throwIfPostingStopped();
      await waitWhilePostingPaused(statusContext);
      debugLog("GraphQL post result received.", {
        groupId: group.id,
        success: postResult.success,
        postId: postResult.postId,
        postUrl: postResult.postUrl,
        error: postResult.error,
      });

      if (postResult.success) {
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
          processedCount: index + 1,
        });
      } else {
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
            processedCount: index + 1,
            error: postResult.error,
          });
          await sleep(2_000);
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
          processedCount: index + 1,
          error: postResult.error,
        });
      }

      if (index < request.groups.length - 1) {
        const nextGroup = request.groups[index + 1];
        const nextCurrent = current + 1;

        notifyUiPostingStatus({
          status: "waiting",
          message: `Waiting ${request.delaySeconds} seconds before posting to ${nextGroup.name}...`,
          current: nextCurrent,
          total,
          groupId: nextGroup.id,
          groupName: nextGroup.name,
          successCount,
          failedCount,
          processedCount: index + 1,
        });
        await sleepWithPostingCountdown(request.delaySeconds, {
          current: nextCurrent,
          total,
          groupId: nextGroup.id,
          groupName: nextGroup.name,
          successCount,
          failedCount,
          processedCount: index + 1,
        });
      }
    }

    notifyUiPostingStatus({
      status: "done",
      message: `Finished posting ${successCount}/${total}.`,
      current: total,
      total,
      successCount,
      failedCount,
      processedCount: total,
    });
    await sleep(2_000);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    debugWarn("Posting queue stopped with error.", { error: errorMessage });
    notifyUiPostingStatus({
      status:
        errorMessage === MANUAL_STOP_MESSAGE ? "stopped" : "done",
      message:
        errorMessage === MANUAL_STOP_MESSAGE
          ? MANUAL_STOP_MESSAGE
          : "GraphQL posting stopped.",
      current: Math.min(successCount + failedCount, total),
      total,
      successCount,
      failedCount,
      processedCount: Math.min(successCount + failedCount, total),
      error: errorMessage,
    });
    await sleep(2_000);
  } finally {
    debugLog("Posting queue finished.", {
      total,
      successCount,
      failedCount,
    });
    activePosting = false;
    stopPostingRequested = false;
    pausePostingRequested = false;
    pauseNotificationSent = false;
  }
}

async function ensurePostingTemplates(
  tabId: number,
  groups: SimpleGroup[],
  originalBody: string,
  images: UiPostImage[],
  total: number,
): Promise<{
  uploadTemplate?: CapturedRequest;
  postTemplate: CapturedRequest;
  firstGroupPosted: boolean;
}> {
  const requiresUploadTemplate = images.length > 0;

  const firstGroup = groups[0];
  if (!firstGroup) {
    throw new Error("Select at least one group before posting.");
  }

  debugLog("Capturing fresh templates from first group post.", {
    groupId: firstGroup.id,
    groupName: firstGroup.name,
    requiresUploadTemplate,
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
    processedCount: 0,
  });

  const body = await maybeRewriteDescription(originalBody);
  debugLog("Post body prepared for first group.", {
    current: 1,
    total,
    groupId: firstGroup.id,
    groupName: firstGroup.name,
    originalLength: originalBody.length,
    finalLength: body.length,
    rewritten: body !== originalBody,
  });

  notifyUiPostingStatus({
    status: "posting",
    message:
      "Capturing fresh Facebook request templates from the first post...",
    current: 1,
    total,
    groupId: firstGroup.id,
    groupName: firstGroup.name,
    successCount: 0,
    failedCount: 0,
    processedCount: 0,
  });

  beginPostingTemplateCapture(tabId);
  throwIfPostingStopped();

  const groupUrl = normalizeGroupUrl(firstGroup.id);
  await chrome.tabs.update(tabId, { url: groupUrl, active: true });
  await waitForTabComplete(tabId, "/groups/");
  await sleepWithStopChecks(5_000, {
    current: 1,
    total,
    groupId: firstGroup.id,
    groupName: firstGroup.name,
    successCount: 0,
    failedCount: 0,
    processedCount: 0,
  });

  const postResult = await createPostInTab(tabId, images, body);
  if (!postResult.ok) {
    stopPostingTemplateCapture();
    throw new Error(postResult.error ?? "Unable to create the first post.");
  }

  const capturedTemplates = await waitForPostingTemplatesInternal(
    requiresUploadTemplate,
  );

  return {
    uploadTemplate: capturedTemplates.uploadTemplate,
    postTemplate: capturedTemplates.postTemplate,
    firstGroupPosted: true,
  };
}

function beginPostingTemplateCapture(tabId: number) {
  postingCaptureTabId = tabId;
  capturedUploadTemplate = undefined;
  capturedPostTemplate = undefined;
  loggedUploadCandidateRequestIds.clear();
  debugLog("Template capture started.", { tabId });
}

function stopPostingTemplateCapture() {
  loggedUploadCandidateRequestIds.clear();
  debugLog("Template capture stopped.");
  postingCaptureTabId = undefined;
}

async function waitForPostingTemplates(): Promise<{
  uploadTemplate?: CapturedRequest;
  postTemplate: CapturedRequest;
}> {
  return waitForPostingTemplatesInternal(true);
}

async function waitForPostingTemplatesInternal(
  requiresUploadTemplate: boolean,
): Promise<{
  uploadTemplate?: CapturedRequest;
  postTemplate: CapturedRequest;
}> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30_000) {
    throwIfPostingStopped();
    if (
      capturedPostTemplate &&
      (!requiresUploadTemplate || capturedUploadTemplate)
    ) {
      const uploadTemplate =
        requiresUploadTemplate && capturedUploadTemplate
          ? finalizeUploadTemplate(capturedUploadTemplate, capturedPostTemplate)
          : undefined;
      const postTemplate = capturedPostTemplate;
      stopPostingTemplateCapture();
      debugLog("Template capture complete.", {
        hasUploadTemplate: Boolean(uploadTemplate),
        hasPostTemplate: true,
      });
      return { uploadTemplate, postTemplate };
    }

    await sleepWithStopChecks(250);
  }

  stopPostingTemplateCapture();
  const missing: string[] = [];
  if (requiresUploadTemplate && !capturedUploadTemplate) {
    missing.push("upload template");
  }
  if (!capturedPostTemplate) {
    missing.push("post mutation template");
  }
  throw new Error(
    `The first post completed, but these templates were not captured in time: ${missing.join(", ")}.`,
  );
}

function finalizeUploadTemplate(
  uploadTemplate: CapturedRequest,
  postTemplate: CapturedRequest,
): CapturedRequest {
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
    formData,
  };
}

function normalizeGroupUrl(groupUrlOrId: string): string {
  if (
    groupUrlOrId.startsWith("http://") ||
    groupUrlOrId.startsWith("https://")
  ) {
    return groupUrlOrId;
  }

  return `https://www.facebook.com/groups/${groupUrlOrId}/`;
}

function isRateLimitError(error: string | undefined): boolean {
  return /limit|temporarily blocked/i.test(error ?? "");
}

async function createPostInTab(
  tabId: number,
  images: CreatePostRequest["images"],
  body: string,
): Promise<CreatePostResponse> {
  const request: CreatePostRequest = {
    type: "CREATE_POST",
    body,
    images,
  };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = (await chrome.tabs.sendMessage(
        tabId,
        request,
      )) as CreatePostResponse;

      if (response?.ok) {
        return response;
      }

      return {
        ok: false,
        composerFound: false,
        composerClicked: false,
        spanCount: 0,
        error: response?.error ?? "Unable to inspect Facebook page.",
      };
    } catch (error) {
      if (attempt === 19) {
        return {
          ok: false,
          composerFound: false,
          composerClicked: false,
          spanCount: 0,
          error:
            error instanceof Error
              ? error.message
              : "Content script did not respond.",
        };
      }

      await sleep(250);
    }
  }

  return {
    ok: false,
    composerFound: false,
    composerClicked: false,
    spanCount: 0,
    error: "Content script did not respond.",
  };
}

async function waitForTabComplete(
  tabId: number,
  urlIncludes: string,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 45_000) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && tab.url?.includes(urlIncludes)) {
      return;
    }

    await sleep(250);
  }

  throw new Error("Facebook group page took too long to load.");
}

async function uploadImagesForGroup(
  tabId: number,
  uploadTemplate: CapturedRequest,
  images: UiPostImage[],
): Promise<string[]> {
  const photoIds: string[] = [];
  debugLog("Starting image uploads.", { imageCount: images.length });

  for (const image of images) {
    try {
      debugLog("Uploading image.", {
        name: image.name,
        type: image.type,
      });
      const response = await uploadImage(tabId, uploadTemplate, image);
      if (response.success && response.photoId) {
        photoIds.push(response.photoId);
        debugLog("Image uploaded successfully.", {
          name: image.name,
          photoId: response.photoId,
        });
      } else if (response.error) {
        debugWarn("Image upload failed.", {
          image: image.name,
          error: response.error,
        });
      }
    } catch (error) {
      debugWarn("Image upload crashed.", {
        image: image.name,
        error,
      });
    }
  }

  return photoIds;
}

async function uploadImage(
  tabId: number,
  uploadTemplate: CapturedRequest,
  image: UiPostImage,
): Promise<UploadResponse> {
  await logPageCookieDiagnostics(tabId, "Before upload replay");
  let result:
    | chrome.scripting.InjectionResult<{
        status: number;
        ok: boolean;
        responseText: string;
        contentType?: string;
        error?: string;
      }>
    | undefined;

  try {
    [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: uploadImageInPage,
      args: [uploadTemplate, image],
    });
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Upload replay script failed to execute.",
    };
  }

  const payload = (result?.result ?? {
    status: 0,
    ok: false,
    responseText: "",
    contentType: "",
    error: "Upload replay returned no result.",
  }) as {
    status: number;
    ok: boolean;
    responseText: string;
    contentType?: string;
    error?: string;
  };

  debugLog("Upload response received.", {
    image: image.name,
    status: payload.status,
    ok: payload.ok,
    contentType: payload.contentType,
    error: payload.error,
    preview: payload.responseText.slice(0, 200),
  });

  if (payload.error) {
    return {
      success: false,
      error: payload.error,
    };
  }

  return parseUploadResponse(payload.responseText);
}

function parseUploadResponse(responseText: string): UploadResponse {
  const normalized = responseText.trim().replace(/^for\s*\(;;\);\s*/, "");

  try {
    const parsed = JSON.parse(normalized) as {
      __ar?: number;
      payload?: { photoID?: string };
    };
    const photoId = parsed.payload?.photoID;

    if (parsed.__ar === 1 && photoId) {
      return { success: true, photoId };
    }

    return {
      success: false,
      error: "Upload failed - no photo ID returned.",
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to parse Facebook upload response.",
    };
  }
}

async function createGraphqlPost(
  tabId: number,
  postTemplate: CapturedRequest,
  text: string,
  photoIds: string[],
  groupId: string,
  textWasRewritten: boolean,
): Promise<GraphqlPostResult> {
  await logPageCookieDiagnostics(tabId, "Before GraphQL replay");
  const variables = buildPostVariables(
    postTemplate.formData,
    text,
    photoIds,
    groupId,
    textWasRewritten,
  );
  debugLog("Sending GraphQL post request.", {
    groupId,
    photoCount: photoIds.length,
    variableLength: variables.length,
  });
  let result:
    | chrome.scripting.InjectionResult<{
        status: number;
        ok: boolean;
        responseText: string;
        contentType?: string;
        error?: string;
      }>
    | undefined;

  try {
    [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: createGraphqlPostInPage,
      args: [postTemplate, variables],
    });
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "GraphQL replay script failed to execute.",
    };
  }

  const payload = (result?.result ?? {
    status: 0,
    ok: false,
    responseText: "",
    contentType: "",
    error: "GraphQL replay returned no result.",
  }) as {
    status: number;
    ok: boolean;
    responseText: string;
    contentType?: string;
    error?: string;
  };
  debugLog("GraphQL post response received.", {
    groupId,
    status: payload.status,
    ok: payload.ok,
    contentType: payload.contentType,
    error: payload.error,
    preview: payload.responseText.slice(0, 300),
  });

  if (payload.error) {
    return {
      success: false,
      error: payload.error,
    };
  }

  if (isRateLimitBody(payload.responseText)) {
    debugWarn("Facebook rate limit detected in GraphQL response.", {
      groupId,
    });
    return {
      success: false,
      error: "Facebook returned a posting limit response.",
    };
  }

  return parsePostResponse(payload.responseText);
}

function buildPostVariables(
  templateFormData: Record<string, string>,
  text: string,
  photoIds: string[],
  groupId: string,
  textWasRewritten: boolean,
): string {
  const hasImages = photoIds.length > 0;
  const attachments = photoIds.map((photoId) => ({
    photo: {
      id: photoId,
    },
  }));
  const templateVariables = cloneJsonRecord(
    safeParseJson(templateFormData.variables),
  );

  if (!templateVariables || !isRecord(templateVariables.input)) {
    return buildFallbackPostVariables(
      templateFormData,
      text,
      attachments,
      groupId,
      textWasRewritten,
    );
  }

  const input = templateVariables.input;
  const originalText =
    isRecord(input.message) && typeof input.message.text === "string"
      ? input.message.text
      : undefined;
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
    ...(isRecord(input.audience) ? input.audience : {}),
    to_id: groupId,
  };
  input.client_mutation_id = String(Date.now());

  if (originalText !== text || !isRecord(input.composed_text)) {
    input.composed_text = buildComposedText(text, {
      preserveBlankLines: !textWasRewritten,
    });
  }

  replaceStringValue(templateVariables, originalText, text);
  replaceStringValue(templateVariables, originalGroupId, groupId);

  return JSON.stringify(templateVariables);
}

function buildFallbackPostVariables(
  templateFormData: Record<string, string>,
  text: string,
  attachments: Array<{ photo: { id: string } }>,
  groupId: string,
  textWasRewritten: boolean,
): string {
  const actorId =
    extractUserIdFromFormData(templateFormData) ?? "61553861467726";
  const variables = {
    input: {
      composer_entry_point: "inline_composer",
      composer_source_surface: "group",
      composer_type: "group",
      logging: {
        composer_session_id: generateSessionId(),
      },
      source: "WWW",
      message: {
        ranges: [],
        text,
      },
      composed_text: buildComposedText(text, {
        preserveBlankLines: !textWasRewritten,
      }),
      audience: {
        to_id: groupId,
      },
      actor_id: actorId,
      client_mutation_id: String(Date.now()),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
    feedLocation: "GROUP",
    renderLocation: "group",
    isGroup: true,
  };

  return JSON.stringify(variables);
}

function buildComposedText(
  text: string,
  { preserveBlankLines }: { preserveBlankLines: boolean },
) {
  const textBlocks = text.split(/\r?\n/);
  const blocks = (textBlocks.length > 0 ? textBlocks : [text])
    .map((block) => block.trimEnd())
    .filter((block) => preserveBlankLines || block.trim().length > 0)
    .map((block) => (block.length > 0 ? block : "\u00A0"));
  const normalizedBlocks = blocks.length > 0 ? blocks : [text.trim()];

  return {
    block_data: normalizedBlocks.map(() => "{}"),
    block_depths: normalizedBlocks.map(() => 0),
    block_types: normalizedBlocks.map(() => 0),
    blocks: normalizedBlocks,
    entities: normalizedBlocks.map(() => "[]"),
    entity_map: "{}",
    inline_styles: normalizedBlocks.map(() => "[]"),
  };
}

function getTemplateGroupId(input: Record<string, any>): string | undefined {
  if (isRecord(input.audience) && typeof input.audience.to_id === "string") {
    return input.audience.to_id;
  }

  if (typeof input.group_id === "string") {
    return input.group_id;
  }

  if (typeof input.groupID === "string") {
    return input.groupID;
  }

  return undefined;
}

function parsePostResponse(responseText: string): GraphqlPostResult {
  const normalized = responseText.trim().replace(/^for\s*\(;;\);\s*/, "");

  if (!normalized) {
    return {
      success: true,
      postId: "unknown-empty-response",
    };
  }

  try {
    const decoder = new JsonObjectDecoder(normalized);
    const objects = decoder.decodeAll();
    const firstObject = objects[0];
    if (!firstObject) {
      return {
        success: false,
        error: "Facebook returned an empty JSON payload.",
      };
    }

    if (isRecord(firstObject) && typeof firstObject.errorSummary === "string") {
      return {
        success: false,
        error:
          typeof firstObject.errorDescription === "string"
            ? `${firstObject.errorSummary}: ${firstObject.errorDescription}`
            : firstObject.errorSummary,
      };
    }

    const storyCreateMatch = findStoryCreateResult(firstObject);
    if (storyCreateMatch) {
      return {
        success: true,
        postId: storyCreateMatch.postId,
        postUrl: storyCreateMatch.url,
      };
    }

    const matches = findPostRecords(firstObject);
    const lastMatch =
      matches.length > 0 ? matches[matches.length - 1] : undefined;

    if (!lastMatch) {
      return {
        success: false,
        error: "Facebook did not return a post permalink.",
      };
    }

    return {
      success: true,
      postId: lastMatch.postId,
      postUrl: lastMatch.url,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to parse Facebook post response.",
    };
  }
}

function findStoryCreateResult(
  value: unknown,
): { postId: string; url: string } | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findStoryCreateResult(entry);
      if (nested) {
        return nested;
      }
    }

    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const storyCreate = value.story_create;
  if (isRecord(storyCreate)) {
    const directUrl =
      typeof storyCreate.url === "string" ? storyCreate.url : undefined;
    const directPostId =
      typeof storyCreate.post_id === "string" ? storyCreate.post_id : undefined;
    const story = isRecord(storyCreate.story) ? storyCreate.story : undefined;
    const storyUrl =
      story && typeof story.url === "string" ? story.url : undefined;
    const storyId =
      story && typeof story.id === "string" ? story.id : undefined;
    const fallbackUrl = directUrl ?? storyUrl;
    const fallbackId = directPostId ?? storyId;

    if (
      fallbackUrl &&
      (fallbackUrl.includes("/pending_posts/") ||
        fallbackUrl.includes("/permalink/") ||
        fallbackUrl.includes("/posts/"))
    ) {
      return {
        postId: fallbackId ?? "unknown-story-id",
        url: fallbackUrl,
      };
    }
  }

  for (const nestedValue of Object.values(value)) {
    const nested = findStoryCreateResult(nestedValue);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function findPostRecords(
  value: unknown,
): Array<{ postId: string; url: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => findPostRecords(entry));
  }

  if (!isRecord(value)) {
    return [];
  }

  const matches: Array<{ postId: string; url: string }> = [];
  if (
    typeof value.post_id === "string" &&
    typeof value.url === "string" &&
    value.url.includes("permalink")
  ) {
    matches.push({ postId: value.post_id, url: value.url });
  }

  for (const nestedValue of Object.values(value)) {
    matches.push(...findPostRecords(nestedValue));
  }

  return matches;
}

function isRateLimitBody(responseText: string): boolean {
  return (
    FACEBOOK_POST_LIMIT_PATTERN.test(responseText) ||
    /temporarily blocked/i.test(responseText)
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonRecord(value: unknown): Record<string, any> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, any>;
}

function replaceStringValue(
  value: unknown,
  from: string | undefined,
  to: string,
): void {
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

function extractUserIdFromFormData(
  formData: Record<string, string>,
): string | undefined {
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

  return undefined;
}

function generateSessionId(): string {
  return crypto.randomUUID();
}

function safeParseJson(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function logPageCookieDiagnostics(
  tabId: number,
  label: string,
): Promise<void> {
  try {
    const [tabInfo, result] = await Promise.all([
      chrome.tabs.get(tabId),
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const cookieNames = document.cookie
            .split(";")
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => part.split("=")[0]?.trim())
            .filter((name): name is string => Boolean(name));

          return {
            href: window.location.href,
            origin: window.location.origin,
            cookieCount: cookieNames.length,
            cookieNames,
          };
        },
      }),
    ]);

    const pageData = result[0]?.result as
      | {
          href: string;
          origin: string;
          cookieCount: number;
          cookieNames: string[];
        }
      | undefined;

    debugLog(`${label} page cookie diagnostics.`, {
      tabUrl: tabInfo.url,
      pageUrl: pageData?.href,
      pageOrigin: pageData?.origin,
      pageCookieCount: pageData?.cookieCount ?? 0,
      pageCookieNames: pageData?.cookieNames ?? [],
    });
  } catch (error) {
    debugWarn(`${label} page cookie diagnostics failed.`, {
      tabId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function uploadImageInPage(
  uploadTemplate: CapturedRequest,
  image: UiPostImage,
): Promise<{
  status: number;
  ok: boolean;
  responseText: string;
  contentType: string;
  error?: string;
}> {
  try {
    const buildHeaders = (headers: Record<string, string>): HeadersInit => {
      const replayHeaders: Record<string, string> = {};
      const allowedHeaders = [
        "accept",
        "accept-language",
        "priority",
        "sec-fetch-dest",
        "sec-fetch-mode",
        "sec-fetch-site",
        "x-asbd-id",
        "x-fb-lsd",
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
      body: formData,
    });

    return {
      status: uploadResponse.status,
      ok: uploadResponse.ok,
      responseText: await uploadResponse.text(),
      contentType: uploadResponse.headers.get("content-type") ?? "",
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      responseText: "",
      contentType: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function createGraphqlPostInPage(
  postTemplate: CapturedRequest,
  variables: string,
): Promise<{
  status: number;
  ok: boolean;
  responseText: string;
  contentType: string;
  error?: string;
}> {
  try {
    const buildHeaders = (headers: Record<string, string>): HeadersInit => {
      const replayHeaders: Record<string, string> = {};
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
        "x-fb-lsd",
      ];

      for (const header of allowedHeaders) {
        const value = headers[header];
        if (value) {
          replayHeaders[header] = value;
        }
      }

      replayHeaders["content-type"] =
        replayHeaders["content-type"] ?? "application/x-www-form-urlencoded";
      replayHeaders["x-fb-friendly-name"] =
        replayHeaders["x-fb-friendly-name"] ?? "ComposerStoryCreateMutation";

      return replayHeaders;
    };

    const formData = new URLSearchParams(postTemplate.formData);
    formData.set("variables", variables);

    const response = await fetch(postTemplate.url, {
      method: "POST",
      credentials: "include",
      headers: buildHeaders(postTemplate.headers),
      body: formData.toString(),
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: await response.text(),
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      responseText: "",
      contentType: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function maybeRewriteDescription(description: string): Promise<string> {
  const trimmed = description.trim();
  if (!trimmed) {
    return trimmed;
  }

  const storage = await chrome.storage.local.get([
    ...GEMINI_API_KEY_STORAGE_KEYS,
    GEMINI_REWRITE_ENABLED_STORAGE_KEY,
  ]);
  const rewriteEnabled = storage[GEMINI_REWRITE_ENABLED_STORAGE_KEY] === true;

  if (!rewriteEnabled) {
    debugLog("Gemini rewrite skipped because the feature is disabled.");
    return trimmed;
  }

  const apiKey = GEMINI_API_KEY_STORAGE_KEYS.map((key) => storage[key]).find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );

  if (!apiKey) {
    debugLog("Gemini rewrite skipped because no API key was found.");
    return trimmed;
  }

  const prompt = `Rewrite this Facebook Group product description to be concise, clear, natural, and persuasive.

Rules:
- Return only the rewritten description.
- Keep important product details.
- Do not invent details.
- Always make the description easy to scan using short lines and natural paragraph breaks instead of one wall of text.
- Use a few appropriate, persuasive emojis where they make the listing feel more engaging.
- Do not use Markdown formatting, asterisks, bullet symbols, or decorative separator symbols.
- Keep emojis natural and relevant; do not overuse them.
- If the phone number is present, keep it exactly as written.
- Include exactly 6 relevant hashtags based on the product and description context.
- Put all 6 hashtags together at the very bottom of the description.

Description:
${trimmed}`;

  try {
    debugLog("Sending Gemini rewrite request.", {
      model: GEMINI_MODEL,
      inputLength: trimmed.length,
    });
    const ai = new GoogleGenAI({ apiKey });
    const response = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
      GEMINI_TIMEOUT_MS,
      "Gemini rewrite timed out.",
    );

    const rewritten = String(response.text ?? "").trim();
    debugLog("Gemini rewrite completed.", {
      outputLength: rewritten.length,
      changed: rewritten !== trimmed,
    });
    return rewritten || trimmed;
  } catch (error) {
    debugWarn("Gemini rewrite failed.", error);
    return trimmed;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId = 0;

  return new Promise<T>((resolve, reject) => {
    timeoutId = self.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    void promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function notifyUiPostingStatus(
  partial: Omit<UiPostingStatusMessage, "type">,
): void {
  const status: UiPostingStatusMessage = {
    type: "UI_POSTING_STATUS",
    ...partial,
  };

  void chrome.runtime.sendMessage(status);
}

class JsonObjectDecoder {
  private readonly input: string;
  private index = 0;

  constructor(input: string) {
    this.input = input;
  }

  decodeAll(): unknown[] {
    const results: unknown[] = [];

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

  private skipWhitespace() {
    while (
      this.index < this.input.length &&
      /\s/.test(this.input[this.index])
    ) {
      this.index += 1;
    }
  }
}
