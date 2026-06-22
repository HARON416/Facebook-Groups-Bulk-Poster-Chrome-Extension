import type {
  FacebookGroup,
  GroupExtractionStatusMessage,
  LoadGroupsResponse,
  StopUiPostingRequest,
  StartUiPostingRequest,
  UiPostImage,
  UiPostingResponse,
  UiPostingStatusMessage,
} from "./config";
import { AUTH_API_BASE_URL, AUTH_WEB_BASE_URL } from "./auth-config";

const GEMINI_API_KEY_STORAGE_KEY = "geminiApiKey";
const GEMINI_REWRITE_ENABLED_STORAGE_KEY = "geminiRewriteEnabled";
const AUTH_TOKEN_STORAGE_KEY = "authToken";
const AUTH_USER_STORAGE_KEY = "authUser";
const AUTH_EXPIRES_AT_STORAGE_KEY = "authExpiresAt";
const MIN_SLEEP_SECONDS = 120;

const loadGroupsButton =
  document.querySelector<HTMLButtonElement>("#load-groups-btn");
const groupsList = document.querySelector<HTMLElement>("#groups-list");
const groupsStatusMessage = document.querySelector<HTMLElement>(
  "#groups-status-message",
);
const groupsStatusCount = document.querySelector<HTMLElement>(
  "#groups-status-count",
);
const groupsSelectionCount = document.querySelector<HTMLElement>(
  "#groups-selection-count",
);
const groupsSearchInput = document.querySelector<HTMLInputElement>(
  "#groups-search-input",
);
const groupsSelectAll =
  document.querySelector<HTMLLabelElement>("#groups-select-all");
const groupsSelectAllCheckbox = document.querySelector<HTMLInputElement>(
  "#groups-select-all-checkbox",
);
const postBodyInput =
  document.querySelector<HTMLTextAreaElement>("#post-body-input");
const postImagesInput =
  document.querySelector<HTMLInputElement>("#post-images-input");
const imagePreviewList = document.querySelector<HTMLElement>(
  "#image-preview-list",
);
const postSleepInput =
  document.querySelector<HTMLInputElement>("#post-sleep-input");
const geminiApiKeyInput = document.querySelector<HTMLInputElement>(
  "#gemini-api-key-input",
);
const geminiRewriteToggle = document.querySelector<HTMLInputElement>(
  "#gemini-rewrite-toggle",
);
const geminiStatusMessage = document.querySelector<HTMLElement>(
  "#gemini-status-message",
);
const geminiStatusCount = document.querySelector<HTMLElement>(
  "#gemini-status-count",
);
const createForm = document.querySelector<HTMLFormElement>("#create-form");
const startPostingButton =
  document.querySelector<HTMLButtonElement>("#start-posting-btn");
const postingProgress =
  document.querySelector<HTMLElement>("#posting-progress");
const postingProgressTitle = document.querySelector<HTMLElement>(
  "#posting-progress-title",
);
const postingProgressPercent = document.querySelector<HTMLElement>(
  "#posting-progress-percent",
);
const postingProgressBar = document.querySelector<HTMLElement>(
  "#posting-progress-bar",
);
const postingProgressSuccess = document.querySelector<HTMLElement>(
  "#posting-progress-success",
);
const postingProgressFailed = document.querySelector<HTMLElement>(
  "#posting-progress-failed",
);
const postingProgressRemaining = document.querySelector<HTMLElement>(
  "#posting-progress-remaining",
);
const postingProgressCurrent = document.querySelector<HTMLElement>(
  "#posting-progress-current",
);
const postingProgressLog = document.querySelector<HTMLOListElement>(
  "#posting-progress-log",
);
const authLoginButton =
  document.querySelector<HTMLButtonElement>("#auth-login-btn");
const authSignupButton =
  document.querySelector<HTMLButtonElement>("#auth-signup-btn");
const authLogoutButton =
  document.querySelector<HTMLButtonElement>("#auth-logout-btn");
const authStatusMessage = document.querySelector<HTMLElement>(
  "#auth-status-message",
);
const authPanelTitle =
  document.querySelector<HTMLElement>("#auth-panel-title");
