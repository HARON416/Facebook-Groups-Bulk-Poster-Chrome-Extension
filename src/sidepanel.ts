import type {
  FacebookGroup,
  GetPostingQueueStatusRequest,
  GroupExtractionStatusMessage,
  LoadGroupsResponse,
  PauseUiPostingRequest,
  PostingQueueStatusResponse,
  PostingTiming,
  ResumeUiPostingRequest,
  StopUiPostingRequest,
  StartUiPostingRequest,
  StatusBannerTone,
  UiPostImage,
  UiPostingResponse,
  UiPostingStatusMessage,
} from "./config";
import { sendPostingRequest } from "./posting-request-transfer";
import { groupsInSelectionOrder } from "./group-posting-order";
import { overlappingTarget, type DragBounds } from "./drag-target";
import {
  initializePostingWizard,
  type PostingWizardMessages,
} from "./posting-wizard";
import { initializePostEditor } from "./rich-text-editor";
import {
  initializeSchedulePicker,
  type SchedulePicker,
} from "./schedule-picker";
import { getLocale, initializeI18n, msg } from "./i18n";
const SIDE_PANEL_SESSION_STORAGE_KEY = "sidePanelSession";
const SIDE_PANEL_DRAFT_IMAGES_STORAGE_KEY = "sidePanelDraftImages";
const MIN_SLEEP_SECONDS = 60;
const PREVIOUS_MIN_SLEEP_SECONDS = 120;
const DEFAULT_MAX_SLEEP_SECONDS = 300;

const toastRegion = document.querySelector<HTMLElement>("#toast-region");
const APP_THEME_STORAGE_KEY = "postika:theme";

function showToast(
  message: string,
  tone: StatusBannerTone = "info",
  durationMs = tone === "error" ? 8_000 : 5_000,
) {
  if (!toastRegion) {
    console[tone === "error" ? "error" : "info"](message);
    return;
  }

  while (toastRegion.childElementCount >= 4) {
    toastRegion.firstElementChild?.remove();
  }

  const toast = document.createElement("section");
  toast.className = `toast-card toast-card--${tone}`;
  toast.dataset.message = message;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");

  const accent = document.createElement("span");
  accent.className = "toast-card__accent";
  accent.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "toast-card__content";
  const title = document.createElement("strong");
  title.textContent = toastTitle(tone);
  const copy = document.createElement("span");
  copy.textContent = localizeAppText(message);
  content.append(title, copy);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-card__close";
  close.setAttribute("aria-label", msg("dismissNotification"));
  close.textContent = "×";

  let removalTimer: number | undefined;
  const dismiss = () => {
    if (!toast.isConnected || toast.classList.contains("toast-card--closing")) {
      return;
    }
    if (removalTimer !== undefined) {
      window.clearTimeout(removalTimer);
    }
    toast.classList.add("toast-card--closing");
    window.setTimeout(() => toast.remove(), 170);
  };
  close.addEventListener("click", dismiss);
  toast.append(accent, content, close);
  toastRegion.append(toast);
  removalTimer = window.setTimeout(dismiss, durationMs);
}

function initializeAppMenu() {
  const trigger =
    document.querySelector<HTMLButtonElement>("#app-menu-trigger");
  const menu = document.querySelector<HTMLElement>("#app-menu");
  const title = document.querySelector<HTMLElement>("#app-menu-title");
  const themeToggle =
    document.querySelector<HTMLButtonElement>("#theme-toggle");
  const themeToggleLabel =
    themeToggle?.querySelector<HTMLElement>(".app-menu__label");
  if (!trigger || !menu || !title || !themeToggle || !themeToggleLabel) return;

  let theme: "light" | "dark" = "light";
  try {
    theme =
      localStorage.getItem(APP_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch (error) {
    console.error("Could not load the appearance setting.", error);
    showToast(msg("themePreferenceLoadFailure"), "warning");
  }

  const render = () => {
    trigger.setAttribute("aria-label", msg("settingsAndSupport"));
    title.textContent = msg("settingsAndSupport");
    themeToggleLabel.textContent = msg("darkMode");
    themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    themeToggle.setAttribute("aria-label", msg("darkMode"));
    menu
      .querySelector<HTMLAnchorElement>(".app-menu__whatsapp")
      ?.replaceChildren(document.createTextNode(msg("whatsappDeveloper")));
    menu
      .querySelector<HTMLAnchorElement>(".app-menu__email")
      ?.replaceChildren(document.createTextNode(msg("emailDeveloper")));
    menu
      .querySelector<HTMLElement>(".app-menu__download .app-menu__label")
      ?.replaceChildren(document.createTextNode(msg("downloadDesktopApp")));
  };

  const applyTheme = (persist: boolean) => {
    document.documentElement.dataset.theme = theme;
    render();
    if (!persist) return;
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.error("Could not save the appearance setting.", error);
      showToast(msg("themePreferenceSaveFailure"), "error");
    }
  };

  const close = (restoreFocus = false) => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  };

  trigger.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    trigger.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) themeToggle.focus();
  });
  themeToggle.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    applyTheme(true);
  });
  menu.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) {
      close();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      event.target instanceof Node &&
      !menu.contains(event.target) &&
      !trigger.contains(event.target)
    ) {
      close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      close(true);
    }
  });
  window.addEventListener("postika:locale-changed", render);

  applyTheme(false);
}

function toastTitle(tone: StatusBannerTone): string {
  switch (tone) {
    case "success":
      return msg("success");
    case "warning":
      return msg("pleaseCheck");
    case "error":
      return msg("somethingWentWrong");
    default:
      return msg("information");
  }
}

function refreshToastTranslations() {
  toastRegion?.querySelectorAll<HTMLElement>(".toast-card").forEach((toast) => {
    const tone = (["success", "warning", "error"] as const).find((candidate) =>
      toast.classList.contains(`toast-card--${candidate}`),
    );
    const title = toast.querySelector<HTMLElement>(
      ".toast-card__content strong",
    );
    const copy = toast.querySelector<HTMLElement>(".toast-card__content span");
    const close = toast.querySelector<HTMLButtonElement>(".toast-card__close");
    if (title) title.textContent = toastTitle(tone ?? "info");
    if (copy) copy.textContent = localizeAppText(toast.dataset.message ?? "");
    close?.setAttribute("aria-label", msg("dismissNotification"));
  });
}

type SidePanelSession = {
  minimumDelaySeconds: number;
  maximumDelaySeconds: number;
  delaySeconds?: number;
  intervalSettingsVersion: number;
  loadedGroups: FacebookGroup[];
  selectedGroupIds: string[];
  groupsSearchQuery: string;
  groupsVisible?: boolean;
  imagePreviewsVisible: boolean;
  postBodyHtml: string;
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
const postImagesInput =
  document.querySelector<HTMLInputElement>("#post-images-input");
const groupsPhotoDropzone =
  document.querySelector<HTMLElement>("#image-picker");
const groupsPhotoStatus = document.querySelector<HTMLElement>(
  "#groups-photo-status",
);
const imagePreviewList = document.querySelector<HTMLElement>(
  "#image-preview-list",
);
const postIntervalMinInput = document.querySelector<HTMLInputElement>(
  "#post-interval-min-input",
);
const postIntervalMaxInput = document.querySelector<HTMLInputElement>(
  "#post-interval-max-input",
);
const createForm = document.querySelector<HTMLFormElement>("#create-form");
const photoLightbox = document.querySelector<HTMLElement>("#photo-lightbox");
const photoLightboxBackdrop = document.querySelector<HTMLElement>(
  "#photo-lightbox-backdrop",
);
const photoLightboxClose = document.querySelector<HTMLButtonElement>(
  "#photo-lightbox-close",
);
const photoLightboxTitle = document.querySelector<HTMLElement>(
  "#photo-lightbox-title",
);
const photoLightboxImage = document.querySelector<HTMLImageElement>(
  "#photo-lightbox-image",
);
const photoLightboxCounter = document.querySelector<HTMLElement>(
  "#photo-lightbox-counter",
);
const photoLightboxFilename = document.querySelector<HTMLElement>(
  "#photo-lightbox-filename",
);
const photoLightboxPrevious = document.querySelector<HTMLButtonElement>(
  "#photo-lightbox-previous",
);
const photoLightboxNext = document.querySelector<HTMLButtonElement>(
  "#photo-lightbox-next",
);
const photoLightboxThumbnails = document.querySelector<HTMLElement>(
  "#photo-lightbox-thumbnails",
);
const pausePostingButton =
  document.querySelector<HTMLButtonElement>("#pause-posting-btn");
const stopPostingButton =
  document.querySelector<HTMLButtonElement>("#stop-posting-btn");
const startPostingButton =
  document.querySelector<HTMLButtonElement>("#start-posting-btn");
const openScheduleButton =
  document.querySelector<HTMLButtonElement>("#open-schedule-btn");
const cancelScheduleButton = document.querySelector<HTMLButtonElement>(
  "#cancel-schedule-btn",
);
const confirmScheduleButton = document.querySelector<HTMLButtonElement>(
  "#confirm-schedule-btn",
);
const schedulePanel = document.querySelector<HTMLElement>("#schedule-panel");
const scheduleTimezoneNote = document.querySelector<HTMLElement>(
  "#schedule-timezone-note",
);
const schedulePickerRoot = document.querySelector<HTMLElement>(
  "#schedule-time-picker",
);
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
const postingProgressTrack = document.querySelector<HTMLElement>(
  ".posting-progress__bar",
);
const postingProgressSuccess = document.querySelector<HTMLElement>(
  "#posting-progress-success",
);
const postingProgressPending = document.querySelector<HTMLElement>(
  "#posting-progress-pending",
);
const postingProgressFailed = document.querySelector<HTMLElement>(
  "#posting-progress-failed",
);
const postingProgressRemaining = document.querySelector<HTMLElement>(
  "#posting-progress-remaining",
);
const postingTiming = document.querySelector<HTMLElement>("#posting-timing");
const postingTimingLabel = document.querySelector<HTMLElement>(
  "#posting-timing-label",
);
const postingElapsedTime = document.querySelector<HTMLElement>(
  "#posting-elapsed-time",
);
const postingItemTimingLabel = document.querySelector<HTMLElement>(
  "#posting-item-timing-label",
);
const postingItemTime =
  document.querySelector<HTMLElement>("#posting-item-time");
const postingProgressCurrent = document.querySelector<HTMLElement>(
  "#posting-progress-current",
);
const postingProgressLog = document.querySelector<HTMLOListElement>(
  "#posting-progress-log",
);
const postingProgressPostedFilterButton =
  document.querySelector<HTMLButtonElement>("#posting-progress-filter-posted");
const postingProgressPendingFilterButton =
  document.querySelector<HTMLButtonElement>("#posting-progress-filter-pending");
const postingProgressFailedFilterButton =
  document.querySelector<HTMLButtonElement>("#posting-progress-filter-failed");
const selectedImagePreviewUrls: string[] = [];
const photoLightboxUrls: string[] = [];
let selectedImageFiles: File[] = [];
let groupPhotoAdditionQueue = Promise.resolve();
const imageContentSignatureCache = new WeakMap<File, Promise<string>>();
let latestGroupsPhotoStatus = "";
let latestGroupsPhotoStatusIsError = false;
type PostingLogFilter = "all" | "posted" | "pending" | "failed";
let groupsPostingLogFilter: PostingLogFilter = "all";
let postingLogMessages: UiPostingStatusMessage[] = [];
let latestGroupsPostingTiming: PostingTiming | undefined;
let latestUiPostingStatusMessage: UiPostingStatusMessage | undefined;
let latestGroupsStatusMessage = "";
let latestGroupsStatusCount = 0;
let draggedGroupPhotoIndex: number | undefined;
let selectedImageDragPointer: {
  pointerId: number;
  index: number;
  element: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
} | null = null;
let selectedImageDragPreview: HTMLElement | null = null;
let selectedImageDragFrame = 0;
let selectedImageDropTarget: HTMLElement | undefined;
let selectedImageDropTargetIndex: number | undefined;
let selectedImageDropSide: "before" | "after" = "before";
let suppressNextImagePreviewClick = false;
let photoLightboxIndex = 0;
let photoLightboxReturnFocus: HTMLElement | undefined;
let loadedGroups: FacebookGroup[] = [];
let hasRenderedGroups = false;
let selectedGroupIds = new Set<string>();
let groupsSearchQuery = "";
let shouldSaveDraftImages = false;
let imagePreviewsVisible = false;
let isPostingActive = false;
let isPostingScheduling = false;
let isPostingScheduled = false;
let isPostingPaused = false;
let isStopRequestPending = false;
let isPauseResumeRequestPending = false;
let isScheduleOpen = false;
let isScheduleTimeValid = false;
let saveSidePanelSessionTimer: number | undefined;
let isRestoringSidePanelSession = false;
const postEditor = initializePostEditor(() => {
  updatePostingReadiness();
  scheduleSaveSidePanelSession();
});
const postingWizard = initializePostingWizard(
  () => ({
    ...postEditor.getContent(),
    images: selectedImageFiles,
    groups: groupsInSelectionOrder(loadedGroups, Array.from(selectedGroupIds)),
    busy: isPostingActive,
  }),
  updatePostingButtonState,
  (): PostingWizardMessages => ({
    nextSelectGroups: msg("nextSelectGroups"),
    addTextAndImage: msg("addTextAndImageToContinue"),
    addText: msg("addPostTextToContinue"),
    addImage: msg("addImageToContinue"),
    selectOneGroup: msg("selectOneGroup"),
    oneGroupSelectedContinue: msg("oneGroupSelectedContinue"),
    groupsSelectedContinue: (count) => msg("groupsSelectedContinue", count),
    oneImageCount: msg("oneImageCount"),
    imageCount: (count) => msg("imageCount", count),
    oneGroupSelected: msg("oneGroupSelected"),
    groupsSelectedCount: (count) => msg("groupsSelectedCount", count),
  }),
);
if (!schedulePickerRoot) {
  throw new Error("The scheduling time picker could not be initialized.");
}
const schedulePicker: SchedulePicker = initializeSchedulePicker(
  schedulePickerRoot,
  (valid) => {
    isScheduleTimeValid = valid;
    if (confirmScheduleButton) {
      confirmScheduleButton.disabled = !valid;
    }
  },
  () => msg("twentyFourHourClock"),
);
updateScheduleControls();
void initializeSidePanelSession();
// Discard abandoned disk-backed handoffs from older builds.
indexedDB.deleteDatabase("postika-posting-requests");
void restorePostingQueueStatus();

initializePasteNormalization();

function initializePasteNormalization() {
  document.addEventListener("paste", (event) => {
    const control = event.target;
    if (!isPasteNormalizableControl(control) || !event.clipboardData) {
      return;
    }

    const pastedText = event.clipboardData.getData("text/plain");
    const normalizedText = pastedText.normalize("NFKC");
    if (normalizedText === pastedText) {
      return;
    }

    event.preventDefault();
    const selectionStart = control.selectionStart ?? control.value.length;
    const selectionEnd = control.selectionEnd ?? selectionStart;
    const availableCharacters =
      control.maxLength >= 0
        ? Math.max(
            control.maxLength -
              (control.value.length - (selectionEnd - selectionStart)),
            0,
          )
        : normalizedText.length;
    const replacement = normalizedText.slice(0, availableCharacters);
    control.setRangeText(replacement, selectionStart, selectionEnd, "end");
    control.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: replacement,
        inputType: "insertFromPaste",
      }),
    );
  });
}

