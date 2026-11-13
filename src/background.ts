import { shuffleGroups } from "./group-posting-order";
import { inspectPageReadinessInPage } from "./page-readiness";
import {
  GROUPS_QUERY_FRIENDLY_NAME,
  JOINED_GROUPS_URL,
  type CreatePostRequest,
  type CreatePostResponse,
  type ExtensionRequest,
  type FacebookGroup,
  type GroupExtractionStatusMessage,
  type PostingTiming,
  type SimpleGroup,
  type StartUiPostingRequest,
  type UiPostImage,
  type UiPostingStatusMessage,
} from "./config";
import { listenForPostingRequests } from "./posting-request-transfer";
import {
  getScheduledPosting,
  removeScheduledPosting,
  saveScheduledPosting,
  takeScheduledPosting,
  type ScheduledPosting,
} from "./scheduled-posting";

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
  pendingApproval?: boolean;
  actorId?: string;
  postId?: string;
  postUrl?: string;
  responseBody?: string;
  error?: string;
};

const POST_MUTATION_FRIENDLY_NAME = "ComposerStoryCreateMutation";
const UPLOAD_CANDIDATE_MATCHES = [
  "upload.facebook.com/ajax/react_composer/attachments/photo/upload",
  "www.facebook.com/ajax/react_composer/attachments/photo/upload",
  "web.facebook.com/ajax/react_composer/attachments/photo/upload",
  "/ajax/react_composer/attachments/photo/upload",
];
const MIN_POSTING_DELAY_SECONDS = 60;
const LOG_PREFIX = "[Facebook Groups Bulk Poster]";
const SCHEDULED_POSTING_ALARM = "postika-scheduled-posting";

class MissingFirstGroupComposerError extends Error {
  constructor(groupName: string) {
    super(
      `Postika could not find the post composer in ${groupName}. Postika will skip it and try the next selected Group.`,
    );
    this.name = "MissingFirstGroupComposerError";
  }
}

class FacebookPostResponseError extends Error {
  readonly responseBody: string;

  constructor(message: string, responseBody: string) {
    super(message);
    this.name = "FacebookPostResponseError";
    this.responseBody = responseBody;
  }
}

function isMissingFirstGroupComposerError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error instanceof MissingFirstGroupComposerError ||
      /write something(?:\.\.\.)?.*(?:not found|could not find)/i.test(
        error.message,
      ))
  );
}

const FACEBOOK_HOSTS = new Set([
  "www.facebook.com",
  "web.facebook.com",
  "upload.facebook.com",
]);

function normalizeFacebookActorId(value: string | undefined): string {
  const actorId = value?.trim() ?? "";
  return /^\d{5,32}$/.test(actorId) ? actorId : "";
}

async function getFacebookActorId(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isFacebookUrl(tab.url)) {
    throw new Error("Open Facebook and sign in before starting to post.");
  }
  const cookie = await chrome.cookies.get({
    url: tab.url,
    name: "c_user",
  });
  const actorId = normalizeFacebookActorId(cookie?.value);
  if (!actorId) {
    throw new Error(
      "Postika could not identify the Facebook account signed in to this Chrome profile. Refresh Facebook, sign in again, and retry.",
    );
  }
  return actorId;
}

const pendingRequests = new Map<string, PendingRequest>();

let capturedGroupsRequest: CapturedRequest | undefined;
let captureTabId: number | undefined;

let activePosting = false;
let postingRequestStartInProgress = false;
let scheduledQueueStartPromise: Promise<void> | undefined;
let activePostingSuccessTarget: number | undefined;
let activePostingPendingCount = 0;
let stopPostingRequested = false;
let pausePostingRequested = false;
let pauseNotificationSent = false;
let postingNetworkOffline = false;
let queuePauseApplied = false;
let latestUiPostingStatus: UiPostingStatusMessage | undefined;
let activePostingTabId: number | undefined;
let postingCaptureTabId: number | undefined;
let capturedUploadTemplate: CapturedRequest | undefined;
let capturedPostTemplate: CapturedRequest | undefined;

type QueueTimer = {
  startedAt: number;
  totalActiveMs: number;
  totalActiveSince?: number;
  itemKey?: string;
  itemActiveMs: number;
  itemActiveSince?: number;
  pausedAt?: number;
  pausedMs: number;
  complete: boolean;
};

type PostingStatusContext = Pick<
  UiPostingStatusMessage,
  | "current"
  | "total"
  | "groupId"
  | "groupName"
  | "successCount"
  | "failedCount"
  | "processedCount"
>;

let groupsPostingTimer: QueueTimer | undefined;

function createQueueTimer(requestedStartedAt?: number): QueueTimer {
  const now = Date.now();
  const startedAt =
    typeof requestedStartedAt === "number" &&
    Number.isFinite(requestedStartedAt) &&
    requestedStartedAt <= now
      ? Math.max(0, requestedStartedAt)
      : now;
  return {
    startedAt,
    totalActiveMs: now - startedAt,
    totalActiveSince: now,
    itemActiveMs: now - startedAt,
    itemActiveSince: now,
    pausedMs: 0,
    complete: false,
  };
}

function commitQueueTimer(timer: QueueTimer, now = Date.now()) {
  if (timer.totalActiveSince !== undefined) {
    timer.totalActiveMs += Math.max(0, now - timer.totalActiveSince);
    timer.totalActiveSince = undefined;
  }
  if (timer.itemActiveSince !== undefined) {
    timer.itemActiveMs += Math.max(0, now - timer.itemActiveSince);
    timer.itemActiveSince = undefined;
  }
}

function pauseQueueTimer(timer?: QueueTimer) {
  if (!timer || timer.complete || timer.pausedAt !== undefined) {
    return;
  }
  const now = Date.now();
  commitQueueTimer(timer, now);
  timer.pausedAt = now;
}

function resumeQueueTimer(timer?: QueueTimer) {
  if (!timer || timer.complete || timer.pausedAt === undefined) {
    return;
  }
  const now = Date.now();
  timer.pausedMs += Math.max(0, now - timer.pausedAt);
  timer.pausedAt = undefined;
  timer.totalActiveSince = now;
  timer.itemActiveSince = now;
}

function finishQueueTimer(timer?: QueueTimer) {
  if (!timer || timer.complete) {
    return;
  }
  const now = Date.now();
  commitQueueTimer(timer, now);
  if (timer.pausedAt !== undefined) {
    timer.pausedMs += Math.max(0, now - timer.pausedAt);
    timer.pausedAt = undefined;
  }
  timer.complete = true;
}

