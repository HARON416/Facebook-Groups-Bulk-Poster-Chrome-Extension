import {
  GROUPS_QUERY_FRIENDLY_NAME,
  JOINED_GROUPS_URL,
  type CreatePostRequest,
  type CreatePostResponse,
  type ExtensionRequest,
  type GeminiErrorPrompt,
  type FacebookGroup,
  type GroupExtractionStatusMessage,
  type MarketplaceItemPostingResponse,
  type MarketplaceItemPostingStatusMessage,
  type MarketplaceCleanupStatusMessage,
  type PostingTiming,
  type SimpleGroup,
  type StartMarketplaceItemPostingRequest,
  type StartUiPostingRequest,
  type UiPostImage,
  type UiPostingStatusMessage,
} from "./config";
import { AUTH_API_BASE_URL } from "./auth-config";

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

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
};

const POST_MUTATION_FRIENDLY_NAME = "ComposerStoryCreateMutation";
const MARKETPLACE_SELLING_PAGINATION_FRIENDLY_NAME =
  "MarketplaceYouSellingFastActiveSectionPaginationQuery";
const MARKETPLACE_DELETE_FRIENDLY_NAME =
  "useCometMarketplaceForSaleItemDeleteMutation";
const MARKETPLACE_DELETE_DOC_ID = "30073389588942699";
const UPLOAD_CANDIDATE_MATCHES = [
  "upload.facebook.com/ajax/react_composer/attachments/photo/upload",
  "www.facebook.com/ajax/react_composer/attachments/photo/upload",
  "web.facebook.com/ajax/react_composer/attachments/photo/upload",
  "/ajax/react_composer/attachments/photo/upload",
];
const GEMINI_API_KEY_STORAGE_KEYS = ["geminiApiKey", "GEMINI_API_KEY"] as const;
const GEMINI_REWRITE_ENABLED_STORAGE_KEY = "geminiRewriteEnabled";
const GEMINI_CUSTOM_PROMPT_STORAGE_KEY = "geminiCustomPrompt";
const GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY = "geminiIncludeHashtags";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 30_000;
const MIN_POSTING_DELAY_SECONDS = 60;
const AUTH_SESSION_STORAGE_KEY = "googleAuthSession";
const GROUP_STARTER_EXCLUSIONS_STORAGE_KEY = "balancedStarterExcludedGroupIds";
const LOG_PREFIX = "[Facebook Groups Bulk Poster]";

type PostingUsageKind = "group_post" | "marketplace_listing";

class PostingAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostingAccessError";
  }
}

