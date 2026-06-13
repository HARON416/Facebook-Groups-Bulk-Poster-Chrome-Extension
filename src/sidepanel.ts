import type {
  FacebookGroup,
  GroupExtractionStatusMessage,
  LoadGroupsResponse,
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
const imagePreviewList =
  document.querySelector<HTMLElement>("#image-preview-list");
const postSleepInput =
  document.querySelector<HTMLInputElement>("#post-sleep-input");
const createForm = document.querySelector<HTMLFormElement>("#create-form");
const startPostingButton =
  document.querySelector<HTMLButtonElement>("#start-posting-btn");
const selectedImagePreviewUrls: string[] = [];
let selectedImageFiles: File[] = [];

function renderGroups(groups: FacebookGroup[]) {
  if (!groupsList) {
    return;
  }

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
  (message: GroupExtractionStatusMessage) => {
    if (message.type !== "GROUP_EXTRACTION_STATUS") {
      return;
    }

    updateGroupsStatus(message.message, message.loadedCount);
  },
);

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
    updateGroupsStatus(`Finished loading ${groups.length} groups.`, groups.length);
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

updatePostingReadiness();

window.addEventListener("beforeunload", clearImagePreviewUrls);