const authSessionPill = document.querySelector<HTMLElement>("#auth-session-pill");
const authUserEmail = document.querySelector<HTMLElement>("#auth-user-email");
const selectedImagePreviewUrls: string[] = [];
let selectedImageFiles: File[] = [];
let loadedGroups: FacebookGroup[] = [];
let selectedGroupIds = new Set<string>();
let groupsSearchQuery = "";
let isPostingActive = false;
let isStopRequestPending = false;
let currentAuthSession:
  | {
      token: string;
      expiresAt: string;
      user: { id: number; email: string; created_at: string };
    }
  | undefined;

void initializeGeminiSettings();
void initializeAuth();

function renderGroups(groups: FacebookGroup[]) {
  if (!groupsList) {
    return;
  }

  loadedGroups = groups;
  selectedGroupIds = new Set(
    Array.from(selectedGroupIds).filter((groupId) =>
      groups.some((group) => group.id === groupId),
    ),
  );

  if (groups.length === 0) {
    if (groupsSelectAll) {
      groupsSelectAll.hidden = true;
    }
    if (groupsSelectAllCheckbox) {
      groupsSelectAllCheckbox.checked = false;
      groupsSelectAllCheckbox.indeterminate = false;
    }
    if (groupsSearchInput) {
      groupsSearchInput.value = "";
      groupsSearchInput.disabled = true;
    }
    groupsSearchQuery = "";
    groupsList.className = "empty-state";
    groupsList.textContent = "No groups found.";
    updatePostingReadiness();
    return;
  }

  if (groupsSelectAll) {
    groupsSelectAll.hidden = false;
  }
  if (groupsSearchInput) {
    groupsSearchInput.disabled = false;
  }

  const normalizedQuery = groupsSearchQuery.trim().toLowerCase();
  const visibleGroups = normalizedQuery.length
    ? groups.filter((group) =>
        `${group.name} ${group.url}`.toLowerCase().includes(normalizedQuery),
      )
    : groups;

  if (visibleGroups.length === 0) {
    groupsList.className = "empty-state";
    groupsList.textContent = `No groups match "${groupsSearchQuery.trim()}".`;
    updatePostingReadiness();
    return;
  }

  const selectedGroups = visibleGroups.filter((group) =>
    selectedGroupIds.has(group.id),
  );
  const remainingGroups = visibleGroups.filter(
    (group) => !selectedGroupIds.has(group.id),
  );

  const renderGroupItem = (group: FacebookGroup) => {
      const item = document.createElement("label");
      item.className = "group-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = group.id;
      checkbox.className = "group-item__checkbox";
      checkbox.checked = selectedGroupIds.has(group.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedGroupIds.add(group.id);
        } else {
          selectedGroupIds.delete(group.id);
        }

        renderGroups(loadedGroups);
      });

      const content = document.createElement("span");
      content.className = "group-item__content";

      const name = document.createElement("span");
      name.className = "group-item__name";
      name.textContent = group.name;

      const url = document.createElement("span");
      url.className = "group-item__url";
      url.textContent = group.url;

      content.append(name, url);
      item.append(checkbox, content);

      return item;
    };

  const createSection = (
    title: string,
    groupsForSection: FacebookGroup[],
    emptyMessage: string,
  ) => {
    const section = document.createElement("section");
    section.className = "groups-list-section";

    const header = document.createElement("div");
    header.className = "groups-list-section__header";

    const heading = document.createElement("span");
    heading.className = "groups-list-section__title";
    heading.textContent = title;

    const count = document.createElement("span");
    count.className = "groups-list-section__count";
    count.textContent = `${groupsForSection.length}`;

    header.append(heading, count);
    section.append(header);

    if (groupsForSection.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "empty-state";
      emptyState.textContent = emptyMessage;
      section.append(emptyState);
      return section;
    }

    const list = document.createElement("div");
    list.className = "groups-list";
    list.append(...groupsForSection.map(renderGroupItem));
    section.append(list);

    return section;
  };

  groupsList.className = "groups-list-sections";
  groupsList.replaceChildren(
    createSection(
      "Selected Groups",
      selectedGroups,
      normalizedQuery.length
        ? "No selected groups match this search."
        : "No groups selected yet.",
    ),
    createSection(
      "Other Groups",
      remainingGroups,
      normalizedQuery.length
        ? "No remaining groups match this search."
        : "No other groups available.",
    ),
  );
  updatePostingReadiness();
}