class MissingFirstGroupComposerError extends Error {
  constructor(groupName: string) {
    super(
      `Postika could not find “Write something...” in ${groupName}. Start posting again and Postika will try another selected Group first.`,
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

async function updatePostingUsage(
  action: "claim" | "complete" | "release",
  kind: PostingUsageKind,
  operationId: string,
  facebookActorId?: string,
) {
  const sessionToken = await getKundiPostSessionToken();

  const response = await fetch(
    `${AUTH_API_BASE_URL}/api/posting-usage/${action}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind,
        operation_id: operationId,
        ...(action === "claim" && facebookActorId
          ? { facebook_actor_id: facebookActorId }
          : {}),
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    reset_at?: string;
    access?: import("./config").AccessEntitlements;
  };
  if (!response.ok) {
    const reset = payload.reset_at
      ? ` The next slot becomes available ${new Date(payload.reset_at).toLocaleString()}.`
      : "";
    throw new PostingAccessError(
      `${payload.error ?? "Unable to verify your posting allowance."}${reset}`,
    );
  }
  if (payload.access) {
    void chrome.runtime
      .sendMessage({
        type: "ACCESS_ENTITLEMENTS_UPDATED",
        access: payload.access,
      })
      .catch(() => undefined);
  }
}

async function getKundiPostSessionToken(): Promise<string> {
  const storage = await chrome.storage.local.get(AUTH_SESSION_STORAGE_KEY);
  const session = storage[AUTH_SESSION_STORAGE_KEY] as
    | { sessionToken?: unknown }
    | undefined;
  const sessionToken =
    typeof session?.sessionToken === "string"
      ? session.sessionToken.trim()
      : "";
  if (!sessionToken) {
    throw new PostingAccessError("Sign in with Google to continue posting.");
  }
  return sessionToken;
}

async function createBalancedGroupPostingPlan(
  groups: StartUiPostingRequest["groups"],
  facebookActorId: string,
  maximumPosts: number,
  failedGroupIds: string[],
  starterExcludedGroupIds: string[],
): Promise<StartUiPostingRequest["groups"]> {
  const sessionToken = await getKundiPostSessionToken();
  const response = await fetch(
    `${AUTH_API_BASE_URL}/api/group-posting-stats/plan`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        facebook_actor_id: facebookActorId,
        groups: groups.map(({ id, name }) => ({ id, name })),
        maximum_posts: maximumPosts,
        failed_group_ids: failedGroupIds,
        starter_excluded_group_ids: starterExcludedGroupIds,
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    plan?: StartUiPostingRequest["groups"];
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    if (payload.code === "no_eligible_balanced_group") {
      return [];
    }
    throw new PostingAccessError(
      payload.error ?? "Unable to create a balanced Group posting plan.",
    );
  }
  return payload.plan ?? [];
}

async function getGroupStarterExcludedIds(
  facebookActorId: string,
): Promise<string[]> {
  const actorKey = await hashLocalIdentifier(facebookActorId);
  const stored = await chrome.storage.session.get(
    GROUP_STARTER_EXCLUSIONS_STORAGE_KEY,
  );
  const exclusions = stored[GROUP_STARTER_EXCLUSIONS_STORAGE_KEY] as
    | Record<string, unknown>
    | undefined;
  const values = exclusions?.[actorKey];
  return Array.isArray(values)
    ? values.filter(
        (value): value is string =>
          typeof value === "string" && /^\d{5,32}$/.test(value),
      )
    : [];
}

async function rememberGroupStarterExclusion(
  facebookActorId: string,
  groupId: string,
): Promise<void> {
  const actorKey = await hashLocalIdentifier(facebookActorId);
  const stored = await chrome.storage.session.get(
    GROUP_STARTER_EXCLUSIONS_STORAGE_KEY,
  );
  const exclusions = {
    ...((stored[GROUP_STARTER_EXCLUSIONS_STORAGE_KEY] as
      | Record<string, unknown>
      | undefined) ?? {}),
  };
  const existing = Array.isArray(exclusions[actorKey])
    ? (exclusions[actorKey] as unknown[]).filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  exclusions[actorKey] = Array.from(new Set([...existing, groupId]));
  await chrome.storage.session.set({
    [GROUP_STARTER_EXCLUSIONS_STORAGE_KEY]: exclusions,
  });
}

function moveFirstAvailableStarterToFront(
  groups: StartUiPostingRequest["groups"],
  excludedGroupIds: string[],
): StartUiPostingRequest["groups"] {
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
    ...groups.slice(starterIndex + 1),
  ];
}

async function hashLocalIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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

async function recordAcceptedGroupPost(
  facebookActorId: string,
  group: StartUiPostingRequest["groups"][number],
  operationId: string,
): Promise<boolean> {
  const sessionToken = await getKundiPostSessionToken();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(
        `${AUTH_API_BASE_URL}/api/group-posting-stats/accepted`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            facebook_actor_id: facebookActorId,
            group_id: group.id,
            group_name: group.name,
            operation_id: operationId,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (response.ok) {
        return true;
      }
      if (response.status < 500 || attempt === 3) {
        debugWarn("Unable to update Group posting history.", {
          groupId: group.id,
          status: response.status,
          error: payload.error,
        });
        return false;
      }
    } catch (error) {
      if (attempt === 3) {
        debugWarn("Unable to update Group posting history.", {
          groupId: group.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }
  }
  return false;
}

async function claimPostingUsage(
  kind: PostingUsageKind,
  facebookActorId: string,
): Promise<string> {
  const operationId = crypto.randomUUID();
  await updatePostingUsage("claim", kind, operationId, facebookActorId);
  return operationId;
}

async function finalizePostingUsage(
  action: "complete" | "release",
  kind: PostingUsageKind,
  operationId: string,
) {
  try {
    await updatePostingUsage(action, kind, operationId);
  } catch (error) {
    console.warn(LOG_PREFIX, `Unable to ${action} posting allowance.`, error);
  }
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
    throw new PostingAccessError(
      "Open Facebook and sign in before starting a posting queue.",
    );
  }
  const cookie = await chrome.cookies.get({
    url: tab.url,
    name: "c_user",
  });
  const actorId = normalizeFacebookActorId(cookie?.value);
  if (!actorId) {
    throw new PostingAccessError(
      "Postika could not identify the Facebook account signed in to this Chrome profile. Refresh Facebook, sign in again, and retry.",
    );
  }
  return actorId;
}

const pendingRequests = new Map<string, PendingRequest>();

let capturedGroupsRequest: CapturedRequest | undefined;
let captureTabId: number | undefined;
let marketplaceCleanupCaptureTabId: number | undefined;
let capturedMarketplaceSellingRequest: CapturedRequest | undefined;
let marketplaceCleanupActive = false;
const marketplaceCleanupCompletions = new Map<
  string,
  (result: { ok: boolean; deletedCount?: number; error?: string }) => void
>();

let activePosting = false;
let activePostingSuccessTarget: number | undefined;
let activePostingPendingCount = 0;
let stopPostingRequested = false;
let pausePostingRequested = false;
let pauseNotificationSent = false;
type GeminiQueue = "groups" | "marketplace";
const geminiBypassed = { groups: false, marketplace: false };
const pendingGeminiPrompts = new Map<
  string,
  {
    prompt: GeminiErrorPrompt;
    resolve: (action: "continue" | "stop") => void;
  }
>();

function resolveGeminiPrompt(id: string, action: "continue" | "stop") {
  const pending = pendingGeminiPrompts.get(id);
  if (!pending) return false;
  pendingGeminiPrompts.delete(id);
  pending.resolve(action);
  return true;
}

async function handleGeminiFailure(
  queue: GeminiQueue,
  error: string,
): Promise<void> {
  const stopped = () =>
    queue === "groups" ? stopPostingRequested : marketplaceStopPostingRequested;
  if (stopped()) throw new Error(MANUAL_STOP_MESSAGE);
  const prompt: GeminiErrorPrompt = {
    type: "GEMINI_ERROR_PROMPT",
    id: crypto.randomUUID(),
    queue,
    error,
  };
  const decision = new Promise<"continue" | "stop">((resolve) => {
    pendingGeminiPrompts.set(prompt.id, { prompt, resolve });
  });
  const log = (message: string) => {
    if (queue === "groups" && latestUiPostingStatus) {
      notifyUiPostingStatus({
        ...latestUiPostingStatus,
        status: "posting",
        message,
      });
    } else if (queue === "marketplace" && latestMarketplacePostingStatus) {
      notifyMarketplaceItemPostingStatus({
        ...latestMarketplacePostingStatus,
        status: "posting",
        message,
      });
    }
  };
  log(`Gemini rewrite failed: ${error} Waiting for your choice.`);
  void chrome.runtime.sendMessage(prompt).catch(() => {});
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

let activeGeminiRequestController: AbortController | undefined;
let latestUiPostingStatus: UiPostingStatusMessage | undefined;
let activePostingTabId: number | undefined;
let postingCaptureTabId: number | undefined;
let capturedUploadTemplate: CapturedRequest | undefined;
let capturedPostTemplate: CapturedRequest | undefined;
let activeMarketplaceItemPosting = false;
let marketplaceStopPostingRequested = false;
let marketplacePausePostingRequested = false;
let latestMarketplacePostingStatus:
  | MarketplaceItemPostingStatusMessage
  | undefined;
let activeMarketplacePostingTabId: number | undefined;

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

let groupsPostingTimer: QueueTimer | undefined;
let marketplacePostingTimer: QueueTimer | undefined;

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
const LAST_GROUP_POSTING_STATUS_STORAGE_KEY = "lastGroupPostingStatus";
const LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY =
  "lastMarketplacePostingStatus";

// Older builds stored queue summaries durably. Remove those entries once so
// logs now follow the browser session rather than surviving a restart.
void chrome.storage.local.remove([
  LAST_GROUP_POSTING_STATUS_STORAGE_KEY,
  LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY,
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
    const shouldCaptureMarketplaceCleanup =
      marketplaceCleanupCaptureTabId !== undefined &&
      details.tabId === marketplaceCleanupCaptureTabId;

    if (
      !shouldCaptureGroups &&
      !shouldCapturePosting &&
      !shouldCaptureMarketplaceCleanup
    ) {
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
    const shouldCaptureMarketplaceCleanup =
      marketplaceCleanupCaptureTabId !== undefined &&
      details.tabId === marketplaceCleanupCaptureTabId;

    if (
      !shouldCaptureGroups &&
      !shouldCapturePosting &&
      !shouldCaptureMarketplaceCleanup
    ) {
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
    if (request.type === "RESOLVE_GEMINI_ERROR") {
      sendResponse({
        ok:
          (request.action === "continue" || request.action === "stop") &&
          resolveGeminiPrompt(request.id, request.action),
      });
      return false;
    }
    if (request.type === "GET_POSTING_QUEUE_STATUS") {
      void chrome.storage.session
        .get([
          LAST_GROUP_POSTING_STATUS_STORAGE_KEY,
          LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY,
        ])
        .then((storage) => {
          const storedGroups = storage[
            LAST_GROUP_POSTING_STATUS_STORAGE_KEY
          ] as UiPostingStatusMessage | undefined;
          const storedGroupsIsTransientError =
            storedGroups?.status === "rate_limited";
          if (storedGroupsIsTransientError) {
            void chrome.storage.session.remove(
              LAST_GROUP_POSTING_STATUS_STORAGE_KEY,
            );
          }
          const currentGroups =
            latestUiPostingStatus &&
            (activePosting || latestUiPostingStatus.status !== "rate_limited")
              ? {
                  ...latestUiPostingStatus,
                  timing:
                    queueTimingSnapshot(
                      groupsPostingTimer,
                      latestUiPostingStatus.groupId,
                    ) ?? latestUiPostingStatus.timing,
                }
              : undefined;
          sendResponse({
            geminiPrompts: Array.from(
              pendingGeminiPrompts.values(),
              ({ prompt }) => prompt,
            ),
            groups:
              currentGroups ??
              (storedGroupsIsTransientError ? undefined : storedGroups),
            marketplace: latestMarketplacePostingStatus
              ? {
                  ...latestMarketplacePostingStatus,
                  timing:
                    queueTimingSnapshot(
                      marketplacePostingTimer,
                      latestMarketplacePostingStatus.listingId,
                    ) ?? latestMarketplacePostingStatus.timing,
                }
              : storage[LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY],
          });
        });
      return true;
    }

    if (request.type === "MARKETPLACE_CLEANUP_FINISHED") {
      marketplaceCleanupCompletions.get(request.runId)?.({
        ok: request.ok,
        deletedCount: request.deletedCount,
        error: request.error,
      });
      sendResponse({ ok: true });
      return false;
    }

    if (request.type === "MARKETPLACE_SELLING_REQUEST_CAPTURED") {
      if (
        marketplaceCleanupCaptureTabId !== undefined &&
        request.request.body
      ) {
        capturedMarketplaceSellingRequest = {
          ...request.request,
          formData: formDataFromBody(request.request.body, {}),
        };
        debugLog("Captured raw Marketplace request from the Facebook page.", {
          url: request.request.url,
        });
      }
      sendResponse({ ok: true });
      return false;
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
      if (activePosting) {
        sendResponse({
          ok: false,
          error: "A posting queue is already running.",
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
          error: "Another Facebook posting action is already running.",
        });
        return false;
      }
      activeMarketplaceItemPosting = true;
      marketplaceStopPostingRequested = false;
      marketplacePausePostingRequested = false;
      void runMarketplaceItemPostingQueue(request)
        .catch((error: unknown) => {
          notifyMarketplaceItemPostingStatus({
            status: "done",
            message: "Marketplace posting queue stopped.",
            current: 0,
            total: request.listings.length,
            successCount: 0,
            failedCount: request.listings.length,
            error:
              error instanceof Error
                ? error.message
                : "Unable to run Marketplace posting queue.",
          });
        })
        .finally(() => {
          activeMarketplaceItemPosting = false;
          marketplaceStopPostingRequested = false;
          marketplacePausePostingRequested = false;
          activeMarketplacePostingTabId = undefined;
        });
      sendResponse({ ok: true });
      return false;
    }

    if (request.type === "DELETE_OLD_MARKETPLACE_LISTINGS") {
      if (
        marketplaceCleanupActive ||
        activeMarketplaceItemPosting ||
        activePosting
      ) {
        sendResponse({
          ok: false,
          error:
            "Another Facebook posting or cleanup action is already running.",
        });
        return false;
      }
      if (!Number.isSafeInteger(request.daysOld) || request.daysOld < 0) {
        sendResponse({
          ok: false,
          error: "Days old must be a whole number of 0 or greater.",
        });
        return false;
      }
      marketplaceCleanupActive = true;
      void runMarketplaceCleanupInSellingPage(request.daysOld)
        .catch((error: unknown) => {
          notifyMarketplaceCleanupStatus({
            status: "failed",
            message: "Marketplace cleanup failed.",
            processed: 0,
            total: 0,
            deletedCount: 0,
            failedCount: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          marketplaceCleanupActive = false;
          marketplaceCleanupCaptureTabId = undefined;
          capturedMarketplaceSellingRequest = undefined;
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
        "Stopping Marketplace posting after the current Facebook action…",
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
        "Marketplace posting paused.",
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
        "Marketplace posting resumed.",
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
        "Stopping posting after the current Facebook action finishes...",
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

  if (
    tabId === marketplaceCleanupCaptureTabId &&
    friendlyName === MARKETPLACE_SELLING_PAGINATION_FRIENDLY_NAME &&
    body.length > 0
  ) {
    capturedMarketplaceSellingRequest = {
      url: pending.url,
      method: pending.method,
      body,
      headers: pending.headers,
      formData: formDataFromBody(body, formData),
    };
    debugLog("Captured Marketplace selling pagination request.", {
      url: pending.url,
      friendlyName,
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

async function prepareMarketplacePostingPage(
  listing: StartMarketplaceItemPostingRequest["listings"][number],
): Promise<number> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab?.id || !isFacebookUrl(activeTab.url)) {
    throw new Error("Open Facebook in the active tab before posting an item.");
  }

  const tabId = activeTab.id;
  activeMarketplacePostingTabId = tabId;
  const createPath =
    listing.listingType === "vehicle"
      ? "/marketplace/create/vehicle"
      : "/marketplace/create/item";
  await chrome.tabs.update(tabId, {
    url: `https://www.facebook.com${createPath}`,
  });
  await waitForPageDomReady(tabId, createPath);
  await waitWhileMarketplacePostingPaused();
  throwIfMarketplacePostingStopped();
  await sleep(1_500);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["dist/marketplace-item.js"],
  });
  await waitWhileMarketplacePostingPaused();
  throwIfMarketplacePostingStopped();