function queueTimingSnapshot(
  timer: QueueTimer | undefined,
  itemKey?: string,
): PostingTiming | undefined {
  if (!timer) {
    return undefined;
  }
  const now = Date.now();
  if (itemKey && itemKey !== timer.itemKey) {
    if (timer.itemKey === undefined) {
      timer.itemKey = itemKey;
    } else {
      if (timer.itemActiveSince !== undefined) {
        timer.itemActiveMs += Math.max(0, now - timer.itemActiveSince);
      }
      timer.itemKey = itemKey;
      timer.itemActiveMs = 0;
      timer.itemActiveSince =
        timer.pausedAt === undefined && !timer.complete ? now : undefined;
    }
  }
  const running = timer.pausedAt === undefined && !timer.complete;
  return {
    startedAt: timer.startedAt,
    updatedAt: now,
    elapsedMs:
      timer.totalActiveMs +
      (running && timer.totalActiveSince !== undefined
        ? Math.max(0, now - timer.totalActiveSince)
        : 0),
    itemElapsedMs:
      timer.itemActiveMs +
      (running && timer.itemActiveSince !== undefined
        ? Math.max(0, now - timer.itemActiveSince)
        : 0),
    pausedMs:
      timer.pausedMs +
      (timer.pausedAt !== undefined ? Math.max(0, now - timer.pausedAt) : 0),
    isPaused: timer.pausedAt !== undefined,
    isComplete: timer.complete,
  };
}
const loggedUploadCandidateRequestIds = new Set<string>();
const MANUAL_STOP_MESSAGE = "Posting stopped by user.";
const FACEBOOK_POST_LIMIT_PATTERN = /\bwe\s+limit\s+how\s+often\s+you\b/i;
const FACEBOOK_OTHER_POSTING_RESTRICTION_PATTERN =
  /\b(?:temporarily\s+(?:blocked|restricted)|posting\s+(?:has\s+been\s+)?(?:limited|restricted)|posting\s+limit|rate\s+limit)\b/i;
const FACEBOOK_RATE_LIMIT_ERROR_CODE_PATTERN = /"code"\s*:\s*1390008\b/;
const FACEBOOK_RATE_LIMIT_API_ERROR_CODE_PATTERN =
  /"api_error_code"\s*:\s*368\b/;
const FACEBOOK_PENDING_CONTENT_LIMIT_PATTERN =
  /limit\s+for\s+pending\s+content\s+in\s+this\s+group/i;
const FACEBOOK_PENDING_CONTENT_LIMIT_ERROR_CODE_PATTERN =
  /"code"\s*:\s*1357006\b/;
const FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE =
  "You're at the limit for pending content in this group.";
const FACEBOOK_RATE_LIMIT_MESSAGE =
  "Facebook has temporarily limited posting. Stop and try again later.";
const FACEBOOK_UNCONFIRMED_POST_MESSAGE =
  "Facebook did not confirm whether the first post was submitted. Check Facebook before trying again.";
const LAST_GROUP_POSTING_STATUS_STORAGE_KEY = "lastGroupPostingStatus";

// Logs follow the browser session; discard summaries from older durable storage.
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

function debugLog(message: string, data?: unknown) {
  if (data === undefined) {
    console.log(`${LOG_PREFIX} ${message}`);
    return;
  }

  console.log(`${LOG_PREFIX} ${message}`, data);
}

function debugWarn(message: string, data?: unknown) {
  if (data === undefined) {
    console.log(`${LOG_PREFIX} ${message}`);
    return;
  }

  console.log(`${LOG_PREFIX} ${message}`, data);
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

listenForPostingRequests(startUiPostingRequest);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCHEDULED_POSTING_ALARM) {
    void startScheduledPosting().catch(handleScheduledPostingFailure);
  }
});

void restoreScheduledPosting().catch(handleScheduledPostingFailure);

async function startUiPostingRequest(
  request: StartUiPostingRequest,
): Promise<{ ok: boolean; error?: string }> {
  if (activePosting || postingRequestStartInProgress) {
    return { ok: false, error: "Posting is already in progress." };
  }

  postingRequestStartInProgress = true;
  try {
    const pending = await getScheduledPosting();
    if (pending) {
      return { ok: false, error: "Posting is already in progress." };
    }

    if (request.scheduledAt !== undefined) {
      const scheduledAt = Date.parse(request.scheduledAt);
      if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
        return {
          ok: false,
          error: "Choose a future date and time for your post.",
        };
      }

      const scheduled: ScheduledPosting = { request, scheduledAt };
      try {
        await chrome.alarms.create(SCHEDULED_POSTING_ALARM, {
          when: scheduledAt,
        });
        await saveScheduledPosting(scheduled);
      } catch (error) {
        await chrome.alarms.clear(SCHEDULED_POSTING_ALARM);
        throw error;
      }

      try {
        await chrome.storage.session.remove(
          LAST_GROUP_POSTING_STATUS_STORAGE_KEY,
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
    if (request.scheduledAt !== undefined) {
      debugWarn("Could not schedule the posting queue.", error);
      return {
        ok: false,
        error:
          "Could not schedule this queue. Check that Chrome storage is available and try again.",
      };
    }
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not start posting.",
    };
  } finally {
    postingRequestStartInProgress = false;
  }
}

function createScheduledStatus(
  scheduled: ScheduledPosting,
): Omit<UiPostingStatusMessage, "type"> {
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
    successTarget: total,
  };
}

async function restoreScheduledPosting(): Promise<void> {
  const scheduled = await getScheduledPosting();
  if (!scheduled) return;

  if (scheduled.scheduledAt <= Date.now()) {
    await startScheduledPosting();
    return;
  }

  const alarm = await chrome.alarms.get(SCHEDULED_POSTING_ALARM);
  if (!alarm || Math.abs(alarm.scheduledTime - scheduled.scheduledAt) > 1_000) {
    await chrome.alarms.create(SCHEDULED_POSTING_ALARM, {
      when: scheduled.scheduledAt,
    });
  }
  notifyUiPostingStatus(createScheduledStatus(scheduled));
}

function startScheduledPosting(): Promise<void> {
  if (scheduledQueueStartPromise) return scheduledQueueStartPromise;
  scheduledQueueStartPromise = startScheduledPostingQueue().finally(() => {
    scheduledQueueStartPromise = undefined;
  });
  return scheduledQueueStartPromise;
}

async function startScheduledPostingQueue(): Promise<void> {
  const scheduled = await getScheduledPosting();
  if (!scheduled) {
    await chrome.alarms.clear(SCHEDULED_POSTING_ALARM);
    return;
  }
  if (scheduled.scheduledAt > Date.now()) {
    await chrome.alarms.create(SCHEDULED_POSTING_ALARM, {
      when: scheduled.scheduledAt,
    });
    return;
  }
  if (activePosting || postingRequestStartInProgress) {
    await chrome.alarms.create(SCHEDULED_POSTING_ALARM, {
      when: Date.now() + 60_000,
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
        when: Date.now() + 60_000,
      });
      return;
    }

    void chrome.alarms.clear(SCHEDULED_POSTING_ALARM);
    void runGraphqlPostingQueue({
      ...claimed.request,
      startedAt: Date.now(),
      scheduledAt: undefined,
    });
  } finally {
    postingRequestStartInProgress = false;
  }
}

async function cancelScheduledPosting(): Promise<boolean> {
  const scheduled = await getScheduledPosting();
  if (!scheduled || !(await removeScheduledPosting())) return false;

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
    processedCount: 0,
  });
  return true;
}

async function stopUiPosting(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (await cancelScheduledPosting()) return { ok: true };
  } catch (error) {
    if (!activePosting) {
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unable to stop posting.",
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
    "Stopping posting after the current Facebook action finishes...",
  );
  return { ok: true };
}