function updateGroupsStatus(message: string, loadedCount: number) {
  if (groupsStatusMessage) {
    groupsStatusMessage.textContent = message;
  }

  if (groupsStatusCount) {
    groupsStatusCount.textContent = `${loadedCount} loaded`;
  }
}

function updateGeminiStatus() {
  const hasKey = (geminiApiKeyInput?.value.trim().length ?? 0) > 0;
  const rewriteEnabled = Boolean(geminiRewriteToggle?.checked);

  if (geminiStatusMessage) {
    geminiStatusMessage.textContent = rewriteEnabled
      ? hasKey
        ? "Gemini rewrite is enabled."
        : "Gemini rewrite is enabled, but no API key is saved yet."
      : "Gemini rewrite is off.";
  }

  if (geminiStatusCount) {
    geminiStatusCount.textContent = hasKey
      ? rewriteEnabled
        ? "Ready"
        : "Key saved"
      : "No key";
  }
}

function getSelectedGroupsCount() {
  return selectedGroupIds.size;
}

function getGroupCheckboxes() {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(".group-item__checkbox"),
  );
}

function updateGroupsSelectAllState() {
  if (!groupsSelectAllCheckbox) {
    return;
  }

  const hasGroups = loadedGroups.length > 0;
  const selectedCount = selectedGroupIds.size;

  groupsSelectAllCheckbox.checked = hasGroups && selectedCount === loadedGroups.length;
  groupsSelectAllCheckbox.indeterminate =
    hasGroups && selectedCount > 0 && selectedCount < loadedGroups.length;
}

function updatePostingReadiness() {
  const isAuthenticated = Boolean(currentAuthSession?.token);
  const selectedGroupsCount = getSelectedGroupsCount();
  const hasPostBody = (postBodyInput?.value.trim().length ?? 0) > 0;
  const sleepTime = Number(postSleepInput?.value ?? 0);
  const hasValidSleepTime =
    Number.isFinite(sleepTime) && sleepTime >= MIN_SLEEP_SECONDS;

  if (groupsSelectionCount) {
    groupsSelectionCount.textContent = `${selectedGroupsCount} ${
      selectedGroupsCount === 1 ? "group" : "groups"
    } selected`;
  }

  updateGroupsSelectAllState();

  updatePostingButtonState(
    isAuthenticated,
    hasPostBody,
    selectedGroupsCount,
    hasValidSleepTime,
  );

  if (loadGroupsButton) {
    loadGroupsButton.disabled = !isAuthenticated;
  }
}

function updatePostingButtonState(
  isAuthenticated = Boolean(currentAuthSession?.token),
  hasPostBody = (postBodyInput?.value.trim().length ?? 0) > 0,
  selectedGroupsCount = getSelectedGroupsCount(),
  hasValidSleepTime = (() => {
    const sleepTime = Number(postSleepInput?.value ?? 0);
    return Number.isFinite(sleepTime) && sleepTime >= MIN_SLEEP_SECONDS;
  })(),
) {
  if (!startPostingButton) {
    return;
  }

  if (isPostingActive) {
    startPostingButton.disabled = isStopRequestPending;
    startPostingButton.textContent = isStopRequestPending
      ? "Stopping..."
      : "Stop Posting";
    startPostingButton.classList.add("start-posting-btn--stop");
    return;
  }

  startPostingButton.classList.remove("start-posting-btn--stop");
  startPostingButton.disabled = !(
    isAuthenticated &&
    hasPostBody &&
    selectedGroupsCount > 0 &&
    hasValidSleepTime
  );
  startPostingButton.textContent = "START POSTING";
}

chrome.runtime.onMessage.addListener(
  (message: GroupExtractionStatusMessage | UiPostingStatusMessage) => {
    if (message.type === "GROUP_EXTRACTION_STATUS") {
      updateGroupsStatus(message.message, message.loadedCount);
    }

    if (message.type === "UI_POSTING_STATUS") {
      updateUiPostingStatus(message);
    }
  },
);

