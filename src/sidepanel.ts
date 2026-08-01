import type {
  FacebookGroup,
  GroupExtractionStatusMessage,
  LoadGroupsResponse,
  PauseUiPostingRequest,
  ResumeUiPostingRequest,
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
const EXTENSION_INSTALL_ID_STORAGE_KEY = "extensionInstallId";
const EXTENSION_ACTIVATION_ID_STORAGE_KEY = "extensionActivationId";
const SIDE_PANEL_SESSION_STORAGE_KEY = "sidePanelSession";
const MIN_SLEEP_SECONDS = 60;
const PREVIOUS_MIN_SLEEP_SECONDS = 120;
const DEFAULT_MAX_SLEEP_SECONDS = 300;
const DEFAULT_MAX_POSTS = 200;
const MIN_MAX_POSTS = 1;
const TRIAL_CONTACT_EMAIL = "haronkibetrutoh@gmail.com";
const TRIAL_CONTACT_WHATSAPP = "254718448461";

type SidePanelSession = {
  postBody: string;
  minimumDelaySeconds: number;
  maximumDelaySeconds: number;
  delaySeconds?: number;
  intervalSettingsVersion: number;
  maxPosts: number;
  shuffleGroups: boolean;
  loadedGroups: FacebookGroup[];
  selectedGroupIds: string[];
  groupsSearchQuery: string;
  groupsVisible: boolean;
  imagePreviewsVisible: boolean;
  images: UiPostImage[];
};

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
const postIntervalMinInput = document.querySelector<HTMLInputElement>(
  "#post-interval-min-input",
);
const postIntervalMaxInput = document.querySelector<HTMLInputElement>(
  "#post-interval-max-input",
);
const maxPostsInput =
  document.querySelector<HTMLInputElement>("#max-posts-input");
const geminiApiKeyInput = document.querySelector<HTMLInputElement>(
  "#gemini-api-key-input",
);
const geminiRewriteToggle = document.querySelector<HTMLInputElement>(
  "#gemini-rewrite-toggle",
);
const shuffleGroupsToggle = document.querySelector<HTMLInputElement>(
  "#shuffle-groups-toggle",
);
const geminiStatusMessage = document.querySelector<HTMLElement>(
  "#gemini-status-message",
);
const geminiStatusCount = document.querySelector<HTMLElement>(
  "#gemini-status-count",
);
const createForm = document.querySelector<HTMLFormElement>("#create-form");
const pausePostingButton =
  document.querySelector<HTMLButtonElement>("#pause-posting-btn");
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
let groupsVisible = true;
let imagePreviewsVisible = false;
let isPostingActive = false;
let isPostingPaused = false;
let isStopRequestPending = false;
let isPauseResumeRequestPending = false;
let pauseRequestedLocally = false;
let saveSidePanelSessionTimer: number | undefined;
let isRestoringSidePanelSession = false;
let currentExtensionAccess:
  | {
      active: boolean;
      accessType: "trial" | "lifetime" | "expired";
      activationId: string;
      trialExpiresAt: string;
      lifetimeActive: boolean;
      activatedAt?: string;
    }
  | undefined;
let currentAuthSession:
  | {
      token: string;
      expiresAt: string;
      user: { id: number; email: string; created_at: string };
    }
  | undefined;

void initializeGeminiSettings();
void initializeSidePanelSession();
void initializeExtensionAccess();

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
    groupsVisible = true;
    groupsList.hidden = false;
    if (groupsSelectAll) {
      groupsSelectAll.hidden = true;
    }
    if (groupsSelectAllCheckbox) {
      groupsSelectAllCheckbox.checked = false;
      groupsSelectAllCheckbox.indeterminate = false;
    }
    const groupsSearchField = groupsSearchInput?.closest<HTMLElement>(".field");
    if (groupsSearchField) {
      groupsSearchField.hidden = false;
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

  groupsList.hidden = !groupsVisible;
  const groupsSearchField = groupsSearchInput?.closest<HTMLElement>(".field");
  if (groupsSelectAll) {
    groupsSelectAll.hidden = !groupsVisible;
  }
  if (groupsSearchField) {
    groupsSearchField.hidden = !groupsVisible;
  }
  if (groupsSearchInput) {
    groupsSearchInput.disabled = false;
  }

  if (!groupsVisible) {
    updatePostingReadiness();
    return;
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
        scheduleSaveSidePanelSession();
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

function updateGroupsSelectionSummary() {
  if (!groupsSelectionCount) {
    return;
  }

  const selectedGroupsCount = getSelectedGroupsCount();
  const selectedLabel = `${selectedGroupsCount} ${
    selectedGroupsCount === 1 ? "group" : "groups"
  } selected`;

  if (loadedGroups.length === 0) {
    groupsSelectionCount.className = "selection-count";
    groupsSelectionCount.textContent = selectedLabel;
    return;
  }

  const summary = document.createElement("span");
  summary.textContent = `${selectedLabel} from ${loadedGroups.length} loaded`;

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "groups-summary__toggle";
  toggleButton.textContent = groupsVisible ? "Hide groups" : "View groups";
  toggleButton.addEventListener("click", () => {
    groupsVisible = !groupsVisible;
    renderGroups(loadedGroups);
    scheduleSaveSidePanelSession();
  });

  groupsSelectionCount.className = "selection-count groups-summary";
  groupsSelectionCount.replaceChildren(summary, toggleButton);
}

function updatePostingReadiness() {
  const isAuthenticated = hasActiveExtensionAccess();
  const selectedGroupsCount = getSelectedGroupsCount();
  const hasPostBody = (postBodyInput?.value.trim().length ?? 0) > 0;
  const minimumDelaySeconds = Number(postIntervalMinInput?.value ?? 0);
  const maximumDelaySeconds = Number(postIntervalMaxInput?.value ?? 0);
  const hasValidSleepTime = isValidPostingInterval(
    minimumDelaySeconds,
    maximumDelaySeconds,
  );
  const maxPosts = Number(maxPostsInput?.value ?? 0);
  const hasValidMaxPosts =
    Number.isInteger(maxPosts) && maxPosts >= MIN_MAX_POSTS;

  updateGroupsSelectionSummary();

  updateGroupsSelectAllState();

  updatePostingButtonState(
    isAuthenticated,
    hasPostBody,
    selectedGroupsCount,
    hasValidSleepTime,
    hasValidMaxPosts,
  );

  if (loadGroupsButton) {
    loadGroupsButton.disabled = !isAuthenticated;
  }
}

function isValidPostingInterval(
  minimumDelaySeconds: number,
  maximumDelaySeconds: number,
): boolean {
  return (
    Number.isInteger(minimumDelaySeconds) &&
    minimumDelaySeconds >= MIN_SLEEP_SECONDS &&
    Number.isInteger(maximumDelaySeconds) &&
    maximumDelaySeconds >= minimumDelaySeconds
  );
}

function normalizePostingInterval() {
  if (!postIntervalMinInput || !postIntervalMaxInput) {
    return;
  }

  const enteredMinimum = Number(postIntervalMinInput.value);
  const minimumDelaySeconds =
    Number.isInteger(enteredMinimum) && enteredMinimum >= MIN_SLEEP_SECONDS
      ? enteredMinimum
      : MIN_SLEEP_SECONDS;
  const enteredMaximum = Number(postIntervalMaxInput.value);
  const maximumDelaySeconds =
    Number.isInteger(enteredMaximum) &&
    enteredMaximum >= minimumDelaySeconds
      ? enteredMaximum
      : Math.max(DEFAULT_MAX_SLEEP_SECONDS, minimumDelaySeconds);

  postIntervalMinInput.value = String(minimumDelaySeconds);
  postIntervalMaxInput.value = String(maximumDelaySeconds);
  updatePostingReadiness();
  scheduleSaveSidePanelSession();
}

function updatePostingButtonState(
  isAuthenticated = hasActiveExtensionAccess(),
  hasPostBody = (postBodyInput?.value.trim().length ?? 0) > 0,
  selectedGroupsCount = getSelectedGroupsCount(),
  hasValidSleepTime = (() => {
    return isValidPostingInterval(
      Number(postIntervalMinInput?.value ?? 0),
      Number(postIntervalMaxInput?.value ?? 0),
    );
  })(),
  hasValidMaxPosts = (() => {
    const maxPosts = Number(maxPostsInput?.value ?? 0);
    return Number.isInteger(maxPosts) && maxPosts >= MIN_MAX_POSTS;
  })(),
) {
  if (!startPostingButton) {
    return;
  }

  if (isPostingActive) {
    startPostingButton.disabled = isStopRequestPending;
    setButtonContent(
      startPostingButton,
      isStopRequestPending ? "Stopping..." : "Stop Posting",
      isStopRequestPending,
    );
    startPostingButton.classList.add("start-posting-btn--stop");
    updatePausePostingButtonState();
    return;
  }

  startPostingButton.classList.remove("start-posting-btn--stop");
  startPostingButton.disabled = !(
    isAuthenticated &&
    hasPostBody &&
    selectedGroupsCount > 0 &&
    hasValidSleepTime &&
    hasValidMaxPosts
  );
  setButtonContent(startPostingButton, "Start Posting");
  updatePausePostingButtonState();
}

function updatePausePostingButtonState() {
  if (!pausePostingButton) {
    return;
  }

  pausePostingButton.hidden = !isPostingActive;
  pausePostingButton.disabled = isStopRequestPending || isPauseResumeRequestPending;
  pausePostingButton.classList.toggle(
    "pause-posting-btn--resume",
    isPostingPaused,
  );

  const label = isPauseResumeRequestPending
    ? isPostingPaused
      ? "Resuming..."
      : "Pausing..."
    : isPostingPaused
      ? "Resume Posting"
      : "Pause Posting";
  setButtonContent(pausePostingButton, label, isPauseResumeRequestPending);
}

function setButtonContent(
  button: HTMLButtonElement,
  label: string,
  showLoader = false,
) {
  if (!showLoader) {
    button.textContent = label;
    return;
  }

  const loader = document.createElement("span");
  loader.className = "loader";
  loader.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.textContent = label;

  button.replaceChildren(loader, text);
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
    message.status === "paused" ||
    message.status === "posted" ||
    message.status === "failed"
  ) {
    isPostingActive = true;
    isPostingPaused =
      message.status === "paused" || pauseRequestedLocally;
    if (message.status === "paused") {
      pauseRequestedLocally = true;
      isPauseResumeRequestPending = false;
    }
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
    isPostingPaused = false;
    isStopRequestPending = false;
    isPauseResumeRequestPending = false;
    pauseRequestedLocally = false;
    updatePostingReadiness();
  } else {
    updatePostingButtonState();
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

  const existingUpdatableItem =
    message.status === "waiting" || message.status === "paused"
      ? postingProgressLog.querySelector<HTMLLIElement>(
          `li[data-status="${message.status}"][data-group-id="${CSS.escape(
            message.groupId ?? "queue",
          )}"]`,
        )
      : undefined;
  const item = existingUpdatableItem ?? document.createElement("li");
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

  if (!existingUpdatableItem) {
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
    case "paused":
      return "Pause";
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
  if (!hasActiveExtensionAccess()) {
    alert("Your trial has ended. Contact the developer to activate lifetime access.");
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
    groupsVisible = true;
    renderGroups(groups);
    scheduleSaveSidePanelSession();
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
      const groupsSearchField = groupsSearchInput.closest<HTMLElement>(".field");
      if (groupsSearchField) {
        groupsSearchField.hidden = false;
      }
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
  if (selectedImageFiles.length === 0) {
    imagePreviewsVisible = false;
  }
  syncPostImagesInput();
  renderImagePreviews();
  scheduleSaveSidePanelSession();
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

  const summary = document.createElement("div");
  summary.className = "image-preview-summary";

  const count = document.createElement("span");
  count.textContent = `${selectedImageFiles.length} ${
    selectedImageFiles.length === 1 ? "image" : "images"
  } selected`;

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "image-preview-summary__toggle";
  toggleButton.textContent = imagePreviewsVisible
    ? "Hide previews"
    : "View previews";
  toggleButton.addEventListener("click", () => {
    imagePreviewsVisible = !imagePreviewsVisible;
    renderImagePreviews();
    scheduleSaveSidePanelSession();
  });

  summary.append(count, toggleButton);

  if (!imagePreviewsVisible) {
    imagePreviewList.replaceChildren(summary);
    return;
  }

  const previews = selectedImageFiles.map((file, index) => {
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
    });

  imagePreviewList.replaceChildren(summary, ...previews);
}

postImagesInput?.addEventListener("change", () => {
  const newImageFiles = Array.from(postImagesInput.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
  selectedImageFiles = [...selectedImageFiles, ...newImageFiles];
  syncPostImagesInput();
  renderImagePreviews();
  scheduleSaveSidePanelSession();
});

postBodyInput?.addEventListener("input", () => {
  updatePostingReadiness();
  scheduleSaveSidePanelSession();
});

groupsSelectAllCheckbox?.addEventListener("change", () => {
  const shouldSelectAll = groupsSelectAllCheckbox.checked;

  if (shouldSelectAll) {
    selectedGroupIds = new Set(loadedGroups.map((group) => group.id));
  } else {
    selectedGroupIds.clear();
  }

  renderGroups(loadedGroups);
  scheduleSaveSidePanelSession();
});

groupsSearchInput?.addEventListener("input", () => {
  groupsSearchQuery = groupsSearchInput.value;
  renderGroups(loadedGroups);
  scheduleSaveSidePanelSession();
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

postIntervalMinInput?.addEventListener("change", normalizePostingInterval);
postIntervalMaxInput?.addEventListener("change", normalizePostingInterval);

maxPostsInput?.addEventListener("change", () => {
  const value = Number(maxPostsInput.value);

  if (!Number.isInteger(value) || value < MIN_MAX_POSTS) {
    maxPostsInput.value = String(DEFAULT_MAX_POSTS);
  }

  updatePostingReadiness();
  scheduleSaveSidePanelSession();
});

shuffleGroupsToggle?.addEventListener("change", () => {
  scheduleSaveSidePanelSession();
});

createForm?.addEventListener("submit", (event) => {
  event.preventDefault();
});

pausePostingButton?.addEventListener("click", async () => {
  if (!isPostingActive || isPauseResumeRequestPending || isStopRequestPending) {
    return;
  }

  isPauseResumeRequestPending = true;
  const shouldResume = isPostingPaused || pauseRequestedLocally;
  pauseRequestedLocally = !shouldResume;
  updatePausePostingButtonState();
  updatePostingButtonState();

  try {
    const request: PauseUiPostingRequest | ResumeUiPostingRequest = {
      type: shouldResume ? "RESUME_UI_POSTING" : "PAUSE_UI_POSTING",
    };
    const response = await chrome.runtime.sendMessage<
      PauseUiPostingRequest | ResumeUiPostingRequest,
      UiPostingResponse
    >(request);

    if (!response?.ok) {
      throw new Error(
        response?.error ??
          (shouldResume ? "Unable to resume posting." : "Unable to pause posting."),
      );
    }

    if (shouldResume) {
      pauseRequestedLocally = false;
      isPostingPaused = false;
      isPauseResumeRequestPending = false;
      updatePausePostingButtonState();
      updatePostingButtonState();
    } else {
      isPostingPaused = true;
      isPauseResumeRequestPending = false;
      updatePausePostingButtonState();
      updatePostingButtonState();
    }
  } catch (error) {
    isPauseResumeRequestPending = false;
    pauseRequestedLocally = isPostingPaused;
    updatePausePostingButtonState();
    updatePostingButtonState();
    alert(
      error instanceof Error
        ? error.message
        : shouldResume
          ? "Unable to resume posting."
          : "Unable to pause posting.",
    );
  }
});

startPostingButton?.addEventListener("click", async () => {
  if (isPostingActive) {
    if (isStopRequestPending || !startPostingButton) {
      return;
    }

    isStopRequestPending = true;
    pauseRequestedLocally = false;
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

  if (!hasActiveExtensionAccess()) {
    alert("Your trial has ended. Contact the developer to activate lifetime access.");
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

  const minimumDelaySeconds = Number(
    postIntervalMinInput?.value ?? MIN_SLEEP_SECONDS,
  );
  const maximumDelaySeconds = Number(
    postIntervalMaxInput?.value ?? DEFAULT_MAX_SLEEP_SECONDS,
  );
  if (!isValidPostingInterval(minimumDelaySeconds, maximumDelaySeconds)) {
    alert(
      `Posting intervals must be whole numbers of at least ${MIN_SLEEP_SECONDS} seconds, and the maximum cannot be below the minimum`,
    );
    return;
  }

  const maxPosts = Number(maxPostsInput?.value ?? DEFAULT_MAX_POSTS);
  if (!Number.isInteger(maxPosts) || maxPosts < MIN_MAX_POSTS) {
    alert("Maximum number of posts must be a whole number of at least 1");
    return;
  }

  const selectedGroups = loadedGroups.filter((group) =>
    selectedGroupIdList.includes(group.id),
  );

  if (selectedGroups.length === 0) {
    alert("Selected groups are no longer loaded. Click Load Groups and try again.");
    return;
  }

  const orderedPostingGroups = shuffleGroupsToggle?.checked
    ? shuffleGroups(selectedGroups)
    : selectedGroups;
  const postingGroups = orderedPostingGroups.slice(0, maxPosts);

  isPostingActive = true;
  isPostingPaused = false;
  isStopRequestPending = false;
  isPauseResumeRequestPending = false;
  pauseRequestedLocally = false;
  updatePostingButtonState();
  updateGroupsStatus("Preparing GraphQL posting...", 0);
  resetPostingProgress(postingGroups.length);
  scrollPostingProgressIntoView();

  try {
    const images = await Promise.all(selectedImageFiles.map(fileToUiPostImage));
    const request: StartUiPostingRequest = {
      type: "START_UI_POSTING",
      body: postText,
      groups: postingGroups.map((group) => ({
        id: group.id,
        name: group.name,
        url: group.url,
      })),
      images,
      minimumDelaySeconds,
      maximumDelaySeconds,
      maxPosts,
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
    isPostingPaused = false;
    isStopRequestPending = false;
    isPauseResumeRequestPending = false;
    pauseRequestedLocally = false;
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

window.addEventListener("beforeunload", () => {
  flushSidePanelSessionSave();
  clearImagePreviewUrls();
});

authLoginButton?.addEventListener("click", () => {
  openContactEmail();
});

authSignupButton?.addEventListener("click", () => {
  openContactWhatsApp();
});

authLogoutButton?.addEventListener("click", () => {
  void initializeExtensionAccess();
});

function hasActiveExtensionAccess(): boolean {
  return currentExtensionAccess?.active === true;
}

async function initializeExtensionAccess() {
  setAccessBusyState("Checking your trial access...");

  try {
    const identity = await getOrCreateExtensionIdentity();
    const response = await fetch(`${AUTH_API_BASE_URL}/api/extension-access/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        install_id: identity.installId,
        activation_id: identity.activationId,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      active?: boolean;
      access_type?: "trial" | "lifetime" | "expired";
      activation_id?: string;
      trial_expires_at?: string;
      lifetime_active?: boolean;
      activated_at?: string;
    };

    if (!response.ok || !payload.activation_id || !payload.trial_expires_at) {
      throw new Error(payload.error ?? "Unable to check trial access.");
    }

    currentExtensionAccess = {
      active: payload.active === true,
      accessType: payload.access_type ?? "expired",
      activationId: payload.activation_id,
      trialExpiresAt: payload.trial_expires_at,
      lifetimeActive: payload.lifetime_active === true,
      activatedAt: payload.activated_at,
    };

    await chrome.storage.local.set({
      [EXTENSION_ACTIVATION_ID_STORAGE_KEY]: payload.activation_id,
    });

    updateExtensionAccessUi();
  } catch (error) {
    currentExtensionAccess = undefined;
    showAccessUnavailable(
      error instanceof Error ? error.message : "Unable to check trial access.",
    );
  }
}

async function getOrCreateExtensionIdentity(): Promise<{
  installId: string;
  activationId: string;
}> {
  const storage = await chrome.storage.local.get([
    EXTENSION_INSTALL_ID_STORAGE_KEY,
    EXTENSION_ACTIVATION_ID_STORAGE_KEY,
  ]);

  const installId =
    typeof storage[EXTENSION_INSTALL_ID_STORAGE_KEY] === "string"
      ? storage[EXTENSION_INSTALL_ID_STORAGE_KEY]
      : crypto.randomUUID();
  const activationId =
    typeof storage[EXTENSION_ACTIVATION_ID_STORAGE_KEY] === "string"
      ? storage[EXTENSION_ACTIVATION_ID_STORAGE_KEY]
      : generateActivationId();

  await chrome.storage.local.set({
    [EXTENSION_INSTALL_ID_STORAGE_KEY]: installId,
    [EXTENSION_ACTIVATION_ID_STORAGE_KEY]: activationId,
  });

  return { installId, activationId };
}

function generateActivationId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `FGBP-${code.slice(0, 4)}-${code.slice(4)}`;
}

function updateExtensionAccessUi() {
  const access = currentExtensionAccess;
  const active = access?.active === true;
  const activationId = access?.activationId ?? "";

  if (createForm) {
    createForm.hidden = !active;
  }

  if (authSessionPill) {
    authSessionPill.hidden = !activationId;
  }

  if (authUserEmail) {
    authUserEmail.textContent = activationId;
  }

  if (authPanelTitle) {
    authPanelTitle.hidden = false;
    authPanelTitle.textContent = active
      ? access?.accessType === "lifetime"
        ? "Lifetime access is active."
        : "Your 7-day trial is active."
      : "Your trial has ended.";
  }

  if (authStatusMessage) {
    authStatusMessage.textContent = getAccessStatusMessage(access);
  }

  const showContactActions = !active;
  if (authLoginButton) {
    authLoginButton.hidden = !showContactActions;
    authLoginButton.disabled = false;
    authLoginButton.textContent = "Email Developer";
  }
  if (authSignupButton) {
    authSignupButton.hidden = !showContactActions;
    authSignupButton.disabled = false;
    authSignupButton.textContent = "WhatsApp Developer";
  }
  if (authLogoutButton) {
    authLogoutButton.hidden = active;
    authLogoutButton.disabled = false;
    authLogoutButton.textContent = "Refresh Access";
  }

  updatePostingReadiness();
}

function showAccessUnavailable(message: string) {
  if (createForm) {
    createForm.hidden = true;
  }
  if (authPanelTitle) {
    authPanelTitle.hidden = false;
    authPanelTitle.textContent = "Unable to check access.";
  }
  if (authStatusMessage) {
    authStatusMessage.textContent = `${message} Refresh access or contact the developer if this keeps happening.`;
  }
  if (authSessionPill && authUserEmail) {
    void chrome.storage.local
      .get(EXTENSION_ACTIVATION_ID_STORAGE_KEY)
      .then((storage) => {
        const activationId = storage[EXTENSION_ACTIVATION_ID_STORAGE_KEY];
        authSessionPill.hidden = typeof activationId !== "string";
        authUserEmail.textContent = typeof activationId === "string" ? activationId : "";
      });
  }
  if (authLoginButton) {
    authLoginButton.hidden = false;
    authLoginButton.disabled = false;
    authLoginButton.textContent = "Email Developer";
  }
  if (authSignupButton) {
    authSignupButton.hidden = false;
    authSignupButton.disabled = false;
    authSignupButton.textContent = "WhatsApp Developer";
  }
  if (authLogoutButton) {
    authLogoutButton.hidden = false;
    authLogoutButton.disabled = false;
    authLogoutButton.textContent = "Refresh Access";
  }
  updatePostingReadiness();
}

function setAccessBusyState(message: string) {
  if (createForm) {
    createForm.hidden = true;
  }
  if (authPanelTitle) {
    authPanelTitle.hidden = false;
    authPanelTitle.textContent = "Checking your trial access...";
  }
  if (authStatusMessage) {
    authStatusMessage.textContent = message;
  }
  if (authSessionPill) {
    authSessionPill.hidden = true;
  }
  if (authLoginButton) {
    authLoginButton.hidden = true;
  }
  if (authSignupButton) {
    authSignupButton.hidden = true;
  }
  if (authLogoutButton) {
    authLogoutButton.hidden = true;
  }
  updatePostingReadiness();
}

function getAccessStatusMessage(
  access: typeof currentExtensionAccess,
): string {
  if (!access) {
    return "Unable to load extension access.";
  }

  if (access.accessType === "lifetime") {
    return "Thanks for supporting the extension. Lifetime access is active on this browser profile.";
  }

  if (access.active) {
    return `Trial access is active until ${formatExpiry(access.trialExpiresAt)}.`;
  }

  return `Trial access ended on ${formatExpiry(access.trialExpiresAt)}. Send your Activation ID to ${TRIAL_CONTACT_EMAIL} or WhatsApp +${TRIAL_CONTACT_WHATSAPP} to activate lifetime access.`;
}

function openContactEmail() {
  const activationId = currentExtensionAccess?.activationId ?? "";
  const subject = encodeURIComponent("Facebook Groups Bulk Poster lifetime access");
  const body = encodeURIComponent(
    `Hi, I want to activate lifetime access.\n\nActivation ID: ${activationId}`,
  );
  void chrome.tabs.create({
    url: `mailto:${TRIAL_CONTACT_EMAIL}?subject=${subject}&body=${body}`,
  });
}

function openContactWhatsApp() {
  const activationId = currentExtensionAccess?.activationId ?? "";
  const text = encodeURIComponent(
    `Hi, I want to activate lifetime access for Facebook Groups Bulk Poster. Activation ID: ${activationId}`,
  );
  void chrome.tabs.create({
    url: `https://wa.me/${TRIAL_CONTACT_WHATSAPP}?text=${text}`,
  });
}

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

async function initializeSidePanelSession() {
  isRestoringSidePanelSession = true;

  try {
    const storage = await chrome.storage.local.get([
      SIDE_PANEL_SESSION_STORAGE_KEY,
    ]);
    const session = storage[SIDE_PANEL_SESSION_STORAGE_KEY] as
      | Partial<SidePanelSession>
      | undefined;

    if (!session || typeof session !== "object") {
      renderImagePreviews();
      return;
    }

    if (postBodyInput && typeof session.postBody === "string") {
      postBodyInput.value = session.postBody;
    }

    const legacyDelaySeconds =
      typeof session.delaySeconds === "number"
        ? Math.max(session.delaySeconds, MIN_SLEEP_SECONDS)
        : undefined;
    if (postIntervalMinInput) {
      const savedMinimum =
        typeof session.minimumDelaySeconds === "number"
          ? session.minimumDelaySeconds
          : legacyDelaySeconds;
      const shouldMigratePreviousDefault =
        session.intervalSettingsVersion !== 2 &&
        savedMinimum === PREVIOUS_MIN_SLEEP_SECONDS;
      postIntervalMinInput.value = String(
        shouldMigratePreviousDefault
          ? MIN_SLEEP_SECONDS
          : Math.max(savedMinimum ?? MIN_SLEEP_SECONDS, MIN_SLEEP_SECONDS),
      );
    }
    if (postIntervalMaxInput) {
      const restoredMinimum = Number(postIntervalMinInput?.value);
      const savedMaximum =
        typeof session.maximumDelaySeconds === "number"
          ? session.maximumDelaySeconds
          : legacyDelaySeconds;
      postIntervalMaxInput.value = String(
        session.intervalSettingsVersion === 2 && savedMaximum !== undefined
          ? Math.max(savedMaximum, restoredMinimum)
          : Math.max(
              DEFAULT_MAX_SLEEP_SECONDS,
              savedMaximum ?? DEFAULT_MAX_SLEEP_SECONDS,
              restoredMinimum,
            ),
      );
    }

    if (maxPostsInput && typeof session.maxPosts === "number") {
      maxPostsInput.value = String(
        Number.isInteger(session.maxPosts) && session.maxPosts >= MIN_MAX_POSTS
          ? session.maxPosts
          : DEFAULT_MAX_POSTS,
      );
    }

    if (shuffleGroupsToggle) {
      shuffleGroupsToggle.checked = session.shuffleGroups === true;
    }

    if (groupsSearchInput && typeof session.groupsSearchQuery === "string") {
      groupsSearchInput.value = session.groupsSearchQuery;
      groupsSearchQuery = session.groupsSearchQuery;
    }

    groupsVisible = session.groupsVisible !== false;
    imagePreviewsVisible = session.imagePreviewsVisible === true;

    if (Array.isArray(session.selectedGroupIds)) {
      selectedGroupIds = new Set(
        session.selectedGroupIds.filter(
          (groupId) => typeof groupId === "string",
        ),
      );
    }

    if (Array.isArray(session.images)) {
      selectedImageFiles = session.images
        .filter(isRestorableImage)
        .map((image) => dataUrlToFile(image.dataUrl, image.name, image.type));
      syncPostImagesInput();
    }

    if (
      Array.isArray(session.loadedGroups) &&
      session.loadedGroups.length > 0
    ) {
      renderGroups(session.loadedGroups.filter(isRestorableGroup));
      updateGroupsStatus(
        `Restored ${loadedGroups.length} loaded groups.`,
        loadedGroups.length,
      );
    } else {
      updatePostingReadiness();
    }

    renderImagePreviews();
  } catch (error) {
    console.warn(
      "Unable to restore side panel session.",
      error instanceof Error ? error.message : error,
    );
    renderImagePreviews();
  } finally {
    isRestoringSidePanelSession = false;
  }
}

function isRestorableGroup(value: unknown): value is FacebookGroup {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FacebookGroup).id === "string" &&
    typeof (value as FacebookGroup).name === "string" &&
    typeof (value as FacebookGroup).url === "string"
  );
}

function isRestorableImage(value: unknown): value is UiPostImage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as UiPostImage).name === "string" &&
    typeof (value as UiPostImage).type === "string" &&
    typeof (value as UiPostImage).dataUrl === "string"
  );
}

function dataUrlToFile(dataUrl: string, name: string, type: string): File {
  const [metadata, base64Data = ""] = dataUrl.split(",");
  const mimeType = metadata.match(/data:([^;]+)/)?.[1] || type;
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], name, { type: mimeType || type });
}

function scheduleSaveSidePanelSession() {
  if (isRestoringSidePanelSession) {
    return;
  }

  if (saveSidePanelSessionTimer !== undefined) {
    window.clearTimeout(saveSidePanelSessionTimer);
  }

  saveSidePanelSessionTimer = window.setTimeout(() => {
    saveSidePanelSessionTimer = undefined;
    void saveSidePanelSession();
  }, 400);
}

function flushSidePanelSessionSave() {
  if (saveSidePanelSessionTimer !== undefined) {
    window.clearTimeout(saveSidePanelSessionTimer);
    saveSidePanelSessionTimer = undefined;
  }

  void saveSidePanelSession();
}

async function saveSidePanelSession() {
  try {
    const images = await Promise.all(selectedImageFiles.map(fileToUiPostImage));
    const session: SidePanelSession = {
      postBody: postBodyInput?.value ?? "",
      minimumDelaySeconds: Number(
        postIntervalMinInput?.value ?? MIN_SLEEP_SECONDS,
      ),
      maximumDelaySeconds: Number(
        postIntervalMaxInput?.value ?? DEFAULT_MAX_SLEEP_SECONDS,
      ),
      intervalSettingsVersion: 2,
      maxPosts: Number(maxPostsInput?.value ?? DEFAULT_MAX_POSTS),
      shuffleGroups: Boolean(shuffleGroupsToggle?.checked),
      loadedGroups,
      selectedGroupIds: Array.from(selectedGroupIds),
      groupsSearchQuery,
      groupsVisible,
      imagePreviewsVisible,
      images,
    };

    await chrome.storage.local.set({
      [SIDE_PANEL_SESSION_STORAGE_KEY]: session,
    });
  } catch (error) {
    console.warn(
      "Unable to save side panel session.",
      error instanceof Error ? error.message : error,
    );
  }
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

function shuffleGroups<T>(groups: T[]): T[] {
  const shuffledGroups = [...groups];

  for (let index = shuffledGroups.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledGroups[index], shuffledGroups[swapIndex]] = [
      shuffledGroups[swapIndex],
      shuffledGroups[index],
    ];
  }

  return shuffledGroups;
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