function isPasteNormalizableControl(
  target: EventTarget | null,
): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) {
    return !target.disabled && !target.readOnly;
  }
  if (!(target instanceof HTMLInputElement)) {
    return false;
  }
  return (
    !target.disabled &&
    !target.readOnly &&
    ["text", "search", "email", "tel", "url"].includes(target.type)
  );
}

function getImageContentSignature(file: File): Promise<string> {
  const cachedSignature = imageContentSignatureCache.get(file);
  if (cachedSignature) {
    return cachedSignature;
  }

  const signature = file
    .arrayBuffer()
    .then((contents) => crypto.subtle.digest("SHA-256", contents))
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    )
    .catch(() => `${file.name}:${file.size}:${file.lastModified}`);
  imageContentSignatureCache.set(file, signature);
  return signature;
}

async function removeDuplicateImages(
  candidates: File[],
  existingImages: File[],
): Promise<{ uniqueImages: File[]; duplicateCount: number }> {
  const existingSignatures = new Set(
    await Promise.all(existingImages.map(getImageContentSignature)),
  );
  const uniqueImages: File[] = [];
  let duplicateCount = 0;

  for (const file of candidates) {
    const signature = await getImageContentSignature(file);
    if (existingSignatures.has(signature)) {
      duplicateCount += 1;
      continue;
    }
    existingSignatures.add(signature);
    uniqueImages.push(file);
  }

  return { uniqueImages, duplicateCount };
}

function openGroupsPhotoLightbox(index: number, returnFocus: HTMLElement) {
  openPhotoLightbox(index, returnFocus);
}

function getPhotoLightboxFiles() {
  return selectedImageFiles;
}

function openPhotoLightbox(index: number, returnFocus: HTMLElement) {
  const files = selectedImageFiles;
  if (!photoLightbox || index < 0 || index >= files.length) {
    return;
  }

  closePhotoLightbox(false);
  photoLightboxReturnFocus = returnFocus;
  photoLightboxIndex = index;

  files.forEach((file) => {
    photoLightboxUrls.push(URL.createObjectURL(file));
  });

  if (photoLightboxTitle) {
    photoLightboxTitle.textContent = msg("photoImagePreview");
  }

  photoLightbox.hidden = false;
  document.body.classList.add("photo-lightbox-open");
  renderPhotoLightboxThumbnails();
  renderPhotoLightbox();
  photoLightboxClose?.focus();
}

function renderPhotoLightbox() {
  const files = getPhotoLightboxFiles();
  const file = files[photoLightboxIndex];
  const previewUrl = photoLightboxUrls[photoLightboxIndex];
  if (!file || !previewUrl) {
    closePhotoLightbox();
    return;
  }

  if (photoLightboxImage) {
    photoLightboxImage.src = previewUrl;
    photoLightboxImage.alt = file.name;
  }
  if (photoLightboxCounter) {
    photoLightboxCounter.textContent = `${photoLightboxIndex + 1} / ${files.length}`;
  }
  if (photoLightboxFilename) {
    photoLightboxFilename.textContent = file.name;
  }
  if (photoLightboxPrevious) {
    photoLightboxPrevious.disabled = photoLightboxIndex === 0;
  }
  if (photoLightboxNext) {
    photoLightboxNext.disabled = photoLightboxIndex === files.length - 1;
  }

  photoLightboxThumbnails
    ?.querySelectorAll<HTMLButtonElement>(".photo-lightbox__thumbnail")
    .forEach((thumbnail, index) => {
      const active = index === photoLightboxIndex;
      thumbnail.classList.toggle("photo-lightbox__thumbnail--active", active);
      thumbnail.setAttribute("aria-current", active ? "true" : "false");
      if (active) {
        thumbnail.scrollIntoView({ block: "nearest", inline: "center" });
      }
    });
}

function renderPhotoLightboxThumbnails() {
  if (!photoLightboxThumbnails) {
    return;
  }

  const thumbnails = getPhotoLightboxFiles().map((file, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "photo-lightbox__thumbnail";
    button.setAttribute("aria-label", msg("viewPhoto", index + 1, file.name));

    const image = document.createElement("img");
    image.src = photoLightboxUrls[index] ?? "";
    image.alt = "";
    image.draggable = false;

    button.append(image);
    button.addEventListener("click", () => {
      photoLightboxIndex = index;
      renderPhotoLightbox();
    });
    return button;
  });

  photoLightboxThumbnails.replaceChildren(...thumbnails);
}

function movePhotoLightbox(direction: -1 | 1) {
  const nextIndex = photoLightboxIndex + direction;
  if (nextIndex < 0 || nextIndex >= getPhotoLightboxFiles().length) {
    return;
  }

  photoLightboxIndex = nextIndex;
  renderPhotoLightbox();
}

function closePhotoLightbox(returnFocus = true) {
  if (!photoLightbox) {
    return;
  }

  photoLightbox.hidden = true;
  document.body.classList.remove("photo-lightbox-open");
  if (photoLightboxImage) {
    photoLightboxImage.src = "";
    photoLightboxImage.alt = "";
  }
  photoLightboxThumbnails?.replaceChildren();
  photoLightboxUrls.forEach((url) => URL.revokeObjectURL(url));
  photoLightboxUrls.length = 0;

  if (returnFocus) {
    photoLightboxReturnFocus?.focus();
  }
  photoLightboxReturnFocus = undefined;
}

photoLightboxClose?.addEventListener("click", () => {
  closePhotoLightbox();
});

photoLightboxBackdrop?.addEventListener("click", () => {
  closePhotoLightbox();
});

photoLightboxPrevious?.addEventListener("click", () => {
  movePhotoLightbox(-1);
});

photoLightboxNext?.addEventListener("click", () => {
  movePhotoLightbox(1);
});

document.addEventListener("keydown", (event) => {
  if (photoLightbox?.hidden !== false) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closePhotoLightbox();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    movePhotoLightbox(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    movePhotoLightbox(1);
  }
});