  return tabId;
}

async function showMarketplaceDescriptionGenerating(tabId: number) {
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: "SHOW_MARKETPLACE_DESCRIPTION_GENERATING",
  })) as MarketplaceItemPostingResponse | undefined;
  if (!response?.ok) {
    console.info(
      LOG_PREFIX,
      response?.error ??
        "Facebook's Description field is unavailable; continuing AI rewrite.",
    );
  }
}

async function runMarketplaceItemPosting(
  listing: StartMarketplaceItemPostingRequest["listings"][number],
  tabId: number,
  shareToSuggestedGroups: boolean,
): Promise<MarketplaceItemPostingResponse> {
  const response = await withTimeout(
    chrome.tabs.sendMessage(tabId, {
      type:
        listing.listingType === "vehicle"
          ? "CREATE_MARKETPLACE_VEHICLE_LISTING"
          : "CREATE_MARKETPLACE_ITEM_LISTING",
      listing,
      shareToSuggestedGroups,
    }),
    300_000,
    "Marketplace listing posting timed out.",
  );
  const result = response as MarketplaceItemPostingResponse | undefined;
  if (!result?.ok) {
    throw new Error(result?.error ?? "Unable to publish Marketplace item.");
  }
  return result;
}

async function runMarketplaceItemPostingQueue(
  request: StartMarketplaceItemPostingRequest,
): Promise<void> {
  const listings = request.listings;
  const total = listings.length;
  if (total === 0) {
    throw new Error("Select at least one Marketplace item before posting.");
  }

  geminiBypassed.marketplace = false;
  marketplacePostingTimer = createQueueTimer(request.startedAt);
  latestMarketplacePostingStatus = undefined;
  void chrome.storage.session.remove(
    LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY,
  );

  const minimumDelaySeconds = Math.max(
    MIN_POSTING_DELAY_SECONDS,
    Math.floor(request.minimumDelaySeconds),
  );
  const maximumDelaySeconds = Math.max(
    minimumDelaySeconds,
    Math.floor(request.maximumDelaySeconds),
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
        failedCount,
      });
      return;
    }
    const listing = listings[index];
    const listingTitle = marketplacePostingListingTitle(listing);
    const current = index + 1;
    notifyMarketplaceItemPostingStatus({
      status: "preparing",
      message: `Preparing “${listingTitle}”…`,
      current,
      total,
      listingId: listing.id,
      listingTitle,
      successCount,
      failedCount,
    });

    let postingUsageOperationId: string | undefined;
    try {
      await waitWhileMarketplacePostingPaused();
      throwIfMarketplacePostingStopped();
      const tabId = await prepareMarketplacePostingPage(listing);
      if (request.rewriteDescriptions) {
        notifyMarketplaceItemPostingStatus({
          status: "preparing",
          message: `Generating description with Gemini AI for “${listingTitle}”…`,
          current,
          total,
          listingId: listing.id,
          listingTitle,
          successCount,
          failedCount,
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
          destination: `Facebook Marketplace ${listing.listingType}`,
        },
      );
      notifyMarketplaceItemPostingStatus({
        status: "posting",
        message: `Posting “${listingTitle}” (${current}/${total})…`,
        current,
        total,
        listingId: listing.id,
        listingTitle,
        successCount,
        failedCount,
      });
      await waitWhileMarketplacePostingPaused();
      throwIfMarketplacePostingStopped();
      const facebookActorId = await getFacebookActorId(tabId);
      postingUsageOperationId = await claimPostingUsage(
        "marketplace_listing",
        facebookActorId,
      );
      await runMarketplaceItemPosting(
        { ...listing, description },
        tabId,
        request.shareToSuggestedGroups,
      );
      await finalizePostingUsage(
        "complete",
        "marketplace_listing",
        postingUsageOperationId,
      );
      postingUsageOperationId = undefined;
      throwIfMarketplacePostingStopped();
      successCount += 1;
      notifyMarketplaceItemPostingStatus({
        status: "posted",
        message: `Posted “${listingTitle}” (${current}/${total}).`,
        current,
        total,
        listingId: listing.id,
        listingTitle,
        successCount,
        failedCount,
      });
    } catch (error) {
      if (postingUsageOperationId) {
        await finalizePostingUsage(
          "release",
          "marketplace_listing",
          postingUsageOperationId,
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
          failedCount,
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
          error: error.message,
        });
        return;
      }
      failedCount += 1;
      notifyMarketplaceItemPostingStatus({
        status: "failed",
        message: `Failed to post “${listingTitle}” (${current}/${total}).`,
        current,
        total,
        listingId: listing.id,
        listingTitle,
        successCount,
        failedCount,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (current < total) {
      const waitSeconds = randomIntegerBetween(
        minimumDelaySeconds,
        maximumDelaySeconds,
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
            failedCount,
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
          waitSeconds: remaining,
        });
        await sleep(1_000);
      }
    }
  }

  notifyMarketplaceItemPostingStatus({
    status: "done",
    message: `Marketplace queue complete: ${successCount} posted, ${failedCount} failed.`,
    current: total,
    total,
    successCount,
    failedCount,
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

function marketplacePostingListingTitle(
  listing: StartMarketplaceItemPostingRequest["listings"][number],
) {
  return listing.listingType === "item"
    ? listing.title
    : [listing.year, listing.make, listing.model].filter(Boolean).join(" ");
}

type RemoteMarketplaceListing = {
  id: string;
  title: string;
  creationTime: number;
};

function notifyMarketplaceCleanupStatus(
  partial: Omit<MarketplaceCleanupStatusMessage, "type">,
) {
  void chrome.runtime.sendMessage({
    type: "MARKETPLACE_CLEANUP_STATUS",
    ...partial,
  } satisfies MarketplaceCleanupStatusMessage);
}

function installMarketplaceCaptureBridge() {
  const eventName = "__bulk_poster_marketplace_graphql_captured__";
  const globalState = globalThis as typeof globalThis & {
    __bulkPosterMarketplaceCaptureBridge?: boolean;
  };
  if (globalState.__bulkPosterMarketplaceCaptureBridge) return;
  globalState.__bulkPosterMarketplaceCaptureBridge = true;
  window.addEventListener(eventName, (event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (!detail) return;
    try {
      const request = JSON.parse(detail) as {
        url: string;
        method: string;
        headers: Record<string, string>;
        body: string;
      };
      void chrome.runtime.sendMessage({
        type: "MARKETPLACE_SELLING_REQUEST_CAPTURED",
        request,
      });
    } catch {
      // Ignore malformed page events and keep waiting for the next request.
    }
  });
}

function installMarketplaceGraphqlCaptureInPage() {
  const targetFriendlyName =
    "MarketplaceYouSellingFastActiveSectionPaginationQuery";
  const eventName = "__bulk_poster_marketplace_graphql_captured__";
  const pageWindow = window as typeof window & {
    __bulkPosterRestoreMarketplaceCapture?: () => void;
  };
  pageWindow.__bulkPosterRestoreMarketplaceCapture?.();

  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  let restored = false;

  const headersToObject = (headersLike: HeadersInit | undefined) => {
    const headers: Record<string, string> = {};
    try {
      new Headers(headersLike ?? {}).forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    } catch {
      // Facebook may pass an opaque headers object; the body remains usable.
    }
    return headers;
  };
  const bodyToText = async (
    bodyLike: BodyInit | null | undefined,
    request: Request | null,
  ) => {
    if (typeof bodyLike === "string") return bodyLike;
    if (bodyLike instanceof URLSearchParams) return bodyLike.toString();
    if (bodyLike instanceof FormData)
      return new URLSearchParams(
        Array.from(bodyLike.entries()).map(([key, value]) => [
          key,
          String(value),
        ]),
      ).toString();
    if (request) {
      try {
        return await request.clone().text();
      } catch {
        return "";
      }
    }
    return "";
  };
  const restore = () => {
    if (restored) return;
    restored = true;
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalXhrOpen;
    XMLHttpRequest.prototype.setRequestHeader = originalXhrSetRequestHeader;
    XMLHttpRequest.prototype.send = originalXhrSend;
    delete pageWindow.__bulkPosterRestoreMarketplaceCapture;
  };
  pageWindow.__bulkPosterRestoreMarketplaceCapture = restore;
  const restoreTimeout = window.setTimeout(restore, 60_000);
  const isTargetRequest = (
    url: string,
    headers: Record<string, string>,
    bodyText: string,
  ) => {
    if (!url.includes("/api/graphql")) return false;
    if (headers["x-fb-friendly-name"] === targetFriendlyName) return true;
    const body = new URLSearchParams(bodyText);
    return (
      body.get("fb_api_req_friendly_name") === targetFriendlyName ||
      bodyText.includes(targetFriendlyName)
    );
  };
  const capture = (request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  }) => {
    window.clearTimeout(restoreTimeout);
    restore();
    window.dispatchEvent(
      new CustomEvent(eventName, { detail: JSON.stringify(request) }),
    );
  };

  window.fetch = async function (...args) {
    const [input, init = {}] = args;
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input ?? "");
    const headers = {
      ...headersToObject(request?.headers),
      ...headersToObject(init.headers),
    };
    const body = await bodyToText(init.body, request);
    const response = await originalFetch.apply(this, args);
    if (isTargetRequest(url, headers, body)) {
      capture({
        url,
        method: init.method ?? request?.method ?? "GET",
        headers,
        body,
      });
    }
    return response;
  };

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    (
      this as XMLHttpRequest & { __bulkPosterCapture?: any }
    ).__bulkPosterCapture = {
      method,
      url: String(url),
      headers: {},
    };
    if (async === undefined) {
      return (originalXhrOpen as Function).call(this, method, url);
    }
    return (originalXhrOpen as Function).call(
      this,
      method,
      url,
      async,
      username,
      password,
    );
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const request = (this as XMLHttpRequest & { __bulkPosterCapture?: any })
      .__bulkPosterCapture;
    if (request) request.headers[name.toLowerCase()] = value;
    return originalXhrSetRequestHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (bodyLike) {
    const request = (this as XMLHttpRequest & { __bulkPosterCapture?: any })
      .__bulkPosterCapture;
    const body =
      typeof bodyLike === "string"
        ? bodyLike
        : bodyLike instanceof URLSearchParams
          ? bodyLike.toString()
          : "";
    if (request && isTargetRequest(request.url, request.headers, body)) {
      capture({ ...request, body });
    }
    return originalXhrSend.call(this, bodyLike);
  };
}

