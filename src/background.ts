import {
  GROUPS_QUERY_FRIENDLY_NAME,
  JOINED_GROUPS_URL,
  type ExtensionRequest,
  type FacebookGroup,
  type GroupExtractionStatusMessage,
  type LoadGroupsResponse,
} from "./config";

type CapturedGraphQLRequest = {
  body: string;
  headers: Record<string, string>;
};

type PendingGraphQLRequest = Partial<CapturedGraphQLRequest>;
type FetchGroupsConfig = {
  formData: Record<string, string>;
  headers: Record<string, string>;
};
type WebRequestBody = {
  formData?: Record<string, string[]>;
  raw?: Array<{ bytes?: ArrayBuffer }>;
};

const pendingRequests = new Map<string, PendingGraphQLRequest>();
let capturedGroupsRequest: CapturedGraphQLRequest | undefined;
let captureTabId: number | undefined;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.windowId) {
    return;
  }

  void chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.webRequest.onBeforeRequest.addListener(
  (details): chrome.webRequest.BlockingResponse | undefined => {
    if (captureTabId !== undefined && details.tabId !== captureTabId) {
      return undefined;
    }

    if (details.method !== "POST" || !details.requestBody) {
      return undefined;
    }

    const body = readRequestBody(details.requestBody as WebRequestBody);
    if (!body.includes(GROUPS_QUERY_FRIENDLY_NAME)) {
      return undefined;
    }

    const pending = pendingRequests.get(details.requestId) ?? {};
    pending.body = body;
    pendingRequests.set(details.requestId, pending);
    maybeCaptureRequest(details.requestId);
    return undefined;
  },
  { urls: ["https://www.facebook.com/api/graphql/*", "https://web.facebook.com/api/graphql/*"] },
  ["requestBody"],
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details): chrome.webRequest.BlockingResponse | undefined => {
    if (captureTabId !== undefined && details.tabId !== captureTabId) {
      return undefined;
    }

    const headers = normalizeHeaders(details.requestHeaders ?? []);
    const pending = pendingRequests.get(details.requestId) ?? {};
    pending.headers = headers;
    pendingRequests.set(details.requestId, pending);
    maybeCaptureRequest(details.requestId);
    return undefined;
  },
  { urls: ["https://www.facebook.com/api/graphql/*", "https://web.facebook.com/api/graphql/*"] },
  ["requestHeaders", "extraHeaders"],
);

chrome.runtime.onMessage.addListener(
  (
    request: ExtensionRequest,
    _sender,
    sendResponse: (response: LoadGroupsResponse) => void,
  ) => {
    if (request.type !== "LOAD_GROUPS") {
      return false;
    }

    void loadGroups()
      .then((groups) => sendResponse({ ok: true, groups }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to load groups.",
        });
      });

    return true;
  },
);

function readRequestBody(requestBody: WebRequestBody): string {
  if (requestBody.formData) {
    const params = new URLSearchParams();

    for (const [key, values] of Object.entries(requestBody.formData)) {
      for (const value of values ?? []) {
        params.append(key, value);
      }
    }

    return params.toString();
  }

  const rawBody = requestBody.raw?.[0]?.bytes;
  if (!rawBody) {
    return "";
  }

  return new TextDecoder().decode(rawBody);
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

function maybeCaptureRequest(requestId: string) {
  const pending = pendingRequests.get(requestId);

  if (!pending?.body || !pending.headers) {
    return;
  }

  const params = new URLSearchParams(pending.body);
  const friendlyName =
    pending.headers["x-fb-friendly-name"] ??
    params.get("fb_api_req_friendly_name");

  if (friendlyName !== GROUPS_QUERY_FRIENDLY_NAME) {
    return;
  }

  capturedGroupsRequest = {
    body: pending.body,
    headers: pending.headers,
  };
  pendingRequests.delete(requestId);
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
    notifyGroupsStatus("Scrolling to trigger Facebook groups request...", 0);
    await scrollJoinedGroupsPage(tab.id);

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

  if (activeTab?.id) {
    return activeTab;
  }

  return chrome.tabs.create({ url: JOINED_GROUPS_URL, active: true });
}

async function navigateToJoinedGroups(tabId: number | undefined): Promise<void> {
  if (!tabId) {
    throw new Error("Unable to open joined groups in the current tab.");
  }

  await chrome.tabs.update(tabId, { url: JOINED_GROUPS_URL });
  await waitForJoinedGroupsPage(tabId);
  await sleep(1_000);
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

async function scrollJoinedGroupsPage(tabId: number | undefined) {
  if (!tabId) {
    throw new Error("Unable to scroll joined groups tab.");
  }

  for (let index = 0; index < 5; index += 1) {
    notifyGroupsStatus(`Scrolling joined groups page (${index + 1}/5)...`, 0);
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.scrollBy(0, 500),
    });
    await sleep(2_000);
  }
}

async function waitForCapturedGroupsRequest(): Promise<CapturedGraphQLRequest> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 20_000) {
    if (capturedGroupsRequest) {
      return capturedGroupsRequest;
    }

    await sleep(250);
  }

  throw new Error("Could not capture Facebook groups request. Try again while logged into Facebook.");
}

function updateFetchGroupsConfigFromCapturedRequest(
  capturedRequest: CapturedGraphQLRequest,
): FetchGroupsConfig {
  const formData: Record<string, string> = {};
  const params = new URLSearchParams(capturedRequest.body);

  for (const [key, value] of params.entries()) {
    formData[key] = value;
  }

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
    args: [config],
  });

  const value = result?.result as FacebookGroup[] | { error: string } | undefined;

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
      replayHeaders["x-fb-friendly-name"] =
        "GroupsCometAllJoinedGroupsSectionPaginationQuery";

      return replayHeaders;
    };

    const allGroups: FacebookGroup[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 100; page += 1) {
      notifyGroupsStatus(`Fetching groups page ${page + 1}...`, allGroups.length);

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
        throw new Error(`Facebook groups request failed with ${response.status}.`);
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

    notifyGroupsStatus(`Finished loading ${allGroups.length} groups.`, allGroups.length, true);
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

function notifyGroupsStatus(message: string, loadedCount: number, done = false) {
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