function renderGroups(groups: FacebookGroup[]) {
  if (!groupsList) {
    return;
  }

  hasRenderedGroups = true;
  loadedGroups = groups;
  updateLoadGroupsButtonLabel();
  selectedGroupIds = new Set(
    Array.from(selectedGroupIds).filter((groupId) =>
      groups.some((group) => group.id === groupId),
    ),
  );

  if (groups.length === 0) {
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
    groupsList.textContent = msg("noGroupsFound");
    updatePostingReadiness();
    return;
  }

  groupsList.hidden = false;
  const groupsSearchField = groupsSearchInput?.closest<HTMLElement>(".field");
  if (groupsSelectAll) {
    groupsSelectAll.hidden = false;
  }
  if (groupsSearchField) {
    groupsSearchField.hidden = false;
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
    groupsList.textContent = msg("noGroupsMatch", groupsSearchQuery.trim());
    updatePostingReadiness();
    return;
  }

  const selectedGroups = groupsInSelectionOrder(
    visibleGroups,
    selectedGroupIds,
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
      msg("selectedGroupsSection"),
      selectedGroups,
      normalizedQuery.length
        ? msg("noSelectedGroupsMatch")
        : msg("noSelectedGroupsYet"),
    ),
    createSection(
      msg("otherGroups"),
      remainingGroups,
      normalizedQuery.length
        ? msg("noRemainingGroupsMatch")
        : msg("noOtherGroups"),
    ),
  );
  updatePostingReadiness();
}

function updateLoadGroupsButtonLabel() {
  if (!loadGroupsButton || loadGroupsButton.disabled) return;
  loadGroupsButton.textContent = msg(
    loadedGroups.length > 0 ? "refreshGroups" : "findMyGroups",
  );
}

function updateGroupsStatus(message: string, loadedCount: number) {
  latestGroupsStatusMessage = message;
  latestGroupsStatusCount = loadedCount;
  if (groupsStatusMessage) {
    groupsStatusMessage.textContent = localizeAppText(message);
  }

  if (groupsStatusCount) {
    groupsStatusCount.textContent = msg("loadedCount", loadedCount);
  }
}

function localizeAppText(text: string): string {
  const exactMessages: Record<string, string> = {
    "Finding the groups you have joined...": msg("findingJoinedGroups"),
    "Getting ready to post...": msg("gettingReadyToPost"),
    "Could not find your groups. Check that you are signed into Facebook and try again.":
      msg("couldNotFindGroups"),
    "Starting group extraction...": msg("groupExtractionStarting"),
    "Preparing current tab...": msg("preparingCurrentTab"),
    "Open Facebook first. This extension only works on facebook.com.":
      msg("openFacebookFirst"),
    "Opening Facebook joined groups page...": msg("openingJoinedGroupsPage"),
    "Facebook joined groups page loaded.": msg("joinedGroupsPageLoaded"),
    "Changing joined groups sort to trigger Facebook groups request...":
      msg("changingGroupSort"),
    "Waiting for fresh Facebook groups request...": msg(
      "waitingForGroupsRequest",
    ),
    "Captured groups request. Preparing extraction...": msg(
      "capturedGroupsRequest",
    ),
    "Unable to fetch groups.": msg("unableToFetchGroups"),
    "Unable to open joined groups in the current tab.": msg(
      "unableToOpenJoinedGroups",
    ),
    "Unable to trigger joined groups sort.": msg("unableToTriggerGroupsSort"),
    "The joined groups sort control changed. Please load groups again.":
      msg("groupsSortChanged"),
    "Unable to read groups from joined groups tab.": msg("unableToReadGroups"),
    "Facebook did not return group data.": msg("noGroupDataReturned"),
    "Select at least one group before posting.": msg("selectAtLeastOneGroup"),
    "Select at least one post before posting.": msg("selectPostBeforePosting"),
    "Choose a future date and time for your post.": msg("futureDateRequired"),
    "Your queue is scheduled.": msg("queueScheduled"),
    "Scheduled posting cancelled.": msg("scheduledPostingCancelled"),
    "The scheduled queue could not be started. Please schedule it again.": msg(
      "scheduledQueueStartFailure",
    ),
    "Could not schedule this queue. Check that Chrome storage is available and try again.":
      msg("couldNotScheduleQueue"),
    "Unable to find the active tab for posting.": msg("noActiveTabForPosting"),
    "None of the selected Groups has a visible post composer. Select another standard Group and try again.":
      msg("noVisibleGroupComposer"),
    "Could not set up photo uploads from your first post. Please start posting again.":
      msg("photoUploadSetupFailed"),
    "Facebook did not provide the request values needed to continue. Try again.":
      msg("postingRequestValuesMissing"),
    "Facebook did not confirm whether the first post was submitted. Check Facebook before trying again.":
      msg("unconfirmedFirstPost"),
    "Posting is already in progress.": msg("postingInProgress"),
    "Wait for the current posts to finish, or stop posting before starting again.":
      msg("waitForQueue"),
    "Preparing the first post...": msg("preparingFirstPost"),
    "Continuing to post automatically...": msg("continuingAutomatically"),
    "Your post is pending": msg("pendingPost"),
    "Automatic posting stopped.": msg("automaticPostingStopped"),
    "Posting stopped by user.": msg("manualStop"),
    "Facebook temporarily blocked posting on this account. Queue stopped. Try again later.":
      msg("accountTemporarilyBlocked"),
    "Posting paused.": msg("postingPaused"),
    "Internet connection lost. Posting paused until the connection returns.":
      msg("postingPausedOffline"),
    "Posting resumed.": msg("postingResumed"),
    "Internet connection restored. Resuming posting.": msg(
      "postingResumedOnline",
    ),
    "Internet connection restored. Posting remains paused until you resume.":
      msg("postingStillPausedOnline"),
    "Your post is awaiting admin approval. If the admin team approves it, it'll become visible in the group.":
      msg("pendingApprovalDetail"),
    "Only image files can be added.": msg("imageFilesOnly"),
    "Unable to add images.": msg("unableToAddImages"),
    "Unable to resume posting.": msg("unableToResume"),
    "Unable to pause posting.": msg("unableToPause"),
    "Unable to stop posting.": msg("unableToStop"),
    "Please select at least one group.": msg("selectAtLeastOneGroup"),
    "Write your post and add at least one image before posting.":
      msg("addPostAndImage"),
    "Your selected groups are no longer available. Click Find my groups, select them again, and try posting.":
      msg("groupsNoLongerAvailable"),
    "Could not start posting. Please try again.": msg("couldNotStartPosting"),
    "Facebook groups request failed.": msg("unableToFetchGroups"),
  };
  if (exactMessages[text]) return exactMessages[text];

  const patterns: Array<[RegExp, (...values: string[]) => string]> = [
    [
      /^Finished loading (\d+) groups\.$/,
      (count) => msg("finishedLoadingGroups", count),
    ],
    [
      /^Restored (\d+) loaded groups\.$/,
      (count) => msg("restoredGroups", count),
    ],
    [
      /^Fetching groups page (\d+)\.\.\.$/,
      (page) => msg("fetchingGroupsPage", page),
    ],
    [
      /^Loaded (\d+) groups so far\.$/,
      (count) => msg("loadedGroupsSoFar", count),
    ],
    [
      /^Fetching next page\. (\d+) groups loaded\.$/,
      (count) => msg("fetchingNextGroupsPage", count),
    ],
    [
      /^Facebook groups request failed with (\d+)\.$/,
      (status) => msg("groupsRequestFailed", status),
    ],
    [
      /^(\d+) duplicate image was skipped\.$/,
      (count) => msg("duplicateImageSkipped", count),
    ],
    [
      /^(\d+) duplicate images were skipped\.$/,
      (count) => msg("duplicateImagesSkipped", count),
    ],
    [/^Unable to read (.+)\.$/, (file) => msg("unableToReadFile", file)],
    [
      /^Posting paused before (.+)\.$/,
      (group) => msg("postingPausedBefore", group),
    ],
    [/^Next post in (.+)$/, (time) => msg("nextPostIn", time)],
    [/^Posted to (.+)\.$/, (group) => msg("postedToGroup", group)],
    [
      /^Posted successfully to (.+)\.$/,
      (group) => msg("postedSuccessfullyToGroup", group),
    ],
    [
      /^Preparing post (\d+)\/(\d+) for (.+)\.\.\.$/,
      (current, total, group) =>
        msg("preparingPostForGroup", current, total, group),
    ],
    [
      /^Uploading images from post (\d+)\/(\d+) for (.+)\.\.\.$/,
      (current, total, group) =>
        msg("uploadingPostImages", current, total, group),
    ],
    [
      /^Preparing text-only post (\d+)\/(\d+) for (.+)\.\.\.$/,
      (current, total, group) =>
        msg("preparingTextPost", current, total, group),
    ],
    [
      /^Posting post (\d+)\/(\d+) to (.+)\.\.\.$/,
      (current, total, group) => msg("postingToGroup", current, total, group),
    ],
    [
      /^Failed to post to (.+)\.$/,
      (group) => msg("failedToPostToGroup", group),
    ],
    [
      /^Posting finished: (\d+) posts were submitted\.$/,
      (count) => msg("postingFinished", count),
    ],
    [
      /^Posting finished: (\d+) posts were submitted and (\d+) groups failed\.$/,
      (posted, failed) => msg("postingFinishedWithFailures", posted, failed),
    ],
    [
      /^Facebook rejected the post to (.+) because this Group cannot accept more pending content from your account\.$/,
      (group) => msg("facebookPendingLimit", group),
    ],
    [
      /^(.+) does not allow Postika to start posting\. Trying (.+) instead\.\.\.$/,
      (starter, next) => msg("incompatibleGroupStarter", starter, next),
    ],
    [
      /^Fresh (.+) request values captured from (.+)\.$/,
      (kind, group) => msg("freshPostRequestCaptured", kind, group),
    ],
    [/^Paused (.+)$/, (duration) => msg("pausedDuration", duration)],
    [/^paused (.+)$/, (duration) => msg("pausedDurationShort", duration)],
    [/^Active time (.+)$/, (duration) => `${msg("activeTime")} ${duration}`],
    [/^Item time (.+)$/, (duration) => `${msg("itemTime")} ${duration}`],
  ];
  for (const [pattern, translate] of patterns) {
    const match = pattern.exec(text);
    if (match) return translate(...match.slice(1));
  }
  return text;
}

function getSelectedGroupsCount() {
  return selectedGroupIds.size;
}

function updateGroupsSelectAllState() {
  if (!groupsSelectAllCheckbox) {
    return;
  }

  const hasGroups = loadedGroups.length > 0;
  const selectedCount = selectedGroupIds.size;

  groupsSelectAllCheckbox.checked =
    hasGroups && selectedCount === loadedGroups.length;
  groupsSelectAllCheckbox.indeterminate =
    hasGroups && selectedCount > 0 && selectedCount < loadedGroups.length;
}

function updateGroupsSelectionSummary() {
  if (!groupsSelectionCount) {
    return;
  }

  const selectedGroupsCount = getSelectedGroupsCount();
  const selectedLabel = `${msg(
    selectedGroupsCount === 1 ? "groupCountSingular" : "groupCountPlural",
    selectedGroupsCount,
  )} ${msg("selected")}`;

  const label =
    loadedGroups.length > 0
      ? `${selectedLabel} ${msg("fromLoaded", loadedGroups.length)}`
      : selectedLabel;
  groupsSelectionCount.className = "selection-count";
  groupsSelectionCount.textContent = label;
  const cardSummary = document.querySelector<HTMLElement>(
    "#groups-card-summary",
  );
  if (cardSummary) {
    cardSummary.textContent =
      loadedGroups.length > 0 ? label : msg("findAndSelectGroups");
  }
}