function updateUiPostingStatus(message: UiPostingStatusMessage) {
  if (
    message.status === "posting" ||
    message.status === "waiting" ||
    message.status === "posted" ||
    message.status === "failed"
  ) {
    isPostingActive = true;
    isStopRequestPending = false;
  }

  updatePostingProgress(message);

  if (groupsStatusMessage) {
    groupsStatusMessage.textContent = message.error
      ? `${message.message}: ${message.error}`
      : message.message;
  }

  if (groupsStatusCount) {
    groupsStatusCount.textContent = `${message.successCount ?? 0}/${message.total} posted`;
  }

  if (
    message.status === "stopped" ||
    message.status === "done" ||
    message.status === "rate_limited"
  ) {
    isPostingActive = false;
    isStopRequestPending = false;
    updatePostingReadiness();
  }
}

function updatePostingProgress(message: UiPostingStatusMessage) {
  if (postingProgress) {
    postingProgress.hidden = false;
  }

  const successCount = message.successCount ?? 0;
  const failedCount = message.failedCount ?? 0;
  const processedCount =
    message.processedCount ??
    Math.min(message.total, successCount + failedCount);
  const remainingCount = Math.max(message.total - processedCount, 0);
  const percent =
    message.total > 0
      ? Math.round((processedCount / message.total) * 100)
      : 0;

  if (postingProgressTitle) {
    postingProgressTitle.textContent = `${processedCount}/${message.total} groups processed`;
  }

  if (postingProgressPercent) {
    postingProgressPercent.textContent = `${percent}%`;
  }

  if (postingProgressBar) {
    postingProgressBar.style.width = `${percent}%`;
  }

  if (postingProgressSuccess) {
    postingProgressSuccess.textContent = String(successCount);
  }

  if (postingProgressFailed) {
    postingProgressFailed.textContent = String(failedCount);
  }

  if (postingProgressRemaining) {
    postingProgressRemaining.textContent = String(remainingCount);
  }

  if (postingProgressCurrent) {
    const prefix =
      message.current > 0 && message.total > 0
        ? `Group ${message.current}/${message.total}`
        : "Queue";
    postingProgressCurrent.textContent = message.groupName
      ? `${prefix}: ${message.groupName}`
      : message.message;
  }

  appendPostingProgressLog(message);
}

function appendPostingProgressLog(message: UiPostingStatusMessage) {
  if (!postingProgressLog) {
    return;
  }

  const existingWaitingItem =
    message.status === "waiting"
      ? postingProgressLog.querySelector<HTMLLIElement>(
          `li[data-status="waiting"][data-group-id="${CSS.escape(
            message.groupId ?? "queue",
          )}"]`,
        )
      : undefined;
  const item = existingWaitingItem ?? document.createElement("li");
  item.dataset.status = message.status;
  item.dataset.groupId = message.groupId ?? "queue";

  const count =
    message.current > 0 && message.total > 0
      ? `${message.current}/${message.total}`
      : "";

  const badge = document.createElement("span");
  badge.className = "posting-progress__log-badge";
  badge.textContent = getPostingStatusLabel(message.status);

  const body = document.createElement("span");
  body.className = "posting-progress__log-body";

  const text = document.createElement("span");
  text.className = "posting-progress__log-text";
  text.textContent = message.message;

  body.append(text);

  if (count || message.error) {
    const meta = document.createElement("span");
    meta.className = "posting-progress__log-meta";
    meta.textContent = [count, message.error].filter(Boolean).join(" · ");
    body.append(meta);
  }

  item.replaceChildren(badge, body);

  if (!existingWaitingItem) {
    postingProgressLog.prepend(item);
  }
}

function getPostingStatusLabel(status: UiPostingStatusMessage["status"]) {
  switch (status) {
    case "posted":
      return "Done";
    case "failed":
      return "Fail";
    case "rate_limited":
      return "Limit";
    case "waiting":
      return "Wait";
    case "stopped":
      return "Stop";
    case "done":
      return "Done";
    case "posting":
      return "Post";
    default:
      return "Info";
  }
}