async function runMarketplaceCleanupInSellingPage(daysOld: number) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isFacebookUrl(tab.url)) {
    throw new Error("Open Facebook in the active tab before cleanup.");
  }
  const sellingUrl =
    "https://www.facebook.com/marketplace/you/selling?action=delete";
  notifyMarketplaceCleanupStatus({
    status: "preparing",
    message: "Opening your Facebook Marketplace selling listings…",
    processed: 0,
    total: 0,
    deletedCount: 0,
    failedCount: 0,
  });
  capturedMarketplaceSellingRequest = undefined;
  marketplaceCleanupCaptureTabId = tab.id;
  await navigateTabAndWaitForComplete(
    tab.id,
    sellingUrl,
    "/marketplace/you/selling",
  );

  const capturedDuringLoad = Boolean(capturedMarketplaceSellingRequest);
  const needsFallback = !capturedMarketplaceSellingRequest;

  if (needsFallback) {
    notifyMarketplaceCleanupStatus({
      status: "scanning",
      message: "Scrolling Marketplace to capture the active listings request…",
      processed: 0,
      total: 0,
      deletedCount: 0,
      failedCount: 0,
    });
    await scrollForMarketplaceCleanupRequest(tab.id);
  }

  debugLog("Marketplace cleanup capture completed.", {
    capturedDuringLoad,
    captured: Boolean(capturedMarketplaceSellingRequest),
  });
  marketplaceCleanupCaptureTabId = undefined;
  const activeSession = capturedMarketplaceSellingRequest
    ? marketplaceSessionFromCapturedRequest(capturedMarketplaceSellingRequest)
    : undefined;
  const refreshedTab = await chrome.tabs.get(tab.id);
  const refreshedUrl = new URL(refreshedTab.url ?? "");
  if (
    refreshedUrl.pathname !== "/marketplace/you/selling" ||
    refreshedUrl.searchParams.get("action") !== "delete"
  ) {
    throw new Error(`Marketplace cleanup only works on ${sellingUrl}`);
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["dist/marketplace-cleanup.js"],
  });
  if (!activeSession) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      files: ["marketplace-graphql-capture.js"],
    });
  }
  const runId = crypto.randomUUID();
  const completion = new Promise<{
    ok: boolean;
    deletedCount?: number;
    error?: string;
  }>((resolve) => {
    marketplaceCleanupCompletions.set(runId, resolve);
  });
  try {
    const response = (await chrome.tabs.sendMessage(tab.id, {
      type: "RUN_MARKETPLACE_CLEANUP_IN_PAGE",
      runId,
      daysOld,
      activeSession,
    })) as MarketplaceItemPostingResponse | undefined;
    if (!response?.ok) {
      throw new Error(
        response?.error ?? "Marketplace cleanup did not start in the page.",
      );
    }
    const result = await withTimeout(
      completion,
      20 * 60 * 1_000,
      "Marketplace cleanup timed out.",
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

async function scrollForMarketplaceCleanupRequest(
  tabId: number,
): Promise<void> {
  let stableBottomPasses = 0;
  let previousHeight = -1;

  while (true) {
    if (capturedMarketplaceSellingRequest) return;

    const [scrollResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const scrollingElement =
          document.scrollingElement ?? document.documentElement;
        const height = scrollingElement.scrollHeight;
        window.scrollTo({ top: height, behavior: "auto" });
        return { height };
      },
    });

    await sleep(1_500);

    const [metricsResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const scrollingElement =
          document.scrollingElement ?? document.documentElement;
        return {
          top: scrollingElement.scrollTop,
          height: scrollingElement.scrollHeight,
          viewportHeight: scrollingElement.clientHeight,
        };
      },
    });
    const metrics = metricsResult?.result;
    if (!metrics) continue;

    const atBottom = metrics.top + metrics.viewportHeight >= metrics.height - 4;
    const heightDidNotGrow =
      previousHeight === metrics.height ||
      scrollResult?.result?.height === metrics.height;
    stableBottomPasses =
      atBottom && heightDidNotGrow ? stableBottomPasses + 1 : 0;
    previousHeight = metrics.height;

    // Facebook can render a section before issuing its pagination request, so
    // allow several settled passes at the final scroll position before deciding
    // that the selected section did not expose a reusable GraphQL request.
    if (stableBottomPasses >= 5) return;
  }
}