function updatePostingReadiness() {
  const selectedGroupsCount = getSelectedGroupsCount();
  const hasPostContent =
    Boolean(postEditor.getContent().body.trim()) &&
    selectedImageFiles.length > 0;
  const minimumDelaySeconds = Number(postIntervalMinInput?.value ?? 0);
  const maximumDelaySeconds = Number(postIntervalMaxInput?.value ?? 0);
  const hasValidSleepTime = isValidPostingInterval(
    minimumDelaySeconds,
    maximumDelaySeconds,
  );

  updateGroupsSelectionSummary();

  updateGroupsSelectAllState();

  updatePostingButtonState(
    hasPostContent,
    selectedGroupsCount,
    hasValidSleepTime,
  );
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
    Number.isInteger(enteredMaximum) && enteredMaximum >= minimumDelaySeconds
      ? enteredMaximum
      : Math.max(DEFAULT_MAX_SLEEP_SECONDS, minimumDelaySeconds);

  postIntervalMinInput.value = String(minimumDelaySeconds);
  postIntervalMaxInput.value = String(maximumDelaySeconds);
  updatePostingReadiness();
  scheduleSaveSidePanelSession();
}

function updatePostingButtonState(
  hasPostContent = Boolean(postEditor.getContent().body.trim()) &&
    selectedImageFiles.length > 0,
  selectedGroupsCount = getSelectedGroupsCount(),
  hasValidSleepTime = (() => {
    return isValidPostingInterval(
      Number(postIntervalMinInput?.value ?? 0),
      Number(postIntervalMaxInput?.value ?? 0),
    );
  })(),
) {
  postingWizard.refresh();
  if (!startPostingButton) {
    return;
  }

  const canPost =
    postingWizard.step === 3 &&
    hasPostContent &&
    selectedGroupsCount > 0 &&
    hasValidSleepTime;

  if (isPostingActive) {
    startPostingButton.disabled = true;
    startPostingButton.title = msg("postingAlreadyInProgress");
    setButtonContent(
      startPostingButton,
      isPostingScheduling
        ? msg("schedulingQueue")
        : isPostingScheduled
          ? msg("scheduled")
          : msg("posting"),
    );
    updateScheduleControls(false);
    updatePausePostingButtonState();
    return;
  }

  startPostingButton.classList.remove("start-posting-btn--stop");
  startPostingButton.title = "";
  startPostingButton.disabled = !canPost;
  setButtonContent(startPostingButton, msg("postNow"));
  updateScheduleControls(canPost);
  updatePausePostingButtonState();
}

function updateScheduleControls(canPost?: boolean) {
  const ready =
    canPost ??
    (postingWizard.step === 3 &&
      Boolean(postEditor.getContent().body.trim()) &&
      selectedImageFiles.length > 0 &&
      getSelectedGroupsCount() > 0 &&
      isValidPostingInterval(
        Number(postIntervalMinInput?.value ?? 0),
        Number(postIntervalMaxInput?.value ?? 0),
      ));

  if (schedulePanel) {
    schedulePanel.hidden = !isScheduleOpen || isPostingActive;
  }
  if (startPostingButton) {
    startPostingButton.hidden = isScheduleOpen || isPostingActive;
  }
  if (openScheduleButton) {
    openScheduleButton.hidden = isScheduleOpen || isPostingActive;
    openScheduleButton.disabled = !ready;
    openScheduleButton.textContent = msg("schedule");
  }
  if (cancelScheduleButton) {
    cancelScheduleButton.hidden = !isScheduleOpen || isPostingActive;
    cancelScheduleButton.textContent = msg("cancel");
  }
  if (confirmScheduleButton) {
    confirmScheduleButton.hidden = !isScheduleOpen || isPostingActive;
    confirmScheduleButton.disabled = !ready || !isScheduleTimeValid;
    confirmScheduleButton.textContent = msg("confirmSchedule");
  }
  if (scheduleTimezoneNote) {
    const timeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
    scheduleTimezoneNote.textContent = msg("scheduleTimezoneNotice", timeZone);
  }
}

function updatePausePostingButtonState() {
  if (pausePostingButton) {
    pausePostingButton.hidden =
      !isPostingActive || isPostingScheduling || isPostingScheduled;
    pausePostingButton.disabled =
      isStopRequestPending || isPauseResumeRequestPending;
    pausePostingButton.classList.toggle(
      "pause-posting-btn--resume",
      isPostingPaused,
    );

    const label = isPauseResumeRequestPending
      ? isPostingPaused
        ? msg("resuming")
        : msg("pausing")
      : isPostingPaused
        ? msg("resume")
        : msg("pause");
    setButtonContent(pausePostingButton, label, isPauseResumeRequestPending);
  }

  if (stopPostingButton) {
    stopPostingButton.hidden = !isPostingActive || isPostingScheduling;
    stopPostingButton.disabled = isStopRequestPending || isPostingScheduling;
    setButtonContent(
      stopPostingButton,
      isStopRequestPending
        ? msg("stopping")
        : isPostingScheduled
          ? msg("cancelScheduledQueue")
          : msg("stop"),
      isStopRequestPending,
    );
  }
}

function setButtonContent(
  button: HTMLButtonElement,
  label: string,
  showLoader = false,
) {
  if (!showLoader) {
    button.classList.remove("button--loading");
    button.textContent = label;
    return;
  }

  button.classList.add("button--loading");

  const loader = document.createElement("span");
  loader.className = "loader";
  loader.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.textContent = label;

  button.replaceChildren(loader, text);
}

type PostingTimingElements = {
  container: HTMLElement | null;
  elapsedLabel: HTMLElement | null;
  elapsedValue: HTMLElement | null;
  itemLabel: HTMLElement | null;
  itemValue: HTMLElement | null;
};

const groupsPostingTimingElements: PostingTimingElements = {
  container: postingTiming,
  elapsedLabel: postingTimingLabel,
  elapsedValue: postingElapsedTime,
  itemLabel: postingItemTimingLabel,
  itemValue: postingItemTime,
};

function livePostingDuration(
  timing: PostingTiming,
  value: "elapsedMs" | "itemElapsedMs",
): number {
  const liveDelta =
    timing.isPaused || timing.isComplete
      ? 0
      : Math.max(0, Date.now() - timing.updatedAt);
  return Math.max(0, timing[value] + liveDelta);
}