loadGroupsButton?.addEventListener("click", async () => {
  if (!currentAuthSession?.token) {
    alert("Please sign in before loading groups.");
    return;
  }

  if (!groupsList || !loadGroupsButton) {
    return;
  }

  loadGroupsButton.disabled = true;
  loadGroupsButton.textContent = "Loading...";
  updateGroupsStatus("Starting group extraction...", 0);
  selectedGroupIds.clear();
  if (groupsSelectAll) {
    groupsSelectAll.hidden = true;
  }
  if (groupsSelectAllCheckbox) {
    groupsSelectAllCheckbox.checked = false;
    groupsSelectAllCheckbox.indeterminate = false;
  }
  if (groupsSearchInput) {
    groupsSearchInput.disabled = true;
  }
  groupsList.className = "empty-state";
  groupsList.textContent = "Opening joined groups and reading groups...";

  try {
    const response = await chrome.runtime.sendMessage<
      { type: "LOAD_GROUPS" },
      LoadGroupsResponse
    >({ type: "LOAD_GROUPS" });

    if (!response?.ok) {
      throw new Error(response?.error ?? "Unable to load groups.");
    }

    const groups = response.groups ?? [];
    renderGroups(groups);
    updateGroupsStatus(
      `Finished loading ${groups.length} groups.`,
      groups.length,
    );
  } catch (error) {
    updateGroupsStatus("Group extraction failed.", 0);
    if (groupsSelectAll) {
      groupsSelectAll.hidden = true;
    }
    if (groupsSelectAllCheckbox) {
      groupsSelectAllCheckbox.checked = false;
      groupsSelectAllCheckbox.indeterminate = false;
    }
    if (groupsSearchInput) {
      groupsSearchInput.disabled = true;
    }
    groupsList.className = "empty-state";
    groupsList.textContent =
      error instanceof Error ? error.message : "Unable to load groups.";
  } finally {
    loadGroupsButton.disabled = false;
    loadGroupsButton.textContent = "Load Groups";
  }
});

function clearImagePreviewUrls() {
  for (const url of selectedImagePreviewUrls) {
    URL.revokeObjectURL(url);
  }

  selectedImagePreviewUrls.length = 0;
}

function syncPostImagesInput() {
  if (!postImagesInput) {
    return;
  }

  const dataTransfer = new DataTransfer();

  for (const file of selectedImageFiles) {
    dataTransfer.items.add(file);
  }

  postImagesInput.files = dataTransfer.files;
}

function removeSelectedImage(indexToRemove: number) {
  selectedImageFiles = selectedImageFiles.filter(
    (_file, index) => index !== indexToRemove,
  );
  syncPostImagesInput();
  renderImagePreviews();
}

function renderImagePreviews() {
  if (!imagePreviewList) {
    return;
  }

  clearImagePreviewUrls();

  if (selectedImageFiles.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "No images selected.";
    imagePreviewList.replaceChildren(emptyState);
    return;
  }

  imagePreviewList.replaceChildren(
    ...selectedImageFiles.map((file, index) => {
      const previewUrl = URL.createObjectURL(file);
      selectedImagePreviewUrls.push(previewUrl);

      const preview = document.createElement("figure");
      preview.className = "image-preview";

      const image = document.createElement("img");
      image.src = previewUrl;
      image.alt = file.name;

      const caption = document.createElement("span");
      caption.textContent = file.name;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "image-preview__remove";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        removeSelectedImage(index);
      });

      preview.append(image, caption, removeButton);
      return preview;
    }),
  );
}