function marketplaceSessionFromCapturedRequest(request: CapturedRequest) {
  const body = new URLSearchParams(request.body);
  const value = (name: string) =>
    body.get(name) ?? request.formData[name] ?? "";
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
    docId: value("doc_id"),
  };
}

async function deleteOldMarketplaceListings(daysOld: number) {
  notifyMarketplaceCleanupStatus({
    status: "preparing",
    message: "Opening your Facebook Marketplace selling listings…",
    processed: 0,
    total: 0,
    deletedCount: 0,
    failedCount: 0,
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isFacebookUrl(tab.url)) {
    throw new Error("Open Facebook in the active tab before cleanup.");
  }

  capturedMarketplaceSellingRequest = undefined;
  marketplaceCleanupCaptureTabId = tab.id;
  await chrome.tabs.update(tab.id, {
    url: "https://www.facebook.com/marketplace/you/selling",
  });
  await waitForTabComplete(tab.id, "/marketplace/you/selling");
  notifyMarketplaceCleanupStatus({
    status: "scanning",
    message: "Loading Marketplace listings and capturing pagination…",
    processed: 0,
    total: 0,
    deletedCount: 0,
    failedCount: 0,
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: installMarketplaceCaptureBridge,
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: installMarketplaceGraphqlCaptureInPage,
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const globalState = globalThis as typeof globalThis & {
        __marketplaceCleanupScrollTimer?: number;
      };
      if (globalState.__marketplaceCleanupScrollTimer) {
        clearInterval(globalState.__marketplaceCleanupScrollTimer);
      }
      globalState.__marketplaceCleanupScrollTimer = window.setInterval(() => {
        window.scrollBy({ top: 900, behavior: "smooth" });
      }, 1_500);
    },
  });

  let capturedRequest: CapturedRequest;
  try {
    const captured = await waitForMarketplaceSellingRequest();
    if (!captured) {
      notifyMarketplaceCleanupStatus({
        status: "warning",
        message:
          "Not enough listings to trigger Facebook pagination. Cleanup was not performed.",
        processed: 0,
        total: 0,
        deletedCount: 0,
        failedCount: 0,
        error:
          "Facebook only provides the required pagination request when more listings are available to load.",
      });
      return;
    }
    capturedRequest = captured;
  } finally {
    marketplaceCleanupCaptureTabId = undefined;
    await chrome.scripting
      .executeScript({
        target: { tabId: tab.id },
        func: () => {
          const globalState = globalThis as typeof globalThis & {
            __marketplaceCleanupScrollTimer?: number;
          };
          if (globalState.__marketplaceCleanupScrollTimer) {
            clearInterval(globalState.__marketplaceCleanupScrollTimer);
            delete globalState.__marketplaceCleanupScrollTimer;
          }
        },
      })
      .catch(() => undefined);
  }

  const listings = await fetchAllMarketplaceSellingListings(capturedRequest);
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1_000;
  const oldListings = listings.filter((listing) => {
    const timestampMs =
      listing.creationTime < 1_000_000_000_000
        ? listing.creationTime * 1_000
        : listing.creationTime;
    return timestampMs < cutoff;
  });

  if (oldListings.length === 0) {
    notifyMarketplaceCleanupStatus({
      status: "done",
      message: `No Marketplace listings older than ${daysOld} ${daysOld === 1 ? "day" : "days"} were found.`,
      processed: 0,
      total: 0,
      deletedCount: 0,
      failedCount: 0,
    });
    return;
  }

  let deletedCount = 0;
  let failedCount = 0;
  for (let index = 0; index < oldListings.length; index += 1) {
    const listing = oldListings[index];
    if (!listing) continue;
    const processed = index + 1;
    notifyMarketplaceCleanupStatus({
      status: "deleting",
      message: `Deleting “${listing.title || "Untitled listing"}” (${processed}/${oldListings.length})…`,
      processed: index,
      total: oldListings.length,
      deletedCount,
      failedCount,
      listingId: listing.id,
      listingTitle: listing.title,
    });
    try {
      await deleteRemoteMarketplaceListing(capturedRequest, listing.id);
      deletedCount += 1;
      notifyMarketplaceCleanupStatus({
        status: "deleted",
        message: `Deleted “${listing.title || "Untitled listing"}”.`,
        processed,
        total: oldListings.length,
        deletedCount,
        failedCount,
        listingId: listing.id,
        listingTitle: listing.title,
      });
      await sleep(500);
    } catch (error) {
      failedCount += 1;
      notifyMarketplaceCleanupStatus({
        status: "failed",
        message: `Failed to delete “${listing.title || "Untitled listing"}”.`,
        processed,
        total: oldListings.length,
        deletedCount,
        failedCount,
        listingId: listing.id,
        listingTitle: listing.title,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(750);
    }
  }

  notifyMarketplaceCleanupStatus({
    status: "done",
    message: `Marketplace cleanup complete: ${deletedCount} deleted, ${failedCount} failed.`,
    processed: oldListings.length,
    total: oldListings.length,
    deletedCount,
    failedCount,
  });
}

async function waitForMarketplaceSellingRequest() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (capturedMarketplaceSellingRequest) {
      return capturedMarketplaceSellingRequest;
    }
    await sleep(250);
  }
  return undefined;
}

function marketplaceReplayHeaders(request: CapturedRequest): HeadersInit {
  const body = new URLSearchParams(request.body);
  return {
    accept: request.headers.accept ?? "*/*",
    "content-type": "application/x-www-form-urlencoded",
    "x-asbd-id": request.headers["x-asbd-id"] ?? "359341",
    "x-fb-friendly-name": MARKETPLACE_SELLING_PAGINATION_FRIENDLY_NAME,
    "x-fb-lsd":
      request.headers["x-fb-lsd"] ??
      body.get("lsd") ??
      request.formData.lsd ??
      "",
  };
}

function parseFacebookGraphqlResponses(text: string): any[] {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/^for \(;;\);/, ""))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function findMarketplaceListingConnections(value: unknown): any[] {
  const connections: any[] = [];
  const connectionSet = new Set<object>();
  const visited = new Set<object>();
  const addConnection = (connection: object) => {
    if (!connectionSet.has(connection)) {
      connectionSet.add(connection);
      connections.push(connection);
    }
  };

  const visit = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") return;
    if (visited.has(candidate)) return;
    visited.add(candidate);

    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }

    const record = candidate as Record<string, unknown>;
    const namedConnection = record.marketplace_listing_sets;
    if (
      namedConnection &&
      typeof namedConnection === "object" &&
      Array.isArray((namedConnection as { edges?: unknown[] }).edges)
    ) {
      addConnection(namedConnection);
    }

    if (
      Array.isArray(record.edges) &&
      record.edges.some(
        (edge: any) => edge?.node?.first_listing?.id !== undefined,
      )
    ) {
      addConnection(record);
    }

    Object.values(record).forEach(visit);
  };

  visit(value);
  return connections;
}