function handleScheduledPostingFailure(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  debugWarn("Could not restore or start the scheduled queue.", detail);
  void removeScheduledPosting()
    .then(async (removed) => {
      await chrome.alarms.clear(SCHEDULED_POSTING_ALARM);
      if (!removed) return;
      notifyUiPostingStatus({
        status: "stopped",
        message:
          "The scheduled queue could not be started. Please schedule it again.",
        current: 0,
        total: 0,
      });
    })
    .catch((cleanupError: unknown) => {
      debugWarn(
        "Could not clear the failed scheduled queue.",
        cleanupError instanceof Error ? cleanupError.message : cleanupError,
      );
    });
}

chrome.runtime.onMessage.addListener(
  (
    request: ExtensionRequest,
    _sender,
    sendResponse: (response: any) => void,
  ) => {
    if (request.type === "GET_POSTING_QUEUE_STATUS") {
      void Promise.all([
        chrome.storage.session.get(LAST_GROUP_POSTING_STATUS_STORAGE_KEY),
        getScheduledPosting(),
      ])
        .then(([storage, scheduled]) => {
          const storedStatus = storage[
            LAST_GROUP_POSTING_STATUS_STORAGE_KEY
          ] as UiPostingStatusMessage | undefined;
          const groups = scheduled
            ? {
                type: "UI_POSTING_STATUS" as const,
                ...createScheduledStatus(scheduled),
              }
            : (latestUiPostingStatus ?? storedStatus);
          sendResponse({
            groups: groups
              ? {
                  ...groups,
                  timing:
                    queueTimingSnapshot(groupsPostingTimer, groups.groupId) ??
                    groups.timing,
                }
              : undefined,
          });
        })
        .catch((error: unknown) => {
          debugWarn(
            "Could not read the posting queue status.",
            error instanceof Error ? error.message : error,
          );
          sendResponse({ groups: latestUiPostingStatus });
        });
      return true;
    }

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
        postingNetworkOffline
          ? "Internet connection lost. Posting paused until the connection returns."
          : "Posting paused.",
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
        postingNetworkOffline
          ? "Internet connection lost. Posting paused until the connection returns."
          : "Posting resumed.",
      );
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
    capturedGroupsRequest = undefined;
    await triggerJoinedGroupsSortRequest(tab.id);

    notifyGroupsStatus("Waiting for fresh Facebook groups request...", 0);
    const capturedRequest = await waitForCapturedGroupsRequest(tab.id!);
    notifyGroupsStatus("Captured groups request. Preparing extraction...", 0);
    const config = updateFetchGroupsConfigFromCapturedRequest(capturedRequest);
    notifyGroupsStatus("Fetching groups page 1...", 0);
    const groups = await extractAllGroups(tab.id, config);
    const uniqueGroups = shuffleGroups(dedupeGroups(groups));
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

  if (activeTab?.id !== undefined && isFacebookUrl(activeTab.url)) {
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
}

async function waitForJoinedGroupsPage(tabId: number): Promise<void> {
  while (true) {
    const tab = await chrome.tabs.get(tabId);

    if (tab.status === "complete") {
      if (tab.url?.includes("/groups/joins/")) {
        return;
      }

      if (
        tab.url &&
        isFacebookUrl(tab.url) &&
        /^\/(?:login|checkpoint)(?:\/|$)/.test(new URL(tab.url).pathname)
      ) {
        throw new Error(
          "Could not find your groups. Check that you are signed in to Facebook and try again.",
        );
      }
    }

    await sleep(250);
  }
}

async function waitForPageDomReady(
  tabId: number,
  urlIncludes: string,
): Promise<void> {
  while (true) {
    // A closed tab is an actual failure, rather than a reason to keep waiting.
    await chrome.tabs.get(tabId);
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: inspectPageReadinessInPage,
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
      "disabled",
    ],
  });

  const waitForStableDom = async () => {
    while (
      document.readyState !== "complete" ||
      Array.from(document.querySelectorAll('[aria-busy="true"]')).some(
        isVisible,
      ) ||
      Date.now() - lastChangedAt < 1_500
    ) {
      await wait(250);
    }
  };
  const findSortTrigger = (): HTMLElement | undefined => {
    const root = document.querySelector('[role="main"]') ?? document;
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(
        '[role="button"][tabindex="0"][aria-haspopup="menu"][aria-expanded]',
      ),
    ).filter((button) => {
      if (
        !isVisible(button) ||
        button.getAttribute("aria-disabled") === "true" ||
        button.closest(
          'article, [role="article"], [role="dialog"], [role="navigation"], [role="banner"]',
        ) ||
        button.querySelector('svg, img, i, a, input, [contenteditable="true"]')
      )
        return false;
      const label = button.querySelector(":scope > span");
      const overlay = button.querySelector(
        ':scope > [role="none"][data-visualcompletion="ignore"]',
      );
      return (
        Boolean(label?.textContent?.trim()) &&
        Boolean(overlay) &&
        label?.textContent?.trim() === button.textContent?.trim()
      );
    });
    if (candidates.length === 1) return candidates[0];
    // Use the supplied label classes only to disambiguate structural matches.
    const matches = candidates.filter((button) =>
      button.querySelector(":scope > span.x6prxxf.xvq8zen.xo1l8bm.x1fey0fg"),
    );
    return matches.length === 1 ? matches[0] : undefined;
  };
  const visibleOptions = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).filter(isVisible);

  try {
    let trigger: HTMLElement | undefined;
    while (!trigger) {
      await waitForStableDom();
      trigger = findSortTrigger();
      if (!trigger) await wait(250);
    }

    // Ignore radio menus that were already open elsewhere on the page.
    const previousOptions = new Set(visibleOptions());
    clickElement(trigger);
    lastChangedAt = Date.now();
    while (true) {
      await waitForStableDom();
      if (!trigger.isConnected) {
        throw new Error(
          "The joined groups sort control changed. Please load groups again.",
        );
      }
      const options = visibleOptions().filter(
        (option) => !previousOptions.has(option),
      );
      const menus = new Set(
        options.map((option) => option.closest('[role="menu"]')),
      );
      if (
        trigger.getAttribute("aria-expanded") === "true" &&
        options.length >= 2 &&
        menus.size === 1
      ) {
        // Choose a different ordering so Facebook sends a fresh request.
        const sortOption = options.find(
          (option) => option.getAttribute("aria-checked") === "false",
        );
        if (sortOption) {
          clickElement(sortOption);
          return { ok: true };
        }
      }
      // Click once, then let late-rendered options arrive without closing the menu.
      await wait(250);
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to trigger joined groups sort.",
    };
  } finally {
    observer.disconnect();
  }
}

async function waitForCapturedGroupsRequest(
  tabId: number,
): Promise<CapturedRequest> {
  while (true) {
    if (capturedGroupsRequest) {
      return capturedGroupsRequest;
    }

    await chrome.tabs.get(tabId);
    await sleep(250);
  }
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
        `Fetching next page. ${allGroups.length} groups loaded.`,
        allGroups.length,
      );
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

function currentPostingStatusContext(): PostingStatusContext {
  const latest = latestUiPostingStatus;
  return {
    current: latest?.current ?? 0,
    total: latest?.total ?? 0,
    groupId: latest?.groupId,
    groupName: latest?.groupName,
    successCount: latest?.successCount ?? 0,
    failedCount: latest?.failedCount ?? 0,
    processedCount: latest?.processedCount ?? 0,
  };
}

