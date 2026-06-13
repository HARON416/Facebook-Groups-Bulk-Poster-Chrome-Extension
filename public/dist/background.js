"use strict";
(() => {
  // src/config.ts
  var JOINED_GROUPS_URL = "https://web.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added";
  var GROUPS_QUERY_FRIENDLY_NAME = "GroupsCometAllJoinedGroupsSectionPaginationQuery";

  // src/background.ts
  var pendingRequests = /* @__PURE__ */ new Map();
  var capturedGroupsRequest;
  var captureTabId;
  var activeUiPosting = false;
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
    (details) => {
      if (captureTabId !== void 0 && details.tabId !== captureTabId) {
        return void 0;
      }
      if (details.method !== "POST" || !details.requestBody) {
        return void 0;
      }
      const body = readRequestBody(details.requestBody);
      if (!body.includes(GROUPS_QUERY_FRIENDLY_NAME)) {
        return void 0;
      }
      const pending = pendingRequests.get(details.requestId) ?? {};
      pending.body = body;
      pendingRequests.set(details.requestId, pending);
      maybeCaptureRequest(details.requestId);
      return void 0;
    },
    {
      urls: [
        "https://www.facebook.com/api/graphql/*",
        "https://web.facebook.com/api/graphql/*"
      ]
    },
    ["requestBody"]
  );
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (captureTabId !== void 0 && details.tabId !== captureTabId) {
        return void 0;
      }
      const headers = normalizeHeaders(details.requestHeaders ?? []);
      const pending = pendingRequests.get(details.requestId) ?? {};
      pending.headers = headers;
      pendingRequests.set(details.requestId, pending);
      maybeCaptureRequest(details.requestId);
      return void 0;
    },
    {
      urls: [
        "https://www.facebook.com/api/graphql/*",
        "https://web.facebook.com/api/graphql/*"
      ]
    },
    ["requestHeaders", "extraHeaders"]
  );
  chrome.runtime.onMessage.addListener(
    (request, _sender, sendResponse) => {
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
        void runUiPostingQueue(request);
        sendResponse({ ok: true });
        return false;
      }
      return false;
    }
  );
  function readRequestBody(requestBody) {
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
  function maybeCaptureRequest(requestId) {
    const pending = pendingRequests.get(requestId);
    if (!pending?.body || !pending.headers) {
      return;
    }
    const params = new URLSearchParams(pending.body);
    const friendlyName = pending.headers["x-fb-friendly-name"] ?? params.get("fb_api_req_friendly_name");
    if (friendlyName !== GROUPS_QUERY_FRIENDLY_NAME) {
      return;
    }
    capturedGroupsRequest = {
      body: pending.body,
      headers: pending.headers
    };
    pendingRequests.delete(requestId);
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
    if (activeTab?.id) {
      return activeTab;
    }
    return chrome.tabs.create({ url: JOINED_GROUPS_URL, active: true });
  }
  async function getActiveTabForPosting() {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!activeTab?.id) {
      throw new Error("Unable to find the active tab for posting.");
    }
    return activeTab;
  }
  async function navigateToJoinedGroups(tabId) {
    if (!tabId) {
      throw new Error("Unable to open joined groups in the current tab.");
    }
    await chrome.tabs.update(tabId, { url: JOINED_GROUPS_URL });
    await waitForJoinedGroupsPage(tabId);
    await sleep(1e3);
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
  async function scrollJoinedGroupsPage(tabId) {
    if (!tabId) {
      throw new Error("Unable to scroll joined groups tab.");
    }
    for (let index = 0; index < 5; index += 1) {
      notifyGroupsStatus(`Scrolling joined groups page (${index + 1}/5)...`, 0);
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.scrollBy(0, 500)
      });
      await sleep(2e3);
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
    const formData = {};
    const params = new URLSearchParams(capturedRequest.body);
    for (const [key, value] of params.entries()) {
      formData[key] = value;
    }
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
      args: [config]
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
  async function fetchAllGroupsInPage(config) {
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
        replayHeaders["x-fb-friendly-name"] = "GroupsCometAllJoinedGroupsSectionPaginationQuery";
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
  async function runUiPostingQueue(request) {
    if (activeUiPosting) {
      notifyUiPostingStatus({
        status: "failed",
        message: "A posting queue is already running.",
        current: 0,
        total: request.groups.length,
        successCount: 0,
        error: "Wait for the current queue to finish before starting another."
      });
      return;
    }
    activeUiPosting = true;
    let successCount = 0;
    const total = request.groups.length;
    try {
      if (total === 0) {
        throw new Error("Select at least one group before posting.");
      }
      const postingTab = await getActiveTabForPosting();
      const postingTabId = postingTab.id;
      if (!postingTabId) {
        throw new Error("Unable to find the active tab for posting.");
      }
      notifyUiPostingStatus({
        status: "posting",
        message: "Starting posting queue...",
        current: 0,
        total,
        successCount
      });
      for (let index = 0; index < request.groups.length; index += 1) {
        const group = request.groups[index];
        const current = index + 1;
        notifyUiPostingStatus({
          status: "posting",
          message: `Opening ${group.name}...`,
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount
        });
        const groupUrl = normalizeGroupUrl(group.id);
        await chrome.tabs.update(postingTabId, { url: groupUrl, active: true });
        await waitForTabComplete(postingTabId, "/groups/");
        await sleep(5e3);
        const writeSomething = await findWriteSomethingInTab(
          postingTabId,
          request.images,
          request.body
        );
        successCount += 1;
        notifyUiPostingStatus({
          status: "posted",
          message: writeSomething.clicked ? `Opened ${group.name}. Composer trigger clicked.` : `Opened ${group.name}. Composer trigger not found.`,
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount
        });
        if (index < request.groups.length - 1) {
          notifyUiPostingStatus({
            status: "waiting",
            message: `Waiting ${request.delaySeconds} seconds before next group...`,
            current,
            total,
            groupId: group.id,
            groupName: group.name,
            successCount
          });
          await sleep(request.delaySeconds * 1e3);
        }
      }
      notifyUiPostingStatus({
        status: "done",
        message: `Finished opening ${successCount}/${total} groups.`,
        current: total,
        total,
        successCount
      });
    } catch (error) {
      notifyUiPostingStatus({
        status: "done",
        message: "UI posting automation stopped.",
        current: 0,
        total,
        successCount,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    } finally {
      activeUiPosting = false;
    }
  }
  function normalizeGroupUrl(groupUrlOrId) {
    if (groupUrlOrId.startsWith("http://") || groupUrlOrId.startsWith("https://")) {
      return groupUrlOrId;
    }
    return `https://www.facebook.com/groups/${groupUrlOrId}/`;
  }
  async function findWriteSomethingInTab(tabId, images = [], body = "") {
    const request = {
      type: "FIND_WRITE_SOMETHING",
      images,
      body
    };
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
          found: false,
          clicked: false,
          spanCount: 0,
          error: response?.error ?? "Unable to inspect Facebook page."
        };
      } catch (error) {
        if (attempt === 19) {
          return {
            ok: false,
            found: false,
            clicked: false,
            spanCount: 0,
            error: error instanceof Error ? error.message : "Content script did not respond."
          };
        }
        await sleep(250);
      }
    }
    return {
      ok: false,
      found: false,
      clicked: false,
      spanCount: 0,
      error: "Content script did not respond."
    };
  }
  async function waitForTabComplete(tabId, urlIncludes) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 45e3) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" && tab.url?.includes(urlIncludes)) {
        return;
      }
      await sleep(250);
    }
    throw new Error("Facebook group page took too long to load.");
  }
  function notifyUiPostingStatus(partial) {
    const status = {
      type: "UI_POSTING_STATUS",
      ...partial
    };
    void chrome.runtime.sendMessage(status);
  }
})();