async function fetchAllMarketplaceSellingListings(request: CapturedRequest) {
  const listings = new Map<string, RemoteMarketplaceListing>();
  const originalBody = new URLSearchParams(request.body);
  const originalVariables = JSON.parse(
    originalBody.get("variables") ?? "{}",
  ) as Record<string, unknown>;
  const capturedCount = Number(originalVariables.count);
  const count = Number.isFinite(capturedCount) ? capturedCount : 10;
  let cursor: string | null = null;

  for (let page = 1; page <= 1_000; page += 1) {
    const body = new URLSearchParams(request.body);
    const variables: Record<string, unknown> = {
      ...originalVariables,
      count,
      order:
        typeof originalVariables.order === "string"
          ? originalVariables.order
          : "CREATION_TIMESTAMP_DESC",
    };
    if (cursor) variables.cursor = cursor;
    else delete variables.cursor;
    body.set("variables", JSON.stringify(variables));
    body.set("__spin_t", String(Math.floor(Date.now() / 1_000)));

    const response = await fetch(request.url, {
      method: "POST",
      credentials: "include",
      headers: marketplaceReplayHeaders(request),
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(
        `Facebook listings request failed with HTTP ${response.status}.`,
      );
    }
    const responseText = await response.text();
    const payloads = parseFacebookGraphqlResponses(responseText);
    const errors = payloads.flatMap((payload) =>
      Array.isArray(payload?.errors) ? payload.errors : [],
    );
    if (errors.length > 0) {
      throw new Error(
        errors[0]?.message ?? "Facebook rejected the listings request.",
      );
    }
    const connections = payloads.flatMap(findMarketplaceListingConnections);
    if (connections.length === 0) {
      const dataKeys = payloads.flatMap((payload) =>
        payload?.data && typeof payload.data === "object"
          ? Object.keys(payload.data)
          : [],
      );
      throw new Error(
        `Facebook returned an unrecognized Marketplace listings response${dataKeys.length > 0 ? ` (data: ${dataKeys.join(", ")})` : ""}.`,
      );
    }
    const edges = connections.flatMap((connection) =>
      Array.isArray(connection?.edges) ? connection.edges : [],
    );
    for (const edge of edges) {
      const listing = edge?.node?.first_listing;
      if (!listing?.id) continue;
      listings.set(listing.id, {
        id: listing.id,
        title: listing.marketplace_listing_title ?? "Untitled listing",
        creationTime: Number(listing.creation_time ?? 0),
      });
    }
    notifyMarketplaceCleanupStatus({
      status: "scanning",
      message: `Scanned Marketplace page ${page}: ${listings.size} listings found…`,
      processed: listings.size,
      total: 0,
      deletedCount: 0,
      failedCount: 0,
    });
    const nextCursor = edges[edges.length - 1]?.cursor ?? null;
    const hasMore = edges.length === count;
    if (!hasMore || !nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
    await sleep(500);
  }
  return Array.from(listings.values());
}

async function deleteRemoteMarketplaceListing(
  request: CapturedRequest,
  listingId: string,
) {
  const source = new URLSearchParams(request.body);
  const userId = source.get("av") ?? source.get("__user") ?? "";
  if (!userId)
    throw new Error("Facebook user ID was missing from the captured request.");
  const variables = {
    input: {
      actor_id: userId,
      client_mutation_id: "1",
      batch_delete_variants: true,
      for_sale_item_id: listingId,
      referral_surface: null,
      surface: "MARKETPLACE_PAGE_SELLING",
    },
  };
  const body = new URLSearchParams({
    av: userId,
    __aaid: source.get("__aaid") ?? "0",
    __user: userId,
    __a: "1",
    __req: "1",
    __hs: source.get("__hs") ?? "",
    dpr: source.get("dpr") ?? "1",
    __ccg: "EXCELLENT",
    __rev: source.get("__rev") ?? "",
    __s: source.get("__s") ?? "",
    __hsi: source.get("__hsi") ?? "",
    __crn: "comet.fbweb.MarketplaceSellingUIMRoute",
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: MARKETPLACE_DELETE_FRIENDLY_NAME,
    server_timestamps: "true",
    variables: JSON.stringify(variables),
    doc_id: MARKETPLACE_DELETE_DOC_ID,
    fb_dtsg: source.get("fb_dtsg") ?? "",
    jazoest: source.get("jazoest") ?? "",
    lsd: source.get("lsd") ?? "",
    __spin_r: source.get("__spin_r") ?? source.get("__rev") ?? "",
    __spin_b: source.get("__spin_b") ?? "trunk",
    __spin_t: String(Math.floor(Date.now() / 1_000)),
  });
  const response = await fetch("https://www.facebook.com/api/graphql/", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
      "x-asbd-id": request.headers["x-asbd-id"] ?? "359341",
      "x-fb-friendly-name": MARKETPLACE_DELETE_FRIENDLY_NAME,
      "x-fb-lsd": source.get("lsd") ?? "",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(
      `Facebook delete request failed with HTTP ${response.status}.`,
    );
  }
  const payloads = parseFacebookGraphqlResponses(await response.text());
  const errors = payloads.flatMap((payload) =>
    Array.isArray(payload?.errors) ? payload.errors : [],
  );
  if (errors.length > 0) {
    throw new Error(
      errors[0]?.message ?? "Facebook rejected the delete request.",
    );
  }
  const confirmed = payloads.some(
    (payload) =>
      payload?.data?.commerce_for_sale_item_delete?.deleted_for_sale_item_id ===
      listingId,
  );
  if (!confirmed) {
    throw new Error("Facebook did not confirm deletion of this listing.");
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

  throwIfPostingStopped();
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
  const requestedMaxPosts = Number.isInteger(request.maxPosts)
    ? Math.max(request.maxPosts, 1)
    : request.groups.length;
  const balancedPosting = request.postingStrategy === "balanced";
  const maxPosts = requestedMaxPosts;
  const selectedGroups = request.groups;
  let groups = selectedGroups;
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
    requestedGroups: request.groups.length,
    groups: groups.length,
    maxPosts,
    posts: posts.length,
    images: posts.reduce((count, post) => count + post.images.length, 0),
    minimumDelaySeconds,
    maximumDelaySeconds,
    rotationStartedWithImagePost: firstPostWithImagesIndex > 0,
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
      error: "Wait for the current queue to finish before starting another.",
    });
    return;
  }

  activePosting = true;
  geminiBypassed.groups = false;
  groupsPostingTimer = createQueueTimer(request.startedAt);
  void chrome.storage.session.remove(LAST_GROUP_POSTING_STATUS_STORAGE_KEY);
  activePostingSuccessTarget = maxPosts;
  activePostingPendingCount = 0;
  latestUiPostingStatus = undefined;
  stopPostingRequested = false;
  pausePostingRequested = false;
  pauseNotificationSent = false;
  let successCount = 0;
  let failedCount = 0;
  const failedBalancedGroupIds = new Set<string>();
  const total = balancedPosting ? maxPosts : groups.length;
  let postingTabId: number | undefined;

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
      await getGroupStarterExcludedIds(facebookActorId),
    );
    if (balancedPosting) {
      groups = await createBalancedGroupPostingPlan(
        selectedGroups,
        facebookActorId,
        maxPosts,
        [],
        Array.from(starterExcludedGroupIds),
      );
      if (groups.length === 0) {
        throw new Error(
          "None of the selected Groups can start posting in this browser session. Select another standard Group with a visible “Write something...” button.",
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
        successTarget: maxPosts,
      });
    } else {
      groups = moveFirstAvailableStarterToFront(
        selectedGroups,
        Array.from(starterExcludedGroupIds),
      );
      if (groups.length === 0) {
        throw new Error(
          "None of the selected Groups can start posting in this browser session. Select another standard Group with a visible “Write something...” button.",
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
      processedCount: 0,
    });
    const firstPostBody = await maybeRewriteDescription(posts[0].body);
    throwIfPostingStopped();

    let firstPostingUsageOperationId = "";
    let templates: Awaited<ReturnType<typeof ensurePostingTemplates>>;
    while (true) {
      firstPostingUsageOperationId = await claimPostingUsage(
        "group_post",
        facebookActorId,
      );
      try {
        templates = await ensurePostingTemplates(
          postingTabId,
          groups,
          posts[0].body,
          firstPostBody,
          posts[0].images,
          total,
        );
        break;
      } catch (error) {
        await finalizePostingUsage(
          "release",
          "group_post",
          firstPostingUsageOperationId,
        );
        if (!isMissingFirstGroupComposerError(error)) {
          throw error;
        }

        const incompatibleStarter = groups[0];
        starterExcludedGroupIds.add(incompatibleStarter.id);
        try {
          await rememberGroupStarterExclusion(
            facebookActorId,
            incompatibleStarter.id,
          );
        } catch (storageError) {
          debugWarn("Unable to remember the incompatible starter Group.", {
            groupId: incompatibleStarter.id,
            error:
              storageError instanceof Error
                ? storageError.message
                : String(storageError),
          });
        }

        groups = balancedPosting
          ? await createBalancedGroupPostingPlan(
              selectedGroups,
              facebookActorId,
              maxPosts,
              [],
              Array.from(starterExcludedGroupIds),
            )
          : moveFirstAvailableStarterToFront(
              selectedGroups,
              Array.from(starterExcludedGroupIds),
            );
        if (groups.length === 0) {
          throw new Error(
            "None of the selected Groups has a visible “Write something...” button. Select another standard Group and try again.",
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
          successTarget: maxPosts,
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
      await finalizePostingUsage(
        "complete",
        "group_post",
        firstPostingUsageOperationId,
      );
      const firstHistoryRecorded = await recordAcceptedGroupPost(
        facebookActorId,
        groups[0],
        firstPostingUsageOperationId,
      );
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
        detail: firstPostPending
          ? "Your post is awaiting admin approval. If the admin team approves it, it'll become visible in the group."
          : firstHistoryRecorded
            ? undefined
            : "The post succeeded, but Postika could not update its Group balance history.",
        current: 1,
        total,
        groupId: groups[0].id,
        groupName: groups[0].name,
        successCount,
        failedCount,
        processedCount: 1,
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
          successTarget: maxPosts,
        });
        return;
      }
    } else {
      await finalizePostingUsage(
        "release",
        "group_post",
        firstPostingUsageOperationId,
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
      successCount < maxPosts &&
      (!balancedPosting || attemptIndex < groups.length);
      attemptIndex += 1
    ) {
      throwIfPostingStopped();
      const groupIndex = balancedPosting
        ? attemptIndex
        : attemptIndex % groups.length;
      const cycleNumber = balancedPosting
        ? Math.floor(attemptIndex / selectedGroups.length) + 1
        : Math.floor(attemptIndex / groups.length) + 1;
      const group = groups[groupIndex];
      if (balancedPosting && failedBalancedGroupIds.has(group.id)) {
        if (failedBalancedGroupIds.size >= selectedGroups.length) {
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
        cycle: cycleNumber,
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
        rewritten: postBodyWasRewritten,
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
          throw new Error("Image upload template was not captured.");
        }

        photoIds = await uploadImagesForGroup(
          postingTabId,
          templates.uploadTemplate,
          preparedPost.images,
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
        message: `Posting prepared post ${preparedPostNumber}/${posts.length} to ${group.name}...`,
        current,
        total,
        groupId: group.id,
        groupName: group.name,
        successCount,
        failedCount,
        processedCount: attemptIndex,
      });

      const postingUsageOperationId = await claimPostingUsage(
        "group_post",
        facebookActorId,
      );
      let postResult: GraphqlPostResult;
      try {
        postResult = await createGraphqlPost(
          postingTabId,
          templates.postTemplate,
          postBody,
          photoIds,
          group.id,
        );
      } catch (error) {
        await finalizePostingUsage(
          "release",
          "group_post",
          postingUsageOperationId,
        );
        throw error;
      }
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
        await finalizePostingUsage(
          "complete",
          "group_post",
          postingUsageOperationId,
        );
        const historyRecorded = await recordAcceptedGroupPost(
          facebookActorId,
          group,
          postingUsageOperationId,
        );
        successCount += 1;
        if (postResult.pendingApproval) {
          activePostingPendingCount += 1;
        }
        notifyUiPostingStatus({
          status: postResult.pendingApproval ? "pending" : "posted",
          message: postResult.pendingApproval
            ? "Your post is pending"
            : `Posted successfully to ${group.name}.`,
          detail: postResult.pendingApproval
            ? "Your post is awaiting admin approval. If the admin team approves it, it'll become visible in the group."
            : historyRecorded
              ? undefined
              : "The post succeeded, but Postika could not update its Group balance history.",
          current,
          total,
          groupId: group.id,
          groupName: group.name,
          successCount,
          failedCount,
          processedCount: attemptIndex + 1,
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
            successTarget: maxPosts,
          });
          return;
        }
      } else {
        await finalizePostingUsage(
          "release",
          "group_post",
          postingUsageOperationId,
        );
        failedCount += 1;
        if (balancedPosting) {
          failedBalancedGroupIds.add(group.id);
        }

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
      if (
        balancedPosting &&
        failedBalancedGroupIds.size >= selectedGroups.length
      ) {
        break;
      }
      if (balancedPosting) {
        const currentPlan = groups.slice(0, nextAttemptIndex);
        const remainingPlan = groups
          .slice(nextAttemptIndex)
          .filter(
            (plannedGroup) => !failedBalancedGroupIds.has(plannedGroup.id),
          );
        const remainingTarget = maxPosts - successCount;
        if (remainingPlan.length < remainingTarget) {
          const replacementPlan = await createBalancedGroupPostingPlan(
            selectedGroups,
            facebookActorId,
            remainingTarget,
            Array.from(failedBalancedGroupIds),
            [],
          );
          groups = [...currentPlan, ...replacementPlan];
        } else {
          groups = [...currentPlan, ...remainingPlan];
        }
      }
      if (balancedPosting && nextAttemptIndex >= groups.length) {
        break;
      }
      const nextGroupIndex = balancedPosting
        ? nextAttemptIndex
        : nextAttemptIndex % groups.length;
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
    if (balancedPosting) {
      notifyUiPostingStatus({
        status: "done",
        message:
          successCount >= maxPosts
            ? `Balanced queue reached ${successCount} accepted posts.`
            : `Balanced queue stopped after every selected Group failed. ${successCount} posts were accepted.`,
        current: Math.min(successCount + failedCount, total),
        total,
        successCount,
        failedCount,
        processedCount: Math.min(successCount + failedCount, total),
        successTarget: maxPosts,
      });
    }
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
            : "GraphQL posting stopped.",
        current: Math.min(successCount + failedCount, total),
        total,
        successCount,
        failedCount,
        processedCount: Math.min(successCount + failedCount, total),
        error: errorMessage,
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
      failedCount,
    });
    activePosting = false;
    activePostingSuccessTarget = undefined;
    activePostingPendingCount = 0;
    stopPostingRequested = false;
    pausePostingRequested = false;
    pauseNotificationSent = false;
    activePostingTabId = undefined;
  }
}