postImagesInput?.addEventListener("change", () => {
  const newImageFiles = Array.from(postImagesInput.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
  selectedImageFiles = [...selectedImageFiles, ...newImageFiles];
  syncPostImagesInput();
  renderImagePreviews();
});

postBodyInput?.addEventListener("input", updatePostingReadiness);

groupsSelectAllCheckbox?.addEventListener("change", () => {
  const shouldSelectAll = groupsSelectAllCheckbox.checked;

  if (shouldSelectAll) {
    selectedGroupIds = new Set(loadedGroups.map((group) => group.id));
  } else {
    selectedGroupIds.clear();
  }

  renderGroups(loadedGroups);
});

groupsSearchInput?.addEventListener("input", () => {
  groupsSearchQuery = groupsSearchInput.value;
  renderGroups(loadedGroups);
});

geminiApiKeyInput?.addEventListener("input", () => {
  updateGeminiStatus();
});

geminiApiKeyInput?.addEventListener("change", () => {
  void saveGeminiApiKey();
});

geminiApiKeyInput?.addEventListener("blur", () => {
  void saveGeminiApiKey();
});

geminiRewriteToggle?.addEventListener("change", () => {
  void saveGeminiRewriteEnabled();
  updateGeminiStatus();
});

postSleepInput?.addEventListener("change", () => {
  const value = Number(postSleepInput.value);

  if (!Number.isFinite(value) || value < MIN_SLEEP_SECONDS) {
    postSleepInput.value = String(MIN_SLEEP_SECONDS);
  }

  updatePostingReadiness();
});

createForm?.addEventListener("submit", (event) => {
  event.preventDefault();
});

startPostingButton?.addEventListener("click", async () => {
  if (isPostingActive) {
    if (isStopRequestPending || !startPostingButton) {
      return;
    }

    isStopRequestPending = true;
    updatePostingButtonState();

    try {
      const response = await chrome.runtime.sendMessage<
        StopUiPostingRequest,
        UiPostingResponse
      >({
        type: "STOP_UI_POSTING",
      });

      if (!response?.ok) {
        throw new Error(response?.error ?? "Unable to stop posting.");
      }
    } catch (error) {
      isStopRequestPending = false;
      updatePostingButtonState();
      alert(
        error instanceof Error ? error.message : "Unable to stop posting.",
      );
    }

    return;
  }

  if (!currentAuthSession?.token) {
    alert("Please sign in before posting.");
    return;
  }

  if (!startPostingButton) {
    return;
  }

  const selectedGroupIdList = Array.from(selectedGroupIds);

  if (selectedGroupIdList.length === 0) {
    alert("Please select at least one group");
    return;
  }

  const postText = postBodyInput?.value ?? "";
  if (postText.trim().length === 0) {
    alert("Please enter post text");
    return;
  }

  const sleepTime = Number(postSleepInput?.value ?? MIN_SLEEP_SECONDS);
  if (!Number.isFinite(sleepTime) || sleepTime < MIN_SLEEP_SECONDS) {
    alert(`Sleep time must be at least ${MIN_SLEEP_SECONDS} seconds`);
    return;
  }

  const selectedGroups = loadedGroups.filter((group) =>
    selectedGroupIdList.includes(group.id),
  );

  if (selectedGroups.length === 0) {
    alert("Selected groups are no longer loaded. Click Load Groups and try again.");
    return;
  }

  isPostingActive = true;
  isStopRequestPending = false;
  updatePostingButtonState();
  updateGroupsStatus("Preparing GraphQL posting...", 0);
  resetPostingProgress(selectedGroups.length);
  scrollPostingProgressIntoView();

  try {
    const images = await Promise.all(selectedImageFiles.map(fileToUiPostImage));
    const request: StartUiPostingRequest = {
      type: "START_UI_POSTING",
      body: postText,
      groups: selectedGroups.map((group) => ({
        id: group.id,
        name: group.name,
        url: group.url,
      })),
      images,
      delaySeconds: sleepTime,
    };
    const response = await chrome.runtime.sendMessage<
      StartUiPostingRequest,
      UiPostingResponse
    >(request);

    if (!response?.ok) {
      throw new Error(response?.error ?? "Unable to start GraphQL posting.");
    }
  } catch (error) {
    isPostingActive = false;
    isStopRequestPending = false;
    updatePostingReadiness();
    alert(
      error instanceof Error
        ? error.message
        : "Unable to start GraphQL posting.",
    );
  }
});

updatePostingReadiness();
updateGeminiStatus();

window.addEventListener("beforeunload", clearImagePreviewUrls);

authLoginButton?.addEventListener("click", () => {
  void startAuthFlow("login");
});

authSignupButton?.addEventListener("click", () => {
  void startAuthFlow("signup");
});

authLogoutButton?.addEventListener("click", () => {
  void clearAuthSession();
});

function fileToUiPostImage(file: File): Promise<UiPostImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Unable to read ${file.name}.`));
        return;
      }

      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        dataUrl: reader.result,
      });
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error(`Unable to read ${file.name}.`));
    });
    reader.readAsDataURL(file);
  });
}

function resetPostingProgress(total: number) {
  if (postingProgress) {
    postingProgress.hidden = false;
  }

  if (postingProgressTitle) {
    postingProgressTitle.textContent = `0/${total} groups processed`;
  }

  if (postingProgressPercent) {
    postingProgressPercent.textContent = "0%";
  }

  if (postingProgressBar) {
    postingProgressBar.style.width = "0%";
  }

  if (postingProgressSuccess) {
    postingProgressSuccess.textContent = "0";
  }

  if (postingProgressFailed) {
    postingProgressFailed.textContent = "0";
  }

  if (postingProgressRemaining) {
    postingProgressRemaining.textContent = String(total);
  }

  if (postingProgressCurrent) {
    postingProgressCurrent.textContent = "Preparing posting queue...";
  }

  postingProgressLog?.replaceChildren();
}

function scrollPostingProgressIntoView() {
  postingProgress?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

async function initializeGeminiSettings() {
  const storage = await chrome.storage.local.get([
    GEMINI_API_KEY_STORAGE_KEY,
    GEMINI_REWRITE_ENABLED_STORAGE_KEY,
  ]);

  if (geminiApiKeyInput) {
    geminiApiKeyInput.value =
      typeof storage[GEMINI_API_KEY_STORAGE_KEY] === "string"
        ? storage[GEMINI_API_KEY_STORAGE_KEY]
        : "";
  }

  if (geminiRewriteToggle) {
    geminiRewriteToggle.checked =
      storage[GEMINI_REWRITE_ENABLED_STORAGE_KEY] === true;
  }

  updateGeminiStatus();
}

async function saveGeminiApiKey() {
  const value = geminiApiKeyInput?.value.trim() ?? "";
  await chrome.storage.local.set({
    [GEMINI_API_KEY_STORAGE_KEY]: value,
  });
  updateGeminiStatus();
}

async function saveGeminiRewriteEnabled() {
  await chrome.storage.local.set({
    [GEMINI_REWRITE_ENABLED_STORAGE_KEY]: Boolean(
      geminiRewriteToggle?.checked,
    ),
  });
}

async function initializeAuth() {
  const storage = await chrome.storage.local.get([
    AUTH_TOKEN_STORAGE_KEY,
    AUTH_USER_STORAGE_KEY,
    AUTH_EXPIRES_AT_STORAGE_KEY,
  ]);

  const token = storage[AUTH_TOKEN_STORAGE_KEY];
  const user = storage[AUTH_USER_STORAGE_KEY];
  const expiresAt = storage[AUTH_EXPIRES_AT_STORAGE_KEY];

  if (
    typeof token !== "string" ||
    typeof expiresAt !== "string" ||
    !user ||
    typeof user !== "object"
  ) {
    clearAuthSessionUiOnly();
    return;
  }

  currentAuthSession = {
    token,
    expiresAt,
    user: user as { id: number; email: string; created_at: string },
  };

  const valid = await verifyAuthToken(token);
  if (!valid) {
    await clearAuthSession();
    return;
  }

  updateAuthUi();
}

async function startAuthFlow(mode: "login" | "signup") {
  try {
    setAuthBusyState(true, mode === "login" ? "Opening login..." : "Opening signup...");

    const state = crypto.randomUUID();
    const redirectUri = chrome.identity.getRedirectURL("auth");
    const url = new URL(`${AUTH_WEB_BASE_URL}/${mode}`);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);

    const finalUrl = await chrome.identity.launchWebAuthFlow({
      url: url.toString(),
      interactive: true,
    });

    if (!finalUrl) {
      throw new Error("Authentication was cancelled.");
    }

    const callback = new URL(finalUrl);
    if (callback.searchParams.get("state") !== state) {
      throw new Error("Authentication state mismatch.");
    }

    const code = callback.searchParams.get("code");
    if (!code) {
      throw new Error("Authentication code was not returned.");
    }

    const response = await fetch(`${AUTH_API_BASE_URL}/api/auth/extension/exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      token?: string;
      expires_at?: string;
      user?: { id: number; email: string; created_at: string };
    };

    if (!response.ok || !payload.token || !payload.expires_at || !payload.user) {
      throw new Error(payload.error ?? "Unable to complete extension sign in.");
    }

    currentAuthSession = {
      token: payload.token,
      expiresAt: payload.expires_at,
      user: payload.user,
    };

    await chrome.storage.local.set({
      [AUTH_TOKEN_STORAGE_KEY]: payload.token,
      [AUTH_USER_STORAGE_KEY]: payload.user,
      [AUTH_EXPIRES_AT_STORAGE_KEY]: payload.expires_at,
    });

    updateAuthUi();
  } catch (error) {
    clearAuthSessionUiOnly();
    if (authStatusMessage) {
      authStatusMessage.textContent =
        error instanceof Error ? error.message : "Unable to sign in.";
    }
  } finally {
    setAuthBusyState(false);
  }
}