function formatPostingDurationClock(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const minuteText = String(minutes).padStart(2, "0");
  const secondText = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${minuteText}:${secondText}`
    : `${minuteText}:${secondText}`;
}

function formatPostingDurationSummary(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  if (totalSeconds < 1) {
    return msg("underOneSecond");
  }
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours > 0 ? msg("hoursShort", hours) : "",
    minutes > 0 ? msg("minutesShort", minutes) : "",
    msg("secondsShort", seconds),
  ]
    .filter(Boolean)
    .join(" ");
}

function renderPostingTiming(
  timing: PostingTiming | undefined,
  elements: PostingTimingElements,
) {
  if (!timing) {
    return;
  }
  const elapsedMs = livePostingDuration(timing, "elapsedMs");
  const itemElapsedMs = livePostingDuration(timing, "itemElapsedMs");
  if (elements.elapsedValue) {
    elements.elapsedValue.textContent = formatPostingDurationClock(elapsedMs);
  }
  if (elements.itemValue) {
    elements.itemValue.textContent = formatPostingDurationClock(itemElapsedMs);
  }
  if (elements.elapsedLabel) {
    elements.elapsedLabel.textContent = timing.isComplete
      ? msg("activeTime")
      : timing.isPaused
        ? msg("pausedAt")
        : msg("elapsed");
  }
  if (elements.itemLabel) {
    elements.itemLabel.textContent = timing.isComplete
      ? msg("lastItem")
      : msg("currentItem");
  }
  elements.container?.classList.toggle(
    "posting-timing--paused",
    timing.isPaused,
  );
  elements.container?.classList.toggle(
    "posting-timing--complete",
    timing.isComplete,
  );
}

function resetPostingTiming(elements: PostingTimingElements) {
  if (elements.elapsedLabel) elements.elapsedLabel.textContent = msg("elapsed");
  if (elements.elapsedValue) elements.elapsedValue.textContent = "00:00";
  if (elements.itemLabel) elements.itemLabel.textContent = msg("currentItem");
  if (elements.itemValue) elements.itemValue.textContent = "00:00";
  elements.container?.classList.remove(
    "posting-timing--paused",
    "posting-timing--complete",
  );
}

function createPendingPostingTiming(startedAt: number): PostingTiming {
  return {
    startedAt,
    updatedAt: startedAt,
    elapsedMs: 0,
    itemElapsedMs: 0,
    pausedMs: 0,
    isPaused: false,
    isComplete: false,
  };
}

function finishPendingPostingTiming(timing: PostingTiming): PostingTiming {
  const now = Date.now();
  const liveDelta = Math.max(0, now - timing.updatedAt);
  return {
    ...timing,
    updatedAt: now,
    elapsedMs: timing.elapsedMs + liveDelta,
    itemElapsedMs: timing.itemElapsedMs + liveDelta,
    isComplete: true,
  };
}

function renderAllPostingTimers() {
  renderPostingTiming(latestGroupsPostingTiming, groupsPostingTimingElements);
}

window.setInterval(renderAllPostingTimers, 1_000);
// Keep the worker reachable while a queue is paused or waiting between groups.
window.setInterval(() => {
  void chrome.runtime
    .sendMessage({ type: "GET_POSTING_QUEUE_STATUS" })
    .catch(() => {});
}, 10_000);

async function restorePostingQueueStatus() {
  try {
    const response = await chrome.runtime.sendMessage<
      GetPostingQueueStatusRequest,
      PostingQueueStatusResponse
    >({ type: "GET_POSTING_QUEUE_STATUS" });
    if (response?.groups) {
      updateUiPostingStatus(response.groups);
    }
  } catch {
    // The background service may still be starting; live events will catch up.
  }
}

function postingTimingLogMeta(
  timing: PostingTiming | undefined,
  scope: "item" | "queue",
): string {
  if (!timing) {
    return "";
  }
  const duration = scope === "queue" ? timing.elapsedMs : timing.itemElapsedMs;
  const parts = [
    `${scope === "queue" ? "Active time" : "Item time"} ${formatPostingDurationSummary(duration)}`,
  ];
  if (scope === "queue" && timing.pausedMs >= 1_000) {
    parts.push(`paused ${formatPostingDurationSummary(timing.pausedMs)}`);
  }
  return parts.join(" · ");
}

function postingPausedTimeMeta(timing: PostingTiming | undefined): string {
  return timing && timing.pausedMs >= 1_000
    ? `Paused ${formatPostingDurationSummary(timing.pausedMs)}`
    : "";
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

function createFacebookResponseCopyButton(
  responseBody: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "posting-progress__copy-response";
  button.title = msg("copyFacebookResponse");
  button.setAttribute("aria-label", msg("copyFacebookResponse"));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "32");
  svg.setAttribute("height", "32");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z",
  );
  svg.append(path);
  button.append(svg);
  button.addEventListener("click", async () => {
    if (await copyTextToClipboard(responseBody)) {
      showToast(msg("responseCopied"), "success");
    } else {
      showToast(msg("unableToCopyResponse"), "error");
    }
  });
  return button;
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function applyPostingLogFilter(
  log: HTMLOListElement | null,
  filter: PostingLogFilter,
  postedButton: HTMLButtonElement | null,
  failedButton: HTMLButtonElement | null,
  pendingButton?: HTMLButtonElement | null,
) {
  postedButton?.setAttribute("aria-pressed", String(filter === "posted"));
  failedButton?.setAttribute("aria-pressed", String(filter === "failed"));
  pendingButton?.setAttribute("aria-pressed", String(filter === "pending"));
  log?.querySelectorAll<HTMLLIElement>("li[data-status]").forEach((item) => {
    item.hidden = !shouldShowPostingLogEntry(item.dataset.status, filter);
  });
}

function shouldShowPostingLogEntry(
  status: string | undefined,
  filter: PostingLogFilter,
) {
  switch (filter) {
    case "posted":
      return status === "posted";
    case "pending":
      return status === "pending";
    case "failed":
      return status === "failed" || status === "rate_limited";
    default:
      return true;
  }
}

function toggleGroupsPostingLogFilter(
  filter: Exclude<PostingLogFilter, "all">,
) {
  groupsPostingLogFilter = groupsPostingLogFilter === filter ? "all" : filter;
  applyPostingLogFilter(
    postingProgressLog,
    groupsPostingLogFilter,
    postingProgressPostedFilterButton,
    postingProgressFailedFilterButton,
    postingProgressPendingFilterButton,
  );
}

function updateUiPostingStatus(message: UiPostingStatusMessage) {
  if (message.timing) {
    latestGroupsPostingTiming = message.timing;
    renderPostingTiming(message.timing, groupsPostingTimingElements);
  }
  if (
    message.status === "scheduled" ||
    message.status === "posting" ||
    message.status === "waiting" ||
    message.status === "paused" ||
    message.status === "posted" ||
    message.status === "pending" ||
    message.status === "failed"
  ) {
    isPostingActive = true;
    isPostingScheduling = false;
    isPostingScheduled = message.status === "scheduled";
    isPostingPaused = message.status === "paused";
    if (message.status === "paused") {
      isPauseResumeRequestPending = false;
    }
  }

  updatePostingProgress(message);

  if (
    message.status === "stopped" ||
    message.status === "done" ||
    message.status === "rate_limited"
  ) {
    isPostingActive = false;
    isPostingScheduling = false;
    isPostingScheduled = false;
    isPostingPaused = false;
    isStopRequestPending = false;
    isPauseResumeRequestPending = false;
    updatePostingReadiness();
  } else {
    updatePostingButtonState();
  }
}

function updatePostingProgress(
  message: UiPostingStatusMessage,
  appendLog = true,
) {
  latestUiPostingStatusMessage = message;
  if (postingProgress) {
    postingProgress.hidden = false;
  }

  const successCount = message.successCount ?? 0;
  const pendingCount = message.pendingCount ?? 0;
  const postedCount = Math.max(successCount - pendingCount, 0);
  const failedCount = message.failedCount ?? 0;
  const processedCount =
    message.processedCount ??
    Math.min(message.total, successCount + failedCount);
  const hasSuccessTarget = message.successTarget !== undefined;
  const remainingCount = hasSuccessTarget
    ? Math.max(message.successTarget! - successCount - failedCount, 0)
    : Math.max(message.total - processedCount, 0);
  const percent = hasSuccessTarget
    ? message.successTarget! > 0
      ? Math.min(
          Math.round(
            ((successCount + failedCount) / message.successTarget!) * 100,
          ),
          100,
        )
      : 0
    : message.total > 0
      ? Math.round((processedCount / message.total) * 100)
      : 0;

  if (postingProgressTitle) {
    postingProgressTitle.textContent =
      message.status === "scheduled"
        ? msg("scheduled")
        : hasSuccessTarget
          ? msg("postsSubmitted", successCount, message.successTarget ?? 0)
          : msg("groupsProcessed", processedCount, message.total);
  }

  if (postingProgressPercent) {
    postingProgressPercent.textContent = `${percent}%`;
  }

  if (postingProgressBar) {
    postingProgressBar.style.width = `${percent}%`;
  }
  postingProgressTrack?.setAttribute("aria-valuenow", String(percent));

  if (postingProgressSuccess) {
    postingProgressSuccess.textContent = String(postedCount);
  }

  if (postingProgressPending) {
    postingProgressPending.textContent = String(pendingCount);
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
        ? msg("groupNumber", message.current, message.total)
        : msg("queue");
    postingProgressCurrent.textContent = message.groupName
      ? `${prefix}: ${message.groupName}`
      : displayPostingMessage(message);
  }

  if (postingTiming) {
    postingTiming.hidden = message.status === "scheduled";
  }

  if (appendLog) appendPostingProgressLog(message);
}

function displayPostingMessage(message: UiPostingStatusMessage): string {
  if (message.status === "scheduled" && message.scheduledAt) {
    const date = new Intl.DateTimeFormat(getLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(message.scheduledAt));
    return msg("scheduledFor", date);
  }
  return localizePostingText(message.message);
}

function localizePostingText(text: string): string {
  return localizeAppText(text);
}

function appendPostingProgressLog(
  message: UiPostingStatusMessage,
  trackMessage = true,
) {
  if (!postingProgressLog) {
    return;
  }

  if (trackMessage) {
    const groupId = message.groupId ?? "queue";
    if (message.status !== "waiting" && message.status !== "paused") {
      postingLogMessages = postingLogMessages.filter(
        (entry) => entry.status !== "waiting",
      );
    }
    const messageIndex =
      message.status === "waiting" || message.status === "paused"
        ? postingLogMessages.findIndex(
            (entry) =>
              entry.status === message.status &&
              (entry.groupId ?? "queue") === groupId,
          )
        : -1;
    if (messageIndex >= 0) {
      postingLogMessages[messageIndex] = message;
    } else {
      postingLogMessages.unshift(message);
    }
  }

  if (message.status !== "waiting" && message.status !== "paused") {
    const waitingIndex = postingLogMessages.findIndex(
      (entry) => entry.status === "waiting",
    );
    if (waitingIndex >= 0) postingLogMessages.splice(waitingIndex, 1);
    postingProgressLog
      .querySelector<HTMLLIElement>('li[data-status="waiting"]')
      ?.remove();
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
  text.textContent = displayPostingMessage(message);
  const hasGroupsCompletionSummary =
    message.status === "done" && !message.error && Boolean(message.timing);
  if (hasGroupsCompletionSummary && message.timing) {
    const completedCount = message.successCount ?? 0;
    const failedCount = message.failedCount ?? 0;
    text.textContent = msg(
      "completedPosts",
      completedCount,
      formatPostingDurationSummary(message.timing.elapsedMs),
      failedCount > 0 ? msg("failedCount", failedCount) : "",
    );
  }

  body.append(text);

  if (message.detail) {
    const detail = document.createElement("span");
    detail.className = "posting-progress__log-detail";
    detail.textContent = localizePostingText(message.detail);
    body.append(detail);
  }

  const timingMeta =
    message.status === "done" ||
    message.status === "stopped" ||
    message.status === "rate_limited"
      ? hasGroupsCompletionSummary
        ? postingPausedTimeMeta(message.timing)
        : postingTimingLogMeta(message.timing, "queue")
      : message.status === "posted" ||
          message.status === "pending" ||
          message.status === "failed"
        ? postingTimingLogMeta(message.timing, "item")
        : "";
  if (count || message.error || timingMeta) {
    const meta = document.createElement("span");
    meta.className = "posting-progress__log-meta";
    meta.textContent = [
      count,
      localizeAppText(timingMeta),
      message.error ? localizeAppText(message.error) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    body.append(meta);
  }

  const copyResponseButton = message.responseBody
    ? createFacebookResponseCopyButton(message.responseBody)
    : undefined;
  item.replaceChildren(
    badge,
    body,
    ...(copyResponseButton ? [copyResponseButton] : []),
  );

  if (!existingUpdatableItem) {
    postingProgressLog.prepend(item);
  }
  item.hidden = !shouldShowPostingLogEntry(
    message.status,
    groupsPostingLogFilter,
  );
}

function getPostingStatusLabel(status: UiPostingStatusMessage["status"]) {
  switch (status) {
    case "scheduled":
      return msg("scheduled");
    case "posted":
      return msg("done");
    case "pending":
      return msg("pending");
    case "failed":
      return msg("fail");
    case "rate_limited":
      return msg("limit");
    case "waiting":
      return msg("next");
    case "paused":
      return msg("pause");
    case "stopped":
      return msg("stop");
    case "done":
      return msg("done");
    case "posting":
      return msg("post");
    default:
      return msg("info");
  }
}

loadGroupsButton?.addEventListener("click", async () => {
  if (!groupsList || !loadGroupsButton) {
    return;
  }

  const isRefresh = loadedGroups.length > 0;
  loadGroupsButton.disabled = true;
  loadGroupsButton.textContent = msg("loading");
  updateGroupsStatus(
    "Finding the groups you have joined...",
    isRefresh ? loadedGroups.length : 0,
  );
  if (!isRefresh) {
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
    groupsList.textContent = msg("openingFacebookGroups");
  }

  try {
    const response = await chrome.runtime.sendMessage<
      { type: "LOAD_GROUPS" },
      LoadGroupsResponse
    >({ type: "LOAD_GROUPS" });

    if (!response?.ok) {
      throw new Error(response?.error ?? msg("unableToLoadGroups"));
    }

    const groups = response.groups ?? [];

    renderGroups(groups);
    scheduleSaveSidePanelSession();
    updateGroupsStatus(
      `Finished loading ${groups.length} groups.`,
      groups.length,
    );
  } catch (error) {
    updateGroupsStatus(
      "Could not find your groups. Check that you are signed into Facebook and try again.",
      isRefresh ? loadedGroups.length : 0,
    );
    if (!isRefresh) {
      if (groupsSelectAll) {
        groupsSelectAll.hidden = true;
      }
      if (groupsSelectAllCheckbox) {
        groupsSelectAllCheckbox.checked = false;
        groupsSelectAllCheckbox.indeterminate = false;
      }
      if (groupsSearchInput) {
        groupsSearchInput.disabled = true;
        const groupsSearchField =
          groupsSearchInput.closest<HTMLElement>(".field");
        if (groupsSearchField) {
          groupsSearchField.hidden = false;
        }
      }
      groupsList.className = "empty-state";
      groupsList.textContent = localizeAppText(
        error instanceof Error ? error.message : "Unable to load groups.",
      );
    }
  } finally {
    loadGroupsButton.disabled = false;
    updateLoadGroupsButtonLabel();
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

function showGroupsPhotoStatus(message: string, isError = false) {
  if (!groupsPhotoStatus) return;
  latestGroupsPhotoStatus = message;
  latestGroupsPhotoStatusIsError = isError;
  groupsPhotoStatus.hidden = false;
  groupsPhotoStatus.textContent = localizeAppText(message);
  groupsPhotoStatus.classList.toggle("photo-status--error", isError);
}

function hideGroupsPhotoStatus() {
  if (!groupsPhotoStatus) return;
  latestGroupsPhotoStatus = "";
  latestGroupsPhotoStatusIsError = false;
  groupsPhotoStatus.hidden = true;
  groupsPhotoStatus.textContent = "";
  groupsPhotoStatus.classList.remove("photo-status--error");
}

function queueGroupPhotos(files: File[]) {
  groupPhotoAdditionQueue = groupPhotoAdditionQueue
    .then(() => addGroupPhotos(files))
    .catch((error: unknown) => {
      showGroupsPhotoStatus(
        error instanceof Error ? error.message : "Unable to add images.",
        true,
      );
    });
}

async function addGroupPhotos(files: File[]) {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  const { uniqueImages, duplicateCount } = await removeDuplicateImages(
    imageFiles,
    selectedImageFiles,
  );
  selectedImageFiles.push(...uniqueImages);
  syncPostImagesInput();
  renderImagePreviews();
  updatePostingReadiness();
  scheduleSaveSidePanelSession(true);

  const rejectedForType = files.length - imageFiles.length;
  if (rejectedForType > 0) {
    showGroupsPhotoStatus("Only image files can be added.", true);
  } else if (duplicateCount > 0) {
    showGroupsPhotoStatus(
      duplicateCount === 1
        ? `${duplicateCount} duplicate image was skipped.`
        : `${duplicateCount} duplicate images were skipped.`,
    );
  } else {
    hideGroupsPhotoStatus();
  }
}

function clearSelectedImageDropTarget() {
  selectedImageDropTarget?.classList.remove(
    "photo-preview--drop-before",
    "photo-preview--drop-after",
  );
  selectedImageDropTarget = undefined;
  selectedImageDropTargetIndex = undefined;
}

function updateSelectedImageDropTarget() {
  const pointer = selectedImageDragPointer;
  if (!pointer || draggedGroupPhotoIndex === undefined || !imagePreviewList) {
    return;
  }

  clearSelectedImageDropTarget();
  const rail = imagePreviewList.querySelector<HTMLElement>(
    ".image-preview-rail",
  );
  if (!rail) return;

  const railBounds = rail.getBoundingClientRect();
  const step = imagePreviewList.closest<HTMLElement>(".posting-step");
  const stepBounds = step?.getBoundingClientRect();
  const clip: DragBounds = {
    left: Math.max(0, railBounds.left, stepBounds?.left ?? 0),
    top: Math.max(0, railBounds.top, stepBounds?.top ?? 0),
    right: Math.min(
      window.innerWidth,
      railBounds.right,
      stepBounds?.right ?? window.innerWidth,
    ),
    bottom: Math.min(
      window.innerHeight,
      railBounds.bottom,
      stepBounds?.bottom ?? window.innerHeight,
    ),
  };
  if (clip.right <= clip.left || clip.bottom <= clip.top) return;

  const left = pointer.x - pointer.offsetX;
  const top = pointer.y - pointer.offsetY;
  const draggedBounds: DragBounds = {
    left,
    top,
    right: left + pointer.width,
    bottom: top + pointer.height,
  };
  const targets = Array.from(
    rail.querySelectorAll<HTMLElement>(
      ".groups-photo-preview, .groups-photo-end-target",
    ),
  )
    .filter(
      (target) => Number(target.dataset.photoIndex) !== draggedGroupPhotoIndex,
    )
    .map((tile) => ({
      tile,
      index: Number(tile.dataset.photoIndex),
      bounds: tile.getBoundingClientRect(),
    }));
  const target = overlappingTarget(draggedBounds, targets, clip);
  if (!target || !Number.isInteger(target.index)) return;

  selectedImageDropTarget = target.tile;
  selectedImageDropTargetIndex = target.index;
  selectedImageDropSide =
    target.tile.dataset.photoEnd !== undefined ||
    draggedGroupPhotoIndex < target.index
      ? "after"
      : "before";
  target.tile.classList.add(
    selectedImageDropSide === "before"
      ? "photo-preview--drop-before"
      : "photo-preview--drop-after",
  );
}

function renderSelectedImageDrag() {
  selectedImageDragFrame = 0;
  const pointer = selectedImageDragPointer;
  if (!pointer || draggedGroupPhotoIndex === undefined) return;

  if (selectedImageDragPreview) {
    selectedImageDragPreview.style.transform = `translate3d(${pointer.x - pointer.offsetX}px, ${pointer.y - pointer.offsetY}px, 0)`;
  }

  const step = pointer.element.closest<HTMLElement>(".posting-step");
  if (step) {
    const bounds = step.getBoundingClientRect();
    const edge = 64;
    const inside =
      pointer.x >= bounds.left &&
      pointer.x <= bounds.right &&
      pointer.y >= bounds.top &&
      pointer.y <= bounds.bottom;
    const scroll = !inside
      ? 0
      : pointer.y < bounds.top + edge
        ? -10
        : pointer.y > bounds.bottom - edge
          ? 10
          : 0;
    if (scroll) step.scrollBy({ top: scroll, behavior: "instant" });
  }

  updateSelectedImageDropTarget();
  selectedImageDragFrame = requestAnimationFrame(renderSelectedImageDrag);
}

function startSelectedImageDrag(event: PointerEvent, index: number) {
  if (
    !event.isPrimary ||
    event.button !== 0 ||
    selectedImageFiles.length < 2 ||
    (event.target instanceof Element && event.target.closest("button"))
  ) {
    return;
  }

  resetSelectedImageDrag();
  const element = event.currentTarget as HTMLElement;
  const bounds = element.getBoundingClientRect();
  selectedImageDragPointer = {
    pointerId: event.pointerId,
    index,
    element,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    offsetX: event.clientX - bounds.left,
    offsetY: event.clientY - bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
  element.setPointerCapture(event.pointerId);
}

function moveSelectedImagePointer(event: PointerEvent) {
  const pointer = selectedImageDragPointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;

  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (
    draggedGroupPhotoIndex === undefined &&
    Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) >= 5
  ) {
    const image = pointer.element.querySelector<HTMLImageElement>("img");
    if (!image) {
      resetSelectedImageDrag();
      return;
    }

    draggedGroupPhotoIndex = pointer.index;
    pointer.element.classList.add("photo-preview--dragging");
    const preview = document.createElement("div");
    preview.className = "photo-drag-preview";
    preview.setAttribute("aria-hidden", "true");
    preview.style.width = `${pointer.width}px`;
    preview.style.height = `${pointer.height}px`;
    const previewImage = image.cloneNode() as HTMLImageElement;
    previewImage.alt = "";
    previewImage.draggable = false;
    preview.append(previewImage);
    document.body.append(preview);
    selectedImageDragPreview = preview;
    selectedImageDragFrame = requestAnimationFrame(renderSelectedImageDrag);
  }

  if (draggedGroupPhotoIndex !== undefined) event.preventDefault();
}

function resetSelectedImageDrag() {
  const pointer = selectedImageDragPointer;
  selectedImageDragPointer = null;
  if (selectedImageDragFrame) {
    cancelAnimationFrame(selectedImageDragFrame);
    selectedImageDragFrame = 0;
  }
  selectedImageDragPreview?.remove();
  selectedImageDragPreview = null;
  clearSelectedImageDropTarget();
  imagePreviewList
    ?.querySelectorAll<HTMLElement>(".groups-photo-preview")
    .forEach((preview) => preview.classList.remove("photo-preview--dragging"));
  draggedGroupPhotoIndex = undefined;
  if (pointer?.element.hasPointerCapture(pointer.pointerId)) {
    pointer.element.releasePointerCapture(pointer.pointerId);
  }
}

function getImageMoveDestination(
  fromIndex: number,
  targetIndex: number,
  side: "before" | "after",
) {
  let destination = targetIndex + (side === "after" ? 1 : 0);
  if (fromIndex < destination) destination -= 1;
  return destination;
}

function endSelectedImagePointer(event: PointerEvent) {
  const pointer = selectedImageDragPointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;

  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (draggedGroupPhotoIndex !== undefined) {
    updateSelectedImageDropTarget();
  }
  const fromIndex = draggedGroupPhotoIndex;
  const targetIndex = selectedImageDropTargetIndex;
  const side = selectedImageDropSide;
  resetSelectedImageDrag();

  if (fromIndex === undefined) return;
  suppressNextImagePreviewClick = true;
  window.setTimeout(() => {
    suppressNextImagePreviewClick = false;
  }, 0);

  if (targetIndex === undefined) return;
  const destination = getImageMoveDestination(fromIndex, targetIndex, side);
  if (destination === fromIndex) return;
  moveSelectedImage(fromIndex, destination);
  imagePreviewList
    ?.querySelector<HTMLElement>(
      `.groups-photo-preview[data-photo-index="${destination}"]`,
    )
    ?.focus({ preventScroll: true });
}

function removeSelectedImage(indexToRemove: number) {
  resetSelectedImageDrag();
  selectedImageFiles = selectedImageFiles.filter(
    (_file, index) => index !== indexToRemove,
  );
  if (selectedImageFiles.length === 0) {
    imagePreviewsVisible = false;
  }
  syncPostImagesInput();
  renderImagePreviews();
  updatePostingReadiness();
  scheduleSaveSidePanelSession(true);
}

function renderImagePreviews() {
  if (!imagePreviewList) {
    return;
  }

  resetSelectedImageDrag();
  clearImagePreviewUrls();
  const hasImages = selectedImageFiles.length > 0;
  imagePreviewList.hidden = !hasImages;
  imagePreviewList.setAttribute("aria-label", msg("imagesSectionTitle"));
  imagePreviewList.classList.remove("image-preview-list--dragging");
  imagePreviewList.classList.toggle("image-preview-list--selected", hasImages);
  groupsPhotoDropzone?.toggleAttribute("hidden", hasImages);
  imagePreviewsVisible = hasImages;

  if (!hasImages) {
    imagePreviewList.replaceChildren();
    return;
  }

  const heading = document.createElement("div");
  heading.className = "image-preview-heading";

  const title = document.createElement("strong");
  title.textContent = msg("imagesSectionTitle");

  const required = document.createElement("span");
  required.className = "image-preview-required";
  required.textContent = msg("imagesRequired");
  heading.append(title, required);

  const imageMeta = document.createElement("div");
  imageMeta.className = "image-preview-meta";

  const selectedCount = document.createElement("span");
  selectedCount.className = "image-preview-count";
  selectedCount.textContent = msg(
    "selectedImagesCount",
    selectedImageFiles.length,
  );

  const addMoreButton = document.createElement("button");
  addMoreButton.type = "button";
  addMoreButton.className = "image-preview-add";
  addMoreButton.setAttribute("aria-label", msg("addMorePhotos"));

  const addMoreIcon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  addMoreIcon.setAttribute("viewBox", "0 0 24 24");
  addMoreIcon.setAttribute("fill", "none");
  addMoreIcon.setAttribute("stroke", "currentColor");
  addMoreIcon.setAttribute("stroke-width", "2");
  addMoreIcon.setAttribute("stroke-linecap", "round");
  addMoreIcon.setAttribute("aria-hidden", "true");

  const addMoreIconPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  addMoreIconPath.setAttribute("d", "M12 5v14M5 12h14");
  addMoreIcon.append(addMoreIconPath);

  const addMoreLabel = document.createElement("span");
  addMoreLabel.textContent = msg("addMorePhotos");
  addMoreButton.append(addMoreIcon, addMoreLabel);
  addMoreButton.addEventListener("click", () => postImagesInput?.click());

  imageMeta.append(selectedCount, addMoreButton);

  const previewRail = document.createElement("div");
  previewRail.className = "photo-previews image-preview-rail";

  const previews = selectedImageFiles.map((file, index) => {
    const previewUrl = URL.createObjectURL(file);
    selectedImagePreviewUrls.push(previewUrl);

    const preview = document.createElement("figure");
    preview.className = "photo-preview groups-photo-preview";
    preview.draggable = false;
    preview.tabIndex = 0;
    preview.dataset.photoIndex = String(index);
    preview.setAttribute(
      "aria-label",
      msg("imagePreviewReorder", index + 1, selectedImageFiles.length),
    );

    const image = document.createElement("img");
    image.src = previewUrl;
    image.alt = file.name;
    image.draggable = false;
    image.addEventListener("click", () => {
      if (suppressNextImagePreviewClick) return;
      openGroupsPhotoLightbox(index, preview);
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "photo-preview__remove";
    removeButton.setAttribute("aria-label", msg("removeImage", file.name));

    const removeIcon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    removeIcon.setAttribute("width", "32");
    removeIcon.setAttribute("height", "32");
    removeIcon.setAttribute("fill", "currentColor");
    removeIcon.setAttribute("viewBox", "0 0 256 256");
    removeIcon.setAttribute("aria-hidden", "true");

    const removeIconPath = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    removeIconPath.setAttribute(
      "d",
      "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z",
    );
    removeIcon.append(removeIconPath);
    removeButton.append(removeIcon);
    removeButton.addEventListener("click", () => {
      removeSelectedImage(index);
    });

    preview.addEventListener("pointerdown", (event) =>
      startSelectedImageDrag(event, index),
    );
    preview.addEventListener("lostpointercapture", () => {
      if (selectedImageDragPointer?.element === preview) {
        resetSelectedImageDrag();
      }
    });
    preview.addEventListener("dragstart", (event) => event.preventDefault());

    preview.addEventListener("keydown", (event) => {
      if (
        event.target === preview &&
        event.altKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        event.preventDefault();
        const destination = Math.max(
          0,
          Math.min(
            selectedImageFiles.length - 1,
            index + (event.key === "ArrowLeft" ? -1 : 1),
          ),
        );
        if (destination !== index) {
          moveSelectedImage(index, destination);
          imagePreviewList
            .querySelector<HTMLElement>(
              `.groups-photo-preview[data-photo-index="${destination}"]`,
            )
            ?.focus();
        }
        return;
      }

      if (
        event.target === preview &&
        (event.key === "Enter" || event.key === " ")
      ) {
        event.preventDefault();
        openGroupsPhotoLightbox(index, preview);
      }
    });

    preview.append(image, removeButton);
    return preview;
  });

  previewRail.replaceChildren(...previews);
  if (selectedImageFiles.length > 1 && selectedImageFiles.length < 4) {
    const endTarget = document.createElement("div");
    endTarget.className = "groups-photo-end-target";
    endTarget.dataset.photoIndex = String(selectedImageFiles.length - 1);
    endTarget.dataset.photoEnd = "";
    endTarget.setAttribute("aria-hidden", "true");
    previewRail.append(endTarget);
  }
  imagePreviewList.replaceChildren(heading, imageMeta, previewRail);
}

window.addEventListener("pointermove", moveSelectedImagePointer);
window.addEventListener("pointerup", endSelectedImagePointer);
window.addEventListener("pointercancel", resetSelectedImageDrag);
window.addEventListener("blur", resetSelectedImageDrag);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") resetSelectedImageDrag();
});

function moveSelectedImage(fromIndex: number, toIndex: number) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= selectedImageFiles.length ||
    toIndex >= selectedImageFiles.length
  ) {
    return;
  }

  const [movedImage] = selectedImageFiles.splice(fromIndex, 1);
  if (!movedImage) {
    return;
  }
  selectedImageFiles.splice(toIndex, 0, movedImage);
  draggedGroupPhotoIndex = undefined;
  syncPostImagesInput();
  renderImagePreviews();
  scheduleSaveSidePanelSession(true);
}

postImagesInput?.addEventListener("change", () => {
  queueGroupPhotos(Array.from(postImagesInput.files ?? []));
});

groupsPhotoDropzone?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    postImagesInput?.click();
  }
});

groupsPhotoDropzone?.addEventListener("dragenter", (event) => {
  event.preventDefault();
  groupsPhotoDropzone.classList.add("groups-photo-dropzone--dragging");
});

groupsPhotoDropzone?.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
});

groupsPhotoDropzone?.addEventListener("dragleave", (event) => {
  if (
    event.relatedTarget instanceof Node &&
    groupsPhotoDropzone.contains(event.relatedTarget)
  ) {
    return;
  }
  groupsPhotoDropzone.classList.remove("groups-photo-dropzone--dragging");
});

groupsPhotoDropzone?.addEventListener("drop", (event) => {
  event.preventDefault();
  groupsPhotoDropzone.classList.remove("groups-photo-dropzone--dragging");
  queueGroupPhotos(Array.from(event.dataTransfer?.files ?? []));
});

imagePreviewList?.addEventListener("dragenter", (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
    return;
  }
  event.preventDefault();
  imagePreviewList.classList.add("image-preview-list--dragging");
});

imagePreviewList?.addEventListener("dragover", (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
});

imagePreviewList?.addEventListener("dragleave", (event) => {
  if (
    event.relatedTarget instanceof Node &&
    imagePreviewList.contains(event.relatedTarget)
  ) {
    return;
  }
  imagePreviewList.classList.remove("image-preview-list--dragging");
});

imagePreviewList?.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  event.preventDefault();
  imagePreviewList.classList.remove("image-preview-list--dragging");
  queueGroupPhotos(files);
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

postingProgressPostedFilterButton?.addEventListener("click", () => {
  toggleGroupsPostingLogFilter("posted");
});
postingProgressPendingFilterButton?.addEventListener("click", () => {
  toggleGroupsPostingLogFilter("pending");
});
postingProgressFailedFilterButton?.addEventListener("click", () => {
  toggleGroupsPostingLogFilter("failed");
});

postIntervalMinInput?.addEventListener("change", normalizePostingInterval);
postIntervalMaxInput?.addEventListener("change", normalizePostingInterval);

createForm?.addEventListener("submit", (event) => {
  event.preventDefault();
});

pausePostingButton?.addEventListener("click", async () => {
  if (!isPostingActive || isPauseResumeRequestPending || isStopRequestPending) {
    return;
  }

  isPauseResumeRequestPending = true;
  const shouldResume = isPostingPaused;
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
          (shouldResume ? msg("unableToResume") : msg("unableToPause")),
      );
    }

    if (shouldResume) {
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
    updatePausePostingButtonState();
    updatePostingButtonState();
    showToast(
      error instanceof Error
        ? error.message
        : shouldResume
          ? msg("unableToResume")
          : msg("unableToPause"),
      "error",
    );
  }
});

stopPostingButton?.addEventListener("click", async () => {
  if (!isPostingActive || isStopRequestPending) {
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
      throw new Error(response?.error ?? msg("unableToStop"));
    }
  } catch (error) {
    isStopRequestPending = false;
    updatePostingButtonState();
    showToast(
      error instanceof Error ? error.message : msg("unableToStop"),
      "error",
    );
  }
});

openScheduleButton?.addEventListener("click", () => {
  if (isPostingActive || postingWizard.step !== 3) return;
  isScheduleOpen = true;
  updateScheduleControls();
  schedulePicker.open();
  updatePostingButtonState();
});

cancelScheduleButton?.addEventListener("click", () => {
  isScheduleOpen = false;
  updatePostingButtonState();
  openScheduleButton?.focus();
});

confirmScheduleButton?.addEventListener("click", () => {
  const scheduledDate = schedulePicker.getDate();
  if (!scheduledDate || scheduledDate.getTime() <= Date.now()) {
    showToast(msg("futureDateRequired"), "warning");
    return;
  }
  void startPosting(scheduledDate);
});

startPostingButton?.addEventListener("click", () => {
  void startPosting();
});

async function startPosting(scheduledDate?: Date) {
  if (postingWizard.step !== 3 || isPostingActive) return;
  if (!startPostingButton) {
    return;
  }
  if (scheduledDate && scheduledDate.getTime() <= Date.now()) {
    showToast(msg("futureDateRequired"), "warning");
    return;
  }

  const selectedGroupIdList = Array.from(selectedGroupIds);

  if (selectedGroupIdList.length === 0) {
    showToast(msg("selectAtLeastOneGroup"), "warning");
    return;
  }

  const { body, html } = postEditor.getContent();
  const images = [...selectedImageFiles];
  if (!body.trim() || images.length === 0) {
    showToast(msg("addPostAndImage"), "warning");
    return;
  }

  const minimumDelaySeconds = Number(
    postIntervalMinInput?.value ?? MIN_SLEEP_SECONDS,
  );
  const maximumDelaySeconds = Number(
    postIntervalMaxInput?.value ?? DEFAULT_MAX_SLEEP_SECONDS,
  );
  if (!isValidPostingInterval(minimumDelaySeconds, maximumDelaySeconds)) {
    showToast(msg("invalidPostingInterval", MIN_SLEEP_SECONDS), "warning");
    return;
  }

  const selectedGroups = groupsInSelectionOrder(
    loadedGroups,
    selectedGroupIdList,
  );

  if (selectedGroups.length === 0) {
    showToast(msg("groupsNoLongerAvailable"), "warning");
    return;
  }
  const postingStartedAt = Date.now();
  const postingGroups = selectedGroups;
  const scheduledAt = scheduledDate?.toISOString();

  isPostingActive = true;
  isPostingScheduling = Boolean(scheduledAt);
  isPostingScheduled = Boolean(scheduledAt);
  isPostingPaused = false;
  isStopRequestPending = false;
  isPauseResumeRequestPending = false;
  isScheduleOpen = false;
  updatePostingButtonState();
  updateGroupsStatus(
    scheduledAt ? msg("schedulingQueue") : "Getting ready to post...",
    0,
  );
  resetPostingProgress(postingGroups.length);
  if (scheduledAt) {
    if (postingTiming) postingTiming.hidden = true;
  } else {
    latestGroupsPostingTiming = createPendingPostingTiming(postingStartedAt);
    renderPostingTiming(latestGroupsPostingTiming, groupsPostingTimingElements);
  }
  scrollPostingProgressIntoView();

  try {
    const posts = [
      {
        id: crypto.randomUUID(),
        body,
        html,
        images: await Promise.all(images.map(fileToUiPostImage)),
      },
    ];
    const request: StartUiPostingRequest = {
      type: "START_UI_POSTING",
      startedAt: postingStartedAt,
      groups: postingGroups.map((group) => ({
        id: group.id,
        name: group.name,
        url: group.url,
      })),
      posts,
      minimumDelaySeconds,
      maximumDelaySeconds,
      ...(scheduledAt ? { scheduledAt } : {}),
    };
    const response = await sendPostingRequest(request);
    if (!response.ok) {
      throw new Error(response.error ?? msg("couldNotStartPosting"));
    }
  } catch (error: unknown) {
    if (latestGroupsPostingTiming) {
      latestGroupsPostingTiming = finishPendingPostingTiming(
        latestGroupsPostingTiming,
      );
      renderPostingTiming(
        latestGroupsPostingTiming,
        groupsPostingTimingElements,
      );
    }
    isPostingActive = false;
    isPostingScheduling = false;
    isPostingScheduled = false;
    isPostingPaused = false;
    isStopRequestPending = false;
    isPauseResumeRequestPending = false;
    isScheduleOpen = false;
    updatePostingReadiness();
    showToast(
      error instanceof Error ? error.message : msg("couldNotStartPosting"),
      "error",
    );
  }
}

window.addEventListener("postika:locale-changed", () => {
  refreshToastTranslations();
  if (hasRenderedGroups) renderGroups(loadedGroups);
  updateLoadGroupsButtonLabel();
  if (latestGroupsStatusMessage) {
    updateGroupsStatus(latestGroupsStatusMessage, latestGroupsStatusCount);
  }
  updatePostingReadiness();
  updatePausePostingButtonState();
  if (latestGroupsPostingTiming) {
    renderPostingTiming(latestGroupsPostingTiming, groupsPostingTimingElements);
  }
  if (latestUiPostingStatusMessage) {
    updatePostingProgress(latestUiPostingStatusMessage, false);
  }
  postingProgressLog?.replaceChildren();
  for (const message of [...postingLogMessages].reverse()) {
    appendPostingProgressLog(message, false);
  }
  if (latestGroupsPhotoStatus && groupsPhotoStatus) {
    groupsPhotoStatus.textContent = localizeAppText(latestGroupsPhotoStatus);
    groupsPhotoStatus.classList.toggle(
      "photo-status--error",
      latestGroupsPhotoStatusIsError,
    );
  }
  if (photoLightbox && !photoLightbox.hidden) {
    if (photoLightboxTitle) {
      photoLightboxTitle.textContent = msg("photoImagePreview");
    }
    renderPhotoLightboxThumbnails();
  }
  if (selectedImageFiles.length > 0) renderImagePreviews();
});

window.addEventListener("postika:locale-error", () => {
  showToast(msg("languageCouldNotLoad"), "error");
});

initializeAppMenu();

void initializeI18n()
  .then(() => {
    if (hasRenderedGroups) renderGroups(loadedGroups);
    updateLoadGroupsButtonLabel();
    if (latestGroupsStatusMessage) {
      updateGroupsStatus(latestGroupsStatusMessage, latestGroupsStatusCount);
    }
    updatePostingReadiness();
    if (latestGroupsPostingTiming) {
      renderPostingTiming(
        latestGroupsPostingTiming,
        groupsPostingTimingElements,
      );
    }
    if (latestUiPostingStatusMessage) {
      updatePostingProgress(latestUiPostingStatusMessage, false);
    }
    if (selectedImageFiles.length > 0) renderImagePreviews();
  })
  .catch((error: unknown) => {
    console.error("Could not initialize localization.", error);
    showToast(msg("languageCouldNotLoad"), "error");
  });

updatePostingReadiness();

window.addEventListener("beforeunload", () => {
  flushSidePanelSessionSave();
  clearImagePreviewUrls();
});

function fileToUiPostImage(file: File): Promise<UiPostImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error(msg("unableToReadFile", file.name)));
        return;
      }

      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        dataUrl: reader.result,
      });
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error(msg("unableToReadFile", file.name)));
    });
    reader.readAsDataURL(file);
  });
}

function isRestorablePostImage(value: unknown): value is UiPostImage {
  if (typeof value !== "object" || value === null) return false;
  const image = value as Record<string, unknown>;
  return (
    typeof image.name === "string" &&
    typeof image.type === "string" &&
    typeof image.dataUrl === "string" &&
    image.dataUrl.startsWith("data:image/")
  );
}

async function uiPostImageToFile(image: UiPostImage): Promise<File> {
  const response = await fetch(image.dataUrl);
  if (!response.ok) {
    throw new Error(msg("couldNotRestoreDraftImages"));
  }
  const blob = await response.blob();
  return new File([blob], image.name, {
    type: image.type || blob.type,
  });
}

async function initializeSidePanelSession() {
  isRestoringSidePanelSession = true;

  try {
    await chrome.storage.local.remove([
      "googleAuthSession",
      "googleAuthSignedOut",
    ]);
    const storage = await chrome.storage.local.get([
      SIDE_PANEL_SESSION_STORAGE_KEY,
      SIDE_PANEL_DRAFT_IMAGES_STORAGE_KEY,
    ]);
    const session = storage[SIDE_PANEL_SESSION_STORAGE_KEY] as
      | Partial<SidePanelSession>
      | undefined;

    const storedImages = storage[SIDE_PANEL_DRAFT_IMAGES_STORAGE_KEY];
    if (Array.isArray(storedImages)) {
      try {
        selectedImageFiles = await Promise.all(
          storedImages.filter(isRestorablePostImage).map(uiPostImageToFile),
        );
        syncPostImagesInput();
      } catch (error) {
        console.error("Could not restore saved draft images.", error);
        showToast(msg("couldNotRestoreDraftImages"), "error");
      }
    }

    if (!session || typeof session !== "object") {
      renderImagePreviews();
      return;
    }

    if (typeof session.postBodyHtml === "string") {
      postEditor.setContent(session.postBodyHtml);
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
    // Keep the visible card empty until the authenticated account is loaded.

    if (groupsSearchInput && typeof session.groupsSearchQuery === "string") {
      groupsSearchInput.value = session.groupsSearchQuery;
      groupsSearchQuery = session.groupsSearchQuery;
    }

    imagePreviewsVisible = session.imagePreviewsVisible === true;

    if (Array.isArray(session.selectedGroupIds)) {
      selectedGroupIds = new Set(
        session.selectedGroupIds.filter(
          (groupId) => typeof groupId === "string",
        ),
      );
    }

    syncPostImagesInput();

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
    console.log(
      "Unable to restore side panel session.",
      error instanceof Error ? error.message : error,
    );
    renderImagePreviews();
  } finally {
    isRestoringSidePanelSession = false;
    // Rewrite older session records without embedded image data.
    await saveSidePanelSession();
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

function scheduleSaveSidePanelSession(saveImages = false) {
  if (isRestoringSidePanelSession) {
    return;
  }

  shouldSaveDraftImages ||= saveImages;
  if (saveSidePanelSessionTimer !== undefined) {
    window.clearTimeout(saveSidePanelSessionTimer);
  }

  saveSidePanelSessionTimer = window.setTimeout(() => {
    saveSidePanelSessionTimer = undefined;
    const shouldSaveImages = shouldSaveDraftImages;
    shouldSaveDraftImages = false;
    void saveSidePanelSession(shouldSaveImages);
  }, 400);
}

function flushSidePanelSessionSave() {
  if (saveSidePanelSessionTimer !== undefined) {
    window.clearTimeout(saveSidePanelSessionTimer);
    saveSidePanelSessionTimer = undefined;
  }

  const shouldSaveImages = shouldSaveDraftImages;
  shouldSaveDraftImages = false;
  void saveSidePanelSession(shouldSaveImages);
}

async function saveSidePanelSession(saveImages = false) {
  try {
    const session: SidePanelSession = {
      minimumDelaySeconds: Number(
        postIntervalMinInput?.value ?? MIN_SLEEP_SECONDS,
      ),
      maximumDelaySeconds: Number(
        postIntervalMaxInput?.value ?? DEFAULT_MAX_SLEEP_SECONDS,
      ),
      intervalSettingsVersion: 2,
      loadedGroups,
      selectedGroupIds: Array.from(selectedGroupIds),
      groupsSearchQuery,
      imagePreviewsVisible,
      postBodyHtml: postEditor.getContent().html,
    };

    await chrome.storage.local.set({
      [SIDE_PANEL_SESSION_STORAGE_KEY]: session,
    });
    if (saveImages) {
      try {
        await chrome.storage.local.remove(SIDE_PANEL_DRAFT_IMAGES_STORAGE_KEY);
        if (selectedImageFiles.length > 0) {
          const images = await Promise.all(
            selectedImageFiles.map(fileToUiPostImage),
          );
          await chrome.storage.local.set({
            [SIDE_PANEL_DRAFT_IMAGES_STORAGE_KEY]: images,
          });
        }
      } catch (error) {
        console.error("Could not save draft images.", error);
        showToast(msg("couldNotSaveDraftImages"), "error");
      }
    }
  } catch (error) {
    console.error("Unable to save side panel session.", error);
  }
}

function resetPostingProgress(total: number, successTarget?: number) {
  latestGroupsPostingTiming = undefined;
  latestUiPostingStatusMessage = undefined;
  postingLogMessages = [];
  resetPostingTiming(groupsPostingTimingElements);
  if (postingProgress) {
    postingProgress.hidden = false;
  }

  if (postingProgressTitle) {
    postingProgressTitle.textContent = successTarget
      ? msg("postsSubmitted", 0, successTarget)
      : msg("groupsProcessed", 0, total);
  }

  if (postingProgressPercent) {
    postingProgressPercent.textContent = "0%";
  }

  if (postingProgressBar) {
    postingProgressBar.style.width = "0%";
  }
  postingProgressTrack?.setAttribute("aria-valuenow", "0");

  if (postingProgressSuccess) {
    postingProgressSuccess.textContent = "0";
  }

  if (postingProgressPending) {
    postingProgressPending.textContent = "0";
  }

  if (postingProgressFailed) {
    postingProgressFailed.textContent = "0";
  }

  if (postingProgressRemaining) {
    postingProgressRemaining.textContent = String(successTarget ?? total);
  }

  if (postingProgressCurrent) {
    postingProgressCurrent.textContent = msg("gettingReadyToPost");
  }

  postingProgressLog?.replaceChildren();
  groupsPostingLogFilter = "all";
  applyPostingLogFilter(
    postingProgressLog,
    groupsPostingLogFilter,
    postingProgressPostedFilterButton,
    postingProgressFailedFilterButton,
    postingProgressPendingFilterButton,
  );
}

function scrollPostingProgressIntoView() {
  scrollProgressPanelToBottom(postingProgress);
}

function scrollProgressPanelToBottom(panel: HTMLElement | null) {
  if (!panel) return;
  requestAnimationFrame(() =>
    panel.scrollIntoView({ behavior: "smooth", block: "end" }),
  );
}