async function ensurePostingTemplates(
  tabId: number,
  groups: SimpleGroup[],
  originalBody: string,
  body: string,
  images: UiPostImage[],
  total: number,
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

  debugLog("Capturing fresh templates from first group post.", {
    groupId: firstGroup.id,
    groupName: firstGroup.name,
    requiresUploadTemplate,
  });

  throwIfPostingStopped();
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

  await installFirstPostResponseCapture(tabId);
  const postResult = await createPostInTab(tabId, images, body);
  if (
    !postResult.ok &&
    postResult.composerFound === false &&
    /write something button not found/i.test(postResult.error ?? "")
  ) {
    stopPostingTemplateCapture();
    throw new MissingFirstGroupComposerError(firstGroup.name);
  }
  const firstResponseText = await waitForFirstPostResponseCapture(tabId);
  const firstPostResult = firstResponseText
    ? parsePostResponse(firstResponseText)
    : undefined;
  throwIfPostingStopped();
  if (!postResult.ok || firstPostResult?.success === false) {
    stopPostingTemplateCapture();
    const message = firstResponseText
      ? classifyFacebookPostFailure(
          firstResponseText,
          firstPostResult?.error ?? postResult.error,
        )
      : (postResult.error ?? "Unable to create the first post.");
    if (firstResponseText) {
      throw new FacebookPostResponseError(message, firstResponseText);
    }
    throw new Error(message);
  }

  const capturedTemplates = await waitForPostingTemplatesInternal(
    requiresUploadTemplate,
  );

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
): Promise<string | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
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
    "The first post response was not available for moderation classification.",
  );
  return undefined;
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
    debugWarn("Unable to read the first post response capture.", error);
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
): Promise<CreatePostResponse> {
  const request: CreatePostRequest = {
    type: "CREATE_POST",
    body,
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

async function navigateTabAndWaitForComplete(
  tabId: number,
  url: string,
  urlIncludes: string,
): Promise<void> {
  type TabUpdatedListener = Parameters<
    typeof chrome.tabs.onUpdated.addListener
  >[0];
  let listener: TabUpdatedListener | undefined;
  const navigationComplete = new Promise<void>((resolve) => {
    listener = (updatedTabId, changeInfo, updatedTab) => {
      if (
        updatedTabId === tabId &&
        changeInfo.status === "complete" &&
        updatedTab.url?.includes(urlIncludes)
      ) {
        chrome.tabs.onUpdated.removeListener(listener!);
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
): Promise<GraphqlPostResult> {
  await logPageCookieDiagnostics(tabId, "Before GraphQL replay");
  const variables = buildPostVariables(
    postTemplate.formData,
    text,
    photoIds,
    groupId,
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
    input.composed_text = buildComposedText(text);
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

function findStoryCreateResult(value: unknown):
  | {
      postId: string;
      url: string;
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

    if (
      fallbackUrl &&
      (fallbackUrl.includes("/pending_posts/") ||
        fallbackUrl.includes("/permalink/") ||
        fallbackUrl.includes("/posts/"))
    ) {
      return {
        postId: fallbackId ?? "unknown-story-id",
        url: fallbackUrl,
        pendingApproval:
          fallbackUrl.includes("/pending_posts/") ||
          Boolean(story?.if_viewer_can_learn_more_about_pending_post) ||
          Boolean(story?.to?.if_viewer_can_see_pending_post_in_mall),
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
  const storage = await chrome.storage.local.get([
    ...GEMINI_API_KEY_STORAGE_KEYS,
    GEMINI_REWRITE_ENABLED_STORAGE_KEY,
    GEMINI_CUSTOM_PROMPT_STORAGE_KEY,
    GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY,
  ]);
  const apiKey = GEMINI_API_KEY_STORAGE_KEYS.map((key) => storage[key]).find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );

  const customPromptValue = storage[GEMINI_CUSTOM_PROMPT_STORAGE_KEY];
  return rewriteDescriptionWithGemini(description, {
    enabled: storage[GEMINI_REWRITE_ENABLED_STORAGE_KEY] === true,
    apiKey: apiKey ?? "",
    customPrompt:
      typeof customPromptValue === "string" ? customPromptValue.trim() : "",
    includeHashtags: storage[GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY] !== false,
    destination: "Facebook Group",
  });
}

async function rewriteDescriptionWithGemini(
  description: string,
  settings: {
    enabled: boolean;
    apiKey: string;
    customPrompt: string;
    includeHashtags: boolean;
    destination: string;
  },
): Promise<string> {
  const trimmed = description.trim();
  if (!trimmed) {
    return trimmed;
  }
  const queue: GeminiQueue =
    settings.destination === "Facebook Group" ? "groups" : "marketplace";
  if (!settings.enabled || geminiBypassed[queue]) {
    debugLog("Gemini rewrite skipped because the feature is disabled.");
    return trimmed;
  }
  const apiKey = settings.apiKey.trim();
  if (!apiKey) {
    await handleGeminiFailure(
      queue,
      "No Gemini API key is configured. Add a valid key in settings.",
    );
    return trimmed;
  }

  const customPrompt = settings.customPrompt.trim();
  const includeHashtags = settings.includeHashtags;
  const hashtagRules = includeHashtags
    ? "- Include exactly 6 relevant hashtags based on the original description.\n- Put all 6 hashtags together at the very bottom of the finished description, even if the custom instructions omit or forbid hashtags."
    : "- Do not include hashtags in the finished description, even if the original or custom instructions contain them.";
  const phoneNumberRules = `- Treat every phone number as immutable verbatim text and copy every occurrence exactly as it appears in the original description.
- Preserve the exact Unicode characters and formatting of each phone number, including ordinary digits, mathematical or styled digits, keycap emoji digits, leading zeros, country-code prefixes, spaces, punctuation, and separators.
- Never convert a styled or emoji phone number into ordinary digits, and never convert an ordinary-digit phone number into styled text or emojis. For example, 0️⃣7️⃣1️⃣8️⃣4️⃣4️⃣8️⃣4️⃣6️⃣1️⃣ must remain exactly 0️⃣7️⃣1️⃣8️⃣4️⃣4️⃣8️⃣4️⃣6️⃣1️⃣.
- These phone-number preservation rules are mandatory and override any conflicting custom rewrite instruction.`;
  const prompt = customPrompt
    ? `Rewrite the ${settings.destination} description using the custom instructions below.

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
${trimmed}`
    : `Rewrite this ${settings.destination} description to be concise, clear, natural, and persuasive.

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

  let requestController: AbortController | undefined;
  try {
    debugLog("Sending Gemini rewrite request.", {
      model: GEMINI_MODEL,
      inputLength: trimmed.length,
      customPromptLength: customPrompt.length,
    });
    requestController = new AbortController();
    activeGeminiRequestController = requestController;
    const response = await withTimeout(
      (async (): Promise<GeminiGenerateContentResponse> => {
        const apiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            signal: requestController!.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                thinkingConfig: {
                  thinkingBudget: 0,
                },
              },
            }),
          },
        );
        const payload = (await apiResponse
          .json()
          .catch(() => ({}))) as GeminiGenerateContentResponse;

        if (!apiResponse.ok) {
          throw new Error(
            `Gemini request failed (HTTP ${apiResponse.status}): ${payload.error?.message ?? "No error details returned."}`,
          );
        }

        return payload;
      })(),
      GEMINI_TIMEOUT_MS,
      "Gemini rewrite timed out.",
    );

    const rewritten =
      response.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";
    debugLog("Gemini rewrite completed.", {
      outputLength: rewritten.length,
      changed: rewritten !== trimmed,
    });
    if (!rewritten)
      throw new Error(
        "Gemini returned no rewritten text. The response may have been blocked.",
      );
    return rewritten;
  } catch (error) {
    requestController?.abort();
    const rawError = error instanceof Error ? error.message : String(error);
    const safeError = rawError.split(apiKey).join("[redacted]");
    const detail = /failed to fetch/i.test(safeError)
      ? "Could not reach Gemini. Check this browser profile’s connection, proxy, and extension permissions."
      : safeError;
    debugWarn("Gemini rewrite failed.", detail);
    await handleGeminiFailure(queue, detail);
    return trimmed;
  } finally {
    requestController?.abort();
    activeGeminiRequestController = undefined;
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

function notifyMarketplaceItemPostingStatus(
  partial: Omit<MarketplaceItemPostingStatusMessage, "type">,
): void {
  if (partial.status === "done" || partial.status === "stopped") {
    finishQueueTimer(marketplacePostingTimer);
  }
  const status = {
    type: "MARKETPLACE_ITEM_POSTING_STATUS",
    ...partial,
    timing: queueTimingSnapshot(marketplacePostingTimer, partial.listingId),
  } satisfies MarketplaceItemPostingStatusMessage;
  latestMarketplacePostingStatus = status;
  if (status.status === "done" || status.status === "stopped") {
    void chrome.storage.session.set({
      [LAST_MARKETPLACE_POSTING_STATUS_STORAGE_KEY]: status,
    });
  }
  void chrome.runtime.sendMessage(status);
}

function notifyMarketplacePostingControlStatus(
  status: "posting" | "paused" | "stopped",
  message: string,
): void {
  const latest = latestMarketplacePostingStatus;
  notifyMarketplaceItemPostingStatus({
    status,
    message,
    current: latest?.current ?? 0,
    total: latest?.total ?? 0,
    listingId: latest?.listingId,
    listingTitle: latest?.listingTitle,
    successCount: latest?.successCount ?? 0,
    failedCount: latest?.failedCount ?? 0,
  });
}

function sendMarketplacePostingControl(
  type:
    | "PAUSE_MARKETPLACE_POSTING"
    | "RESUME_MARKETPLACE_POSTING"
    | "STOP_MARKETPLACE_POSTING",
): void {
  if (activeMarketplacePostingTabId === undefined) {
    return;
  }
  void chrome.tabs
    .sendMessage(activeMarketplacePostingTabId, { type })
    .catch(() => {
      // The Marketplace content helper is installed after page navigation.
    });
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