function applyPostingPauseState(message?: string) {
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
        message ??
          (postingNetworkOffline
            ? "Internet connection lost. Posting paused until the connection returns."
            : "Posting paused."),
      );
    }
    pauseNotificationSent = true;
  } else if (wasPaused || message) {
    notifyPostingControlStatus("posting", message ?? "Posting resumed.");
    pauseNotificationSent = false;
  }
}

function setPostingNetworkOffline(offline: boolean) {
  if (postingNetworkOffline === offline) return;
  postingNetworkOffline = offline;
  if (!activePosting) return;

  applyPostingPauseState(
    offline
      ? "Internet connection lost. Posting paused until the connection returns."
      : pausePostingRequested
        ? "Internet connection restored. Posting remains paused until you resume."
        : "Internet connection restored. Resuming posting.",
  );
}

function startPostingConnectivityMonitor(): {
  ready: Promise<void>;
  stop: () => void;
} {
  if (typeof fetch !== "function") {
    return { ready: Promise.resolve(), stop: () => {} };
  }

  let stopped = false;
  let controller: AbortController | undefined;
  let failures = 0;
  let sampled = false;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const sample = async () => {
    let online = false;
    if (typeof navigator === "undefined" || navigator.onLine) {
      const probeController = new AbortController();
      controller = probeController;
      const timeout = setTimeout(() => probeController.abort(), 3_000);
      try {
        const responses = await Promise.all(
          [
            "https://www.facebook.com/robots.txt",
            "https://web.facebook.com/robots.txt",
          ].map(async (url) => {
            try {
              const response = await fetch(url, {
                cache: "no-store",
                credentials: "omit",
                redirect: "manual",
                signal: probeController.signal,
              });
              return response.type !== "opaqueredirect";
            } catch {
              return false;
            }
          }),
        );
        online = responses.some(Boolean);
      } finally {
        clearTimeout(timeout);
        controller = undefined;
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
        await sleep(3_000);
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
      resolveReady();
    },
  };
}

function isNetworkTransportFailure(error?: string): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return /failed to fetch|network(?:error| request failed)|load failed|err_(?:network|internet_disconnected|connection|name_not_resolved|address_unreachable|timed_out)|connection (?:reset|closed|lost|refused|timed out)/i.test(
    error ?? "",
  );
}

function throwIfPostingStopped() {
  if (activePosting && stopPostingRequested) {
    throw new Error(MANUAL_STOP_MESSAGE);
  }
}