async function verifyAuthToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${AUTH_API_BASE_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}

function updateAuthUi() {
  const authenticated = Boolean(currentAuthSession?.token);

  if (createForm) {
    createForm.hidden = !authenticated;
  }

  if (authSessionPill) {
    authSessionPill.hidden = !authenticated;
  }

  if (authPanelTitle) {
    authPanelTitle.hidden = authenticated;
  }

  if (authUserEmail) {
    authUserEmail.textContent = currentAuthSession?.user.email ?? "";
  }

  if (authLoginButton) {
    authLoginButton.hidden = authenticated;
  }

  if (authSignupButton) {
    authSignupButton.hidden = authenticated;
  }

  if (authLogoutButton) {
    authLogoutButton.hidden = !authenticated;
  }

  if (authStatusMessage) {
    authStatusMessage.textContent = authenticated
      ? `Authenticated. Your current token expires on ${formatExpiry(currentAuthSession?.expiresAt)}.`
      : "Authenticate with your account before loading groups or starting the posting queue.";
  }

  updatePostingReadiness();
}

function setAuthBusyState(isBusy: boolean, message?: string) {
  if (authLoginButton) {
    authLoginButton.disabled = isBusy;
  }
  if (authSignupButton) {
    authSignupButton.disabled = isBusy;
  }
  if (authLogoutButton) {
    authLogoutButton.disabled = isBusy;
  }
  if (message && authStatusMessage) {
    authStatusMessage.textContent = message;
  }
}

