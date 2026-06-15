import type {
  FacebookGroup,
  GroupExtractionStatusMessage,
  LoadGroupsResponse,
  StartUiPostingRequest,
  UiPostImage,
  UiPostingResponse,
  UiPostingStatusMessage,
} from "./config";

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
const postBodyInput =
  document.querySelector<HTMLTextAreaElement>("#post-body-input");
const postImagesInput =
  document.querySelector<HTMLInputElement>("#post-images-input");
const imagePreviewList = document.querySelector<HTMLElement>(
  "#image-preview-list",
);
const postSleepInput =
  document.querySelector<HTMLInputElement>("#post-sleep-input");
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
const selectedImagePreviewUrls: string[] = [];
let selectedImageFiles: File[] = [];
let loadedGroups: FacebookGroup[] = [];

function renderGroups(groups: FacebookGroup[]) {
  if (!groupsList) {
    return;
  }

  loadedGroups = groups;

  if (groups.length === 0) {
    groupsList.className = "empty-state";
    groupsList.textContent = "No groups found.";
    return;
  }

  groupsList.className = "groups-list";
  groupsList.replaceChildren(
    ...groups.map((group) => {
      const item = document.createElement("label");
      item.className = "group-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = group.id;
      checkbox.className = "group-item__checkbox";
      checkbox.addEventListener("change", updatePostingReadiness);

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
    }),
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

function getSelectedGroupsCount() {
  return document.querySelectorAll<HTMLInputElement>(
    ".group-item__checkbox:checked",
  ).length;
}

function updatePostingReadiness() {
  const selectedGroupsCount = getSelectedGroupsCount();
  const hasPostBody = (postBodyInput?.value.trim().length ?? 0) > 0;
  const sleepTime = Number(postSleepInput?.value ?? 0);
  const hasValidSleepTime = Number.isFinite(sleepTime) && sleepTime >= 300;

  if (groupsSelectionCount) {
    groupsSelectionCount.textContent = `${selectedGroupsCount} ${
      selectedGroupsCount === 1 ? "group" : "groups"
    } selected`;
  }

  if (startPostingButton) {
    startPostingButton.disabled = !(
      hasPostBody &&
      selectedGroupsCount > 0 &&
      hasValidSleepTime
    );
  }
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
    message.status === "done" ||
    message.status === "rate_limited"
  ) {
    if (startPostingButton) {
      startPostingButton.disabled = false;
      startPostingButton.textContent = "START POSTING";
    }

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

  const item = document.createElement("li");
  item.dataset.status = message.status;
  const count =
    message.current > 0 && message.total > 0
      ? `${message.current}/${message.total} · `
      : "";
  item.textContent = `${count}${message.message}${
    message.error ? `: ${message.error}` : ""
  }`;
  postingProgressLog.prepend(item);

  while (postingProgressLog.children.length > 12) {
    postingProgressLog.lastElementChild?.remove();
  }
}

loadGroupsButton?.addEventListener("click", async () => {
  if (!groupsList || !loadGroupsButton) {
    return;
  }

  loadGroupsButton.disabled = true;
  loadGroupsButton.textContent = "Loading...";
  updateGroupsStatus("Starting group extraction...", 0);
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
  selectedImageFiles = Array.from(postImagesInput.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
  syncPostImagesInput();
  renderImagePreviews();
});

postBodyInput?.addEventListener("input", updatePostingReadiness);

postSleepInput?.addEventListener("change", () => {
  const value = Number(postSleepInput.value);

  if (!Number.isFinite(value) || value < 300) {
    postSleepInput.value = "300";
  }

  updatePostingReadiness();
});

createForm?.addEventListener("submit", (event) => {
  event.preventDefault();
});

startPostingButton?.addEventListener("click", async () => {
  if (!startPostingButton) {
    return;
  }

  const selectedGroupIds = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      ".group-item__checkbox:checked",
    ),
  ).map((checkbox) => checkbox.value);

  if (selectedGroupIds.length === 0) {
    alert("Please select at least one group");
    return;
  }

  const postText = postBodyInput?.value.trim() ?? "";
  if (postText.length === 0) {
    alert("Please enter post text");
    return;
  }

  const sleepTime = Number(postSleepInput?.value ?? 300);
  if (!Number.isFinite(sleepTime) || sleepTime < 300) {
    alert("Sleep time must be at least 300 seconds");
    return;
  }

  const selectedGroups = loadedGroups.filter((group) =>
    selectedGroupIds.includes(group.id),
  );

  if (selectedGroups.length === 0) {
    alert("Selected groups are no longer loaded. Click Load Groups and try again.");
    return;
  }

  startPostingButton.disabled = true;
  startPostingButton.textContent = "Posting...";
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
    startPostingButton.disabled = false;
    startPostingButton.textContent = "START POSTING";
    alert(
      error instanceof Error
        ? error.message
        : "Unable to start GraphQL posting.",
    );
  }
});

updatePostingReadiness();

window.addEventListener("beforeunload", clearImagePreviewUrls);

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