async function waitWhilePostingPaused(
  statusContext = currentPostingStatusContext(),
) {
  while (activePosting && (pausePostingRequested || postingNetworkOffline)) {
    throwIfPostingStopped();

    if (!pauseNotificationSent) {
      notifyUiPostingStatus({
        status: "paused",
        message: postingNetworkOffline
          ? "Internet connection lost. Posting paused until the connection returns."
          : statusContext.groupName
            ? `Posting paused before ${statusContext.groupName}.`
            : "Posting paused.",
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

  throwIfPostingStopped();
}

async function sleepWithStopChecks(
  durationMs: number,
  statusContext?: PostingStatusContext,
  intervalMs = 250,
) {
  let remaining = durationMs;

  while (remaining > 0) {
    throwIfPostingStopped();
    await waitWhilePostingPaused(statusContext);
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
      message: `Next post in ${formatPostingCountdown(remaining)}`,
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

function formatPostingCountdown(durationSeconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationSeconds));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const minuteText = String(minutes).padStart(2, "0");
  const secondText = String(seconds).padStart(2, "0");

  return hours > 0
    ? `${hours}:${minuteText}:${secondText}`
    : `${minuteText}:${secondText}`;
}

function randomIntegerBetween(minimum: number, maximum: number): number {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

async function runGraphqlPostingQueue(
  request: StartUiPostingRequest,
): Promise<void> {
  const selectedGroups = shuffleGroups([
    ...new Map(request.groups.map((group) => [group.id, group])).values(),
  ]);
  const targetGroupCount = selectedGroups.length;
  let groups = [...selectedGroups];
  const requestedPosts = request.posts.filter(
    (post) => post.body.trim().length > 0 && post.images.length > 0,
  );
  const firstPostWithImagesIndex = requestedPosts.findIndex(
    (post) => post.images.length > 0,
  );
  const posts =
    firstPostWithImagesIndex > 0
      ? [
          ...requestedPosts.slice(firstPostWithImagesIndex),
          ...requestedPosts.slice(0, firstPostWithImagesIndex),
        ]
      : requestedPosts;
  const requestedMinimumDelay = Number(request.minimumDelaySeconds);
  const minimumDelaySeconds =
    Number.isInteger(requestedMinimumDelay) &&
    requestedMinimumDelay >= MIN_POSTING_DELAY_SECONDS
      ? requestedMinimumDelay
      : MIN_POSTING_DELAY_SECONDS;
  const requestedMaximumDelay = Number(request.maximumDelaySeconds);
  const maximumDelaySeconds =
    Number.isInteger(requestedMaximumDelay) &&
    requestedMaximumDelay >= minimumDelaySeconds
      ? requestedMaximumDelay
      : minimumDelaySeconds;

  debugLog("Starting posting queue.", {
    mode: "UI capture followed by GraphQL posting",
    requestedGroups: request.groups.length,
    groups: groups.length,
    targetGroupCount,
    posts: posts.length,
    images: posts.reduce((count, post) => count + post.images.length, 0),
    minimumDelaySeconds,
    maximumDelaySeconds,
    rotationStartedWithImagePost: firstPostWithImagesIndex > 0,
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
      error:
        "Wait for the current posts to finish, or stop posting before starting again.",
    });
    return;
  }

  activePosting = true;
  groupsPostingTimer = createQueueTimer(request.startedAt);
  void chrome.storage.session.remove(LAST_GROUP_POSTING_STATUS_STORAGE_KEY);
  activePostingSuccessTarget = targetGroupCount;
  activePostingPendingCount = 0;
  latestUiPostingStatus = undefined;
  stopPostingRequested = false;
  pausePostingRequested = false;
  pauseNotificationSent = false;
  postingNetworkOffline = false;
  queuePauseApplied = false;
  let successCount = 0;
  let failedCount = 0;
  const failedGroupIds = new Set<string>();
  const total = groups.length;
  let postingTabId: number | undefined;
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
      processedCount: 0,
    });
    const firstPostBody = posts[0].body;
    const firstPostHtml = posts[0].html;
    throwIfPostingStopped();

    let templates: Awaited<ReturnType<typeof ensurePostingTemplates>>;
    while (true) {
      try {
        templates = await ensurePostingTemplates(
          postingTabId,
          groups,
          posts[0].body,
          firstPostBody,
          firstPostHtml,
          posts[0].images,
          total,
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
            "None of the selected Groups has a visible post composer. Select another standard Group and try again.",
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
          successTarget: targetGroupCount,
        });
      }
    }

    if (templates.firstGroupPosted) {
      if (
        templates.firstPostResult?.actorId &&
        templates.firstPostResult.actorId !== facebookActorId
      ) {
        debugWarn(
          "First post actor did not match the signed-in Facebook account.",
        );
      }
      successCount += 1;
      const firstPostPending =
        templates.firstPostResult?.pendingApproval === true;
      if (firstPostPending) {
        activePostingPendingCount += 1;
      }
      notifyUiPostingStatus({
        status: firstPostPending ? "pending" : "posted",
        message: firstPostPending
          ? "Your post is pending"
          : `Posted to ${groups[0].name}.`,
        detail:
          [
            firstPostPending
              ? "Your post is awaiting admin approval. If the admin team approves it, it'll become visible in the group."
              : undefined,
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        current: 1,
        total,
        groupId: groups[0].id,
        groupName: groups[0].name,
        successCount,
        failedCount,
        processedCount: 1,
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
          successTarget: targetGroupCount,
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
      processedCount: startIndex,
    });

    if (templates.firstGroupPosted) {
      const nextGroupIndex = startIndex % groups.length;
      const nextGroup = groups[nextGroupIndex];
      const delaySeconds = randomIntegerBetween(
        minimumDelaySeconds,
        maximumDelaySeconds,
      );

      await sleepWithPostingCountdown(delaySeconds, {
        current: nextGroupIndex + 1,
        total,
        groupId: nextGroup.id,
        groupName: nextGroup.name,
        successCount,
        failedCount,
        processedCount: startIndex,
      });
    }

    for (
      let attemptIndex = startIndex;
      attemptIndex < groups.length;
      attemptIndex += 1
    ) {
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
      const preparedPostNumber = (attemptIndex % posts.length) + 1;
      const hasImages = preparedPost.images.length > 0;
      const current = groupIndex + 1;
      const statusContext = {
        current,
        total,
        groupId: group.id,
        groupName: group.name,
        successCount,
        failedCount,
        processedCount: attemptIndex,
      };
      await waitWhilePostingPaused(statusContext);
      debugLog("Processing group.", {
        attempt: attemptIndex + 1,
        current,
        total,
        groupId: group.id,
        groupName: group.name,
        preparedPostId: preparedPost.id,
        preparedPostNumber,
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
        processedCount: attemptIndex,
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
        finalLength: postBody.length,
      });

      await waitWhilePostingPaused(statusContext);
      let photoIds: string[] = [];

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
          processedCount: attemptIndex,
        });

        if (!templates.uploadTemplate) {
          throw new Error(
            "Could not set up photo uploads from your first post. Please start posting again.",
          );
        }

        photoIds = await uploadImagesForGroup(
          postingTabId,
          templates.uploadTemplate,
          preparedPost.images,
          statusContext,
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
          processedCount: attemptIndex,
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
        message: `Posting post ${preparedPostNumber}/${posts.length} to ${group.name}...`,
        current,
        total,
        groupId: group.id,
        groupName: group.name,
        successCount,
        failedCount,
        processedCount: attemptIndex,
      });

      const postResult = await createGraphqlPost(
        postingTabId,
        templates.postTemplate,
        postBody,
        photoIds,
        group.id,
        templates.firstGroupPosted && preparedPost === posts[0],
        statusContext,
      );
      debugLog("GraphQL post result received.", {
        groupId: group.id,
        success: postResult.success,
        pendingApproval: postResult.pendingApproval,
        postId: postResult.postId,
        postUrl: postResult.postUrl,
        error: postResult.error,
      });
      if (postResult.actorId && postResult.actorId !== facebookActorId) {
        debugWarn("Post actor did not match the signed-in Facebook account.", {
          groupId: group.id,
        });
      }

      if (postResult.success) {
        successCount += 1;
        if (postResult.pendingApproval) {
          activePostingPendingCount += 1;
        }
        notifyUiPostingStatus({
          status: postResult.pendingApproval ? "pending" : "posted",
          message: postResult.pendingApproval
            ? "Your post is pending"
            : `Posted successfully to ${group.name}.`,
          detail:
            [
              postResult.pendingApproval
                ? "Your post is awaiting admin approval. If the admin team approves it, it'll become visible in the group."
                : undefined,
            ]
              .filter(Boolean)
              .join(" ") || undefined,
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount,
          failedCount,
          processedCount: attemptIndex + 1,
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
            successTarget: targetGroupCount,
          });
          return;
        }
      } else {
        failedCount += 1;
        failedGroupIds.add(group.id);

        if (isRateLimitError(postResult.error, postResult.responseBody)) {
          notifyUiPostingStatus({
            status: "rate_limited",
            message:
              "Facebook temporarily blocked posting on this account. Queue stopped. Try again later.",
            current,
            total,
            groupId: group.id,
            groupName: group.name,
            successCount,
            failedCount,
            processedCount: attemptIndex + 1,
            error: postResult.error,
            responseBody: postResult.responseBody,
          });
          return;
        }

        notifyUiPostingStatus({
          status: "failed",
          message:
            postResult.error === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE
              ? FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE
              : `Failed to post to ${group.name}.`,
          detail:
            postResult.error === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE
              ? `Facebook rejected the post to ${group.name} because this Group cannot accept more pending content from your account.`
              : undefined,
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount,
          failedCount,
          processedCount: attemptIndex + 1,
          error: postResult.error,
          responseBody: postResult.responseBody,
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
        maximumDelaySeconds,
      );

      await sleepWithPostingCountdown(delaySeconds, {
        current: nextCurrent,
        total,
        groupId: nextGroup.id,
        groupName: nextGroup.name,
        successCount,
        failedCount,
        processedCount: nextAttemptIndex,
      });
    }
    notifyUiPostingStatus({
      status: "done",
      message:
        successCount >= targetGroupCount
          ? `Posting finished: ${successCount} posts were submitted.`
          : `Posting finished: ${successCount} posts were submitted and ${failedCount} groups failed.`,
      current: Math.min(successCount + failedCount, total),
      total,
      successCount,
      failedCount,
      processedCount: Math.min(successCount + failedCount, total),
      successTarget: targetGroupCount,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    debugWarn("Posting queue stopped with error.", { error: errorMessage });
    const responseBody =
      error instanceof FacebookPostResponseError
        ? error.responseBody
        : undefined;
    const rateLimited = isRateLimitError(errorMessage, responseBody);
    if (rateLimited) {
      failedCount += 1;
      notifyUiPostingStatus({
        status: "rate_limited",
        message:
          "Facebook temporarily blocked posting on this account. Queue stopped. Try again later.",
        current: groups.length > 0 ? 1 : 0,
        total,
        groupId: groups[0]?.id,
        groupName: groups[0]?.name,
        successCount,
        failedCount,
        processedCount: 1,
        error: errorMessage,
        responseBody,
      });
    } else {
      if (error instanceof FacebookPostResponseError) {
        failedCount += 1;
        notifyUiPostingStatus({
          status: "failed",
          message:
            errorMessage === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE
              ? FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE
              : `Failed to post to ${groups[0]?.name ?? "the first Group"}.`,
          detail:
            errorMessage === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE
              ? `Facebook rejected the post to ${groups[0]?.name ?? "the first Group"} because this Group cannot accept more pending content from your account.`
              : undefined,
          current: groups.length > 0 ? 1 : 0,
          total,
          groupId: groups[0]?.id,
          groupName: groups[0]?.name,
          successCount,
          failedCount,
          processedCount: 1,
          error: errorMessage,
          responseBody: error.responseBody,
        });
      }
      notifyUiPostingStatus({
        status: errorMessage === MANUAL_STOP_MESSAGE ? "stopped" : "done",
        message:
          errorMessage === MANUAL_STOP_MESSAGE
            ? MANUAL_STOP_MESSAGE
            : "Automatic posting stopped.",
        current: Math.min(successCount + failedCount, total),
        total,
        successCount,
        failedCount,
        processedCount: Math.min(successCount + failedCount, total),
        error: errorMessage,
      });
    }
  } finally {
    connectivityMonitor.stop();
    stopPostingTemplateCapture();
    if (postingTabId) {
      await readFirstPostResponseCapture(postingTabId, true);
    }
    debugLog("Posting queue finished.", {
      total,
      successCount,
      pendingCount: activePostingPendingCount,
      failedCount,
    });
    activePosting = false;
    activePostingSuccessTarget = undefined;
    activePostingPendingCount = 0;
    stopPostingRequested = false;
    pausePostingRequested = false;
    pauseNotificationSent = false;
    postingNetworkOffline = false;
    queuePauseApplied = false;
    activePostingTabId = undefined;
  }
}

async function ensurePostingTemplates(
  tabId: number,
  groups: SimpleGroup[],
  originalBody: string,
  body: string,
  html: string,
  images: UiPostImage[],
  total: number,
  progress?: Required<
    Pick<
      UiPostingStatusMessage,
      "current" | "total" | "successCount" | "failedCount" | "processedCount"
    >
  >,
): Promise<{
  uploadTemplate?: CapturedRequest;
  postTemplate: CapturedRequest;
  firstGroupPosted: boolean;
  firstPostResult?: GraphqlPostResult;
}> {
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
    ...progress,
  };

  debugLog("Capturing fresh templates from UI group post.", {
    groupId: firstGroup.id,
    groupName: firstGroup.name,
    requiresUploadTemplate,
  });

  throwIfPostingStopped();
  debugLog("Post body prepared for UI group post.", {
    current: statusContext.current,
    total,
    groupId: firstGroup.id,
    groupName: firstGroup.name,
    originalLength: originalBody.length,
    finalLength: body.length,
  });

  notifyUiPostingStatus({
    status: "posting",
    message: "Setting up automatic posting using your first Facebook post...",
    ...statusContext,
  });

  beginPostingTemplateCapture(tabId);
  throwIfPostingStopped();

  const groupUrl = normalizeGroupUrl(firstGroup.id);
  await chrome.tabs.update(tabId, { url: groupUrl, active: true });
  await waitForTabComplete(tabId, "/groups/");
  await sleepWithStopChecks(5_000, statusContext);

  await installFirstPostResponseCapture(tabId);
  const postResult = await createPostInTab(tabId, images, body, html);
  if (
    !postResult.ok &&
    postResult.composerFound === false &&
    postResult.error === "Group composer button not found."
  ) {
    stopPostingTemplateCapture();
    throw new MissingFirstGroupComposerError(firstGroup.name);
  }
  if (!postResult.ok) {
    stopPostingTemplateCapture();
    throw new Error(postResult.error ?? "Unable to create the first post.");
  }

  const capturedTemplates = await waitForPostingTemplatesInternal(
    requiresUploadTemplate,
    statusContext,
  );
  const firstResponseText = await waitForFirstPostResponseCapture(
    tabId,
    statusContext,
  );
  let firstPostResult = firstResponseText
    ? parsePostResponse(firstResponseText)
    : undefined;
  throwIfPostingStopped();

  if (!firstResponseText) {
    const capturedVariables = capturedTemplates.postTemplate.formData.variables;
    if (!capturedVariables) {
      throw new FacebookPostResponseError(
        FACEBOOK_UNCONFIRMED_POST_MESSAGE,
        "",
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
      capturedVariables,
    );
    throwIfPostingStopped();
    if (
      !firstPostResult.success &&
      isNetworkTransportFailure(firstPostResult.error)
    ) {
      throw new FacebookPostResponseError(
        FACEBOOK_UNCONFIRMED_POST_MESSAGE,
        firstPostResult.responseBody ?? "",
      );
    }
  }

  if (firstPostResult?.success === false) {
    const message = classifyFacebookPostFailure(
      firstResponseText ?? "",
      firstPostResult.error,
    );
    throw new FacebookPostResponseError(
      message,
      firstResponseText ?? firstPostResult.responseBody ?? "",
    );
  }

  notifyUiPostingStatus({
    status: "posting",
    message: `Fresh ${requiresUploadTemplate ? "upload and post" : "post"} request values captured from ${firstGroup.name}.`,
    ...statusContext,
  });

  return {
    uploadTemplate: capturedTemplates.uploadTemplate,
    postTemplate: capturedTemplates.postTemplate,
    firstGroupPosted: true,
    firstPostResult,
  };
}

async function installFirstPostResponseCapture(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: installStoryCreateResponseCaptureInPage,
  });
}