async function clearAuthSession() {
  currentAuthSession = undefined;
  await chrome.storage.local.remove([
    AUTH_TOKEN_STORAGE_KEY,
    AUTH_USER_STORAGE_KEY,
    AUTH_EXPIRES_AT_STORAGE_KEY,
  ]);
  clearAuthSessionUiOnly();
}

function clearAuthSessionUiOnly() {
  currentAuthSession = undefined;
  if (createForm) {
    createForm.hidden = true;
  }
  if (authSessionPill) {
    authSessionPill.hidden = true;
  }
  if (authPanelTitle) {
    authPanelTitle.hidden = false;
  }
  if (authUserEmail) {
    authUserEmail.textContent = "";
  }
  if (authLoginButton) {
    authLoginButton.hidden = false;
    authLoginButton.disabled = false;
  }
  if (authSignupButton) {
    authSignupButton.hidden = false;
    authSignupButton.disabled = false;
  }
  if (authLogoutButton) {
    authLogoutButton.hidden = true;
    authLogoutButton.disabled = false;
  }
  if (authStatusMessage) {
    authStatusMessage.textContent =
      "Authenticate with your account before loading groups or starting the posting queue.";
  }
  updatePostingReadiness();
}

function formatExpiry(value: string | undefined): string {
  if (!value) {
    return "soon";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "soon";
  }

  return date.toLocaleString();
}