async function waitForFirstPostResponseCapture(
  tabId: number,
  statusContext: PostingStatusContext,
): Promise<string | undefined> {
  let activeWaitMs = 0;
  try {
    while (true) {
      throwIfPostingStopped();
      const responseText = await readFirstPostResponseCapture(tabId, false);
      if (responseText) return responseText;
      await waitWhilePostingPaused(statusContext);
      await sleep(200);
      activeWaitMs += 200;
      if (activeWaitMs >= 30_000) return undefined;
    }
  } finally {
    await readFirstPostResponseCapture(tabId, true);
  }
}

async function readFirstPostResponseCapture(
  tabId: number,
  cleanup: boolean,
): Promise<string | undefined> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readStoryCreateResponseCaptureInPage,
      args: [cleanup],
    });
    return typeof result?.result === "string" && result.result.length > 0
      ? result.result
      : undefined;
  } catch (error) {
    debugWarn("Unable to read the UI post response capture.", error);
    return undefined;
  }
}

function installStoryCreateResponseCaptureInPage(): void {
  const key = "__kundiPostStoryCreateResponseCapture";
  const scope = globalThis as typeof globalThis & Record<string, any>;
  const previous = scope[key];
  if (previous?.restore instanceof Function) {
    previous.restore();
  }

  const responses: string[] = [];
  const capture = (text: string) => {
    if (text.includes('"story_create"')) {
      responses.push(text);
    }
  };

  const originalFetch = scope.fetch as typeof fetch;
  const wrappedFetch: typeof fetch = async (...args) => {
    const response = (await Reflect.apply(
      originalFetch,
      scope,
      args,
    )) as Response;
    if (response.url.includes("/api/graphql/")) {
      void response
        .clone()
        .text()
        .then(capture)
        .catch(() => undefined);
    }
    return response;
  };
  scope.fetch = wrappedFetch;

  const xhrPrototype = scope.XMLHttpRequest?.prototype as
    | Record<string, any>
    | undefined;
  const originalOpen = xhrPrototype?.open;
  const originalSend = xhrPrototype?.send;
  if (xhrPrototype && originalOpen && originalSend) {
    xhrPrototype.open = function (...args: any[]) {
      this.__kundiPostRequestUrl = String(args[1] ?? "");
      return originalOpen.apply(this, args);
    };
    xhrPrototype.send = function (...args: any[]) {
      if (String(this.__kundiPostRequestUrl).includes("/api/graphql/")) {
        this.addEventListener(
          "loadend",
          () => {
            try {
              if (!this.responseType || this.responseType === "text") {
                capture(String(this.responseText ?? ""));
              }
            } catch {
              // Facebook may use a response type whose body is not readable.
            }
          },
          { once: true },
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

function readStoryCreateResponseCaptureInPage(
  cleanup: boolean,
): string | undefined {
  const key = "__kundiPostStoryCreateResponseCapture";
  const scope = globalThis as typeof globalThis & Record<string, any>;
  const state = scope[key];
  const response = Array.isArray(state?.responses)
    ? state.responses.shift()
    : undefined;
  if (cleanup && state) {
    if (state.restore instanceof Function) {
      state.restore();
    }
    delete scope[key];
  }
  return typeof response === "string" ? response : undefined;
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

async function waitForPostingTemplatesInternal(
  requiresUploadTemplate: boolean,
  statusContext = currentPostingStatusContext(),
): Promise<{
  uploadTemplate?: CapturedRequest;
  postTemplate: CapturedRequest;
}> {
  let activeWaitMs = 0;
  try {
    while (true) {
      throwIfPostingStopped();
      if (
        capturedPostTemplate &&
        (!requiresUploadTemplate || capturedUploadTemplate)
      ) {
        const uploadTemplate =
          requiresUploadTemplate && capturedUploadTemplate
            ? finalizeUploadTemplate(
                capturedUploadTemplate,
                capturedPostTemplate,
              )
            : undefined;
        const postTemplate = capturedPostTemplate;
        debugLog("Template capture complete.", {
          hasUploadTemplate: Boolean(uploadTemplate),
          hasPostTemplate: true,
        });
        return { uploadTemplate, postTemplate };
      }

      await waitWhilePostingPaused(statusContext);
      await sleep(250);
      activeWaitMs += 250;
      if (activeWaitMs >= 30_000) {
        throw new Error(
          "Facebook did not provide the request values needed to continue. Try again.",
        );
      }
    }
  } finally {
    stopPostingTemplateCapture();
  }
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

function isRateLimitError(
  error: string | undefined,
  responseBody?: string,
): boolean {
  const message = error?.trim() ?? "";
  const combined = `${message}\n${responseBody ?? ""}`;
  if (
    message === FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE ||
    FACEBOOK_PENDING_CONTENT_LIMIT_PATTERN.test(combined) ||
    FACEBOOK_PENDING_CONTENT_LIMIT_ERROR_CODE_PATTERN.test(combined)
  ) {
    return false;
  }
  return isRateLimitBody(combined);
}

async function createPostInTab(
  tabId: number,
  images: CreatePostRequest["images"],
  body: string,
  html: string,
): Promise<CreatePostResponse> {
  const request: CreatePostRequest = {
    type: "CREATE_POST",
    body,
    html,
    images,
  };

  try {
    await injectPostingContentScript(tabId);
  } catch (error) {
    return {
      ok: false,
      composerFound: false,
      composerClicked: false,
      spanCount: 0,
      error:
        error instanceof Error
          ? error.message
          : "Unable to load the posting helper on the Facebook page.",
    };
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = (await chrome.tabs.sendMessage(
        tabId,
        request,
      )) as CreatePostResponse;

      if (response) {
        return response;
      }

      return {
        ok: false,
        composerFound: false,
        composerClicked: false,
        spanCount: 0,
        error: "Unable to inspect Facebook page.",
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

      await sleepWithStopChecks(250);
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

async function injectPostingContentScript(tabId: number): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status !== "complete" || !isFacebookUrl(tab.url)) {
        await sleepWithStopChecks(250);
        continue;
      }

      const [markerResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (marker: string) =>
          (globalThis as typeof globalThis & Record<string, unknown>)[
            marker
          ] === true,
        args: ["__facebookGroupsBulkPosterContentScriptLoaded"],
      });
      if (markerResult?.result === true) {
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["dist/content.js"],
      });
      return;
    } catch (error) {
      lastError = error;
      await sleepWithStopChecks(250);
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `Unable to load the posting helper: ${lastError.message}`
      : "Unable to load the posting helper on the Facebook page.",
  );
}

async function waitForTabComplete(
  tabId: number,
  urlIncludes: string,
): Promise<void> {
  while (true) {
    throwIfPostingStopped();
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && tab.url?.includes(urlIncludes)) {
      return;
    }

    await sleepWithStopChecks(250);
  }
}

async function uploadImagesForGroup(
  tabId: number,
  uploadTemplate: CapturedRequest,
  images: UiPostImage[],
  statusContext: PostingStatusContext,
): Promise<string[]> {
  const photoIds: string[] = [];
  debugLog("Starting image uploads.", { imageCount: images.length });

  for (const image of images) {
    let transportFailures = 0;
    while (true) {
      await waitWhilePostingPaused(statusContext);
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
          break;
        }

        if (
          response.error &&
          isNetworkTransportFailure(response.error) &&
          transportFailures < 3
        ) {
          transportFailures += 1;
          debugWarn("Image upload lost its network connection.", {
            image: image.name,
            attempt: transportFailures,
          });
          setPostingNetworkOffline(true);
          await waitWhilePostingPaused(statusContext);
          continue;
        }

        if (response.error) {
          debugWarn("Image upload failed.", {
            image: image.name,
            error: response.error,
          });
        }
        break;
      } catch (error) {
        debugWarn("Image upload crashed.", {
          image: image.name,
          error,
        });
        break;
      }
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

  setPostingNetworkOffline(false);
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
  preserveCapturedFormatting = false,
  statusContext = currentPostingStatusContext(),
  capturedVariables?: string,
): Promise<GraphqlPostResult> {
  await logPageCookieDiagnostics(tabId, "Before GraphQL replay");
  const variables =
    capturedVariables ??
    buildPostVariables(
      postTemplate.formData,
      text,
      photoIds,
      groupId,
      preserveCapturedFormatting,
    );
  debugLog("Sending GraphQL post request.", {
    groupId,
    photoCount: photoIds.length,
    variableLength: variables.length,
  });
  let transportFailures = 0;

  while (true) {
    await waitWhilePostingPaused(statusContext);
    let result:
      | chrome.scripting.InjectionResult<{
          status: number;
          ok: boolean;
          responseText: string;
          contentType?: string;
          error?: string;
        }>
      | undefined;
    let executionError: string | undefined;

    try {
      [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: createGraphqlPostInPage,
        args: [postTemplate, variables],
      });
    } catch (error) {
      executionError =
        error instanceof Error
          ? error.message
          : "Could not send the post to Facebook.";
    }

    const payload = (result?.result ?? {
      status: 0,
      ok: false,
      responseText: "",
      contentType: "",
      error:
        executionError ??
        "Facebook did not confirm whether the post was submitted.",
    }) as {
      status: number;
      ok: boolean;
      responseText: string;
      contentType?: string;
      error?: string;
    };

    const transportFailure =
      payload.status === 0 &&
      (isNetworkTransportFailure(payload.error) ||
        payload.error ===
          "Facebook did not confirm whether the post was submitted.");
    if (transportFailure) {
      const outageAlreadyDetected =
        postingNetworkOffline ||
        (typeof navigator !== "undefined" && !navigator.onLine);
      transportFailures += outageAlreadyDetected ? 0 : 1;
      setPostingNetworkOffline(true);
      debugWarn("Facebook post request lost its network connection.", {
        groupId,
        attempt: transportFailures,
      });
      await waitWhilePostingPaused(statusContext);
      if (transportFailures > 3) {
        return {
          success: false,
          responseBody: payload.responseText || undefined,
          error: payload.error,
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
      preview: payload.responseText.slice(0, 300),
    });

    if (payload.error) {
      return {
        success: false,
        responseBody: payload.responseText || undefined,
        error: payload.error,
      };
    }

    if (isRateLimitBody(payload.responseText)) {
      debugWarn("Facebook rate limit detected in GraphQL response.", {
        groupId,
      });
      return {
        success: false,
        responseBody: payload.responseText,
        error: "Facebook returned a posting limit response.",
      };
    }

    const postResult = parsePostResponse(payload.responseText);
    if (!postResult.success) {
      postResult.responseBody = payload.responseText;
      postResult.error = classifyFacebookPostFailure(
        payload.responseText,
        postResult.error,
      );
    }
    return postResult;
  }
}

function classifyFacebookPostFailure(
  responseText: string,
  fallback?: string,
): string {
  if (
    FACEBOOK_PENDING_CONTENT_LIMIT_PATTERN.test(responseText) ||
    FACEBOOK_PENDING_CONTENT_LIMIT_ERROR_CODE_PATTERN.test(responseText)
  ) {
    return FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE;
  }
  if (isRateLimitBody(responseText)) {
    return FACEBOOK_RATE_LIMIT_MESSAGE;
  }
  return fallback ?? "Facebook rejected the Group post.";
}

function buildPostVariables(
  templateFormData: Record<string, string>,
  text: string,
  photoIds: string[],
  groupId: string,
  preserveCapturedFormatting = false,
): string {
  text = text.replace(/\r\n?/g, "\n");
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
    );
  }

  const input = templateVariables.input;
  const originalText =
    isRecord(input.message) && typeof input.message.text === "string"
      ? input.message.text
      : undefined;
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
    ...(isRecord(input.audience) ? input.audience : {}),
    to_id: groupId,
  };
  input.client_mutation_id = String(Date.now());

  if (
    !preserveCapturedFormatting &&
    (normalizedOriginalText !== text || !isRecord(input.composed_text))
  ) {
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

function buildFallbackPostVariables(
  templateFormData: Record<string, string>,
  text: string,
  attachments: Array<{ photo: { id: string } }>,
  groupId: string,
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
      composed_text: buildComposedText(text),
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

function buildComposedText(text: string) {
  // Facebook renders separate composed-text blocks as paragraphs. Keep the
  // complete caption in one block so each newline remains a soft line break:
  // one newline stays one break, while two newlines preserve one blank line.
  const normalizedText = text.replace(/\r\n?/g, "\n");

  return {
    block_data: ["{}"],
    block_depths: [0],
    block_types: [0],
    blocks: [normalizedText],
    entities: ["[]"],
    entity_map: "{}",
    inline_styles: ["[]"],
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
        error:
          "Facebook returned an empty response. The post could not be confirmed.",
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
        pendingApproval: storyCreateMatch.pendingApproval,
        actorId: storyCreateMatch.actorId,
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
        error: "Facebook did not provide a link to the post.",
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

function findStoryCreateResult(value: unknown):
  | {
      postId: string;
      url?: string;
      pendingApproval: boolean;
      actorId?: string;
    }
  | undefined {
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
    const defaultActor =
      story && isRecord(story.default_actor) ? story.default_actor : undefined;
    const actorId =
      defaultActor && typeof defaultActor.id === "string"
        ? defaultActor.id
        : undefined;
    const fallbackUrl = directUrl ?? storyUrl;
    const fallbackId = directPostId ?? storyId;
    const pendingApproval =
      Boolean(fallbackUrl?.includes("/pending_posts/")) ||
      Boolean(story?.if_viewer_can_learn_more_about_pending_post) ||
      Boolean(story?.to?.if_viewer_can_see_pending_post_in_mall);

    if (
      pendingApproval ||
      fallbackId ||
      (fallbackUrl &&
        (fallbackUrl.includes("/permalink/") ||
          fallbackUrl.includes("/posts/")))
    ) {
      return {
        postId: fallbackId ?? "unknown-story-id",
        url: fallbackUrl,
        pendingApproval,
        actorId,
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
  const normalized = responseText
    .replace(/\\u0020/gi, " ")
    .replace(/\\[nrt]/g, " ");
  return (
    FACEBOOK_RATE_LIMIT_ERROR_CODE_PATTERN.test(normalized) ||
    FACEBOOK_RATE_LIMIT_API_ERROR_CODE_PATTERN.test(normalized) ||
    FACEBOOK_POST_LIMIT_PATTERN.test(normalized) ||
    FACEBOOK_OTHER_POSTING_RESTRICTION_PATTERN.test(normalized)
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
        replayHeaders["x-fb-friendly-name"] ??
        postTemplate.formData.fb_api_req_friendly_name ??
        "ComposerStoryCreateMutation";
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

function notifyUiPostingStatus(
  partial: Omit<UiPostingStatusMessage, "type">,
): void {
  if (
    partial.status === "done" ||
    partial.status === "stopped" ||
    partial.status === "rate_limited"
  ) {
    finishQueueTimer(groupsPostingTimer);
  }
  const status: UiPostingStatusMessage = {
    type: "UI_POSTING_STATUS",
    successTarget: activePostingSuccessTarget,
    pendingCount: activePostingPendingCount,
    ...partial,
    timing: queueTimingSnapshot(groupsPostingTimer, partial.groupId),
  };

  latestUiPostingStatus = status;
  if (status.status === "done" || status.status === "stopped") {
    const { responseBody: _responseBody, ...storedStatus } = status;
    void chrome.storage.session.set({
      [LAST_GROUP_POSTING_STATUS_STORAGE_KEY]: storedStatus,
    });
  } else if (status.status === "rate_limited") {
    void chrome.storage.session.remove(LAST_GROUP_POSTING_STATUS_STORAGE_KEY);
  }
  void chrome.runtime.sendMessage(status);
}

function notifyPostingControlStatus(
  status: "posting" | "paused",
  message: string,
): void {
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
    processedCount: latest?.processedCount ?? 0,
  });
}

function sendContentPostingControl(
  type: "PAUSE_CREATE_POST" | "RESUME_CREATE_POST" | "STOP_CREATE_POST",
): void {
  if (activePostingTabId === undefined) {
    return;
  }

  void chrome.tabs.sendMessage(activePostingTabId, { type }).catch(() => {
    // The content helper is only present while the first post is being created.
  });
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
