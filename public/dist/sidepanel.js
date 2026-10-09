"use strict";
(() => {
  // src/auth-config.ts
  var AUTH_API_BASE_URL = "https://api.facebook-groups-bulk-poster.softwrhq.com";

  // src/group-posting-order.ts
  function groupsInSelectionOrder(groups, selectedIds) {
    const byId = new Map(groups.map((group) => [group.id, group]));
    return Array.from(selectedIds).flatMap((id) => {
      const group = byId.get(id);
      return group ? [group] : [];
    });
  }

  // src/card-accordions.ts
  function initializeCardAccordions(onChange) {
    document.querySelectorAll("#create-form details.card-accordion").forEach((card) => card.addEventListener("toggle", onChange));
  }
  function expandedCardIds() {
    return Array.from(document.querySelectorAll("#create-form details.card-accordion[open]")).map((card) => card.id);
  }
  function restoreExpandedCards(ids) {
    const expanded = ids.find((id) => document.getElementById(id)?.matches("#create-form details.card-accordion"));
    document.querySelectorAll("#create-form details.card-accordion").forEach((card) => {
      card.open = card.id === expanded;
    });
  }
  function revealCardFor(element) {
    let card = element?.closest("details.card-accordion");
    while (card) {
      card.open = true;
      card = card.parentElement?.closest("details.card-accordion");
    }
  }

  // src/watermark.ts
  var DEFAULT_WATERMARK = {
    enabled: false,
    text: "",
    position: "bottom",
    backgroundColor: "#000000",
    textColor: "#ffffff",
    height: 10
  };
  function normalizeWatermark(value) {
    const input = value && typeof value === "object" ? value : {};
    const color = (value2, fallback) => typeof value2 === "string" && /^#[0-9a-f]{6}$/i.test(value2) ? value2 : fallback;
    return {
      enabled: input.enabled === true,
      text: typeof input.text === "string" ? input.text.slice(0, 200) : "",
      position: input.position === "top" || input.position === "center" ? input.position : "bottom",
      backgroundColor: color(input.backgroundColor, DEFAULT_WATERMARK.backgroundColor),
      textColor: color(input.textColor, DEFAULT_WATERMARK.textColor),
      height: typeof input.height === "number" && Number.isFinite(input.height) ? Math.min(50, Math.max(1, input.height)) : DEFAULT_WATERMARK.height
    };
  }
  function drawWatermark(context, width, height, settings) {
    const bandHeight = Math.max(1, height * settings.height / 100);
    const y = settings.position === "top" ? 0 : settings.position === "center" ? (height - bandHeight) / 2 : height - bandHeight;
    context.fillStyle = settings.backgroundColor;
    context.fillRect(0, y, width, bandHeight);
    context.fillStyle = settings.textColor;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const text = settings.text.trim();
    const fontSize = bandHeight * 0.55;
    const rootFontSize2 = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const fontFamily = getComputedStyle(document.body).fontFamily;
    context.font = `600 ${fontSize / rootFontSize2}rem ${fontFamily}`;
    const availableWidth = width * 0.92;
    const measuredWidth = context.measureText(text).width;
    if (measuredWidth > availableWidth) {
      context.font = `600 ${fontSize * availableWidth / measuredWidth / rootFontSize2}rem ${fontFamily}`;
    }
    context.fillText(text, width / 2, y + bandHeight / 2, availableWidth);
  }
  async function watermarkImage(image, settings) {
    if (!settings.enabled) return image;
    if (!settings.text.trim()) throw new Error("Enter watermark text, or turn off watermarks before posting.");
    await document.fonts.load('600 1rem "Inter"');
    const source = new Image();
    await new Promise((resolve, reject) => {
      source.onload = () => resolve();
      source.onerror = () => reject(new Error(`Unable to load ${image.name} for watermarking.`));
      source.src = image.dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to prepare image watermarks.");
    context.drawImage(source, 0, 0);
    drawWatermark(context, canvas.width, canvas.height, settings);
    const type = image.type === "image/jpeg" ? "image/jpeg" : "image/png";
    const name = image.name.replace(/\.[^.]+$/, "") + (type === "image/jpeg" ? ".jpg" : ".png");
    const dataUrl = canvas.toDataURL(type, 0.95);
    if (!dataUrl.startsWith(`data:${type}`)) throw new Error(`Unable to export ${image.name} with a watermark.`);
    return { ...image, name, type, dataUrl };
  }
  function initializeWatermarkControls(onError) {
    const root = document.querySelector("#watermark-settings");
    const enabled = root?.querySelector("#watermark-enabled");
    const fields = root?.querySelector("fieldset");
    const text = root?.querySelector("#watermark-text");
    const position = root?.querySelector("#watermark-position");
    const backgroundColor = root?.querySelector("#watermark-background-color");
    const textColor = root?.querySelector("#watermark-text-color");
    const height = root?.querySelector("#watermark-height");
    const preview = root?.querySelector("canvas");
    const status = root?.querySelector("[role=status]");
    const picker = root?.querySelector("#watermark-color-picker");
    const pickerTitle = root?.querySelector("#watermark-color-picker-title");
    const swatches = Array.from(root?.querySelectorAll("[data-color-target]") ?? []);
    const channels = Array.from(root?.querySelectorAll("[data-color-channel]") ?? []);
    let activeColor;
    function closePicker(restoreFocus = false) {
      if (picker) picker.hidden = true;
      const trigger = swatches.find((button) => button.dataset.colorTarget === activeColor?.id);
      swatches.forEach((button) => button.setAttribute("aria-expanded", "false"));
      activeColor = void 0;
      if (restoreFocus) trigger?.focus();
    }
    function renderColors() {
      swatches.forEach((button) => {
        const color = button.dataset.colorTarget === backgroundColor?.id ? settings.backgroundColor : settings.textColor;
        button.style.backgroundColor = color;
      });
      if (!settings.enabled) closePicker();
      if (activeColor) {
        const color = activeColor === backgroundColor ? settings.backgroundColor : settings.textColor;
        channels.forEach((channel, index) => {
          channel.value = String(parseInt(color.slice(1 + index * 2, 3 + index * 2), 16));
          const output = channel.parentElement?.querySelector("output");
          if (output) output.textContent = channel.value;
        });
      }
    }
    const storageKey = "imageWatermarkSettings";
    let settings = { ...DEFAULT_WATERMARK };
    let saveQueue = Promise.resolve();
    let edited = false;
    function render() {
      if (!enabled || !fields || !text || !position || !backgroundColor || !textColor || !height) return;
      enabled.checked = settings.enabled;
      fields.disabled = !settings.enabled;
      text.value = settings.text;
      position.value = settings.position;
      backgroundColor.value = settings.backgroundColor;
      textColor.value = settings.textColor;
      height.value = String(settings.height);
      renderColors();
      const context = preview?.getContext("2d");
      if (preview && context) {
        const gradient = context.createLinearGradient(0, 0, preview.width, preview.height);
        gradient.addColorStop(0, "#b8e2ef");
        gradient.addColorStop(1, "#448a67");
        context.fillStyle = gradient;
        context.fillRect(0, 0, preview.width, preview.height);
        if (settings.enabled) drawWatermark(context, preview.width, preview.height, { ...settings, text: settings.text || "Your watermark" });
      }
    }
    root?.addEventListener("input", (event) => {
      if (![enabled, text, position, backgroundColor, textColor, height].includes(event.target)) return;
      edited = true;
      const validColor = (control, fallback) => control && /^#[0-9a-f]{6}$/i.test(control.value) ? control.value : fallback;
      settings = normalizeWatermark({
        enabled: enabled?.checked,
        text: text?.value,
        position: position?.value,
        backgroundColor: validColor(backgroundColor, settings.backgroundColor),
        textColor: validColor(textColor, settings.textColor),
        height: Number(height?.value)
      });
      const draftHeight = height?.value;
      const editingColor = event.target === backgroundColor || event.target === textColor ? event.target : void 0;
      const draftColor = editingColor?.value;
      render();
      if (height && document.activeElement === height) height.value = draftHeight ?? "";
      if (editingColor && document.activeElement === editingColor) editingColor.value = draftColor ?? "";
      const snapshot = { ...settings };
      if (status) status.textContent = "Saving settings\u2026";
      saveQueue = saveQueue.then(async () => {
        try {
          await chrome.storage.local.set({ [storageKey]: snapshot });
          if (status) status.textContent = "Settings saved on this device.";
        } catch {
          if (status) status.textContent = "Unable to save settings. Change a setting to retry.";
          onError("Unable to save watermark settings.");
        }
      });
    });
    swatches.forEach((button) => button.addEventListener("click", () => {
      const control = button.dataset.colorTarget === backgroundColor?.id ? backgroundColor : textColor;
      if (!control || !picker) return;
      if (activeColor === control) {
        closePicker();
        return;
      }
      activeColor = control;
      picker.hidden = false;
      swatches.forEach((swatch) => swatch.setAttribute("aria-expanded", String(swatch === button)));
      if (pickerTitle) pickerTitle.textContent = control === backgroundColor ? "Background color" : "Text color";
      renderColors();
      channels[0]?.focus({ preventScroll: true });
    }));
    channels.forEach((channel) => channel.addEventListener("input", () => {
      if (!activeColor) return;
      activeColor.value = "#" + channels.map((input) => Number(input.value).toString(16).padStart(2, "0")).join("");
      activeColor.dispatchEvent(new Event("input", { bubbles: true }));
    }));
    root?.querySelector("#watermark-color-picker-close")?.addEventListener("click", () => closePicker(true));
    picker?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker(true);
      }
    });
    [backgroundColor, textColor].forEach((control) => control?.addEventListener("blur", render));
    height?.addEventListener("change", render);
    render();
    void document.fonts.ready.then(render);
    const ready = chrome.storage.local.get(storageKey).then((stored) => {
      if (!edited) settings = normalizeWatermark(stored[storageKey]);
      render();
    }).catch(() => onError("Unable to load watermark settings."));
    return {
      async snapshot() {
        await ready;
        if (settings.enabled && !settings.text.trim()) {
          throw new Error("Enter watermark text, or turn off watermarks before posting.");
        }
        return { ...settings };
      }
    };
  }

  // src/sidepanel.ts
  var GEMINI_API_KEY_STORAGE_KEY = "geminiApiKey";
  var GEMINI_REWRITE_ENABLED_STORAGE_KEY = "geminiRewriteEnabled";
  var GEMINI_CUSTOM_PROMPT_STORAGE_KEY = "geminiCustomPrompt";
  var MARKETPLACE_GEMINI_REWRITE_ENABLED_STORAGE_KEY = "marketplaceGeminiRewriteEnabled";
  var MARKETPLACE_GEMINI_CUSTOM_PROMPT_STORAGE_KEY = "marketplaceGeminiCustomPrompt";
  var MARKETPLACE_MIN_INTERVAL_STORAGE_KEY = "marketplaceMinimumDelaySeconds";
  var MARKETPLACE_MAX_INTERVAL_STORAGE_KEY = "marketplaceMaximumDelaySeconds";
  var MARKETPLACE_SHUFFLE_ITEMS_STORAGE_KEY = "marketplaceShuffleItems";
  var AUTH_SESSION_STORAGE_KEY = "googleAuthSession";
  var AUTH_SIGNED_OUT_STORAGE_KEY = "googleAuthSignedOut";
  var SIDE_PANEL_SESSION_STORAGE_KEY = "sidePanelSession";
  var MIN_SLEEP_SECONDS = 60;
  var PREVIOUS_MIN_SLEEP_SECONDS = 120;
  var DEFAULT_MAX_SLEEP_SECONDS = 300;
  var DEFAULT_MAX_POSTS = 200;
  var FREE_MAX_GROUP_POSTS = 5;
  var MIN_MAX_POSTS = 1;
  function rootFontSize() {
    return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  }
  function remToPixels(value) {
    return value * rootFontSize();
  }
  function pixelsToRem(value) {
    return `${value / rootFontSize()}rem`;
  }
  var toastRegion = document.querySelector("#toast-region");
  function showToast(message, tone = "info", durationMs = tone === "error" ? 8e3 : 5e3) {
    if (!toastRegion) {
      console[tone === "error" ? "error" : "info"](message);
      return;
    }
    while (toastRegion.childElementCount >= 4) {
      toastRegion.firstElementChild?.remove();
    }
    const toast = document.createElement("section");
    toast.className = `toast-card toast-card--${tone}`;
    toast.setAttribute("role", tone === "error" ? "alert" : "status");
    const accent = document.createElement("span");
    accent.className = "toast-card__accent";
    accent.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.className = "toast-card__content";
    const title = document.createElement("strong");
    title.textContent = tone === "success" ? "Success" : tone === "warning" ? "Please check" : tone === "error" ? "Something went wrong" : "Information";
    const copy = document.createElement("span");
    copy.textContent = message;
    content.append(title, copy);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-card__close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "\xD7";
    let removalTimer;
    const dismiss = () => {
      if (!toast.isConnected || toast.classList.contains("toast-card--closing")) {
        return;
      }
      if (removalTimer !== void 0) {
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
  var accessSummary = document.querySelector("#access-summary");
  var accessTierBadge = document.querySelector("#access-tier-badge");
  var accessUsageDashboard = document.querySelector(
    "#access-usage-dashboard"
  );
  var accessProSummary = document.querySelector(
    "#access-pro-summary"
  );
  var accessResetMessage = document.querySelector(
    "#access-reset-message"
  );
  var accessResetMessageCopy = document.querySelector(
    "#access-reset-message-copy"
  );
  var accessUpgrade = document.querySelector("#access-upgrade");
  var accessMeters = {
    savedGroupPosts: {
      value: document.querySelector("#saved-groups-value"),
      meter: document.querySelector("#saved-groups-meter")
    },
    savedMarketplaceListings: {
      value: document.querySelector("#saved-marketplace-value"),
      meter: document.querySelector("#saved-marketplace-meter")
    },
    groupPostsToday: {
      value: document.querySelector("#daily-groups-value"),
      meter: document.querySelector("#daily-groups-meter")
    },
    marketplaceListingsToday: {
      value: document.querySelector("#daily-marketplace-value"),
      meter: document.querySelector("#daily-marketplace-meter")
    }
  };
  var loadGroupsButton = document.querySelector("#load-groups-btn");
  var groupsList = document.querySelector("#groups-list");
  var groupsStatusMessage = document.querySelector(
    "#groups-status-message"
  );
  var groupsStatusCount = document.querySelector(
    "#groups-status-count"
  );
  var groupsSelectionCount = document.querySelector(
    "#groups-selection-count"
  );
  var groupsSearchInput = document.querySelector(
    "#groups-search-input"
  );
  var groupsSelectAll = document.querySelector("#groups-select-all");
  var groupsSelectAllCheckbox = document.querySelector(
    "#groups-select-all-checkbox"
  );
  var postBodyInput = document.querySelector("#post-body-input");
  var postImagesInput = document.querySelector("#post-images-input");
  var groupsPhotoDropzone = document.querySelector("#image-picker");
  var groupsPhotoStatus = document.querySelector(
    "#groups-photo-status"
  );
  var imagePreviewList = document.querySelector(
    "#image-preview-list"
  );
  var savePreparedPostButton = document.querySelector(
    "#save-prepared-post-btn"
  );
  var cancelPostEditButton = document.querySelector(
    "#cancel-post-edit-btn"
  );
  var preparedPostsList = document.querySelector(
    "#prepared-posts-list"
  );
  var preparedPostsCount = document.querySelector(
    "#prepared-posts-count"
  );
  var preparedPostsSelectAll = document.querySelector(
    "#prepared-posts-select-all"
  );
  var preparedPostsSelectAllCheckbox = document.querySelector(
    "#prepared-posts-select-all-checkbox"
  );
  var postIntervalMinInput = document.querySelector(
    "#post-interval-min-input"
  );
  var postIntervalMaxInput = document.querySelector(
    "#post-interval-max-input"
  );
  var maxPostsInput = document.querySelector("#max-posts-input");
  var maxPostsNote = document.querySelector("#max-posts-note");
  var geminiApiKeyInput = document.querySelector(
    "#gemini-api-key-input"
  );
  var geminiRewriteToggle = document.querySelector(
    "#gemini-rewrite-toggle"
  );
  var geminiCustomPromptInput = document.querySelector(
    "#gemini-custom-prompt-input"
  );
  var groupCommentEnabledToggle = document.querySelector(
    "#group-comment-enabled-toggle"
  );
  var groupCommentOptionsContainer = document.querySelector(
    "#group-comment-options"
  );
  var groupCommentAddButton = document.querySelector(
    "#group-comment-add-btn"
  );
  var DEFAULT_GROUP_COMMENT_OPTIONS = [""];
  var groupCommentOptions = [...DEFAULT_GROUP_COMMENT_OPTIONS];
  var legacyGroupCommentSettings;
  var groupCommentSettingsLoaded = false;
  var groupCommentSettingsGeneration = 0;
  var groupCommentSaveTimer;
  var groupCommentSaveQueue = Promise.resolve();
  var groupCommentEditVersion = 0;
  var groupCommentSavedVersion = 0;
  var groupCommentSyncStatus = document.querySelector("#group-comment-sync-status");
  var groupCommentRetryButton = document.querySelector("#group-comment-retry-btn");
  var geminiStatusMessage = document.querySelector(
    "#gemini-status-message"
  );
  var geminiStatusCount = document.querySelector(
    "#gemini-status-count"
  );
  var createForm = document.querySelector("#create-form");
  var groupsTab = document.querySelector("#groups-tab");
  var marketplaceTab = document.querySelector("#marketplace-tab");
  var groupsTabPanel = document.querySelector("#groups-tab-panel");
  var marketplaceTabPanel = document.querySelector(
    "#marketplace-tab-panel"
  );
  var marketplaceCleanupCard = document.querySelector(
    ".marketplace-cleanup-card"
  );
  var marketplaceSavedListingsCard = document.querySelector(
    ".marketplace-saved-card"
  );
  var marketplacePostingPreferencesCard = document.querySelector(
    "#marketplace-posting-preferences-card"
  );
  var listingTypeSelect = document.querySelector(
    "#listing-type-select"
  );
  var listingTypeTrigger = document.querySelector(
    "#listing-type-trigger"
  );
  var listingTypeOptions = document.querySelector(
    "#listing-type-options"
  );
  var listingTypeValue = document.querySelector(
    "#listing-type-value"
  );
  var listingTypeSelectedIcon = document.querySelector(
    "#listing-type-selected-icon"
  );
  var listingTypeDefaultIconMarkup = listingTypeSelectedIcon?.innerHTML ?? "";
  var marketplaceListingTypeInput = document.querySelector(
    "#marketplace-listing-type-input"
  );
  var listingTypeOptionElements = Array.from(
    document.querySelectorAll(".custom-select__option")
  );
  var marketplacePhotosField = document.querySelector(
    "#marketplace-photos-field"
  );
  var marketplaceListingFields = document.querySelector(
    "#marketplace-listing-fields"
  );
  var saveMarketplaceListingButton = document.querySelector(
    "#save-marketplace-listing-btn"
  );
  var cancelMarketplaceListingEditButton = document.querySelector(
    "#cancel-marketplace-listing-edit-btn"
  );
  var marketplaceSaveListingStatus = document.querySelector(
    "#marketplace-save-listing-status"
  );
  var savedMarketplaceListingsList = document.querySelector(
    "#saved-marketplace-listings-list"
  );
  var savedMarketplaceListingsCount = document.querySelector(
    "#saved-marketplace-listings-count"
  );
  var savedMarketplaceListingsStatus = document.querySelector(
    "#saved-marketplace-listings-status"
  );
  var marketplaceListingsSelectAllCheckbox = document.querySelector(
    "#marketplace-listings-select-all-checkbox"
  );
  var marketplaceListingsSelectionCount = document.querySelector(
    "#marketplace-listings-selection-count"
  );
  var marketplaceIntervalMinInput = document.querySelector(
    "#marketplace-interval-min-input"
  );
  var marketplaceIntervalMaxInput = document.querySelector(
    "#marketplace-interval-max-input"
  );
  var marketplaceGeminiApiKeyInput = document.querySelector(
    "#marketplace-gemini-api-key-input"
  );
  var marketplaceGeminiPromptInput = document.querySelector(
    "#marketplace-gemini-prompt-input"
  );
  var marketplaceGeminiRewriteToggle = document.querySelector(
    "#marketplace-gemini-rewrite-toggle"
  );
  var marketplaceShuffleItemsToggle = document.querySelector(
    "#marketplace-shuffle-items-toggle"
  );
  var marketplacePostingStatusMessage = document.querySelector(
    "#marketplace-posting-status-message"
  );
  var marketplacePostingStatusCount = document.querySelector(
    "#marketplace-posting-status-count"
  );
  var marketplacePostingLog = document.querySelector(
    "#marketplace-posting-log"
  );
  var marketplaceCleanupDaysInput = document.querySelector(
    "#marketplace-cleanup-days-input"
  );
  var deleteOldMarketplaceListingsButton = document.querySelector(
    "#delete-old-marketplace-listings-btn"
  );
  var marketplaceCleanupProgress = document.querySelector(
    "#marketplace-cleanup-progress"
  );
  var marketplaceCleanupCount = document.querySelector(
    "#marketplace-cleanup-count"
  );
  var marketplaceCleanupPercent = document.querySelector(
    "#marketplace-cleanup-percent"
  );
  var marketplaceCleanupProgressBar = document.querySelector(
    "#marketplace-cleanup-progress-bar"
  );
  var marketplaceCleanupDeleted = document.querySelector(
    "#marketplace-cleanup-deleted"
  );
  var marketplaceCleanupFailed = document.querySelector(
    "#marketplace-cleanup-failed"
  );
  var marketplaceCleanupRemaining = document.querySelector(
    "#marketplace-cleanup-remaining"
  );
  var marketplaceCleanupMessage = document.querySelector(
    "#marketplace-cleanup-message"
  );
  var marketplaceCleanupLog = document.querySelector(
    "#marketplace-cleanup-log"
  );
  var marketplacePostingProgressCard = document.querySelector(
    "#marketplace-posting-progress-card"
  );
  var marketplacePostingProgress = document.querySelector(
    "#marketplace-posting-progress"
  );
  var marketplacePostingProgressPercent = document.querySelector(
    "#marketplace-posting-progress-percent"
  );
  var marketplacePostingProgressBar = document.querySelector(
    "#marketplace-posting-progress-bar"
  );
  var marketplacePostingProgressSuccess = document.querySelector(
    "#marketplace-posting-progress-success"
  );
  var marketplacePostingProgressFailed = document.querySelector(
    "#marketplace-posting-progress-failed"
  );
  var marketplacePostingProgressRemaining = document.querySelector(
    "#marketplace-posting-progress-remaining"
  );
  var marketplacePostingTiming = document.querySelector(
    "#marketplace-posting-timing"
  );
  var marketplacePostingTimingLabel = document.querySelector(
    "#marketplace-posting-timing-label"
  );
  var marketplacePostingElapsedTime = document.querySelector(
    "#marketplace-posting-elapsed-time"
  );
  var marketplacePostingItemTimingLabel = document.querySelector(
    "#marketplace-posting-item-timing-label"
  );
  var marketplacePostingItemTime = document.querySelector(
    "#marketplace-posting-item-time"
  );
  var marketplaceProgressPostedFilterButton = document.querySelector(
    "#marketplace-progress-filter-posted"
  );
  var marketplaceProgressFailedFilterButton = document.querySelector(
    "#marketplace-progress-filter-failed"
  );
  var pauseMarketplacePostingButton = document.querySelector(
    "#pause-marketplace-posting-btn"
  );
  var stopMarketplacePostingButton = document.querySelector(
    "#stop-marketplace-posting-btn"
  );
  var postSelectedMarketplaceItemsButton = document.querySelector(
    "#post-selected-marketplace-items-btn"
  );
  var marketplacePhotoDropzone = document.querySelector(
    "#marketplace-photo-dropzone"
  );
  var marketplaceImagesInput = document.querySelector(
    "#marketplace-images-input"
  );
  var marketplacePhotoCount = document.querySelector(
    "#marketplace-photo-count"
  );
  var marketplacePhotoLimit = document.querySelector(
    "#marketplace-photo-limit"
  );
  var marketplacePhotoGuidance = document.querySelector(
    "#marketplace-photo-guidance"
  );
  var marketplacePhotoStatus = document.querySelector(
    "#marketplace-photo-status"
  );
  var marketplacePhotoPreviews = document.querySelector(
    "#marketplace-photo-previews"
  );
  var marketplaceTitleInput = document.querySelector(
    "#marketplace-title-input"
  );
  var marketplaceTitleCount = document.querySelector(
    "#marketplace-title-count"
  );
  var marketplacePriceInput = document.querySelector(
    "#marketplace-price-input"
  );
  var marketplaceCategorySelect = document.querySelector(
    "#marketplace-category-select"
  );
  var marketplaceCategoryTrigger = document.querySelector(
    "#marketplace-category-trigger"
  );
  var marketplaceCategoryOptions = document.querySelector(
    "#marketplace-category-options"
  );
  var marketplaceCategoryValue = document.querySelector(
    "#marketplace-category-value"
  );
  var marketplaceCategorySelectedIcon = document.querySelector(
    "#marketplace-category-selected-icon"
  );
  var marketplaceCategoryDefaultIconMarkup = marketplaceCategorySelectedIcon?.innerHTML ?? "";
  var marketplaceCategoryInput = document.querySelector(
    "#marketplace-category-input"
  );
  var marketplaceCategoryGroupInput = document.querySelector(
    "#marketplace-category-group-input"
  );
  var marketplaceConditionSelect = document.querySelector(
    "#marketplace-condition-select"
  );
  var marketplaceConditionTrigger = document.querySelector(
    "#marketplace-condition-trigger"
  );
  var marketplaceConditionOptions = document.querySelector(
    "#marketplace-condition-options"
  );
  var marketplaceConditionValue = document.querySelector(
    "#marketplace-condition-value"
  );
  var marketplaceConditionInput = document.querySelector(
    "#marketplace-condition-input"
  );
  var marketplaceConditionOptionElements = Array.from(
    document.querySelectorAll(
      "#marketplace-condition-options .condition-select__option"
    )
  );
  var marketplaceVehicleTypeField = document.querySelector(
    "#marketplace-vehicle-type-field"
  );
  var marketplaceVehicleTypeSelect = document.querySelector(
    "#marketplace-vehicle-type-select"
  );
  var marketplaceVehicleTypeTrigger = document.querySelector(
    "#marketplace-vehicle-type-trigger"
  );
  var marketplaceVehicleTypeOptions = document.querySelector(
    "#marketplace-vehicle-type-options"
  );
  var marketplaceVehicleTypeValue = document.querySelector(
    "#marketplace-vehicle-type-value"
  );
  var marketplaceVehicleTypeInput = document.querySelector(
    "#marketplace-vehicle-type-input"
  );
  var marketplaceVehicleTypeOptionElements = Array.from(
    document.querySelectorAll(".vehicle-type-select__option")
  );
  var marketplaceYearField = document.querySelector(
    "#marketplace-year-field"
  );
  var marketplaceYearSelect = document.querySelector(
    "#marketplace-year-select"
  );
  var marketplaceYearTrigger = document.querySelector(
    "#marketplace-year-trigger"
  );
  var marketplaceYearOptions = document.querySelector(
    "#marketplace-year-options"
  );
  var marketplaceYearValue = document.querySelector(
    "#marketplace-year-value"
  );
  var marketplaceYearInput = document.querySelector(
    "#marketplace-year-input"
  );
  var marketplaceVehicleDetailsFields = document.querySelector(
    "#marketplace-vehicle-details-fields"
  );
  var marketplaceVehicleMileageInput = document.querySelector(
    "#marketplace-vehicle-mileage-input"
  );
  var marketplaceVehicleMileageField = document.querySelector(
    "#marketplace-vehicle-mileage-field"
  );
  var marketplaceBodyStyleSelect = document.querySelector(
    "#marketplace-body-style-select"
  );
  var marketplaceBodyStyleTrigger = document.querySelector(
    "#marketplace-body-style-trigger"
  );
  var marketplaceBodyStyleOptions = document.querySelector(
    "#marketplace-body-style-options"
  );
  var marketplaceBodyStyleValue = document.querySelector(
    "#marketplace-body-style-value"
  );
  var marketplaceBodyStyleInput = document.querySelector(
    "#marketplace-body-style-input"
  );
  var marketplaceBodyStyleOptionElements = Array.from(
    document.querySelectorAll(".body-style-select__option")
  );
  var marketplaceVehicleConditionSelect = document.querySelector(
    "#marketplace-vehicle-condition-select"
  );
  var marketplaceVehicleConditionTrigger = document.querySelector(
    "#marketplace-vehicle-condition-trigger"
  );
  var marketplaceVehicleConditionOptions = document.querySelector(
    "#marketplace-vehicle-condition-options"
  );
  var marketplaceVehicleConditionValue = document.querySelector(
    "#marketplace-vehicle-condition-value"
  );
  var marketplaceVehicleConditionInput = document.querySelector(
    "#marketplace-vehicle-condition-input"
  );
  var marketplaceVehicleConditionOptionElements = Array.from(
    document.querySelectorAll(".vehicle-condition-select__option")
  );
  var marketplaceFuelTypeSelect = document.querySelector(
    "#marketplace-fuel-type-select"
  );
  var marketplaceFuelTypeTrigger = document.querySelector(
    "#marketplace-fuel-type-trigger"
  );
  var marketplaceFuelTypeOptions = document.querySelector(
    "#marketplace-fuel-type-options"
  );
  var marketplaceFuelTypeValue = document.querySelector(
    "#marketplace-fuel-type-value"
  );
  var marketplaceFuelTypeInput = document.querySelector(
    "#marketplace-fuel-type-input"
  );
  var marketplaceFuelTypeOptionElements = Array.from(
    document.querySelectorAll(".fuel-type-select__option")
  );
  var marketplaceTransmissionSelect = document.querySelector(
    "#marketplace-transmission-select"
  );
  var marketplaceTransmissionTrigger = document.querySelector(
    "#marketplace-transmission-trigger"
  );
  var marketplaceTransmissionOptions = document.querySelector(
    "#marketplace-transmission-options"
  );
  var marketplaceTransmissionValue = document.querySelector(
    "#marketplace-transmission-value"
  );
  var marketplaceTransmissionInput = document.querySelector(
    "#marketplace-transmission-input"
  );
  var marketplaceTransmissionOptionElements = Array.from(
    document.querySelectorAll(".transmission-select__option")
  );
  var MARKETPLACE_VEHICLE_COLORS = [
    "Black",
    "Blue",
    "Brown",
    "Gold",
    "Green",
    "Gray",
    "Pink",
    "Purple",
    "Red",
    "Silver",
    "Orange",
    "White",
    "Yellow",
    "Charcoal",
    "Off white",
    "Tan",
    "Beige",
    "Burgundy",
    "Turquoise"
  ];
  var marketplaceColorDropdowns = {
    exterior: {
      select: document.querySelector(
        "#marketplace-exterior-color-select"
      ),
      trigger: document.querySelector(
        "#marketplace-exterior-color-trigger"
      ),
      options: document.querySelector(
        "#marketplace-exterior-color-options"
      ),
      value: document.querySelector(
        "#marketplace-exterior-color-value"
      ),
      input: document.querySelector(
        "#marketplace-exterior-color-input"
      ),
      optionElements: []
    },
    interior: {
      select: document.querySelector(
        "#marketplace-interior-color-select"
      ),
      trigger: document.querySelector(
        "#marketplace-interior-color-trigger"
      ),
      options: document.querySelector(
        "#marketplace-interior-color-options"
      ),
      value: document.querySelector(
        "#marketplace-interior-color-value"
      ),
      input: document.querySelector(
        "#marketplace-interior-color-input"
      ),
      optionElements: []
    }
  };
  var marketplaceRentalTypeField = document.querySelector(
    "#marketplace-rental-type-field"
  );
  var marketplaceRentalTypeSelect = document.querySelector(
    "#marketplace-rental-type-select"
  );
  var marketplaceRentalTypeTrigger = document.querySelector(
    "#marketplace-rental-type-trigger"
  );
  var marketplaceRentalTypeOptions = document.querySelector(
    "#marketplace-rental-type-options"
  );
  var marketplaceRentalTypeValue = document.querySelector(
    "#marketplace-rental-type-value"
  );
  var marketplaceRentalTypeInput = document.querySelector(
    "#marketplace-rental-type-input"
  );
  var marketplaceRentalTypeOptionElements = Array.from(
    document.querySelectorAll(".rental-type-select__option")
  );
  var marketplaceHomeDetailsFields = document.querySelector(
    "#marketplace-home-details-fields"
  );
  var marketplaceVehicleExtraFields = Array.from(
    document.querySelectorAll("[data-vehicle-extra]")
  );
  var marketplaceTitleField = document.querySelector(
    "#marketplace-title-field"
  );
  var marketplacePriceField = document.querySelector(
    "#marketplace-price-field"
  );
  var marketplaceCategoryField = document.querySelector(
    "#marketplace-category-field"
  );
  var marketplaceConditionField = document.querySelector(
    "#marketplace-condition-field"
  );
  var marketplaceDescriptionField = document.querySelector(
    "#marketplace-description-field"
  );
  var marketplaceLocationField = document.querySelector(
    "#marketplace-location-field"
  );
  var marketplaceBedroomsInput = document.querySelector(
    "#marketplace-bedrooms-input"
  );
  var marketplaceBathroomsInput = document.querySelector(
    "#marketplace-bathrooms-input"
  );
  var marketplacePhotoLightbox = document.querySelector(
    "#marketplace-photo-lightbox"
  );
  var marketplacePhotoLightboxBackdrop = document.querySelector(
    "#marketplace-photo-lightbox-backdrop"
  );
  var marketplacePhotoLightboxClose = document.querySelector(
    "#marketplace-photo-lightbox-close"
  );
  var marketplacePhotoLightboxTitle = document.querySelector(
    "#marketplace-photo-lightbox-title"
  );
  var marketplacePhotoLightboxImage = document.querySelector(
    "#marketplace-photo-lightbox-image"
  );
  var marketplacePhotoLightboxCounter = document.querySelector(
    "#marketplace-photo-lightbox-counter"
  );
  var marketplacePhotoLightboxFilename = document.querySelector(
    "#marketplace-photo-lightbox-filename"
  );
  var marketplacePhotoLightboxPrevious = document.querySelector(
    "#marketplace-photo-lightbox-previous"
  );
  var marketplacePhotoLightboxNext = document.querySelector(
    "#marketplace-photo-lightbox-next"
  );
  var marketplacePhotoLightboxThumbnails = document.querySelector(
    "#marketplace-photo-lightbox-thumbnails"
  );
  var pausePostingButton = document.querySelector("#pause-posting-btn");
  var stopPostingButton = document.querySelector("#stop-posting-btn");
  var startPostingButton = document.querySelector("#start-posting-btn");
  var postingProgress = document.querySelector("#posting-progress");
  var postingProgressTitle = document.querySelector(
    "#posting-progress-title"
  );
  var postingProgressPercent = document.querySelector(
    "#posting-progress-percent"
  );
  var postingProgressBar = document.querySelector(
    "#posting-progress-bar"
  );
  var postingProgressSuccess = document.querySelector(
    "#posting-progress-success"
  );
  var postingProgressPending = document.querySelector(
    "#posting-progress-pending"
  );
  var postingProgressFailed = document.querySelector(
    "#posting-progress-failed"
  );
  var postingProgressRemaining = document.querySelector(
    "#posting-progress-remaining"
  );
  var postingTiming = document.querySelector("#posting-timing");
  var postingTimingLabel = document.querySelector(
    "#posting-timing-label"
  );
  var postingElapsedTime = document.querySelector(
    "#posting-elapsed-time"
  );
  var postingItemTimingLabel = document.querySelector(
    "#posting-item-timing-label"
  );
  var postingItemTime = document.querySelector("#posting-item-time");
  var postingProgressCurrent = document.querySelector(
    "#posting-progress-current"
  );
  var postingProgressLog = document.querySelector(
    "#posting-progress-log"
  );
  var postingProgressPostedFilterButton = document.querySelector("#posting-progress-filter-posted");
  var postingProgressPendingFilterButton = document.querySelector("#posting-progress-filter-pending");
  var postingProgressFailedFilterButton = document.querySelector("#posting-progress-filter-failed");
  var authLoginButton = document.querySelector("#auth-login-btn");
  var authLogoutButton = document.querySelector("#auth-logout-btn");
  var authStatusMessage = document.querySelector(
    "#auth-status-message"
  );
  var accountCardToggle = document.querySelector(
    "#account-card-toggle"
  );
  var accountCardContent = document.querySelector(
    "#account-card-content"
  );
  var accountCardExpanded = false;
  function updateAccountCardVisibility(signedIn) {
    if (!signedIn) accountCardExpanded = false;
    if (accountCardToggle) {
      accountCardToggle.hidden = !signedIn;
      accountCardToggle.setAttribute(
        "aria-expanded",
        String(accountCardExpanded)
      );
    }
    if (accountCardContent)
      accountCardContent.hidden = signedIn && !accountCardExpanded;
  }
  accountCardToggle?.addEventListener("click", () => {
    accountCardExpanded = !accountCardExpanded;
    updateAccountCardVisibility(true);
  });
  var authPanelTitle = document.querySelector("#auth-panel-title");
  var authWelcomeArt = document.querySelector("#auth-welcome-art");
  var authBenefits = document.querySelector("#auth-benefits");
  var authSigninNote = document.querySelector("#auth-signin-note");
  var authSessionPill = document.querySelector("#auth-session-pill");
  var authUserEmail = document.querySelector("#auth-user-email");
  var deleteConfirmation = document.querySelector(
    "#delete-confirmation"
  );
  var deleteConfirmationBackdrop = document.querySelector(
    "#delete-confirmation-backdrop"
  );
  var deleteConfirmationTitle = document.querySelector(
    "#delete-confirmation-title"
  );
  var deleteConfirmationMessage = document.querySelector(
    "#delete-confirmation-message"
  );
  var deleteConfirmationCancel = document.querySelector(
    "#delete-confirmation-cancel"
  );
  var deleteConfirmationConfirm = document.querySelector(
    "#delete-confirmation-confirm"
  );
  var marketplaceAudienceChoice = document.querySelector(
    "#marketplace-audience-choice"
  );
  var marketplaceAudienceChoiceBackdrop = document.querySelector(
    "#marketplace-audience-choice-backdrop"
  );
  var marketplaceAudienceChoiceCancel = document.querySelector(
    "#marketplace-audience-choice-cancel"
  );
  var marketplaceAudienceChoiceMarketplaceOnly = document.querySelector(
    "#marketplace-audience-choice-marketplace-only"
  );
  var marketplaceAudienceChoiceWithGroups = document.querySelector(
    "#marketplace-audience-choice-with-groups"
  );
  var selectedImagePreviewUrls = [];
  var marketplacePhotoPreviewUrls = [];
  var marketplacePhotoLightboxUrls = [];
  var MARKETPLACE_PHOTO_LIMITS = {
    item: 10,
    vehicle: 20,
    home: 50
  };
  var MARKETPLACE_CATEGORY_GROUPS = [
    {
      name: "Home & Garden",
      iconPath: "M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z",
      options: [
        { label: "Tools" },
        { label: "Furniture" },
        { label: "Household", shipping: true },
        { label: "Garden" },
        { label: "Appliances" }
      ]
    },
    {
      name: "Entertainment",
      iconPath: "M176,112H152a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16ZM104,96H96V88a8,8,0,0,0-16,0v8H72a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0v-8h8a8,8,0,0,0,0-16ZM241.48,200.65a36,36,0,0,1-54.94,4.81c-.12-.12-.24-.24-.35-.37L146.48,160h-37L69.81,205.09l-.35.37A36.08,36.08,0,0,1,44,216,36,36,0,0,1,8.56,173.75a.68.68,0,0,1,0-.14L24.93,89.52A59.88,59.88,0,0,1,83.89,40H172a60.08,60.08,0,0,1,59,49.25c0,.06,0,.12,0,.18l16.37,84.17a.68.68,0,0,1,0,.14A35.74,35.74,0,0,1,241.48,200.65ZM172,144a44,44,0,0,0,0-88H83.89A43.9,43.9,0,0,0,40.68,92.37l0,.13L24.3,176.59A20,20,0,0,0,58,194.3l41.92-47.59a8,8,0,0,1,6-2.71Zm59.7,32.59-8.74-45A60,60,0,0,1,172,160h-4.2L198,194.31a20.09,20.09,0,0,0,17.46,5.39,20,20,0,0,0,16.23-23.11Z",
      options: [
        { label: "Video Games" },
        { label: "Books, Movies & Music", shipping: true }
      ]
    },
    {
      name: "Clothing & Accessories",
      iconPath: "M216,64H176a48,48,0,0,0-96,0H40A16,16,0,0,0,24,80V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64ZM128,32a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm88,168H40V80H80V96a8,8,0,0,0,16,0V80h64V96a8,8,0,0,0,16,0V80h40Z",
      options: [
        { label: "Bags & Luggage", shipping: true },
        { label: "Women's clothing & shoes", shipping: true },
        { label: "Men's clothing & shoes", shipping: true },
        { label: "Jewelry & Accessories", shipping: true }
      ]
    },
    {
      name: "Family",
      iconPath: "M178,40c-20.65,0-38.73,8.88-50,23.89C116.73,48.88,98.65,40,78,40a62.07,62.07,0,0,0-62,62c0,70,103.79,126.66,108.21,129a8,8,0,0,0,7.58,0C136.21,228.66,240,172,240,102A62.07,62.07,0,0,0,178,40ZM128,214.8C109.74,204.16,32,155.69,32,102A46.06,46.06,0,0,1,78,56c19.45,0,35.78,10.36,42.6,27a8,8,0,0,0,14.8,0c6.82-16.67,23.15-27,42.6-27a46.06,46.06,0,0,1,46,46C224,155.61,146.24,204.15,128,214.8Z",
      options: [
        { label: "Health & beauty", shipping: true },
        { label: "Pet Supplies" },
        { label: "Baby & kids", shipping: true },
        { label: "Toys & Games", shipping: true }
      ]
    },
    {
      name: "Electronics",
      iconPath: "M176,16H80A24,24,0,0,0,56,40V216a24,24,0,0,0,24,24h96a24,24,0,0,0,24-24V40A24,24,0,0,0,176,16ZM72,64H184V192H72Zm8-32h96a8,8,0,0,1,8,8v8H72V40A8,8,0,0,1,80,32Zm96,192H80a8,8,0,0,1-8-8v-8H184v8A8,8,0,0,1,176,224Z",
      options: [
        { label: "Electronics & computers", shipping: true },
        { label: "Mobile phones", shipping: true }
      ]
    },
    {
      name: "Hobbies",
      iconPath: "M249.66,46.34l-40-40a8,8,0,0,0-11.31,11.32L200.69,20,140.52,80.16C117.73,68.3,92.21,69.29,76.75,84.74a42.27,42.27,0,0,0-9.39,14.37A8.24,8.24,0,0,1,59.81,104c-14.59.49-27.26,5.72-36.65,15.11C11.08,131.22,6,148.6,8.74,168.07,11.4,186.7,21.07,205.15,36,220s33.34,24.56,52,27.22A71.13,71.13,0,0,0,98.1,248c15.32,0,28.83-5.23,38.76-15.16,9.39-9.39,14.62-22.06,15.11-36.65a8.24,8.24,0,0,1,4.92-7.55,42.12,42.12,0,0,0,14.37-9.39c15.45-15.46,16.44-41,4.58-63.77L236,55.31l2.34,2.34a8,8,0,1,0,11.32-11.31ZM160,167.93a26.12,26.12,0,0,1-8.95,5.83,24.24,24.24,0,0,0-15,21.89c-.36,10.46-4,19.41-10.43,25.88-8.44,8.43-21,11.95-35.36,9.89C75,229.25,59.73,221.19,47.27,208.73S26.75,181,24.58,165.81c-2-14.37,1.46-26.92,9.89-35.36C40.94,124,49.89,120.37,60.35,120h0a24.22,24.22,0,0,0,21.89-15,26.12,26.12,0,0,1,5.83-9c5.49-5.49,13-8.13,21.38-8.13a49.38,49.38,0,0,1,19.13,4.19L108.5,112.19a32,32,0,1,0,35.31,35.31l20.08-20.08C170.41,142.71,169.47,158.41,160,167.93Zm-10.4-61.48a72.9,72.9,0,0,1,5.93,6.75l-15.42,15.42a32.22,32.22,0,0,0-12.68-12.68l15.42-15.43A73,73,0,0,1,149.55,106.45ZM112,128a16,16,0,0,1,16,16h0a16,16,0,1,1-16-16Zm48.85-32.85a86.94,86.94,0,0,0-6.68-6L176,67.31,188.69,80l-21.83,21.82A86.94,86.94,0,0,0,160.86,95.14ZM200,68.68,187.32,56,212,31.31,224.69,44ZM93.66,194.33a8,8,0,0,1-11.31,11.32l-32-32a8,8,0,0,1,11.32-11.31Z",
      options: [
        { label: "Bicycles" },
        { label: "Arts & Crafts" },
        { label: "Sports & Outdoors", shipping: true },
        { label: "Auto parts" },
        { label: "Musical Instruments" },
        { label: "Antiques & Collectibles" }
      ]
    },
    {
      name: "Classifieds",
      iconPath: "M240,192h-8V98.67a16,16,0,0,0-7.12-13.31l-88-58.67a16,16,0,0,0-17.75,0l-88,58.67A16,16,0,0,0,24,98.67V192H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM40,98.67,128,40l88,58.66V192H192V136a8,8,0,0,0-8-8H72a8,8,0,0,0-8,8v56H40ZM176,144v16H136V144Zm-56,16H80V144h40ZM80,176h40v16H80Zm56,0h40v16H136Z",
      options: [{ label: "Garage Sale" }, { label: "Miscellaneous" }]
    },
    {
      name: "Vehicles",
      iconPath: "M240,104H229.2L201.42,41.5A16,16,0,0,0,186.8,32H69.2a16,16,0,0,0-14.62,9.5L26.8,104H16a8,8,0,0,0,0,16h8v80a16,16,0,0,0,16,16H64a16,16,0,0,0,16-16V184h96v16a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16V120h8a8,8,0,0,0,0-16ZM69.2,48H186.8l24.89,56H44.31ZM64,200H40V184H64Zm128,0V184h24v16Zm24-32H40V120H216ZM56,144a8,8,0,0,1,8-8H80a8,8,0,0,1,0,16H64A8,8,0,0,1,56,144Zm112,0a8,8,0,0,1,8-8h16a8,8,0,0,1,0,16H176A8,8,0,0,1,168,144Z",
      options: []
    }
  ];
  var selectedImageFiles = [];
  var selectedMarketplaceImageFiles = [];
  var groupPhotoAdditionQueue = Promise.resolve();
  var marketplacePhotoAdditionQueue = Promise.resolve();
  var imageContentSignatureCache = /* @__PURE__ */ new WeakMap();
  var selectedMarketplaceListingType;
  var savedMarketplaceListings = [];
  var selectedMarketplaceListingIds = /* @__PURE__ */ new Set();
  var isMarketplacePostingActive = false;
  var isMarketplacePostingPaused = false;
  var isMarketplaceStopRequestPending = false;
  var isMarketplacePauseRequestPending = false;
  var isMarketplaceListingSaving = false;
  var isMarketplaceCleanupActive = false;
  var groupsPostingLogFilter = "all";
  var marketplacePostingLogFilter = "all";
  var latestGroupsPostingTiming;
  var latestMarketplacePostingTiming;
  var editingMarketplaceListingId;
  var draggedMarketplacePhotoIndex;
  var draggedGroupPhotoIndex;
  var marketplacePhotoLightboxIndex = 0;
  var marketplacePhotoLightboxReturnFocus;
  var photoLightboxSource = "marketplace";
  var marketplaceCategoryOptionElements = [];
  var marketplaceYearOptionElements = [];
  var preparedPosts = [];
  var editingPreparedPostId;
  var loadedGroups = [];
  var selectedGroupIds = /* @__PURE__ */ new Set();
  var groupsSearchQuery = "";
  var imagePreviewsVisible = false;
  var isPostingActive = false;
  var isPostingPaused = false;
  var isStopRequestPending = false;
  var isPauseResumeRequestPending = false;
  var saveSidePanelSessionTimer;
  var isRestoringSidePanelSession = false;
  var proMaxPostsPreference = DEFAULT_MAX_POSTS;
  var deleteConfirmationResolver;
  var deleteConfirmationReturnFocus;
  var marketplaceAudienceChoiceResolver;
  var marketplaceAudienceChoiceReturnFocus;
  var currentExtensionAccess;
  var currentGoogleAccessToken;
  if (marketplaceSavedListingsCard && marketplacePostingPreferencesCard) {
    marketplaceSavedListingsCard.before(marketplacePostingPreferencesCard);
  }
  if (marketplaceTabPanel && marketplaceCleanupCard) {
    marketplaceTabPanel.append(marketplaceCleanupCard);
  }
  void initializeGeminiSettings();
  initializeCardAccordions(scheduleSaveSidePanelSession);
  var watermarkControls = initializeWatermarkControls((message) => showToast(message, "error"));
  void initializeMarketplacePostingSettings();
  void initializeMarketplaceCleanupSettings();
  void initializeApplication();
  void restorePostingQueueStatus();
  initializeMarketplaceCategorySelect();
  initializeMarketplaceYearSelect();
  initializeMarketplaceColorSelects();
  initializeDropdownTriggerIcons();
  initializeDropdownChevronIcons();
  initializeListingTypeAvailability();
  initializeVehicleTypeAvailability();
  configureMarketplaceVehicleTypeField();
  initializePasteNormalization();
  initializeDeleteConfirmation();
  initializeMarketplaceAudienceChoice();
  async function initializeApplication() {
    await initializeSidePanelSession();
    await initializeExtensionAccess();
    if (hasActiveExtensionAccess()) {
      await Promise.all([loadCloudPreparedPosts(), loadMarketplaceListings(), loadCloudGroupCommentSettings()]);
    }
  }
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
      const availableCharacters = control.maxLength >= 0 ? Math.max(
        control.maxLength - (control.value.length - (selectionEnd - selectionStart)),
        0
      ) : normalizedText.length;
      const replacement = normalizedText.slice(0, availableCharacters);
      control.setRangeText(replacement, selectionStart, selectionEnd, "end");
      control.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: replacement,
          inputType: "insertFromPaste"
        })
      );
    });
  }
  function isPasteNormalizableControl(target) {
    if (target instanceof HTMLTextAreaElement) {
      return !target.disabled && !target.readOnly;
    }
    if (!(target instanceof HTMLInputElement)) {
      return false;
    }
    return !target.disabled && !target.readOnly && ["text", "search", "email", "tel", "url"].includes(target.type);
  }
  function initializeDeleteConfirmation() {
    deleteConfirmationCancel?.addEventListener("click", () => {
      closeDeleteConfirmation(false);
    });
    deleteConfirmationBackdrop?.addEventListener("click", () => {
      closeDeleteConfirmation(false);
    });
    deleteConfirmationConfirm?.addEventListener("click", () => {
      closeDeleteConfirmation(true);
    });
    deleteConfirmation?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDeleteConfirmation(false);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = [
        deleteConfirmationCancel,
        deleteConfirmationConfirm
      ].filter((button) => Boolean(button));
      if (focusable.length === 0) {
        return;
      }
      const currentIndex = focusable.indexOf(
        document.activeElement
      );
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    });
  }
  function requestDeleteConfirmation(title, message) {
    if (!deleteConfirmation || !deleteConfirmationTitle || !deleteConfirmationMessage || !deleteConfirmationConfirm) {
      return Promise.resolve(false);
    }
    if (deleteConfirmationResolver) {
      closeDeleteConfirmation(false);
    }
    deleteConfirmationTitle.textContent = title;
    deleteConfirmationMessage.textContent = message;
    deleteConfirmationReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : void 0;
    deleteConfirmation.hidden = false;
    document.body.classList.add("delete-confirmation-open");
    deleteConfirmationConfirm.focus();
    return new Promise((resolve) => {
      deleteConfirmationResolver = resolve;
    });
  }
  function closeDeleteConfirmation(confirmed) {
    if (!deleteConfirmationResolver) {
      return;
    }
    const resolve = deleteConfirmationResolver;
    const returnFocus = deleteConfirmationReturnFocus;
    deleteConfirmationResolver = void 0;
    deleteConfirmationReturnFocus = void 0;
    if (deleteConfirmation) {
      deleteConfirmation.hidden = true;
    }
    document.body.classList.remove("delete-confirmation-open");
    resolve(confirmed);
    returnFocus?.focus();
  }
  function initializeMarketplaceAudienceChoice() {
    marketplaceAudienceChoiceCancel?.addEventListener("click", () => {
      closeMarketplaceAudienceChoice(void 0);
    });
    marketplaceAudienceChoiceBackdrop?.addEventListener("click", () => {
      closeMarketplaceAudienceChoice(void 0);
    });
    marketplaceAudienceChoiceMarketplaceOnly?.addEventListener("click", () => {
      closeMarketplaceAudienceChoice(false);
    });
    marketplaceAudienceChoiceWithGroups?.addEventListener("click", () => {
      closeMarketplaceAudienceChoice(true);
    });
    marketplaceAudienceChoice?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMarketplaceAudienceChoice(void 0);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = [
        marketplaceAudienceChoiceCancel,
        marketplaceAudienceChoiceMarketplaceOnly,
        marketplaceAudienceChoiceWithGroups
      ].filter((button) => Boolean(button));
      if (focusable.length === 0) {
        return;
      }
      const currentIndex = focusable.indexOf(
        document.activeElement
      );
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    });
  }
  function requestMarketplaceAudienceChoice() {
    if (!marketplaceAudienceChoice || !marketplaceAudienceChoiceMarketplaceOnly || !marketplaceAudienceChoiceWithGroups) {
      return Promise.resolve(void 0);
    }
    if (marketplaceAudienceChoiceResolver) {
      closeMarketplaceAudienceChoice(void 0);
    }
    marketplaceAudienceChoiceReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : void 0;
    marketplaceAudienceChoice.hidden = false;
    document.body.classList.add("marketplace-audience-choice-open");
    marketplaceAudienceChoiceMarketplaceOnly.focus();
    return new Promise((resolve) => {
      marketplaceAudienceChoiceResolver = resolve;
    });
  }
  function closeMarketplaceAudienceChoice(shareToSuggestedGroups) {
    if (!marketplaceAudienceChoiceResolver) {
      return;
    }
    const resolve = marketplaceAudienceChoiceResolver;
    const returnFocus = marketplaceAudienceChoiceReturnFocus;
    marketplaceAudienceChoiceResolver = void 0;
    marketplaceAudienceChoiceReturnFocus = void 0;
    if (marketplaceAudienceChoice) {
      marketplaceAudienceChoice.hidden = true;
    }
    document.body.classList.remove("marketplace-audience-choice-open");
    resolve(shareToSuggestedGroups);
    returnFocus?.focus();
  }
  function initializeVehicleTypeAvailability() {
    marketplaceVehicleTypeOptionElements.forEach((option) => {
      const available = option.dataset.value === "car_truck";
      option.setAttribute("aria-disabled", String(!available));
      if (!available) {
        option.tabIndex = -1;
        option.setAttribute("aria-description", "Coming soon");
      }
    });
  }
  function initializeListingTypeAvailability() {
    listingTypeOptionElements.forEach((option) => {
      const available = option.dataset.value !== "home";
      option.setAttribute("aria-disabled", String(!available));
      if (!available) {
        option.tabIndex = -1;
        option.setAttribute("aria-description", "Coming soon");
      }
    });
  }
  function initializeDropdownTriggerIcons() {
    document.querySelectorAll(".condition-select__trigger").forEach((trigger) => {
      if (trigger.querySelector(".condition-select__icon")) {
        return;
      }
      const icon = document.createElement("span");
      icon.className = "condition-select__icon";
      icon.setAttribute("aria-hidden", "true");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "32");
      svg.setAttribute("height", "32");
      svg.setAttribute("fill", "currentColor");
      svg.setAttribute("viewBox", "0 0 256 256");
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      path.setAttribute(
        "d",
        "M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"
      );
      svg.append(path);
      icon.append(svg);
      trigger.prepend(icon);
    });
  }
  function initializeDropdownChevronIcons() {
    document.querySelectorAll(
      ".custom-select__chevron, .category-select__chevron, .condition-select__chevron"
    ).forEach((chevron) => {
      const createChevron = (className, pathData) => {
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg"
        );
        svg.classList.add(className);
        svg.setAttribute("width", "32");
        svg.setAttribute("height", "32");
        svg.setAttribute("fill", "currentColor");
        svg.setAttribute("viewBox", "0 0 256 256");
        svg.setAttribute("aria-hidden", "true");
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path"
        );
        path.setAttribute("d", pathData);
        svg.append(path);
        return svg;
      };
      const downChevron = createChevron(
        "dropdown-chevron__down",
        "M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"
      );
      const upChevron = createChevron(
        "dropdown-chevron__up",
        "M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z"
      );
      chevron.replaceChildren(downChevron, upChevron);
    });
  }
  function selectWorkspaceTab(tab) {
    const groupsActive = tab === "groups";
    closeListingTypeDropdown();
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns();
    closeMarketplaceRentalTypeDropdown();
    groupsTab?.classList.toggle("workspace-tab--active", groupsActive);
    groupsTab?.setAttribute("aria-selected", String(groupsActive));
    groupsTab?.setAttribute("tabindex", groupsActive ? "0" : "-1");
    marketplaceTab?.classList.toggle("workspace-tab--active", !groupsActive);
    marketplaceTab?.setAttribute("aria-selected", String(!groupsActive));
    marketplaceTab?.setAttribute("tabindex", groupsActive ? "-1" : "0");
    if (groupsTabPanel) {
      groupsTabPanel.hidden = !groupsActive;
    }
    if (marketplaceTabPanel) {
      marketplaceTabPanel.hidden = groupsActive;
    }
  }
  groupsTab?.addEventListener("click", () => selectWorkspaceTab("groups"));
  marketplaceTab?.addEventListener(
    "click",
    () => selectWorkspaceTab("marketplace")
  );
  function openListingTypeDropdown(focusIndex, focusDirection = 1) {
    if (!listingTypeSelect || !listingTypeTrigger || !listingTypeOptions) {
      return;
    }
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns();
    closeMarketplaceRentalTypeDropdown();
    listingTypeOptions.hidden = false;
    listingTypeSelect.classList.add("custom-select--open");
    listingTypeTrigger.setAttribute("aria-expanded", "true");
    if (focusIndex !== void 0) {
      focusListingTypeOption(focusIndex, focusDirection);
    }
  }
  function closeListingTypeDropdown(returnFocus = false) {
    if (!listingTypeSelect || !listingTypeTrigger || !listingTypeOptions) {
      return;
    }
    listingTypeOptions.hidden = true;
    listingTypeSelect.classList.remove("custom-select--open");
    listingTypeTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      listingTypeTrigger.focus();
    }
  }
  function selectListingType(option, allowDisabled = false) {
    if (!allowDisabled && option.getAttribute("aria-disabled") === "true") {
      return;
    }
    const value = option.dataset.value;
    const label = option.querySelector("strong")?.textContent?.trim();
    if (!value || !label) {
      return;
    }
    if (!(value in MARKETPLACE_PHOTO_LIMITS)) {
      return;
    }
    listingTypeOptionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (listingTypeValue) {
      listingTypeValue.textContent = label;
    }
    if (listingTypeSelectedIcon) {
      const selectedIcon = option.querySelector("svg")?.cloneNode(true);
      if (selectedIcon) {
        listingTypeSelectedIcon.replaceChildren(selectedIcon);
      }
    }
    if (marketplaceListingTypeInput) {
      marketplaceListingTypeInput.value = value;
    }
    configureMarketplacePhotoUploader(value);
    configureMarketplaceVehicleTypeField(value);
    updateMarketplaceSaveListingButtonState();
    closeListingTypeDropdown(true);
  }
  function configureMarketplacePhotoUploader(type) {
    selectedMarketplaceListingType = type;
    const limit = MARKETPLACE_PHOTO_LIMITS[type];
    marketplacePhotosField?.classList.remove("marketplace-photos--disabled");
    marketplacePhotoDropzone?.setAttribute("aria-disabled", "false");
    if (marketplaceImagesInput) {
      marketplaceImagesInput.disabled = false;
    }
    if (marketplacePhotoLimit) {
      marketplacePhotoLimit.textContent = String(limit);
    }
    if (marketplacePhotoGuidance) {
      marketplacePhotoGuidance.textContent = `You can add up to ${limit} photos.`;
    }
    if (selectedMarketplaceImageFiles.length > limit) {
      const removedCount = selectedMarketplaceImageFiles.length - limit;
      selectedMarketplaceImageFiles = selectedMarketplaceImageFiles.slice(
        0,
        limit
      );
      showMarketplacePhotoStatus(
        `${removedCount} ${removedCount === 1 ? "photo was" : "photos were"} removed to match the ${limit}-photo limit.`,
        true
      );
    } else {
      hideMarketplacePhotoStatus();
    }
    syncMarketplaceImagesInput();
    renderMarketplacePhotoPreviews();
    updateMarketplaceSaveListingButtonState();
  }
  function configureMarketplaceVehicleTypeField(type) {
    const listingSelected = Boolean(type);
    const itemSelected = type === "item";
    const vehicleSelected = type === "vehicle";
    const homeSelected = type === "home";
    arrangeMarketplaceListingFields(type);
    setMarketplaceFieldAvailability(marketplaceListingFields, listingSelected);
    setMarketplaceFieldAvailability(marketplaceVehicleTypeField, vehicleSelected);
    setMarketplaceFieldAvailability(marketplaceYearField, vehicleSelected);
    setMarketplaceFieldAvailability(
      marketplaceVehicleDetailsFields,
      vehicleSelected
    );
    setMarketplaceFieldAvailability(marketplaceRentalTypeField, homeSelected);
    setMarketplaceFieldAvailability(marketplaceHomeDetailsFields, homeSelected);
    setMarketplaceFieldAvailability(
      marketplaceTitleField,
      itemSelected || homeSelected
    );
    setMarketplaceFieldAvailability(marketplacePriceField, listingSelected);
    setMarketplaceFieldAvailability(
      marketplaceCategoryField,
      itemSelected || homeSelected
    );
    setMarketplaceFieldAvailability(
      marketplaceConditionField,
      itemSelected || homeSelected
    );
    setMarketplaceFieldAvailability(marketplaceDescriptionField, listingSelected);
    setMarketplaceFieldAvailability(marketplaceLocationField, listingSelected);
    marketplaceVehicleExtraFields.forEach((field) => {
      setMarketplaceFieldAvailability(field, vehicleSelected);
    });
    if (!vehicleSelected) {
      closeMarketplaceVehicleTypeDropdown();
      closeMarketplaceYearDropdown();
      closeMarketplaceBodyStyleDropdown();
      closeMarketplaceVehicleConditionDropdown();
      closeMarketplaceFuelTypeDropdown();
      closeMarketplaceTransmissionDropdown();
      closeMarketplaceColorDropdowns();
    }
    if (!homeSelected) {
      closeMarketplaceRentalTypeDropdown();
    }
    if (vehicleSelected) {
      closeMarketplaceCategoryDropdown();
      closeMarketplaceConditionDropdown();
    }
  }
  function arrangeMarketplaceListingFields(type) {
    if (!marketplaceListingFields || !marketplacePhotosField || !marketplaceVehicleTypeField || !marketplaceTitleField || !marketplacePriceField || !marketplaceCategoryField || !marketplaceDescriptionField || !marketplaceLocationField) {
      return;
    }
    if (type === "vehicle") {
      marketplaceListingFields.insertBefore(
        marketplaceVehicleTypeField,
        marketplacePhotosField
      );
      marketplacePhotosField.insertAdjacentElement(
        "afterend",
        marketplaceLocationField
      );
      marketplaceVehicleMileageField?.insertAdjacentElement(
        "afterend",
        marketplacePriceField
      );
      return;
    }
    marketplacePhotosField.insertAdjacentElement(
      "afterend",
      marketplaceVehicleTypeField
    );
    marketplaceTitleField.insertAdjacentElement(
      "afterend",
      marketplacePriceField
    );
    marketplaceDescriptionField.insertAdjacentElement(
      "afterend",
      marketplaceLocationField
    );
  }
  function setMarketplaceFieldAvailability(container, available) {
    if (!container) {
      return;
    }
    container.hidden = !available;
    container.querySelectorAll("input, button, textarea").forEach((control) => {
      control.disabled = !available;
    });
  }
  function isMarketplaceListingFormComplete() {
    if (!selectedMarketplaceListingType || selectedMarketplaceImageFiles.length === 0 || !marketplaceListingFields) {
      return false;
    }
    const controls = Array.from(
      marketplaceListingFields.querySelectorAll("input[name]:not(:disabled), textarea[name]:not(:disabled)")
    ).filter(
      (control) => !(control instanceof HTMLInputElement) || control.type !== "file" && control.type !== "checkbox"
    );
    if (!controls.every((control) => control.value.trim().length > 0)) {
      return false;
    }
    if (selectedMarketplaceListingType === "vehicle") {
      const mileage = Number(marketplaceVehicleMileageInput?.value ?? 0);
      if (!Number.isInteger(mileage) || mileage < 300 || mileage > 1e6) {
        return false;
      }
    }
    return true;
  }
  function updateMarketplaceSaveListingButtonState() {
    if (!saveMarketplaceListingButton) {
      return;
    }
    const complete = isMarketplaceListingFormComplete();
    const savedLimitReached = !editingMarketplaceListingId && currentExtensionAccess?.access.remaining.saved_marketplace_listings === 0;
    saveMarketplaceListingButton.disabled = isMarketplaceListingSaving || !complete || savedLimitReached;
    saveMarketplaceListingButton.title = savedLimitReached ? "Free accounts can save 1 Marketplace listing. Upgrade to add unlimited listings." : complete ? editingMarketplaceListingId ? "Update this listing" : "Save this listing" : "Complete all listing fields and add at least one photo";
  }
  function updatePreparedPostSaveButtonState() {
    if (!savePreparedPostButton) {
      return;
    }
    const savedLimitReached = !editingPreparedPostId && currentExtensionAccess?.access.remaining.saved_group_posts === 0;
    const hasRequiredContent = (postBodyInput?.value.trim().length ?? 0) > 0 && selectedImageFiles.length > 0;
    savePreparedPostButton.disabled = savedLimitReached || !hasRequiredContent;
    savePreparedPostButton.title = savedLimitReached ? "Free accounts can save 1 reusable Group post. Upgrade to add unlimited posts." : !hasRequiredContent ? "Add a post body and at least one image" : editingPreparedPostId ? "Update this reusable post" : "Add this reusable post";
  }
  function syncMarketplaceImagesInput() {
    if (!marketplaceImagesInput) {
      return;
    }
    const dataTransfer = new DataTransfer();
    selectedMarketplaceImageFiles.forEach((file) => {
      dataTransfer.items.add(file);
    });
    marketplaceImagesInput.files = dataTransfer.files;
  }
  function getImageContentSignature(file) {
    const cachedSignature = imageContentSignatureCache.get(file);
    if (cachedSignature) {
      return cachedSignature;
    }
    const signature = file.arrayBuffer().then((contents) => crypto.subtle.digest("SHA-256", contents)).then(
      (digest) => Array.from(
        new Uint8Array(digest),
        (byte) => byte.toString(16).padStart(2, "0")
      ).join("")
    ).catch(() => `${file.name}:${file.size}:${file.lastModified}`);
    imageContentSignatureCache.set(file, signature);
    return signature;
  }
  async function removeDuplicateImages(candidates, existingImages) {
    const existingSignatures = new Set(
      await Promise.all(existingImages.map(getImageContentSignature))
    );
    const uniqueImages = [];
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
  function queueMarketplacePhotos(files) {
    marketplacePhotoAdditionQueue = marketplacePhotoAdditionQueue.then(() => addMarketplacePhotos(files)).catch((error) => {
      showMarketplacePhotoStatus(
        error instanceof Error ? error.message : "Unable to add photos.",
        true
      );
    });
  }
  async function addMarketplacePhotos(files) {
    if (!selectedMarketplaceListingType) {
      showMarketplacePhotoStatus(
        "Select a listing type before adding photos.",
        true
      );
      return;
    }
    const limit = MARKETPLACE_PHOTO_LIMITS[selectedMarketplaceListingType];
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const { uniqueImages, duplicateCount } = await removeDuplicateImages(
      imageFiles,
      selectedMarketplaceImageFiles
    );
    const remainingSlots = Math.max(
      limit - selectedMarketplaceImageFiles.length,
      0
    );
    const acceptedImages = uniqueImages.slice(0, remainingSlots);
    selectedMarketplaceImageFiles.push(...acceptedImages);
    syncMarketplaceImagesInput();
    renderMarketplacePhotoPreviews();
    const rejectedForType = files.length - imageFiles.length;
    const rejectedForLimit = uniqueImages.length - acceptedImages.length;
    if (rejectedForLimit > 0) {
      showMarketplacePhotoStatus(
        `Only ${limit} photos are allowed for this listing type. ${rejectedForLimit} ${rejectedForLimit === 1 ? "photo was" : "photos were"} not added.`,
        true
      );
    } else if (rejectedForType > 0) {
      showMarketplacePhotoStatus("Only image files can be added.", true);
    } else if (duplicateCount > 0) {
      showMarketplacePhotoStatus(
        `${duplicateCount} duplicate ${duplicateCount === 1 ? "photo was" : "photos were"} skipped.`
      );
    } else {
      hideMarketplacePhotoStatus();
    }
  }
  function clearMarketplacePhotoPreviewUrls() {
    marketplacePhotoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    marketplacePhotoPreviewUrls.length = 0;
  }
  function renderMarketplacePhotoPreviews() {
    if (!marketplacePhotoPreviews) {
      return;
    }
    clearMarketplacePhotoPreviewUrls();
    if (marketplacePhotoCount) {
      marketplacePhotoCount.textContent = String(
        selectedMarketplaceImageFiles.length
      );
    }
    if (selectedMarketplaceImageFiles.length === 0) {
      marketplacePhotoPreviews.hidden = true;
      marketplacePhotoPreviews.replaceChildren();
      updateMarketplaceSaveListingButtonState();
      return;
    }
    const previews = selectedMarketplaceImageFiles.map((file, index) => {
      const previewUrl = URL.createObjectURL(file);
      marketplacePhotoPreviewUrls.push(previewUrl);
      const preview = document.createElement("figure");
      preview.className = "marketplace-photo-preview";
      preview.draggable = true;
      preview.tabIndex = 0;
      preview.dataset.photoIndex = String(index);
      preview.setAttribute(
        "aria-label",
        `Photo ${index + 1} of ${selectedMarketplaceImageFiles.length}. Click to preview or drag to reorder.`
      );
      const image = document.createElement("img");
      image.src = previewUrl;
      image.alt = file.name;
      image.draggable = false;
      image.addEventListener("click", () => {
        openMarketplacePhotoLightbox(index, preview);
      });
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "marketplace-photo-preview__remove";
      removeButton.setAttribute("aria-label", `Remove ${file.name}`);
      const removeIcon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
      );
      removeIcon.setAttribute("width", "32");
      removeIcon.setAttribute("height", "32");
      removeIcon.setAttribute("fill", "currentColor");
      removeIcon.setAttribute("viewBox", "0 0 256 256");
      removeIcon.setAttribute("aria-hidden", "true");
      const removeIconPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      removeIconPath.setAttribute(
        "d",
        "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"
      );
      removeIcon.append(removeIconPath);
      removeButton.append(removeIcon);
      removeButton.addEventListener("click", () => {
        selectedMarketplaceImageFiles.splice(index, 1);
        syncMarketplaceImagesInput();
        renderMarketplacePhotoPreviews();
        hideMarketplacePhotoStatus();
      });
      preview.addEventListener("dragstart", (event) => {
        if (event.target instanceof Element && event.target.closest("button")) {
          event.preventDefault();
          return;
        }
        draggedMarketplacePhotoIndex = index;
        preview.classList.add("marketplace-photo-preview--dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(index));
        }
      });
      preview.addEventListener("dragover", (event) => {
        if (draggedMarketplacePhotoIndex === void 0 || draggedMarketplacePhotoIndex === index) {
          return;
        }
        event.preventDefault();
        preview.classList.add("marketplace-photo-preview--drop-target");
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
      });
      preview.addEventListener("dragleave", () => {
        preview.classList.remove("marketplace-photo-preview--drop-target");
      });
      preview.addEventListener("drop", (event) => {
        event.preventDefault();
        preview.classList.remove("marketplace-photo-preview--drop-target");
        if (draggedMarketplacePhotoIndex === void 0) {
          return;
        }
        moveMarketplacePhoto(draggedMarketplacePhotoIndex, index);
      });
      preview.addEventListener("dragend", () => {
        draggedMarketplacePhotoIndex = void 0;
        marketplacePhotoPreviews.querySelectorAll(".marketplace-photo-preview").forEach((candidate) => {
          candidate.classList.remove(
            "marketplace-photo-preview--dragging",
            "marketplace-photo-preview--drop-target"
          );
        });
      });
      preview.addEventListener("keydown", (event) => {
        if (event.target === preview && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          openMarketplacePhotoLightbox(index, preview);
        }
      });
      preview.append(image, removeButton);
      return preview;
    });
    marketplacePhotoPreviews.hidden = false;
    marketplacePhotoPreviews.replaceChildren(...previews);
    updateMarketplaceSaveListingButtonState();
  }
  function moveMarketplacePhoto(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= selectedMarketplaceImageFiles.length || toIndex >= selectedMarketplaceImageFiles.length) {
      return;
    }
    const [movedPhoto] = selectedMarketplaceImageFiles.splice(fromIndex, 1);
    if (!movedPhoto) {
      return;
    }
    selectedMarketplaceImageFiles.splice(toIndex, 0, movedPhoto);
    draggedMarketplacePhotoIndex = void 0;
    syncMarketplaceImagesInput();
    renderMarketplacePhotoPreviews();
    showMarketplacePhotoStatus("Photo order updated.");
  }
  function openMarketplacePhotoLightbox(index, returnFocus) {
    openPhotoLightbox("marketplace", index, returnFocus);
  }
  function openGroupsPhotoLightbox(index, returnFocus) {
    openPhotoLightbox("groups", index, returnFocus);
  }
  function getPhotoLightboxFiles() {
    return photoLightboxSource === "groups" ? selectedImageFiles : selectedMarketplaceImageFiles;
  }
  function openPhotoLightbox(source, index, returnFocus) {
    const files = source === "groups" ? selectedImageFiles : selectedMarketplaceImageFiles;
    if (!marketplacePhotoLightbox || index < 0 || index >= files.length) {
      return;
    }
    closeMarketplacePhotoLightbox(false);
    photoLightboxSource = source;
    marketplacePhotoLightboxReturnFocus = returnFocus;
    marketplacePhotoLightboxIndex = index;
    files.forEach((file) => {
      marketplacePhotoLightboxUrls.push(URL.createObjectURL(file));
    });
    if (marketplacePhotoLightboxTitle) {
      marketplacePhotoLightboxTitle.textContent = source === "groups" ? "Post image preview" : "Photo preview";
    }
    marketplacePhotoLightbox.hidden = false;
    document.body.classList.add("marketplace-lightbox-open");
    renderMarketplacePhotoLightboxThumbnails();
    renderMarketplacePhotoLightbox();
    marketplacePhotoLightboxClose?.focus();
  }
  function renderMarketplacePhotoLightbox() {
    const files = getPhotoLightboxFiles();
    const file = files[marketplacePhotoLightboxIndex];
    const previewUrl = marketplacePhotoLightboxUrls[marketplacePhotoLightboxIndex];
    if (!file || !previewUrl) {
      closeMarketplacePhotoLightbox();
      return;
    }
    if (marketplacePhotoLightboxImage) {
      marketplacePhotoLightboxImage.src = previewUrl;
      marketplacePhotoLightboxImage.alt = file.name;
    }
    if (marketplacePhotoLightboxCounter) {
      marketplacePhotoLightboxCounter.textContent = `${marketplacePhotoLightboxIndex + 1} / ${files.length}`;
    }
    if (marketplacePhotoLightboxFilename) {
      marketplacePhotoLightboxFilename.textContent = file.name;
    }
    if (marketplacePhotoLightboxPrevious) {
      marketplacePhotoLightboxPrevious.disabled = marketplacePhotoLightboxIndex === 0;
    }
    if (marketplacePhotoLightboxNext) {
      marketplacePhotoLightboxNext.disabled = marketplacePhotoLightboxIndex === files.length - 1;
    }
    marketplacePhotoLightboxThumbnails?.querySelectorAll(
      ".marketplace-photo-lightbox__thumbnail"
    ).forEach((thumbnail, index) => {
      const active = index === marketplacePhotoLightboxIndex;
      thumbnail.classList.toggle(
        "marketplace-photo-lightbox__thumbnail--active",
        active
      );
      thumbnail.setAttribute("aria-current", active ? "true" : "false");
      if (active) {
        thumbnail.scrollIntoView({ block: "nearest", inline: "center" });
      }
    });
  }
  function renderMarketplacePhotoLightboxThumbnails() {
    if (!marketplacePhotoLightboxThumbnails) {
      return;
    }
    const thumbnails = getPhotoLightboxFiles().map((file, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "marketplace-photo-lightbox__thumbnail";
      button.setAttribute("aria-label", `View photo ${index + 1}: ${file.name}`);
      const image = document.createElement("img");
      image.src = marketplacePhotoLightboxUrls[index] ?? "";
      image.alt = "";
      image.draggable = false;
      button.append(image);
      button.addEventListener("click", () => {
        marketplacePhotoLightboxIndex = index;
        renderMarketplacePhotoLightbox();
      });
      return button;
    });
    marketplacePhotoLightboxThumbnails.replaceChildren(...thumbnails);
  }
  function moveMarketplacePhotoLightbox(direction) {
    const nextIndex = marketplacePhotoLightboxIndex + direction;
    if (nextIndex < 0 || nextIndex >= getPhotoLightboxFiles().length) {
      return;
    }
    marketplacePhotoLightboxIndex = nextIndex;
    renderMarketplacePhotoLightbox();
  }
  function closeMarketplacePhotoLightbox(returnFocus = true) {
    if (!marketplacePhotoLightbox) {
      return;
    }
    marketplacePhotoLightbox.hidden = true;
    document.body.classList.remove("marketplace-lightbox-open");
    if (marketplacePhotoLightboxImage) {
      marketplacePhotoLightboxImage.src = "";
      marketplacePhotoLightboxImage.alt = "";
    }
    marketplacePhotoLightboxThumbnails?.replaceChildren();
    marketplacePhotoLightboxUrls.forEach((url) => URL.revokeObjectURL(url));
    marketplacePhotoLightboxUrls.length = 0;
    if (returnFocus) {
      marketplacePhotoLightboxReturnFocus?.focus();
    }
    marketplacePhotoLightboxReturnFocus = void 0;
  }
  function showMarketplacePhotoStatus(message, isError = false) {
    if (!marketplacePhotoStatus) {
      return;
    }
    marketplacePhotoStatus.hidden = false;
    marketplacePhotoStatus.textContent = message;
    marketplacePhotoStatus.classList.toggle(
      "marketplace-photo-status--error",
      isError
    );
  }
  function hideMarketplacePhotoStatus() {
    if (!marketplacePhotoStatus) {
      return;
    }
    marketplacePhotoStatus.hidden = true;
    marketplacePhotoStatus.textContent = "";
    marketplacePhotoStatus.classList.remove("marketplace-photo-status--error");
  }
  function focusListingTypeOption(index, direction = 1) {
    const optionCount = listingTypeOptionElements.length;
    if (optionCount === 0) {
      return;
    }
    let candidateIndex = (index + optionCount) % optionCount;
    for (let attempts = 0; attempts < optionCount; attempts += 1) {
      const candidate = listingTypeOptionElements[candidateIndex];
      if (candidate?.getAttribute("aria-disabled") !== "true") {
        candidate.focus();
        return;
      }
      candidateIndex = (candidateIndex + direction + optionCount) % optionCount;
    }
  }
  listingTypeTrigger?.addEventListener("click", () => {
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    if (listingTypeOptions?.hidden) {
      const selectedIndex = listingTypeOptionElements.findIndex(
        (option) => option.getAttribute("aria-selected") === "true"
      );
      openListingTypeDropdown(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      closeListingTypeDropdown();
    }
  });
  listingTypeTrigger?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = listingTypeOptionElements.length - 1;
    const backwards = event.key === "ArrowUp" || event.key === "End";
    openListingTypeDropdown(backwards ? lastIndex : 0, backwards ? -1 : 1);
  });
  listingTypeOptionElements.forEach((option, index) => {
    option.addEventListener("click", () => {
      if (option.getAttribute("aria-disabled") !== "true") {
        selectListingType(option);
      }
    });
    option.addEventListener("keydown", (event) => {
      if (option.getAttribute("aria-disabled") === "true") {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusListingTypeOption(index + 1, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusListingTypeOption(index - 1, -1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusListingTypeOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusListingTypeOption(listingTypeOptionElements.length - 1, -1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectListingType(option);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeListingTypeDropdown(true);
      } else if (event.key === "Tab") {
        closeListingTypeDropdown();
      }
    });
  });
  function createMarketplaceCategoryIcon(pathData) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "32");
    svg.setAttribute("height", "32");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("viewBox", "0 0 256 256");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
    return svg;
  }
  function initializeMarketplaceCategorySelect() {
    if (!marketplaceCategoryOptions) {
      return;
    }
    const groups = MARKETPLACE_CATEGORY_GROUPS.map((group) => {
      const groupElement = document.createElement("section");
      groupElement.className = "category-select__group";
      groupElement.setAttribute("role", "group");
      groupElement.setAttribute("aria-label", group.name);
      if (group.options.length === 0) {
        groupElement.append(createMarketplaceCategoryOption(group, void 0));
        return groupElement;
      }
      const heading = document.createElement("div");
      heading.className = "category-select__group-heading";
      const icon = document.createElement("span");
      icon.className = "category-select__group-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.append(createMarketplaceCategoryIcon(group.iconPath));
      const name = document.createElement("strong");
      name.textContent = group.name;
      heading.append(icon, name);
      const options = group.options.map(
        (option) => createMarketplaceCategoryOption(group, option)
      );
      groupElement.append(heading, ...options);
      return groupElement;
    });
    marketplaceCategoryOptions.replaceChildren(...groups);
    marketplaceCategoryOptionElements = Array.from(
      marketplaceCategoryOptions.querySelectorAll(
        ".category-select__option"
      )
    );
    marketplaceCategoryOptionElements.forEach((option, index) => {
      option.addEventListener("click", () => selectMarketplaceCategory(option));
      option.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          focusMarketplaceCategoryOption(index + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          focusMarketplaceCategoryOption(index - 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          focusMarketplaceCategoryOption(0);
        } else if (event.key === "End") {
          event.preventDefault();
          focusMarketplaceCategoryOption(
            marketplaceCategoryOptionElements.length - 1
          );
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectMarketplaceCategory(option);
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeMarketplaceCategoryDropdown(true);
        } else if (event.key === "Tab") {
          closeMarketplaceCategoryDropdown();
        }
      });
    });
  }
  function createMarketplaceCategoryOption(group, option) {
    const optionElement = document.createElement("div");
    optionElement.className = "category-select__option";
    optionElement.setAttribute("role", "option");
    optionElement.setAttribute("aria-selected", "false");
    optionElement.tabIndex = -1;
    optionElement.dataset.category = group.name;
    optionElement.dataset.value = option?.label ?? group.name;
    if (!option) {
      optionElement.classList.add("category-select__option--standalone");
      const icon = document.createElement("span");
      icon.className = "category-select__group-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.append(createMarketplaceCategoryIcon(group.iconPath));
      optionElement.append(icon);
    }
    const copy = document.createElement("span");
    copy.className = "category-select__option-copy";
    const label = document.createElement("strong");
    label.textContent = option?.label ?? group.name;
    copy.append(label);
    if (option?.shipping) {
      const shipping = document.createElement("small");
      shipping.textContent = "Shipping available";
      copy.append(shipping);
    }
    const check = document.createElement("span");
    check.className = "category-select__check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "\u2713";
    optionElement.append(copy, check);
    return optionElement;
  }
  function openMarketplaceCategoryDropdown(focusIndex) {
    if (!marketplaceCategorySelect || !marketplaceCategoryTrigger || !marketplaceCategoryOptions) {
      return;
    }
    closeListingTypeDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns();
    marketplaceCategoryOptions.hidden = false;
    marketplaceCategorySelect.classList.add("category-select--open");
    marketplaceCategoryTrigger.setAttribute("aria-expanded", "true");
    positionMarketplaceCategoryDropdown();
    if (focusIndex !== void 0) {
      marketplaceCategoryOptionElements[focusIndex]?.focus();
    }
  }
  function closeMarketplaceCategoryDropdown(returnFocus = false) {
    if (!marketplaceCategorySelect || !marketplaceCategoryTrigger || !marketplaceCategoryOptions) {
      return;
    }
    marketplaceCategoryOptions.hidden = true;
    marketplaceCategoryOptions.style.maxHeight = "";
    marketplaceCategorySelect.classList.remove(
      "category-select--open",
      "category-select--open-upward"
    );
    marketplaceCategoryTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      marketplaceCategoryTrigger.focus();
    }
  }
  function positionMarketplaceCategoryDropdown() {
    if (!marketplaceCategorySelect || !marketplaceCategoryTrigger || !marketplaceCategoryOptions || marketplaceCategoryOptions.hidden) {
      return;
    }
    marketplaceCategorySelect.classList.remove("category-select--open-upward");
    marketplaceCategoryOptions.style.maxHeight = "";
    const viewportPadding = remToPixels(1.2);
    const triggerRect = marketplaceCategoryTrigger.getBoundingClientRect();
    const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
    const spaceBelow = Math.max(
      window.innerHeight - triggerRect.bottom - viewportPadding,
      0
    );
    const preferredHeight = Math.min(
      marketplaceCategoryOptions.scrollHeight,
      window.innerHeight * 0.65,
      remToPixels(42)
    );
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    marketplaceCategorySelect.classList.toggle(
      "category-select--open-upward",
      openUpward
    );
    marketplaceCategoryOptions.style.maxHeight = pixelsToRem(Math.max(
      Math.min(preferredHeight, availableSpace - remToPixels(0.7)),
      remToPixels(12)
    ));
  }
  function selectMarketplaceCategory(option) {
    const value = option.dataset.value;
    const category = option.dataset.category;
    if (!value || !category) {
      return;
    }
    marketplaceCategoryOptionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (marketplaceCategoryValue) {
      marketplaceCategoryValue.textContent = value;
    }
    if (marketplaceCategoryInput) {
      marketplaceCategoryInput.value = value;
    }
    if (marketplaceCategoryGroupInput) {
      marketplaceCategoryGroupInput.value = category;
    }
    const selectedIcon = option.closest(".category-select__group")?.querySelector(".category-select__group-icon svg")?.cloneNode(true);
    if (marketplaceCategorySelectedIcon && selectedIcon) {
      marketplaceCategorySelectedIcon.replaceChildren(selectedIcon);
    }
    closeMarketplaceCategoryDropdown(true);
  }
  function focusMarketplaceCategoryOption(index) {
    const optionCount = marketplaceCategoryOptionElements.length;
    if (optionCount === 0) {
      return;
    }
    const wrappedIndex = (index + optionCount) % optionCount;
    marketplaceCategoryOptionElements[wrappedIndex]?.focus();
  }
  marketplaceCategoryTrigger?.addEventListener("click", () => {
    if (marketplaceCategoryOptions?.hidden) {
      const selectedIndex = marketplaceCategoryOptionElements.findIndex(
        (option) => option.getAttribute("aria-selected") === "true"
      );
      openMarketplaceCategoryDropdown(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      closeMarketplaceCategoryDropdown();
    }
  });
  marketplaceCategoryTrigger?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = marketplaceCategoryOptionElements.length - 1;
    openMarketplaceCategoryDropdown(
      event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
    );
  });
  function openMarketplaceConditionDropdown(focusIndex) {
    if (!marketplaceConditionSelect || !marketplaceConditionTrigger || !marketplaceConditionOptions) {
      return;
    }
    closeListingTypeDropdown();
    closeMarketplaceCategoryDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns();
    marketplaceConditionOptions.hidden = false;
    marketplaceConditionSelect.classList.add("condition-select--open");
    marketplaceConditionTrigger.setAttribute("aria-expanded", "true");
    positionMarketplaceConditionDropdown();
    if (focusIndex !== void 0) {
      marketplaceConditionOptionElements[focusIndex]?.focus();
    }
  }
  function closeMarketplaceConditionDropdown(returnFocus = false) {
    if (!marketplaceConditionSelect || !marketplaceConditionTrigger || !marketplaceConditionOptions) {
      return;
    }
    marketplaceConditionOptions.hidden = true;
    marketplaceConditionOptions.style.maxHeight = "";
    marketplaceConditionSelect.classList.remove(
      "condition-select--open",
      "condition-select--open-upward"
    );
    marketplaceConditionTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      marketplaceConditionTrigger.focus();
    }
  }
  function selectMarketplaceCondition(option) {
    const value = option.dataset.value;
    const label = option.querySelector("span")?.textContent?.trim();
    if (!value || !label) {
      return;
    }
    marketplaceConditionOptionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (marketplaceConditionValue) {
      marketplaceConditionValue.textContent = label;
    }
    if (marketplaceConditionInput) {
      marketplaceConditionInput.value = value;
    }
    closeMarketplaceConditionDropdown(true);
  }
  function focusMarketplaceConditionOption(index) {
    const optionCount = marketplaceConditionOptionElements.length;
    if (optionCount === 0) {
      return;
    }
    const wrappedIndex = (index + optionCount) % optionCount;
    marketplaceConditionOptionElements[wrappedIndex]?.focus();
  }
  function positionMarketplaceConditionDropdown() {
    if (!marketplaceConditionSelect || !marketplaceConditionTrigger || !marketplaceConditionOptions || marketplaceConditionOptions.hidden) {
      return;
    }
    marketplaceConditionSelect.classList.remove("condition-select--open-upward");
    marketplaceConditionOptions.style.maxHeight = "";
    const viewportPadding = remToPixels(1.2);
    const triggerRect = marketplaceConditionTrigger.getBoundingClientRect();
    const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
    const spaceBelow = Math.max(
      window.innerHeight - triggerRect.bottom - viewportPadding,
      0
    );
    const preferredHeight = Math.min(
      marketplaceConditionOptions.scrollHeight,
      window.innerHeight * 0.55,
      remToPixels(28)
    );
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    marketplaceConditionSelect.classList.toggle(
      "condition-select--open-upward",
      openUpward
    );
    marketplaceConditionOptions.style.maxHeight = pixelsToRem(Math.max(
      Math.min(preferredHeight, availableSpace - remToPixels(0.7)),
      remToPixels(12)
    ));
  }
  marketplaceConditionTrigger?.addEventListener("click", () => {
    if (marketplaceConditionOptions?.hidden) {
      const selectedIndex = marketplaceConditionOptionElements.findIndex(
        (option) => option.getAttribute("aria-selected") === "true"
      );
      openMarketplaceConditionDropdown(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      closeMarketplaceConditionDropdown();
    }
  });
  marketplaceConditionTrigger?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = marketplaceConditionOptionElements.length - 1;
    openMarketplaceConditionDropdown(
      event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
    );
  });
  marketplaceConditionOptionElements.forEach((option, index) => {
    option.addEventListener("click", () => selectMarketplaceCondition(option));
    option.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMarketplaceConditionOption(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMarketplaceConditionOption(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusMarketplaceConditionOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusMarketplaceConditionOption(
          marketplaceConditionOptionElements.length - 1
        );
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMarketplaceCondition(option);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMarketplaceConditionDropdown(true);
      } else if (event.key === "Tab") {
        closeMarketplaceConditionDropdown();
      }
    });
  });
  function initializeMarketplaceYearSelect() {
    if (!marketplaceYearOptions) {
      return;
    }
    const options = [];
    for (let year = 2027; year >= 1901; year -= 1) {
      const option = document.createElement("div");
      option.className = "condition-select__option year-select__option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.tabIndex = -1;
      option.dataset.value = String(year);
      const label = document.createElement("span");
      label.textContent = String(year);
      const check = document.createElement("span");
      check.className = "condition-select__check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "\u2713";
      option.append(label, check);
      options.push(option);
    }
    marketplaceYearOptions.replaceChildren(...options);
    marketplaceYearOptionElements = options;
    marketplaceYearOptionElements.forEach((option, index) => {
      option.addEventListener("click", () => selectMarketplaceYear(option));
      option.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          focusMarketplaceYearOption(index + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          focusMarketplaceYearOption(index - 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          focusMarketplaceYearOption(0);
        } else if (event.key === "End") {
          event.preventDefault();
          focusMarketplaceYearOption(marketplaceYearOptionElements.length - 1);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectMarketplaceYear(option);
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeMarketplaceYearDropdown(true);
        } else if (event.key === "Tab") {
          closeMarketplaceYearDropdown();
        }
      });
    });
  }
  function openMarketplaceYearDropdown(focusIndex) {
    if (!marketplaceYearSelect || !marketplaceYearTrigger || !marketplaceYearOptions) {
      return;
    }
    closeListingTypeDropdown();
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns();
    marketplaceYearOptions.hidden = false;
    marketplaceYearSelect.classList.add("condition-select--open");
    marketplaceYearTrigger.setAttribute("aria-expanded", "true");
    positionMarketplaceYearDropdown();
    if (focusIndex !== void 0) {
      marketplaceYearOptionElements[focusIndex]?.focus();
    }
  }
  function closeMarketplaceYearDropdown(returnFocus = false) {
    if (!marketplaceYearSelect || !marketplaceYearTrigger || !marketplaceYearOptions) {
      return;
    }
    marketplaceYearOptions.hidden = true;
    marketplaceYearOptions.style.maxHeight = "";
    marketplaceYearSelect.classList.remove(
      "condition-select--open",
      "condition-select--open-upward"
    );
    marketplaceYearTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      marketplaceYearTrigger.focus();
    }
  }
  function selectMarketplaceYear(option) {
    const value = option.dataset.value;
    if (!value) {
      return;
    }
    marketplaceYearOptionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (marketplaceYearValue) {
      marketplaceYearValue.textContent = value;
    }
    if (marketplaceYearInput) {
      marketplaceYearInput.value = value;
    }
    closeMarketplaceYearDropdown(true);
  }
  function focusMarketplaceYearOption(index) {
    const optionCount = marketplaceYearOptionElements.length;
    if (optionCount === 0) {
      return;
    }
    const wrappedIndex = (index + optionCount) % optionCount;
    marketplaceYearOptionElements[wrappedIndex]?.focus();
  }
  function positionMarketplaceYearDropdown() {
    if (!marketplaceYearSelect || !marketplaceYearTrigger || !marketplaceYearOptions || marketplaceYearOptions.hidden) {
      return;
    }
    marketplaceYearSelect.classList.remove("condition-select--open-upward");
    marketplaceYearOptions.style.maxHeight = "";
    const viewportPadding = remToPixels(1.2);
    const triggerRect = marketplaceYearTrigger.getBoundingClientRect();
    const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
    const spaceBelow = Math.max(
      window.innerHeight - triggerRect.bottom - viewportPadding,
      0
    );
    const preferredHeight = Math.min(
      marketplaceYearOptions.scrollHeight,
      window.innerHeight * 0.65,
      remToPixels(42)
    );
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    marketplaceYearSelect.classList.toggle(
      "condition-select--open-upward",
      openUpward
    );
    marketplaceYearOptions.style.maxHeight = pixelsToRem(Math.max(
      Math.min(preferredHeight, availableSpace - remToPixels(0.7)),
      remToPixels(12)
    ));
  }
  marketplaceYearTrigger?.addEventListener("click", () => {
    if (marketplaceYearOptions?.hidden) {
      const selectedIndex = marketplaceYearOptionElements.findIndex(
        (option) => option.getAttribute("aria-selected") === "true"
      );
      openMarketplaceYearDropdown(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      closeMarketplaceYearDropdown();
    }
  });
  marketplaceYearTrigger?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = marketplaceYearOptionElements.length - 1;
    openMarketplaceYearDropdown(
      event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
    );
  });
  function openMarketplaceVehicleTypeDropdown(focusIndex) {
    if (!marketplaceVehicleTypeSelect || !marketplaceVehicleTypeTrigger || !marketplaceVehicleTypeOptions) {
      return;
    }
    closeListingTypeDropdown();
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns();
    marketplaceVehicleTypeOptions.hidden = false;
    marketplaceVehicleTypeSelect.classList.add("condition-select--open");
    marketplaceVehicleTypeTrigger.setAttribute("aria-expanded", "true");
    positionMarketplaceVehicleTypeDropdown();
    if (focusIndex !== void 0) {
      focusMarketplaceVehicleTypeOption(focusIndex);
    }
  }
  function closeMarketplaceVehicleTypeDropdown(returnFocus = false) {
    if (!marketplaceVehicleTypeSelect || !marketplaceVehicleTypeTrigger || !marketplaceVehicleTypeOptions) {
      return;
    }
    marketplaceVehicleTypeOptions.hidden = true;
    marketplaceVehicleTypeOptions.style.maxHeight = "";
    marketplaceVehicleTypeSelect.classList.remove(
      "condition-select--open",
      "condition-select--open-upward"
    );
    marketplaceVehicleTypeTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      marketplaceVehicleTypeTrigger.focus();
    }
  }
  function selectMarketplaceVehicleType(option) {
    if (option.getAttribute("aria-disabled") === "true") {
      return;
    }
    const value = option.dataset.value;
    const label = option.querySelector("span")?.textContent?.trim();
    if (!value || !label) {
      return;
    }
    marketplaceVehicleTypeOptionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (marketplaceVehicleTypeValue) {
      marketplaceVehicleTypeValue.textContent = label;
    }
    if (marketplaceVehicleTypeInput) {
      marketplaceVehicleTypeInput.value = value;
    }
    closeMarketplaceVehicleTypeDropdown(true);
  }
  function focusMarketplaceVehicleTypeOption(index) {
    const optionCount = marketplaceVehicleTypeOptionElements.length;
    if (optionCount === 0) {
      return;
    }
    const direction = index < 0 ? -1 : 1;
    let candidateIndex = (index + optionCount) % optionCount;
    for (let attempts = 0; attempts < optionCount; attempts += 1) {
      const candidate = marketplaceVehicleTypeOptionElements[candidateIndex];
      if (candidate?.getAttribute("aria-disabled") !== "true") {
        candidate.focus();
        return;
      }
      candidateIndex = (candidateIndex + direction + optionCount) % optionCount;
    }
  }
  function positionMarketplaceVehicleTypeDropdown() {
    if (!marketplaceVehicleTypeSelect || !marketplaceVehicleTypeTrigger || !marketplaceVehicleTypeOptions || marketplaceVehicleTypeOptions.hidden) {
      return;
    }
    marketplaceVehicleTypeSelect.classList.remove(
      "condition-select--open-upward"
    );
    marketplaceVehicleTypeOptions.style.maxHeight = "";
    const viewportPadding = remToPixels(1.2);
    const triggerRect = marketplaceVehicleTypeTrigger.getBoundingClientRect();
    const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
    const spaceBelow = Math.max(
      window.innerHeight - triggerRect.bottom - viewportPadding,
      0
    );
    const preferredHeight = Math.min(
      marketplaceVehicleTypeOptions.scrollHeight,
      window.innerHeight * 0.65,
      remToPixels(36)
    );
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    marketplaceVehicleTypeSelect.classList.toggle(
      "condition-select--open-upward",
      openUpward
    );
    marketplaceVehicleTypeOptions.style.maxHeight = pixelsToRem(Math.max(
      Math.min(preferredHeight, availableSpace - remToPixels(0.7)),
      remToPixels(12)
    ));
  }
  marketplaceVehicleTypeTrigger?.addEventListener("click", () => {
    if (marketplaceVehicleTypeOptions?.hidden) {
      const selectedIndex = marketplaceVehicleTypeOptionElements.findIndex(
        (option) => option.getAttribute("aria-selected") === "true"
      );
      openMarketplaceVehicleTypeDropdown(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      closeMarketplaceVehicleTypeDropdown();
    }
  });
  marketplaceVehicleTypeTrigger?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = marketplaceVehicleTypeOptionElements.length - 1;
    openMarketplaceVehicleTypeDropdown(
      event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
    );
  });
  marketplaceVehicleTypeOptionElements.forEach((option, index) => {
    option.addEventListener("click", () => {
      if (option.getAttribute("aria-disabled") !== "true") {
        selectMarketplaceVehicleType(option);
      }
    });
    option.addEventListener("keydown", (event) => {
      if (option.getAttribute("aria-disabled") === "true") {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMarketplaceVehicleTypeOption(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMarketplaceVehicleTypeOption(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusMarketplaceVehicleTypeOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusMarketplaceVehicleTypeOption(
          marketplaceVehicleTypeOptionElements.length - 1
        );
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMarketplaceVehicleType(option);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMarketplaceVehicleTypeDropdown(true);
      } else if (event.key === "Tab") {
        closeMarketplaceVehicleTypeDropdown();
      }
    });
  });
  function openMarketplaceBodyStyleDropdown(focusIndex) {
    if (!marketplaceBodyStyleSelect || !marketplaceBodyStyleTrigger || !marketplaceBodyStyleOptions) {
      return;
    }
    closeListingTypeDropdown();
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns();
    marketplaceBodyStyleOptions.hidden = false;
    marketplaceBodyStyleSelect.classList.add("condition-select--open");
    marketplaceBodyStyleTrigger.setAttribute("aria-expanded", "true");
    positionMarketplaceBodyStyleDropdown();
    if (focusIndex !== void 0) {
      marketplaceBodyStyleOptionElements[focusIndex]?.focus();
    }
  }
  function closeMarketplaceBodyStyleDropdown(returnFocus = false) {
    if (!marketplaceBodyStyleSelect || !marketplaceBodyStyleTrigger || !marketplaceBodyStyleOptions) {
      return;
    }
    marketplaceBodyStyleOptions.hidden = true;
    marketplaceBodyStyleOptions.style.maxHeight = "";
    marketplaceBodyStyleSelect.classList.remove(
      "condition-select--open",
      "condition-select--open-upward"
    );
    marketplaceBodyStyleTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      marketplaceBodyStyleTrigger.focus();
    }
  }
  function selectMarketplaceBodyStyle(option) {
    const value = option.dataset.value;
    const label = option.querySelector("span")?.textContent?.trim();
    if (!value || !label) {
      return;
    }
    marketplaceBodyStyleOptionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (marketplaceBodyStyleValue) {
      marketplaceBodyStyleValue.textContent = label;
    }
    if (marketplaceBodyStyleInput) {
      marketplaceBodyStyleInput.value = value;
    }
    closeMarketplaceBodyStyleDropdown(true);
  }
  function focusMarketplaceBodyStyleOption(index) {
    const optionCount = marketplaceBodyStyleOptionElements.length;
    if (optionCount === 0) {
      return;
    }
    const wrappedIndex = (index + optionCount) % optionCount;
    marketplaceBodyStyleOptionElements[wrappedIndex]?.focus();
  }
  function positionMarketplaceBodyStyleDropdown() {
    if (!marketplaceBodyStyleSelect || !marketplaceBodyStyleTrigger || !marketplaceBodyStyleOptions || marketplaceBodyStyleOptions.hidden) {
      return;
    }
    marketplaceBodyStyleSelect.classList.remove("condition-select--open-upward");
    marketplaceBodyStyleOptions.style.maxHeight = "";
    const viewportPadding = remToPixels(1.2);
    const triggerRect = marketplaceBodyStyleTrigger.getBoundingClientRect();
    const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
    const spaceBelow = Math.max(
      window.innerHeight - triggerRect.bottom - viewportPadding,
      0
    );
    const preferredHeight = Math.min(
      marketplaceBodyStyleOptions.scrollHeight,
      window.innerHeight * 0.65,
      remToPixels(42)
    );
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    marketplaceBodyStyleSelect.classList.toggle(
      "condition-select--open-upward",
      openUpward
    );
    marketplaceBodyStyleOptions.style.maxHeight = pixelsToRem(Math.max(
      Math.min(preferredHeight, availableSpace - remToPixels(0.7)),
      remToPixels(12)
    ));
  }
  marketplaceBodyStyleTrigger?.addEventListener("click", () => {
    if (marketplaceBodyStyleOptions?.hidden) {
      const selectedIndex = marketplaceBodyStyleOptionElements.findIndex(
        (option) => option.getAttribute("aria-selected") === "true"
      );
      openMarketplaceBodyStyleDropdown(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      closeMarketplaceBodyStyleDropdown();
    }
  });
  marketplaceBodyStyleTrigger?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = marketplaceBodyStyleOptionElements.length - 1;
    openMarketplaceBodyStyleDropdown(
      event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
    );
  });
  marketplaceBodyStyleOptionElements.forEach((option, index) => {
    option.addEventListener("click", () => selectMarketplaceBodyStyle(option));
    option.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMarketplaceBodyStyleOption(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMarketplaceBodyStyleOption(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusMarketplaceBodyStyleOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusMarketplaceBodyStyleOption(
          marketplaceBodyStyleOptionElements.length - 1
        );
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMarketplaceBodyStyle(option);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMarketplaceBodyStyleDropdown(true);
      } else if (event.key === "Tab") {
        closeMarketplaceBodyStyleDropdown();
      }
    });
  });
  function openMarketplaceVehicleConditionDropdown(focusIndex) {
    if (!marketplaceVehicleConditionSelect || !marketplaceVehicleConditionTrigger || !marketplaceVehicleConditionOptions) {
      return;
    }
    closeListingTypeDropdown();
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns();
    marketplaceVehicleConditionOptions.hidden = false;
    marketplaceVehicleConditionSelect.classList.add("condition-select--open");
    marketplaceVehicleConditionTrigger.setAttribute("aria-expanded", "true");
    positionMarketplaceVehicleConditionDropdown();
    if (focusIndex !== void 0) {
      marketplaceVehicleConditionOptionElements[focusIndex]?.focus();
    }
  }
  function closeMarketplaceVehicleConditionDropdown(returnFocus = false) {
    if (!marketplaceVehicleConditionSelect || !marketplaceVehicleConditionTrigger || !marketplaceVehicleConditionOptions) {
      return;
    }
    marketplaceVehicleConditionOptions.hidden = true;
    marketplaceVehicleConditionOptions.style.maxHeight = "";
    marketplaceVehicleConditionSelect.classList.remove(
      "condition-select--open",
      "condition-select--open-upward"
    );
    marketplaceVehicleConditionTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      marketplaceVehicleConditionTrigger.focus();
    }
  }
  function selectMarketplaceVehicleCondition(option) {
    const value = option.dataset.value;
    const label = option.querySelector("span")?.textContent?.trim();
    if (!value || !label) {
      return;
    }
    marketplaceVehicleConditionOptionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (marketplaceVehicleConditionValue) {
      marketplaceVehicleConditionValue.textContent = label;
    }
    if (marketplaceVehicleConditionInput) {
      marketplaceVehicleConditionInput.value = value;
    }
    closeMarketplaceVehicleConditionDropdown(true);
  }
  function focusMarketplaceVehicleConditionOption(index) {
    const optionCount = marketplaceVehicleConditionOptionElements.length;
    if (optionCount === 0) {
      return;
    }
    const wrappedIndex = (index + optionCount) % optionCount;
    marketplaceVehicleConditionOptionElements[wrappedIndex]?.focus();
  }
  function positionMarketplaceVehicleConditionDropdown() {
    if (!marketplaceVehicleConditionSelect || !marketplaceVehicleConditionTrigger || !marketplaceVehicleConditionOptions || marketplaceVehicleConditionOptions.hidden) {
      return;
    }
    marketplaceVehicleConditionSelect.classList.remove(
      "condition-select--open-upward"
    );
    marketplaceVehicleConditionOptions.style.maxHeight = "";
    const viewportPadding = remToPixels(1.2);
    const triggerRect = marketplaceVehicleConditionTrigger.getBoundingClientRect();
    const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
    const spaceBelow = Math.max(
      window.innerHeight - triggerRect.bottom - viewportPadding,
      0
    );
    const preferredHeight = Math.min(
      marketplaceVehicleConditionOptions.scrollHeight,
      window.innerHeight * 0.55,
      remToPixels(28)
    );
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    marketplaceVehicleConditionSelect.classList.toggle(
      "condition-select--open-upward",
      openUpward
    );
    marketplaceVehicleConditionOptions.style.maxHeight = pixelsToRem(Math.max(
      Math.min(preferredHeight, availableSpace - remToPixels(0.7)),
      remToPixels(12)
    ));
  }
  marketplaceVehicleConditionTrigger?.addEventListener("click", () => {
    if (marketplaceVehicleConditionOptions?.hidden) {
      const selectedIndex = marketplaceVehicleConditionOptionElements.findIndex(
        (option) => option.getAttribute("aria-selected") === "true"
      );
      openMarketplaceVehicleConditionDropdown(
        selectedIndex >= 0 ? selectedIndex : 0
      );
    } else {
      closeMarketplaceVehicleConditionDropdown();
    }
  });
  marketplaceVehicleConditionTrigger?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = marketplaceVehicleConditionOptionElements.length - 1;
    openMarketplaceVehicleConditionDropdown(
      event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
    );
  });
  marketplaceVehicleConditionOptionElements.forEach((option, index) => {
    option.addEventListener(
      "click",
      () => selectMarketplaceVehicleCondition(option)
    );
    option.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMarketplaceVehicleConditionOption(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMarketplaceVehicleConditionOption(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusMarketplaceVehicleConditionOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusMarketplaceVehicleConditionOption(
          marketplaceVehicleConditionOptionElements.length - 1
        );
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMarketplaceVehicleCondition(option);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMarketplaceVehicleConditionDropdown(true);
      } else if (event.key === "Tab") {
        closeMarketplaceVehicleConditionDropdown();
      }
    });
  });
  function openMarketplaceFuelTypeDropdown(focusIndex) {
    if (!marketplaceFuelTypeSelect || !marketplaceFuelTypeTrigger || !marketplaceFuelTypeOptions) {
      return;
    }
    closeListingTypeDropdown();
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns();
    marketplaceFuelTypeOptions.hidden = false;
    marketplaceFuelTypeSelect.classList.add("condition-select--open");
    marketplaceFuelTypeTrigger.setAttribute("aria-expanded", "true");
    positionMarketplaceFuelTypeDropdown();
    if (focusIndex !== void 0) {
      marketplaceFuelTypeOptionElements[focusIndex]?.focus();
    }
  }
  function closeMarketplaceFuelTypeDropdown(returnFocus = false) {
    if (!marketplaceFuelTypeSelect || !marketplaceFuelTypeTrigger || !marketplaceFuelTypeOptions) {
      return;
    }
    marketplaceFuelTypeOptions.hidden = true;
    marketplaceFuelTypeOptions.style.maxHeight = "";
    marketplaceFuelTypeSelect.classList.remove(
      "condition-select--open",
      "condition-select--open-upward"
    );
    marketplaceFuelTypeTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      marketplaceFuelTypeTrigger.focus();
    }
  }
  function selectMarketplaceFuelType(option) {
    const value = option.dataset.value;
    const label = option.querySelector("span")?.textContent?.trim();
    if (!value || !label) {
      return;
    }
    marketplaceFuelTypeOptionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (marketplaceFuelTypeValue) {
      marketplaceFuelTypeValue.textContent = label;
    }
    if (marketplaceFuelTypeInput) {
      marketplaceFuelTypeInput.value = value;
    }
    closeMarketplaceFuelTypeDropdown(true);
  }
  function focusMarketplaceFuelTypeOption(index) {
    const optionCount = marketplaceFuelTypeOptionElements.length;
    if (optionCount === 0) {
      return;
    }
    const wrappedIndex = (index + optionCount) % optionCount;
    marketplaceFuelTypeOptionElements[wrappedIndex]?.focus();
  }
  function positionMarketplaceFuelTypeDropdown() {
    if (!marketplaceFuelTypeSelect || !marketplaceFuelTypeTrigger || !marketplaceFuelTypeOptions || marketplaceFuelTypeOptions.hidden) {
      return;
    }
    marketplaceFuelTypeSelect.classList.remove("condition-select--open-upward");
    marketplaceFuelTypeOptions.style.maxHeight = "";
    const viewportPadding = remToPixels(1.2);
    const triggerRect = marketplaceFuelTypeTrigger.getBoundingClientRect();
    const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
    const spaceBelow = Math.max(
      window.innerHeight - triggerRect.bottom - viewportPadding,
      0
    );
    const preferredHeight = Math.min(
      marketplaceFuelTypeOptions.scrollHeight,
      window.innerHeight * 0.65,
      remToPixels(36)
    );
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    marketplaceFuelTypeSelect.classList.toggle(
      "condition-select--open-upward",
      openUpward
    );
    marketplaceFuelTypeOptions.style.maxHeight = pixelsToRem(Math.max(
      Math.min(preferredHeight, availableSpace - remToPixels(0.7)),
      remToPixels(12)
    ));
  }
  marketplaceFuelTypeTrigger?.addEventListener("click", () => {
    if (marketplaceFuelTypeOptions?.hidden) {
      const selectedIndex = marketplaceFuelTypeOptionElements.findIndex(
        (option) => option.getAttribute("aria-selected") === "true"
      );
      openMarketplaceFuelTypeDropdown(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      closeMarketplaceFuelTypeDropdown();
    }
  });
  marketplaceFuelTypeTrigger?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = marketplaceFuelTypeOptionElements.length - 1;
    openMarketplaceFuelTypeDropdown(
      event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
    );
  });
  marketplaceFuelTypeOptionElements.forEach((option, index) => {
    option.addEventListener("click", () => selectMarketplaceFuelType(option));
    option.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMarketplaceFuelTypeOption(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMarketplaceFuelTypeOption(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusMarketplaceFuelTypeOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusMarketplaceFuelTypeOption(
          marketplaceFuelTypeOptionElements.length - 1
        );
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMarketplaceFuelType(option);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMarketplaceFuelTypeDropdown(true);
      } else if (event.key === "Tab") {
        closeMarketplaceFuelTypeDropdown();
      }
    });
  });
  function openMarketplaceTransmissionDropdown(focusIndex) {
    if (!marketplaceTransmissionSelect || !marketplaceTransmissionTrigger || !marketplaceTransmissionOptions) {
      return;
    }
    closeListingTypeDropdown();
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceColorDropdowns();
    marketplaceTransmissionOptions.hidden = false;
    marketplaceTransmissionSelect.classList.add("condition-select--open");
    marketplaceTransmissionTrigger.setAttribute("aria-expanded", "true");
    positionMarketplaceTransmissionDropdown();
    if (focusIndex !== void 0) {
      marketplaceTransmissionOptionElements[focusIndex]?.focus();
    }
  }
  function closeMarketplaceTransmissionDropdown(returnFocus = false) {
    if (!marketplaceTransmissionSelect || !marketplaceTransmissionTrigger || !marketplaceTransmissionOptions) {
      return;
    }
    marketplaceTransmissionOptions.hidden = true;
    marketplaceTransmissionOptions.style.maxHeight = "";
    marketplaceTransmissionSelect.classList.remove(
      "condition-select--open",
      "condition-select--open-upward"
    );
    marketplaceTransmissionTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      marketplaceTransmissionTrigger.focus();
    }
  }
  function selectMarketplaceTransmission(option) {
    const value = option.dataset.value;
    const label = option.querySelector("span")?.textContent?.trim();
    if (!value || !label) {
      return;
    }
    marketplaceTransmissionOptionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (marketplaceTransmissionValue) {
      marketplaceTransmissionValue.textContent = label;
    }
    if (marketplaceTransmissionInput) {
      marketplaceTransmissionInput.value = value;
    }
    closeMarketplaceTransmissionDropdown(true);
  }
  function focusMarketplaceTransmissionOption(index) {
    const optionCount = marketplaceTransmissionOptionElements.length;
    if (optionCount === 0) {
      return;
    }
    const wrappedIndex = (index + optionCount) % optionCount;
    marketplaceTransmissionOptionElements[wrappedIndex]?.focus();
  }
  function positionMarketplaceTransmissionDropdown() {
    if (!marketplaceTransmissionSelect || !marketplaceTransmissionTrigger || !marketplaceTransmissionOptions || marketplaceTransmissionOptions.hidden) {
      return;
    }
    marketplaceTransmissionSelect.classList.remove(
      "condition-select--open-upward"
    );
    marketplaceTransmissionOptions.style.maxHeight = "";
    const viewportPadding = remToPixels(1.2);
    const triggerRect = marketplaceTransmissionTrigger.getBoundingClientRect();
    const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
    const spaceBelow = Math.max(
      window.innerHeight - triggerRect.bottom - viewportPadding,
      0
    );
    const preferredHeight = Math.min(
      marketplaceTransmissionOptions.scrollHeight,
      window.innerHeight * 0.4,
      remToPixels(18)
    );
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    marketplaceTransmissionSelect.classList.toggle(
      "condition-select--open-upward",
      openUpward
    );
    marketplaceTransmissionOptions.style.maxHeight = pixelsToRem(Math.max(
      Math.min(preferredHeight, availableSpace - remToPixels(0.7)),
      remToPixels(10)
    ));
  }
  marketplaceTransmissionTrigger?.addEventListener("click", () => {
    if (marketplaceTransmissionOptions?.hidden) {
      const selectedIndex = marketplaceTransmissionOptionElements.findIndex(
        (option) => option.getAttribute("aria-selected") === "true"
      );
      openMarketplaceTransmissionDropdown(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      closeMarketplaceTransmissionDropdown();
    }
  });
  marketplaceTransmissionTrigger?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = marketplaceTransmissionOptionElements.length - 1;
    openMarketplaceTransmissionDropdown(
      event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
    );
  });
  marketplaceTransmissionOptionElements.forEach((option, index) => {
    option.addEventListener("click", () => selectMarketplaceTransmission(option));
    option.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMarketplaceTransmissionOption(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMarketplaceTransmissionOption(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusMarketplaceTransmissionOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusMarketplaceTransmissionOption(
          marketplaceTransmissionOptionElements.length - 1
        );
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMarketplaceTransmission(option);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMarketplaceTransmissionDropdown(true);
      } else if (event.key === "Tab") {
        closeMarketplaceTransmissionDropdown();
      }
    });
  });
  function initializeMarketplaceColorSelects() {
    ["exterior", "interior"].forEach(
      (kind) => {
        const dropdown = marketplaceColorDropdowns[kind];
        if (!dropdown.options || !dropdown.trigger) {
          return;
        }
        dropdown.optionElements = MARKETPLACE_VEHICLE_COLORS.map((color) => {
          const option = document.createElement("div");
          option.className = "condition-select__option color-select__option";
          option.setAttribute("role", "option");
          option.setAttribute("aria-selected", "false");
          option.tabIndex = -1;
          option.dataset.value = color.toLowerCase().replace(/\s+/g, "_");
          const label = document.createElement("span");
          label.textContent = color;
          option.append(label);
          return option;
        });
        dropdown.options.replaceChildren(...dropdown.optionElements);
        dropdown.trigger.addEventListener("click", () => {
          if (dropdown.options?.hidden) {
            const selectedIndex = dropdown.optionElements.findIndex(
              (option) => option.getAttribute("aria-selected") === "true"
            );
            openMarketplaceColorDropdown(
              kind,
              selectedIndex >= 0 ? selectedIndex : 0
            );
          } else {
            closeMarketplaceColorDropdown(kind);
          }
        });
        dropdown.trigger.addEventListener("keydown", (event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            return;
          }
          event.preventDefault();
          const lastIndex = dropdown.optionElements.length - 1;
          openMarketplaceColorDropdown(
            kind,
            event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
          );
        });
        dropdown.optionElements.forEach((option, index) => {
          option.addEventListener(
            "click",
            () => selectMarketplaceColor(kind, option)
          );
          option.addEventListener("keydown", (event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusMarketplaceColorOption(kind, index + 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              focusMarketplaceColorOption(kind, index - 1);
            } else if (event.key === "Home") {
              event.preventDefault();
              focusMarketplaceColorOption(kind, 0);
            } else if (event.key === "End") {
              event.preventDefault();
              focusMarketplaceColorOption(
                kind,
                dropdown.optionElements.length - 1
              );
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectMarketplaceColor(kind, option);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeMarketplaceColorDropdown(kind, true);
            } else if (event.key === "Tab") {
              closeMarketplaceColorDropdown(kind);
            }
          });
        });
      }
    );
  }
  function openMarketplaceColorDropdown(kind, focusIndex) {
    const dropdown = marketplaceColorDropdowns[kind];
    if (!dropdown.select || !dropdown.trigger || !dropdown.options) {
      return;
    }
    closeListingTypeDropdown();
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns(kind);
    dropdown.options.hidden = false;
    dropdown.select.classList.add("condition-select--open");
    dropdown.trigger.setAttribute("aria-expanded", "true");
    positionMarketplaceColorDropdown(kind);
    if (focusIndex !== void 0) {
      dropdown.optionElements[focusIndex]?.focus();
    }
  }
  function closeMarketplaceColorDropdown(kind, returnFocus = false) {
    const dropdown = marketplaceColorDropdowns[kind];
    if (!dropdown.select || !dropdown.trigger || !dropdown.options) {
      return;
    }
    dropdown.options.hidden = true;
    dropdown.options.style.maxHeight = "";
    dropdown.select.classList.remove(
      "condition-select--open",
      "condition-select--open-upward"
    );
    dropdown.trigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      dropdown.trigger.focus();
    }
  }
  function closeMarketplaceColorDropdowns(except) {
    ["exterior", "interior"].forEach(
      (kind) => {
        if (kind !== except) {
          closeMarketplaceColorDropdown(kind);
        }
      }
    );
  }
  function selectMarketplaceColor(kind, option) {
    const dropdown = marketplaceColorDropdowns[kind];
    const value = option.dataset.value;
    const label = option.textContent?.trim();
    if (!value || !label) {
      return;
    }
    dropdown.optionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (dropdown.value) {
      dropdown.value.textContent = label;
    }
    if (dropdown.input) {
      dropdown.input.value = value;
    }
    closeMarketplaceColorDropdown(kind, true);
  }
  function focusMarketplaceColorOption(kind, index) {
    const options = marketplaceColorDropdowns[kind].optionElements;
    if (options.length === 0) {
      return;
    }
    options[(index + options.length) % options.length]?.focus();
  }
  function positionMarketplaceColorDropdown(kind) {
    const dropdown = marketplaceColorDropdowns[kind];
    if (!dropdown.select || !dropdown.trigger || !dropdown.options || dropdown.options.hidden) {
      return;
    }
    dropdown.select.classList.remove("condition-select--open-upward");
    dropdown.options.style.maxHeight = "";
    const viewportPadding = remToPixels(1.2);
    const triggerRect = dropdown.trigger.getBoundingClientRect();
    const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
    const spaceBelow = Math.max(
      window.innerHeight - triggerRect.bottom - viewportPadding,
      0
    );
    const preferredHeight = Math.min(
      dropdown.options.scrollHeight,
      window.innerHeight * 0.65,
      remToPixels(42)
    );
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    dropdown.select.classList.toggle("condition-select--open-upward", openUpward);
    dropdown.options.style.maxHeight = pixelsToRem(Math.max(
      Math.min(preferredHeight, availableSpace - remToPixels(0.7)),
      remToPixels(12)
    ));
  }
  function openMarketplaceRentalTypeDropdown(focusIndex) {
    if (!marketplaceRentalTypeSelect || !marketplaceRentalTypeTrigger || !marketplaceRentalTypeOptions) {
      return;
    }
    closeListingTypeDropdown();
    closeMarketplaceCategoryDropdown();
    closeMarketplaceConditionDropdown();
    closeMarketplaceVehicleTypeDropdown();
    closeMarketplaceYearDropdown();
    closeMarketplaceBodyStyleDropdown();
    closeMarketplaceVehicleConditionDropdown();
    closeMarketplaceFuelTypeDropdown();
    closeMarketplaceTransmissionDropdown();
    closeMarketplaceColorDropdowns();
    marketplaceRentalTypeOptions.hidden = false;
    marketplaceRentalTypeSelect.classList.add("condition-select--open");
    marketplaceRentalTypeTrigger.setAttribute("aria-expanded", "true");
    positionMarketplaceRentalTypeDropdown();
    if (focusIndex !== void 0) {
      marketplaceRentalTypeOptionElements[focusIndex]?.focus();
    }
  }
  function closeMarketplaceRentalTypeDropdown(returnFocus = false) {
    if (!marketplaceRentalTypeSelect || !marketplaceRentalTypeTrigger || !marketplaceRentalTypeOptions) {
      return;
    }
    marketplaceRentalTypeOptions.hidden = true;
    marketplaceRentalTypeOptions.style.maxHeight = "";
    marketplaceRentalTypeSelect.classList.remove(
      "condition-select--open",
      "condition-select--open-upward"
    );
    marketplaceRentalTypeTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      marketplaceRentalTypeTrigger.focus();
    }
  }
  function selectMarketplaceRentalType(option) {
    const value = option.dataset.value;
    const label = option.textContent?.trim();
    if (!value || !label) {
      return;
    }
    marketplaceRentalTypeOptionElements.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === option));
    });
    if (marketplaceRentalTypeValue) {
      marketplaceRentalTypeValue.textContent = label;
    }
    if (marketplaceRentalTypeInput) {
      marketplaceRentalTypeInput.value = value;
    }
    closeMarketplaceRentalTypeDropdown(true);
  }
  function focusMarketplaceRentalTypeOption(index) {
    const optionCount = marketplaceRentalTypeOptionElements.length;
    if (optionCount === 0) {
      return;
    }
    marketplaceRentalTypeOptionElements[(index + optionCount) % optionCount]?.focus();
  }
  function positionMarketplaceRentalTypeDropdown() {
    if (!marketplaceRentalTypeSelect || !marketplaceRentalTypeTrigger || !marketplaceRentalTypeOptions || marketplaceRentalTypeOptions.hidden) {
      return;
    }
    marketplaceRentalTypeSelect.classList.remove("condition-select--open-upward");
    marketplaceRentalTypeOptions.style.maxHeight = "";
    const viewportPadding = remToPixels(1.2);
    const triggerRect = marketplaceRentalTypeTrigger.getBoundingClientRect();
    const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
    const spaceBelow = Math.max(
      window.innerHeight - triggerRect.bottom - viewportPadding,
      0
    );
    const preferredHeight = Math.min(
      marketplaceRentalTypeOptions.scrollHeight,
      window.innerHeight * 0.55,
      remToPixels(26)
    );
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    marketplaceRentalTypeSelect.classList.toggle(
      "condition-select--open-upward",
      openUpward
    );
    marketplaceRentalTypeOptions.style.maxHeight = pixelsToRem(Math.max(
      Math.min(preferredHeight, availableSpace - remToPixels(0.7)),
      remToPixels(12)
    ));
  }
  marketplaceRentalTypeTrigger?.addEventListener("click", () => {
    if (marketplaceRentalTypeOptions?.hidden) {
      const selectedIndex = marketplaceRentalTypeOptionElements.findIndex(
        (option) => option.getAttribute("aria-selected") === "true"
      );
      openMarketplaceRentalTypeDropdown(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      closeMarketplaceRentalTypeDropdown();
    }
  });
  marketplaceRentalTypeTrigger?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = marketplaceRentalTypeOptionElements.length - 1;
    openMarketplaceRentalTypeDropdown(
      event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
    );
  });
  marketplaceRentalTypeOptionElements.forEach((option, index) => {
    option.addEventListener("click", () => selectMarketplaceRentalType(option));
    option.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMarketplaceRentalTypeOption(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMarketplaceRentalTypeOption(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusMarketplaceRentalTypeOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusMarketplaceRentalTypeOption(
          marketplaceRentalTypeOptionElements.length - 1
        );
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMarketplaceRentalType(option);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMarketplaceRentalTypeDropdown(true);
      } else if (event.key === "Tab") {
        closeMarketplaceRentalTypeDropdown();
      }
    });
  });
  window.addEventListener("resize", positionMarketplaceCategoryDropdown);
  window.addEventListener("resize", positionMarketplaceConditionDropdown);
  window.addEventListener("resize", positionMarketplaceVehicleTypeDropdown);
  window.addEventListener("resize", positionMarketplaceYearDropdown);
  window.addEventListener("resize", positionMarketplaceBodyStyleDropdown);
  window.addEventListener("resize", positionMarketplaceVehicleConditionDropdown);
  window.addEventListener("resize", positionMarketplaceFuelTypeDropdown);
  window.addEventListener("resize", positionMarketplaceTransmissionDropdown);
  window.addEventListener("resize", () => {
    positionMarketplaceColorDropdown("exterior");
    positionMarketplaceColorDropdown("interior");
  });
  window.addEventListener("resize", positionMarketplaceRentalTypeDropdown);
  document.addEventListener("click", (event) => {
    const eventTarget = event.target;
    if (eventTarget instanceof Node) {
      if (!listingTypeSelect?.contains(eventTarget)) {
        closeListingTypeDropdown();
      }
      if (!marketplaceCategorySelect?.contains(eventTarget)) {
        closeMarketplaceCategoryDropdown();
      }
      if (!marketplaceConditionSelect?.contains(eventTarget)) {
        closeMarketplaceConditionDropdown();
      }
      if (!marketplaceVehicleTypeSelect?.contains(eventTarget)) {
        closeMarketplaceVehicleTypeDropdown();
      }
      if (!marketplaceYearSelect?.contains(eventTarget)) {
        closeMarketplaceYearDropdown();
      }
      if (!marketplaceBodyStyleSelect?.contains(eventTarget)) {
        closeMarketplaceBodyStyleDropdown();
      }
      if (!marketplaceVehicleConditionSelect?.contains(eventTarget)) {
        closeMarketplaceVehicleConditionDropdown();
      }
      if (!marketplaceFuelTypeSelect?.contains(eventTarget)) {
        closeMarketplaceFuelTypeDropdown();
      }
      if (!marketplaceTransmissionSelect?.contains(eventTarget)) {
        closeMarketplaceTransmissionDropdown();
      }
      ["exterior", "interior"].forEach(
        (kind) => {
          if (!marketplaceColorDropdowns[kind].select?.contains(eventTarget)) {
            closeMarketplaceColorDropdown(kind);
          }
        }
      );
      if (!marketplaceRentalTypeSelect?.contains(eventTarget)) {
        closeMarketplaceRentalTypeDropdown();
      }
    }
    queueMicrotask(updateMarketplaceSaveListingButtonState);
  });
  marketplaceImagesInput?.addEventListener("change", () => {
    queueMarketplacePhotos(Array.from(marketplaceImagesInput.files ?? []));
  });
  saveMarketplaceListingButton?.addEventListener("click", () => {
    void saveMarketplaceListing();
  });
  cancelMarketplaceListingEditButton?.addEventListener("click", () => {
    clearMarketplaceListingEditor();
  });
  marketplaceListingFields?.addEventListener("input", () => {
    hideMarketplaceSaveListingStatus();
    queueMicrotask(updateMarketplaceSaveListingButtonState);
  });
  marketplaceListingFields?.addEventListener("change", () => {
    queueMicrotask(updateMarketplaceSaveListingButtonState);
  });
  marketplaceTitleInput?.addEventListener("input", () => {
    if (marketplaceTitleCount) {
      marketplaceTitleCount.textContent = `${marketplaceTitleInput.value.length} / 200`;
    }
  });
  marketplacePriceInput?.addEventListener("input", () => {
    const digitsOnly = marketplacePriceInput.value.replace(/[^0-9]/g, "");
    if (marketplacePriceInput.value !== digitsOnly) {
      marketplacePriceInput.value = digitsOnly;
    }
  });
  marketplaceVehicleMileageInput?.addEventListener("input", () => {
    const digitsOnly = marketplaceVehicleMileageInput.value.replace(
      /[^0-9]/g,
      ""
    );
    if (marketplaceVehicleMileageInput.value !== digitsOnly) {
      marketplaceVehicleMileageInput.value = digitsOnly;
    }
  });
  [marketplaceBedroomsInput, marketplaceBathroomsInput].forEach((input) => {
    input?.addEventListener("input", () => {
      const digitsOnly = input.value.replace(/[^0-9]/g, "");
      if (input.value !== digitsOnly) {
        input.value = digitsOnly;
      }
    });
  });
  marketplacePhotoDropzone?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (marketplaceImagesInput?.disabled) {
      showMarketplacePhotoStatus(
        "Select a listing type before adding photos.",
        true
      );
      return;
    }
    marketplaceImagesInput?.click();
  });
  marketplacePhotoDropzone?.addEventListener("dragenter", (event) => {
    event.preventDefault();
    if (!marketplaceImagesInput?.disabled) {
      marketplacePhotoDropzone.classList.add(
        "marketplace-photo-dropzone--dragging"
      );
    }
  });
  marketplacePhotoDropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = marketplaceImagesInput?.disabled ? "none" : "copy";
    }
  });
  marketplacePhotoDropzone?.addEventListener("dragleave", () => {
    marketplacePhotoDropzone.classList.remove(
      "marketplace-photo-dropzone--dragging"
    );
  });
  marketplacePhotoDropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    marketplacePhotoDropzone.classList.remove(
      "marketplace-photo-dropzone--dragging"
    );
    if (marketplaceImagesInput?.disabled) {
      showMarketplacePhotoStatus(
        "Select a listing type before adding photos.",
        true
      );
      return;
    }
    queueMarketplacePhotos(Array.from(event.dataTransfer?.files ?? []));
  });
  marketplacePhotoLightboxClose?.addEventListener("click", () => {
    closeMarketplacePhotoLightbox();
  });
  marketplacePhotoLightboxBackdrop?.addEventListener("click", () => {
    closeMarketplacePhotoLightbox();
  });
  marketplacePhotoLightboxPrevious?.addEventListener("click", () => {
    moveMarketplacePhotoLightbox(-1);
  });
  marketplacePhotoLightboxNext?.addEventListener("click", () => {
    moveMarketplacePhotoLightbox(1);
  });
  document.addEventListener("keydown", (event) => {
    if (marketplacePhotoLightbox?.hidden !== false) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeMarketplacePhotoLightbox();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveMarketplacePhotoLightbox(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveMarketplacePhotoLightbox(1);
    }
  });
  function renderGroups(groups) {
    if (!groupsList) {
      return;
    }
    loadedGroups = groups;
    selectedGroupIds = new Set(
      Array.from(selectedGroupIds).filter(
        (groupId) => groups.some((group) => group.id === groupId)
      )
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
      const groupsSearchField2 = groupsSearchInput?.closest(".field");
      if (groupsSearchField2) {
        groupsSearchField2.hidden = false;
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
    groupsList.hidden = false;
    const groupsSearchField = groupsSearchInput?.closest(".field");
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
    const visibleGroups = normalizedQuery.length ? groups.filter(
      (group) => `${group.name} ${group.url}`.toLowerCase().includes(normalizedQuery)
    ) : groups;
    if (visibleGroups.length === 0) {
      groupsList.className = "empty-state";
      groupsList.textContent = `No groups match "${groupsSearchQuery.trim()}".`;
      updatePostingReadiness();
      return;
    }
    const selectedGroups = groupsInSelectionOrder(visibleGroups, selectedGroupIds);
    const remainingGroups = visibleGroups.filter(
      (group) => !selectedGroupIds.has(group.id)
    );
    const renderGroupItem = (group) => {
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
    const createSection = (title, groupsForSection, emptyMessage) => {
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
        normalizedQuery.length ? "No selected groups match this search." : "No groups selected yet."
      ),
      createSection(
        "Other Groups",
        remainingGroups,
        normalizedQuery.length ? "No remaining groups match this search." : "No other groups available."
      )
    );
    updatePostingReadiness();
  }
  function updateGroupsStatus(message, loadedCount) {
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
      geminiStatusMessage.textContent = rewriteEnabled ? hasKey ? "AI rewriting is on." : "Add your Gemini access key to use AI rewriting." : "AI rewriting is off.";
    }
    if (geminiStatusCount) {
      geminiStatusCount.hidden = hasKey;
      geminiStatusCount.textContent = hasKey ? "" : "No key";
    }
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
    groupsSelectAllCheckbox.checked = hasGroups && selectedCount === loadedGroups.length;
    groupsSelectAllCheckbox.indeterminate = hasGroups && selectedCount > 0 && selectedCount < loadedGroups.length;
  }
  function updateGroupsSelectionSummary() {
    if (!groupsSelectionCount) {
      return;
    }
    const selectedGroupsCount = getSelectedGroupsCount();
    const selectedLabel = `${selectedGroupsCount} ${selectedGroupsCount === 1 ? "group" : "groups"} selected`;
    const label = loadedGroups.length > 0 ? `${selectedLabel} from ${loadedGroups.length} loaded` : selectedLabel;
    groupsSelectionCount.className = "selection-count";
    groupsSelectionCount.textContent = label;
    const cardSummary = document.querySelector("#groups-card-summary");
    if (cardSummary) {
      cardSummary.textContent = loadedGroups.length > 0 ? label : "Find and select the groups you want to post to";
    }
  }
  function updatePostingReadiness() {
    const isAuthenticated = hasActiveExtensionAccess();
    const selectedGroupsCount = getSelectedGroupsCount();
    const hasSelectedPreparedPosts = preparedPosts.some((post) => post.selected);
    const minimumDelaySeconds = Number(postIntervalMinInput?.value ?? 0);
    const maximumDelaySeconds = Number(postIntervalMaxInput?.value ?? 0);
    const hasValidSleepTime = isValidPostingInterval(
      minimumDelaySeconds,
      maximumDelaySeconds
    );
    const maxPosts = Number(maxPostsInput?.value ?? 0);
    const hasValidMaxPosts = Number.isInteger(maxPosts) && maxPosts >= MIN_MAX_POSTS;
    updateGroupsSelectionSummary();
    updateGroupsSelectAllState();
    updatePostingButtonState(
      isAuthenticated,
      hasSelectedPreparedPosts,
      selectedGroupsCount,
      hasValidSleepTime,
      hasValidMaxPosts
    );
    if (loadGroupsButton) {
      loadGroupsButton.disabled = !isAuthenticated;
    }
  }
  function isValidPostingInterval(minimumDelaySeconds, maximumDelaySeconds) {
    return Number.isInteger(minimumDelaySeconds) && minimumDelaySeconds >= MIN_SLEEP_SECONDS && Number.isInteger(maximumDelaySeconds) && maximumDelaySeconds >= minimumDelaySeconds;
  }
  function normalizePostingInterval() {
    if (!postIntervalMinInput || !postIntervalMaxInput) {
      return;
    }
    const enteredMinimum = Number(postIntervalMinInput.value);
    const minimumDelaySeconds = Number.isInteger(enteredMinimum) && enteredMinimum >= MIN_SLEEP_SECONDS ? enteredMinimum : MIN_SLEEP_SECONDS;
    const enteredMaximum = Number(postIntervalMaxInput.value);
    const maximumDelaySeconds = Number.isInteger(enteredMaximum) && enteredMaximum >= minimumDelaySeconds ? enteredMaximum : Math.max(DEFAULT_MAX_SLEEP_SECONDS, minimumDelaySeconds);
    postIntervalMinInput.value = String(minimumDelaySeconds);
    postIntervalMaxInput.value = String(maximumDelaySeconds);
    updatePostingReadiness();
    scheduleSaveSidePanelSession();
  }
  function updatePostingButtonState(isAuthenticated = hasActiveExtensionAccess(), hasSelectedPreparedPosts = preparedPosts.some((post) => post.selected), selectedGroupsCount = getSelectedGroupsCount(), hasValidSleepTime = (() => {
    return isValidPostingInterval(
      Number(postIntervalMinInput?.value ?? 0),
      Number(postIntervalMaxInput?.value ?? 0)
    );
  })(), hasValidMaxPosts = (() => {
    const maxPosts = Number(maxPostsInput?.value ?? 0);
    return Number.isInteger(maxPosts) && maxPosts >= MIN_MAX_POSTS;
  })()) {
    if (!startPostingButton) {
      return;
    }
    if (isPostingActive) {
      startPostingButton.disabled = true;
      startPostingButton.title = "Group posting is already in progress.";
      setButtonContent(startPostingButton, "Posting\u2026");
      updatePausePostingButtonState();
      return;
    }
    startPostingButton.classList.remove("start-posting-btn--stop");
    const hasPostingAllowance = currentExtensionAccess?.access.remaining.group_posts_today !== 0;
    startPostingButton.title = hasPostingAllowance ? "" : `Your Free account has used all ${currentExtensionAccess?.access.limits.group_posts_today ?? FREE_MAX_GROUP_POSTS} Group posts for today`;
    startPostingButton.disabled = !(isAuthenticated && hasPostingAllowance && hasSelectedPreparedPosts && selectedGroupsCount > 0 && hasValidSleepTime && hasValidMaxPosts);
    setButtonContent(startPostingButton, "Start Posting");
    updatePausePostingButtonState();
  }
  function updatePausePostingButtonState() {
    if (pausePostingButton) {
      pausePostingButton.hidden = !isPostingActive;
      pausePostingButton.disabled = isStopRequestPending || isPauseResumeRequestPending;
      pausePostingButton.classList.toggle(
        "pause-posting-btn--resume",
        isPostingPaused
      );
      const label = isPauseResumeRequestPending ? isPostingPaused ? "Resuming\u2026" : "Pausing\u2026" : isPostingPaused ? "Resume" : "Pause";
      setButtonContent(pausePostingButton, label, isPauseResumeRequestPending);
    }
    if (stopPostingButton) {
      stopPostingButton.hidden = !isPostingActive;
      stopPostingButton.disabled = isStopRequestPending;
      setButtonContent(
        stopPostingButton,
        isStopRequestPending ? "Stopping\u2026" : "Stop",
        isStopRequestPending
      );
    }
  }
  function setButtonContent(button, label, showLoader = false) {
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
  var groupsPostingTimingElements = {
    container: postingTiming,
    elapsedLabel: postingTimingLabel,
    elapsedValue: postingElapsedTime,
    itemLabel: postingItemTimingLabel,
    itemValue: postingItemTime
  };
  var marketplacePostingTimingElements = {
    container: marketplacePostingTiming,
    elapsedLabel: marketplacePostingTimingLabel,
    elapsedValue: marketplacePostingElapsedTime,
    itemLabel: marketplacePostingItemTimingLabel,
    itemValue: marketplacePostingItemTime
  };
  function livePostingDuration(timing, value) {
    const liveDelta = timing.isPaused || timing.isComplete ? 0 : Math.max(0, Date.now() - timing.updatedAt);
    return Math.max(0, timing[value] + liveDelta);
  }
  function formatPostingDurationClock(durationMs) {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1e3));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    const minuteText = String(minutes).padStart(2, "0");
    const secondText = String(seconds).padStart(2, "0");
    return hours > 0 ? `${hours}:${minuteText}:${secondText}` : `${minuteText}:${secondText}`;
  }
  function formatPostingDurationSummary(durationMs) {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1e3));
    if (totalSeconds < 1) {
      return "under 1s";
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    return [
      hours > 0 ? `${hours}h` : "",
      minutes > 0 ? `${minutes}m` : "",
      `${seconds}s`
    ].filter(Boolean).join(" ");
  }
  function renderPostingTiming(timing, elements) {
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
      elements.elapsedLabel.textContent = timing.isComplete ? "Active time" : timing.isPaused ? "Paused at" : "Elapsed";
    }
    if (elements.itemLabel) {
      elements.itemLabel.textContent = timing.isComplete ? "Last item" : "Current item";
    }
    elements.container?.classList.toggle(
      "posting-timing--paused",
      timing.isPaused
    );
    elements.container?.classList.toggle(
      "posting-timing--complete",
      timing.isComplete
    );
  }
  function resetPostingTiming(elements) {
    if (elements.elapsedLabel) elements.elapsedLabel.textContent = "Elapsed";
    if (elements.elapsedValue) elements.elapsedValue.textContent = "00:00";
    if (elements.itemLabel) elements.itemLabel.textContent = "Current item";
    if (elements.itemValue) elements.itemValue.textContent = "00:00";
    elements.container?.classList.remove(
      "posting-timing--paused",
      "posting-timing--complete"
    );
  }
  function createPendingPostingTiming(startedAt) {
    return {
      startedAt,
      updatedAt: startedAt,
      elapsedMs: 0,
      itemElapsedMs: 0,
      pausedMs: 0,
      isPaused: false,
      isComplete: false
    };
  }
  function finishPendingPostingTiming(timing) {
    const now = Date.now();
    const liveDelta = Math.max(0, now - timing.updatedAt);
    return {
      ...timing,
      updatedAt: now,
      elapsedMs: timing.elapsedMs + liveDelta,
      itemElapsedMs: timing.itemElapsedMs + liveDelta,
      isComplete: true
    };
  }
  function renderAllPostingTimers() {
    renderPostingTiming(latestGroupsPostingTiming, groupsPostingTimingElements);
    renderPostingTiming(
      latestMarketplacePostingTiming,
      marketplacePostingTimingElements
    );
  }
  window.setInterval(renderAllPostingTimers, 1e3);
  var geminiDialogs = /* @__PURE__ */ new Map();
  function syncGeminiPrompts(prompts) {
    for (const [id, dialog] of geminiDialogs) {
      if (!prompts.some((prompt) => prompt.id === id)) {
        dialog.close();
        dialog.remove();
        geminiDialogs.delete(id);
      }
    }
    prompts.forEach(showGeminiPrompt);
  }
  function showGeminiPrompt(prompt) {
    if (geminiDialogs.has(prompt.id)) return;
    const dialog = document.createElement("dialog");
    dialog.className = "gemini-error-dialog";
    dialog.setAttribute("aria-labelledby", `gemini-title-${prompt.id}`);
    const title = document.createElement("h2");
    title.id = `gemini-title-${prompt.id}`;
    title.textContent = `Gemini error \u2014 ${prompt.queue === "groups" ? "Groups" : "Marketplace"}`;
    const detail = document.createElement("p");
    detail.textContent = prompt.error;
    const explanation = document.createElement("p");
    explanation.textContent = "Posting is paused because AI rewriting failed. Use your original text for the remaining posts, or stop and check your Gemini settings.";
    const actions = document.createElement("div");
    const feedback = document.createElement("p");
    feedback.setAttribute("role", "status");
    for (const action of ["continue", "stop"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action === "stop" ? "button-89 button-89--danger" : "button-89";
      button.textContent = action === "continue" ? "Use original text" : "Stop";
      button.addEventListener("click", async () => {
        const buttons = actions.querySelectorAll("button");
        buttons.forEach((item) => {
          item.disabled = true;
        });
        try {
          const response = await chrome.runtime.sendMessage({
            type: "RESOLVE_GEMINI_ERROR",
            id: prompt.id,
            action
          });
          if (!response?.ok) {
            await restorePostingQueueStatus();
            throw new Error("This prompt is no longer active.");
          }
          dialog.close();
          dialog.remove();
          geminiDialogs.delete(prompt.id);
        } catch {
          feedback.textContent = "Unable to apply your choice. Please try again.";
          buttons.forEach((item) => {
            item.disabled = false;
          });
        }
      });
      actions.append(button);
    }
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    dialog.append(title, detail, explanation, actions, feedback);
    document.body.append(dialog);
    geminiDialogs.set(prompt.id, dialog);
    dialog.showModal();
  }
  window.setInterval(() => {
    void chrome.runtime.sendMessage({ type: "GET_POSTING_QUEUE_STATUS" }).then(
      (response) => syncGeminiPrompts(response?.geminiPrompts ?? [])
    ).catch(() => {
    });
  }, 1e4);
  async function restorePostingQueueStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_POSTING_QUEUE_STATUS" });
      syncGeminiPrompts(response?.geminiPrompts ?? []);
      if (response?.groups) {
        updateUiPostingStatus(response.groups);
      }
      if (response?.marketplace) {
        updateMarketplaceItemPostingStatus(response.marketplace);
      }
    } catch {
    }
  }
  function postingTimingLogMeta(timing, scope) {
    if (!timing) {
      return "";
    }
    const duration = scope === "queue" ? timing.elapsedMs : timing.itemElapsedMs;
    const parts = [
      `${scope === "queue" ? "Active time" : "Item time"} ${formatPostingDurationSummary(duration)}`
    ];
    if (scope === "queue" && timing.pausedMs >= 1e3) {
      parts.push(`paused ${formatPostingDurationSummary(timing.pausedMs)}`);
    }
    return parts.join(" \xB7 ");
  }
  function postingPausedTimeMeta(timing) {
    return timing && timing.pausedMs >= 1e3 ? `Paused ${formatPostingDurationSummary(timing.pausedMs)}` : "";
  }
  chrome.runtime.onMessage.addListener(
    (message) => {
      if (message.type === "GEMINI_ERROR_PROMPT") showGeminiPrompt(message);
      if (message.type === "GROUP_EXTRACTION_STATUS") {
        updateGroupsStatus(message.message, message.loadedCount);
      }
      if (message.type === "UI_POSTING_STATUS") {
        updateUiPostingStatus(message);
      }
      if (message.type === "MARKETPLACE_ITEM_POSTING_STATUS") {
        updateMarketplaceItemPostingStatus(message);
      }
      if (message.type === "MARKETPLACE_CLEANUP_STATUS") {
        updateMarketplaceCleanupStatus(message);
      }
      if (message.type === "ACCESS_ENTITLEMENTS_UPDATED" && currentExtensionAccess) {
        currentExtensionAccess.access = message.access;
        updateExtensionAccessUi();
      }
    }
  );
  function updateMarketplaceCleanupStatus(message) {
    if (marketplaceCleanupProgress) {
      marketplaceCleanupProgress.hidden = false;
    }
    const percent = message.total > 0 ? Math.min(Math.round(message.processed / message.total * 100), 100) : 0;
    if (marketplaceCleanupCount) {
      marketplaceCleanupCount.textContent = message.status === "warning" ? "Unable to verify listings" : message.total > 0 ? `${message.processed}/${message.total} processed` : `${message.processed} listings scanned`;
    }
    if (marketplaceCleanupPercent) {
      marketplaceCleanupPercent.textContent = message.status === "warning" ? "\u2014" : `${percent}%`;
    }
    if (marketplaceCleanupProgressBar) {
      marketplaceCleanupProgressBar.style.width = `${percent}%`;
    }
    if (marketplaceCleanupDeleted) {
      marketplaceCleanupDeleted.textContent = String(message.deletedCount);
    }
    if (marketplaceCleanupFailed) {
      marketplaceCleanupFailed.textContent = String(message.failedCount);
    }
    if (marketplaceCleanupRemaining) {
      marketplaceCleanupRemaining.textContent = message.status === "warning" ? "\u2014" : String(Math.max(message.total - message.processed, 0));
    }
    if (marketplaceCleanupMessage) {
      marketplaceCleanupMessage.textContent = message.error ? `${message.message} ${message.error}` : message.message;
    }
    appendMarketplaceCleanupLog(message);
    isMarketplaceCleanupActive = !(message.status === "done" || message.status === "warning" || message.status === "failed" && message.total === 0);
    updateMarketplaceCleanupControls();
    renderMarketplaceListings();
  }
  function appendMarketplaceCleanupLog(message) {
    if (!marketplaceCleanupLog) return;
    const updatable = message.status === "scanning" || message.status === "deleting" ? marketplaceCleanupLog.querySelector(
      `li[data-status="${message.status}"]`
    ) : void 0;
    const item = updatable ?? document.createElement("li");
    item.dataset.status = message.status;
    const badge = document.createElement("span");
    badge.className = "posting-progress__log-badge";
    badge.textContent = message.status === "deleted" ? "Done" : message.status === "warning" ? "Warning" : message.status === "failed" ? "Fail" : message.status === "deleting" ? "Delete" : message.status === "scanning" ? "Scan" : "Info";
    const body = document.createElement("span");
    body.className = "posting-progress__log-body";
    const text = document.createElement("span");
    text.className = "posting-progress__log-text";
    text.textContent = message.message;
    body.append(text);
    if (message.error) {
      const meta = document.createElement("span");
      meta.className = "posting-progress__log-meta";
      meta.textContent = message.error;
      body.append(meta);
    }
    item.replaceChildren(badge, body);
    if (!updatable) marketplaceCleanupLog.prepend(item);
  }
  function createFacebookResponseCopyButton(responseBody) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "posting-progress__copy-response";
    button.title = "Copy Facebook failure response";
    button.setAttribute("aria-label", "Copy Facebook failure response");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "32");
    svg.setAttribute("height", "32");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("viewBox", "0 0 256 256");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"
    );
    svg.append(path);
    button.append(svg);
    button.addEventListener("click", async () => {
      if (await copyTextToClipboard(responseBody)) {
        showToast("Facebook failure response copied.", "success");
      } else {
        showToast("Unable to copy the Facebook response.", "error");
      }
    });
    return button;
  }
  async function copyTextToClipboard(value) {
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
  function updateMarketplaceCleanupControls() {
    const rawDays = marketplaceCleanupDaysInput?.value.trim() ?? "";
    const days = Number(rawDays);
    const validDays = /^\d+$/.test(rawDays) && Number.isSafeInteger(days) && days >= 0;
    if (marketplaceCleanupDaysInput) {
      marketplaceCleanupDaysInput.disabled = isMarketplaceCleanupActive;
    }
    if (deleteOldMarketplaceListingsButton) {
      deleteOldMarketplaceListingsButton.disabled = isMarketplaceCleanupActive || !validDays || isMarketplacePostingActive;
      setButtonContent(
        deleteOldMarketplaceListingsButton,
        isMarketplaceCleanupActive ? "Cleaning up\u2026" : "Delete old listings",
        isMarketplaceCleanupActive
      );
    }
  }
  function updateMarketplaceItemPostingStatus(message) {
    if (message.timing) {
      latestMarketplacePostingTiming = message.timing;
      renderPostingTiming(message.timing, marketplacePostingTimingElements);
    }
    if (marketplacePostingProgressCard) {
      marketplacePostingProgressCard.hidden = false;
    }
    if (marketplacePostingStatusMessage) {
      marketplacePostingStatusMessage.textContent = message.error ? `${message.message} ${message.error}` : message.message;
    }
    if (marketplacePostingStatusCount) {
      marketplacePostingStatusCount.textContent = `${message.successCount}/${message.total} successful posts`;
    }
    const processedCount = message.successCount + message.failedCount;
    const remainingCount = Math.max(message.total - processedCount, 0);
    const percent = message.total > 0 ? Math.min(Math.round(processedCount / message.total * 100), 100) : 0;
    if (marketplacePostingProgressPercent) {
      marketplacePostingProgressPercent.textContent = `${percent}%`;
    }
    if (marketplacePostingProgressBar) {
      marketplacePostingProgressBar.style.width = `${percent}%`;
    }
    if (marketplacePostingProgressSuccess) {
      marketplacePostingProgressSuccess.textContent = String(
        message.successCount
      );
    }
    if (marketplacePostingProgressFailed) {
      marketplacePostingProgressFailed.textContent = String(message.failedCount);
    }
    if (marketplacePostingProgressRemaining) {
      marketplacePostingProgressRemaining.textContent = String(remainingCount);
    }
    appendMarketplacePostingLog(message);
    if (message.status === "paused") {
      isMarketplacePostingPaused = true;
      isMarketplacePauseRequestPending = false;
    } else if (message.status === "posting") {
      isMarketplacePostingPaused = false;
      isMarketplacePauseRequestPending = false;
    }
    if (message.status === "done" || message.status === "stopped") {
      isMarketplacePostingPaused = false;
      isMarketplaceStopRequestPending = false;
      isMarketplacePauseRequestPending = false;
      setMarketplacePostingActive(false);
      if (message.status === "done" && !message.error) {
        selectedMarketplaceListingIds.clear();
        renderMarketplaceListings();
      }
    } else {
      setMarketplacePostingActive(true);
    }
  }
  function appendMarketplacePostingLog(message) {
    if (!marketplacePostingLog) {
      return;
    }
    marketplacePostingLog.hidden = false;
    if (message.status !== "waiting" && message.status !== "paused") {
      marketplacePostingLog.querySelectorAll('li[data-status="waiting"]').forEach((item2) => item2.remove());
    }
    const existingWaitingItem = message.status === "waiting" || message.status === "paused" ? marketplacePostingLog.querySelector(
      `li[data-status="${message.status}"][data-listing-id="${CSS.escape(
        message.listingId ?? "queue"
      )}"]`
    ) : void 0;
    const item = existingWaitingItem ?? document.createElement("li");
    item.dataset.status = message.status;
    item.dataset.listingId = message.listingId ?? "queue";
    const badge = document.createElement("span");
    badge.className = "posting-progress__log-badge";
    badge.textContent = getMarketplacePostingStatusLabel(message.status);
    const body = document.createElement("span");
    body.className = "posting-progress__log-body";
    const text = document.createElement("span");
    text.className = "posting-progress__log-text";
    text.textContent = message.message;
    const hasMarketplaceCompletionSummary = message.status === "done" && !message.error && Boolean(message.timing);
    if (hasMarketplaceCompletionSummary && message.timing) {
      text.textContent = `Completed ${message.successCount} Marketplace ${message.successCount === 1 ? "listing" : "listings"} in ${formatPostingDurationSummary(message.timing.elapsedMs)}${message.failedCount > 0 ? ` \xB7 ${message.failedCount} failed` : ""}.`;
    }
    body.append(text);
    const count = message.current > 0 && message.total > 0 ? `${message.current}/${message.total}` : "";
    const timingMeta = message.status === "done" || message.status === "stopped" ? hasMarketplaceCompletionSummary ? postingPausedTimeMeta(message.timing) : postingTimingLogMeta(message.timing, "queue") : message.status === "posted" || message.status === "failed" ? postingTimingLogMeta(message.timing, "item") : "";
    if (count || message.error || timingMeta) {
      const meta = document.createElement("span");
      meta.className = "posting-progress__log-meta";
      meta.textContent = [count, timingMeta, message.error].filter(Boolean).join(" \xB7 ");
      body.append(meta);
    }
    item.replaceChildren(badge, body);
    if (!existingWaitingItem) {
      marketplacePostingLog.prepend(item);
    }
    applyPostingLogFilter(
      marketplacePostingLog,
      marketplacePostingLogFilter,
      marketplaceProgressPostedFilterButton,
      marketplaceProgressFailedFilterButton
    );
  }
  function getMarketplacePostingStatusLabel(status) {
    switch (status) {
      case "posted":
      case "done":
        return "Done";
      case "failed":
        return "Fail";
      case "waiting":
        return "Next";
      case "paused":
        return "Pause";
      case "stopped":
        return "Stop";
      case "posting":
        return "Post";
      default:
        return "Info";
    }
  }
  function applyPostingLogFilter(log, filter, postedButton, failedButton, pendingButton) {
    postedButton?.setAttribute("aria-pressed", String(filter === "posted"));
    failedButton?.setAttribute("aria-pressed", String(filter === "failed"));
    pendingButton?.setAttribute("aria-pressed", String(filter === "pending"));
    log?.querySelectorAll("li[data-status]").forEach((item) => {
      const status = item.dataset.status;
      item.hidden = filter === "posted" ? status !== "posted" : filter === "pending" ? status !== "pending" : filter === "failed" ? status !== "failed" && status !== "rate_limited" : false;
    });
  }
  function toggleGroupsPostingLogFilter(filter) {
    groupsPostingLogFilter = groupsPostingLogFilter === filter ? "all" : filter;
    applyPostingLogFilter(
      postingProgressLog,
      groupsPostingLogFilter,
      postingProgressPostedFilterButton,
      postingProgressFailedFilterButton,
      postingProgressPendingFilterButton
    );
  }
  function toggleMarketplacePostingLogFilter(filter) {
    marketplacePostingLogFilter = marketplacePostingLogFilter === filter ? "all" : filter;
    applyPostingLogFilter(
      marketplacePostingLog,
      marketplacePostingLogFilter,
      marketplaceProgressPostedFilterButton,
      marketplaceProgressFailedFilterButton
    );
  }
  function updateUiPostingStatus(message) {
    if (message.timing) {
      latestGroupsPostingTiming = message.timing;
      renderPostingTiming(message.timing, groupsPostingTimingElements);
    }
    if (message.status === "posting" || message.status === "waiting" || message.status === "paused" || message.status === "posted" || message.status === "pending" || message.status === "failed") {
      isPostingActive = true;
      isPostingPaused = message.status === "paused";
      if (message.status === "paused") {
        isPauseResumeRequestPending = false;
      }
    }
    updatePostingProgress(message);
    if (message.status === "stopped" || message.status === "done" || message.status === "rate_limited") {
      isPostingActive = false;
      isPostingPaused = false;
      isStopRequestPending = false;
      isPauseResumeRequestPending = false;
      if (message.status === "done" && !message.error) {
        preparedPosts.forEach((post) => {
          post.selected = false;
        });
        renderPreparedPosts();
      }
      updatePostingReadiness();
    } else {
      updatePostingButtonState();
    }
  }
  function updatePostingProgress(message) {
    if (postingProgress) {
      postingProgress.hidden = false;
    }
    const successCount = message.successCount ?? 0;
    const pendingCount = message.pendingCount ?? 0;
    const postedCount = Math.max(successCount - pendingCount, 0);
    const failedCount = message.failedCount ?? 0;
    const processedCount = message.processedCount ?? Math.min(message.total, successCount + failedCount);
    const hasSuccessTarget = message.successTarget !== void 0;
    const remainingCount = hasSuccessTarget ? Math.max(message.successTarget - successCount, 0) : Math.max(message.total - processedCount, 0);
    const percent = hasSuccessTarget ? message.successTarget > 0 ? Math.min(Math.round(successCount / message.successTarget * 100), 100) : 0 : message.total > 0 ? Math.round(processedCount / message.total * 100) : 0;
    if (postingProgressTitle) {
      postingProgressTitle.textContent = hasSuccessTarget ? `${successCount}/${message.successTarget} posts submitted` : `${processedCount}/${message.total} groups processed`;
    }
    if (postingProgressPercent) {
      postingProgressPercent.textContent = `${percent}%`;
    }
    if (postingProgressBar) {
      postingProgressBar.style.width = `${percent}%`;
    }
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
      const prefix = message.current > 0 && message.total > 0 ? `Group ${message.current}/${message.total}` : "Queue";
      postingProgressCurrent.textContent = message.groupName ? `${prefix}: ${message.groupName}` : message.message;
    }
    appendPostingProgressLog(message);
  }
  function appendPostingProgressLog(message) {
    if (!postingProgressLog) {
      return;
    }
    if (message.status !== "waiting" && message.status !== "paused") {
      postingProgressLog.querySelectorAll('li[data-status="waiting"]').forEach((item2) => item2.remove());
    }
    const existingUpdatableItem = message.status === "waiting" || message.status === "paused" ? postingProgressLog.querySelector(
      `li[data-status="${message.status}"][data-group-id="${CSS.escape(
        message.groupId ?? "queue"
      )}"]`
    ) : void 0;
    const item = existingUpdatableItem ?? document.createElement("li");
    item.dataset.status = message.status;
    item.dataset.groupId = message.groupId ?? "queue";
    const count = message.current > 0 && message.total > 0 ? `${message.current}/${message.total}` : "";
    const badge = document.createElement("span");
    badge.className = "posting-progress__log-badge";
    badge.textContent = getPostingStatusLabel(message.status);
    const body = document.createElement("span");
    body.className = "posting-progress__log-body";
    const text = document.createElement("span");
    text.className = "posting-progress__log-text";
    text.textContent = message.message;
    const hasGroupsCompletionSummary = message.status === "done" && !message.error && Boolean(message.timing);
    if (hasGroupsCompletionSummary && message.timing) {
      const completedCount = message.successCount ?? 0;
      const failedCount = message.failedCount ?? 0;
      text.textContent = `Completed ${completedCount} Group ${completedCount === 1 ? "post" : "posts"} in ${formatPostingDurationSummary(message.timing.elapsedMs)}${failedCount > 0 ? ` \xB7 ${failedCount} failed` : ""}.`;
    }
    body.append(text);
    if (message.detail) {
      const detail = document.createElement("span");
      detail.className = "posting-progress__log-detail";
      detail.textContent = message.detail;
      body.append(detail);
    }
    const timingMeta = message.status === "done" || message.status === "stopped" || message.status === "rate_limited" ? hasGroupsCompletionSummary ? postingPausedTimeMeta(message.timing) : postingTimingLogMeta(message.timing, "queue") : message.status === "posted" || message.status === "pending" || message.status === "failed" ? postingTimingLogMeta(message.timing, "item") : "";
    if (count || message.error || timingMeta) {
      const meta = document.createElement("span");
      meta.className = "posting-progress__log-meta";
      meta.textContent = [count, timingMeta, message.error].filter(Boolean).join(" \xB7 ");
      body.append(meta);
    }
    const copyResponseButton = message.responseBody ? createFacebookResponseCopyButton(message.responseBody) : void 0;
    item.replaceChildren(
      badge,
      body,
      ...copyResponseButton ? [copyResponseButton] : []
    );
    if (!existingUpdatableItem) {
      postingProgressLog.prepend(item);
    }
    applyPostingLogFilter(
      postingProgressLog,
      groupsPostingLogFilter,
      postingProgressPostedFilterButton,
      postingProgressFailedFilterButton,
      postingProgressPendingFilterButton
    );
  }
  function getPostingStatusLabel(status) {
    switch (status) {
      case "posted":
        return "Done";
      case "pending":
        return "Pending";
      case "failed":
        return "Fail";
      case "rate_limited":
        return "Limit";
      case "waiting":
        return "Next";
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
      showToast("Sign in with Google to continue posting.", "warning");
      return;
    }
    if (!groupsList || !loadGroupsButton) {
      return;
    }
    loadGroupsButton.disabled = true;
    loadGroupsButton.textContent = "Loading...";
    updateGroupsStatus("Finding the groups you have joined...", 0);
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
    groupsList.textContent = "Opening Facebook to find the groups you have joined...";
    try {
      const response = await chrome.runtime.sendMessage({ type: "LOAD_GROUPS" });
      if (!response?.ok) {
        throw new Error(response?.error ?? "Unable to load groups.");
      }
      const groups = response.groups ?? [];
      revealCardFor(groupsList);
      renderGroups(groups);
      scheduleSaveSidePanelSession();
      updateGroupsStatus(
        `Finished loading ${groups.length} groups.`,
        groups.length
      );
    } catch (error) {
      updateGroupsStatus("Could not find your groups. Check that you are signed into Facebook and try again.", 0);
      if (groupsSelectAll) {
        groupsSelectAll.hidden = true;
      }
      if (groupsSelectAllCheckbox) {
        groupsSelectAllCheckbox.checked = false;
        groupsSelectAllCheckbox.indeterminate = false;
      }
      if (groupsSearchInput) {
        groupsSearchInput.disabled = true;
        const groupsSearchField = groupsSearchInput.closest(".field");
        if (groupsSearchField) {
          groupsSearchField.hidden = false;
        }
      }
      groupsList.className = "empty-state";
      groupsList.textContent = error instanceof Error ? error.message : "Unable to load groups.";
    } finally {
      loadGroupsButton.disabled = false;
      loadGroupsButton.textContent = "Find my groups";
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
  function showGroupsPhotoStatus(message, isError = false) {
    if (!groupsPhotoStatus) return;
    groupsPhotoStatus.hidden = false;
    groupsPhotoStatus.textContent = message;
    groupsPhotoStatus.classList.toggle(
      "marketplace-photo-status--error",
      isError
    );
  }
  function hideGroupsPhotoStatus() {
    if (!groupsPhotoStatus) return;
    groupsPhotoStatus.hidden = true;
    groupsPhotoStatus.textContent = "";
    groupsPhotoStatus.classList.remove("marketplace-photo-status--error");
  }
  function queueGroupPhotos(files) {
    groupPhotoAdditionQueue = groupPhotoAdditionQueue.then(() => addGroupPhotos(files)).catch((error) => {
      showGroupsPhotoStatus(
        error instanceof Error ? error.message : "Unable to add images.",
        true
      );
    });
  }
  async function addGroupPhotos(files) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const { uniqueImages, duplicateCount } = await removeDuplicateImages(
      imageFiles,
      selectedImageFiles
    );
    selectedImageFiles.push(...uniqueImages);
    syncPostImagesInput();
    renderImagePreviews();
    updatePreparedPostSaveButtonState();
    scheduleSaveSidePanelSession();
    const rejectedForType = files.length - imageFiles.length;
    if (rejectedForType > 0) {
      showGroupsPhotoStatus("Only image files can be added.", true);
    } else if (duplicateCount > 0) {
      showGroupsPhotoStatus(
        `${duplicateCount} duplicate ${duplicateCount === 1 ? "image was" : "images were"} skipped.`
      );
    } else {
      hideGroupsPhotoStatus();
    }
  }
  function removeSelectedImage(indexToRemove) {
    selectedImageFiles = selectedImageFiles.filter(
      (_file, index) => index !== indexToRemove
    );
    if (selectedImageFiles.length === 0) {
      imagePreviewsVisible = false;
    }
    syncPostImagesInput();
    renderImagePreviews();
    updatePreparedPostSaveButtonState();
    scheduleSaveSidePanelSession();
  }
  function renderImagePreviews() {
    if (!imagePreviewList) {
      return;
    }
    clearImagePreviewUrls();
    imagePreviewList.classList.toggle(
      "image-preview-list--grid",
      selectedImageFiles.length > 0
    );
    if (selectedImageFiles.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "empty-state";
      emptyState.textContent = "No images selected.";
      imagePreviewList.replaceChildren(emptyState);
      return;
    }
    const previews = selectedImageFiles.map((file, index) => {
      const previewUrl = URL.createObjectURL(file);
      selectedImagePreviewUrls.push(previewUrl);
      const preview = document.createElement("figure");
      preview.className = "marketplace-photo-preview groups-photo-preview";
      preview.draggable = true;
      preview.tabIndex = 0;
      preview.dataset.photoIndex = String(index);
      preview.setAttribute(
        "aria-label",
        `Image ${index + 1} of ${selectedImageFiles.length}. Click to preview or drag to reorder.`
      );
      const image = document.createElement("img");
      image.src = previewUrl;
      image.alt = file.name;
      image.draggable = false;
      image.addEventListener("click", () => {
        openGroupsPhotoLightbox(index, preview);
      });
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "marketplace-photo-preview__remove";
      removeButton.setAttribute("aria-label", `Remove ${file.name}`);
      const removeIcon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
      );
      removeIcon.setAttribute("width", "32");
      removeIcon.setAttribute("height", "32");
      removeIcon.setAttribute("fill", "currentColor");
      removeIcon.setAttribute("viewBox", "0 0 256 256");
      removeIcon.setAttribute("aria-hidden", "true");
      const removeIconPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      removeIconPath.setAttribute(
        "d",
        "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"
      );
      removeIcon.append(removeIconPath);
      removeButton.append(removeIcon);
      removeButton.addEventListener("click", () => {
        removeSelectedImage(index);
      });
      preview.addEventListener("dragstart", (event) => {
        if (event.target instanceof Element && event.target.closest("button")) {
          event.preventDefault();
          return;
        }
        draggedGroupPhotoIndex = index;
        preview.classList.add("marketplace-photo-preview--dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(index));
        }
      });
      preview.addEventListener("dragover", (event) => {
        if (draggedGroupPhotoIndex === void 0 || draggedGroupPhotoIndex === index) {
          return;
        }
        event.preventDefault();
        preview.classList.add("marketplace-photo-preview--drop-target");
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
      });
      preview.addEventListener("dragleave", () => {
        preview.classList.remove("marketplace-photo-preview--drop-target");
      });
      preview.addEventListener("drop", (event) => {
        event.preventDefault();
        preview.classList.remove("marketplace-photo-preview--drop-target");
        if (draggedGroupPhotoIndex !== void 0) {
          moveSelectedImage(draggedGroupPhotoIndex, index);
        }
      });
      preview.addEventListener("dragend", () => {
        draggedGroupPhotoIndex = void 0;
        imagePreviewList.querySelectorAll(".groups-photo-preview").forEach((candidate) => {
          candidate.classList.remove(
            "marketplace-photo-preview--dragging",
            "marketplace-photo-preview--drop-target"
          );
        });
      });
      preview.addEventListener("keydown", (event) => {
        if (event.target === preview && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          openGroupsPhotoLightbox(index, preview);
        }
      });
      preview.append(image, removeButton);
      return preview;
    });
    imagePreviewList.replaceChildren(...previews);
  }
  function moveSelectedImage(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= selectedImageFiles.length || toIndex >= selectedImageFiles.length) {
      return;
    }
    const [movedImage] = selectedImageFiles.splice(fromIndex, 1);
    if (!movedImage) {
      return;
    }
    selectedImageFiles.splice(toIndex, 0, movedImage);
    draggedGroupPhotoIndex = void 0;
    syncPostImagesInput();
    renderImagePreviews();
    scheduleSaveSidePanelSession();
  }
  function renderPreparedPosts() {
    if (!preparedPostsList) {
      return;
    }
    const selectedCount = preparedPosts.filter((post) => post.selected).length;
    if (preparedPostsCount) {
      preparedPostsCount.textContent = `${selectedCount} of ${preparedPosts.length} reusable posts selected`;
    }
    if (preparedPostsSelectAll) {
      preparedPostsSelectAll.hidden = preparedPosts.length === 0;
    }
    if (preparedPostsSelectAllCheckbox) {
      preparedPostsSelectAllCheckbox.checked = preparedPosts.length > 0 && selectedCount === preparedPosts.length;
      preparedPostsSelectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < preparedPosts.length;
    }
    if (preparedPosts.length === 0) {
      preparedPostsList.className = "empty-state";
      preparedPostsList.textContent = "Add your first reusable post above.";
      updatePostingReadiness();
      updatePreparedPostSaveButtonState();
      return;
    }
    const cards = preparedPosts.map((post) => {
      const card = document.createElement("article");
      card.className = "prepared-post-card";
      card.classList.toggle("prepared-post-card--selected", post.selected);
      const selection = document.createElement("label");
      selection.className = "prepared-post-card__selection";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = post.selected;
      checkbox.addEventListener("change", () => {
        post.selected = checkbox.checked;
        renderPreparedPosts();
        scheduleSaveSidePanelSession();
      });
      const thumbnail = document.createElement("div");
      thumbnail.className = "prepared-post-card__thumbnail";
      const firstImage = post.images[0];
      if (firstImage) {
        const thumbnailImage = document.createElement("img");
        thumbnailImage.src = firstImage.dataUrl;
        thumbnailImage.alt = "";
        thumbnailImage.loading = "lazy";
        thumbnail.append(thumbnailImage);
      } else {
        thumbnail.classList.add("prepared-post-card__thumbnail--empty");
        thumbnail.textContent = "Aa";
        thumbnail.setAttribute("aria-label", "Text-only post");
      }
      const title = document.createElement("strong");
      const titleExcerpt = Array.from(post.body.trim().replace(/\s+/g, " ")).slice(0, 50).join("").trimEnd();
      title.textContent = `${titleExcerpt}\u2026`;
      const mediaCount = document.createElement("span");
      mediaCount.textContent = `${post.images.length} ${post.images.length === 1 ? "image" : "images"}`;
      selection.append(checkbox, thumbnail, title, mediaCount);
      const excerpt = document.createElement("p");
      excerpt.className = "prepared-post-card__excerpt";
      excerpt.textContent = post.body;
      const actions = document.createElement("div");
      actions.className = "prepared-post-card__actions";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "button-89";
      editButton.textContent = "Edit";
      editButton.disabled = isMarketplacePostingActive;
      editButton.disabled = isMarketplacePostingActive;
      editButton.addEventListener("click", () => editPreparedPost(post.id));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "prepared-post-card__delete button-89 button-89--danger";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        void deletePreparedPost(post.id, deleteButton, card);
      });
      actions.append(editButton, deleteButton);
      card.append(selection, excerpt, actions);
      return card;
    });
    preparedPostsList.className = "prepared-posts-list";
    preparedPostsList.replaceChildren(...cards);
    updatePostingReadiness();
    updatePreparedPostSaveButtonState();
  }
  function editPreparedPost(postId) {
    const post = preparedPosts.find((candidate) => candidate.id === postId);
    if (!post || !postBodyInput) {
      return;
    }
    editingPreparedPostId = post.id;
    postBodyInput.value = post.body;
    selectedImageFiles = post.images.map(
      (image) => dataUrlToFile(image.dataUrl, image.name, image.type)
    );
    imagePreviewsVisible = false;
    syncPostImagesInput();
    renderImagePreviews();
    if (savePreparedPostButton) {
      savePreparedPostButton.textContent = "Save";
    }
    updatePreparedPostSaveButtonState();
    if (cancelPostEditButton) {
      cancelPostEditButton.hidden = false;
    }
    revealCardFor(postBodyInput);
    postBodyInput.focus();
    postBodyInput.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  async function deletePreparedPost(postId, button, card) {
    const confirmed = await requestDeleteConfirmation(
      "Delete reusable post?",
      "This permanently removes the reusable post and all of its photos."
    );
    if (!confirmed) {
      return;
    }
    button.disabled = true;
    button.textContent = "Deleting\u2026";
    card.classList.add("prepared-post-card--deleting");
    card.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(
        `${AUTH_API_BASE_URL}/api/group-posts/${encodeURIComponent(postId)}`,
        { method: "DELETE", headers: authenticatedRequestHeaders() }
      );
      if (!response.ok) {
        throw new Error(await readApiError(response, "Unable to delete post."));
      }
      preparedPosts = preparedPosts.filter((post) => post.id !== postId);
      if (editingPreparedPostId === postId) {
        clearPreparedPostEditor();
      }
      card.remove();
      renderPreparedPosts();
      await refreshAccessEntitlements();
      showToast("Reusable post deleted.", "success");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Delete";
      card.classList.remove("prepared-post-card--deleting");
      card.removeAttribute("aria-busy");
      showToast(
        error instanceof Error ? error.message : "Unable to delete post.",
        "error"
      );
    }
  }
  function clearPreparedPostEditor() {
    editingPreparedPostId = void 0;
    if (postBodyInput) {
      postBodyInput.value = "";
    }
    selectedImageFiles = [];
    imagePreviewsVisible = false;
    syncPostImagesInput();
    renderImagePreviews();
    hideGroupsPhotoStatus();
    if (savePreparedPostButton) {
      savePreparedPostButton.textContent = "Save";
    }
    updatePreparedPostSaveButtonState();
    if (cancelPostEditButton) {
      cancelPostEditButton.hidden = true;
    }
  }
  async function savePreparedPost() {
    const body = postBodyInput?.value.trim() ?? "";
    if (!body || selectedImageFiles.length === 0) {
      showToast(
        "Add a post body and at least one image before saving the reusable post.",
        "warning"
      );
      return;
    }
    if (savePreparedPostButton) {
      savePreparedPostButton.disabled = true;
      savePreparedPostButton.textContent = "Saving...";
    }
    try {
      const form = new FormData();
      form.set("body", body);
      selectedImageFiles.forEach(
        (file) => form.append("images", file, file.name)
      );
      const editingId = editingPreparedPostId;
      const response = await fetch(
        editingId ? `${AUTH_API_BASE_URL}/api/group-posts/${encodeURIComponent(editingId)}` : `${AUTH_API_BASE_URL}/api/group-posts`,
        {
          method: editingId ? "PUT" : "POST",
          headers: authenticatedRequestHeaders(),
          body: form
        }
      );
      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Unable to save the reusable post.")
        );
      }
      clearPreparedPostEditor();
      await Promise.all([loadCloudPreparedPosts(), refreshAccessEntitlements()]);
      showToast(
        editingId ? "Reusable post updated." : "Reusable post added.",
        "success"
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to save the reusable post.",
        "error"
      );
      if (savePreparedPostButton) {
        savePreparedPostButton.textContent = "Save";
        updatePreparedPostSaveButtonState();
      }
    }
  }
  async function loadCloudPreparedPosts() {
    try {
      const response = await fetch(`${AUTH_API_BASE_URL}/api/group-posts`, {
        headers: authenticatedRequestHeaders()
      });
      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Unable to load reusable posts.")
        );
      }
      const payload = await response.json();
      const posts = Array.isArray(payload.posts) ? payload.posts : [];
      preparedPosts = await Promise.all(
        posts.map(async (post) => ({
          id: post.id,
          body: post.body,
          images: await Promise.all(
            [...post.images].sort((left, right) => left.position - right.position).map(cloudImageToUiPostImage)
          ),
          selected: true
        }))
      );
      renderPreparedPosts();
    } catch (error) {
      console.error("Unable to load reusable posts", error);
      showToast(
        error instanceof Error ? error.message : "Unable to load reusable posts.",
        "error"
      );
    }
  }
  async function cloudImageToUiPostImage(image) {
    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error("Unable to download a reusable post image.");
    }
    const blob = await response.blob();
    const pathname = new URL(image.url).pathname;
    const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1)) || "prepared-post-image";
    return fileToUiPostImage(new File([blob], name, { type: blob.type }));
  }
  async function readApiError(response, fallback) {
    const payload = await response.json().catch(() => ({}));
    return payload.error ?? fallback;
  }
  postImagesInput?.addEventListener("change", () => {
    queueGroupPhotos(Array.from(postImagesInput.files ?? []));
  });
  postBodyInput?.addEventListener("input", () => {
    updatePreparedPostSaveButtonState();
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
    if (event.relatedTarget instanceof Node && groupsPhotoDropzone.contains(event.relatedTarget)) {
      return;
    }
    groupsPhotoDropzone.classList.remove("groups-photo-dropzone--dragging");
  });
  groupsPhotoDropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    groupsPhotoDropzone.classList.remove("groups-photo-dropzone--dragging");
    queueGroupPhotos(Array.from(event.dataTransfer?.files ?? []));
  });
  savePreparedPostButton?.addEventListener("click", () => {
    void savePreparedPost();
  });
  cancelPostEditButton?.addEventListener("click", () => {
    clearPreparedPostEditor();
    scheduleSaveSidePanelSession();
  });
  preparedPostsSelectAllCheckbox?.addEventListener("change", () => {
    const selected = preparedPostsSelectAllCheckbox.checked;
    preparedPosts.forEach((post) => {
      post.selected = selected;
    });
    renderPreparedPosts();
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
  marketplaceListingsSelectAllCheckbox?.addEventListener("change", () => {
    const itemIds = savedMarketplaceListings.filter(isSupportedMarketplacePostingListing).map((listing) => listing.id);
    if (marketplaceListingsSelectAllCheckbox.checked) {
      selectedMarketplaceListingIds = new Set(itemIds);
    } else {
      selectedMarketplaceListingIds.clear();
    }
    renderMarketplaceListings();
  });
  marketplaceCleanupDaysInput?.addEventListener("input", () => {
    const digitsOnly = marketplaceCleanupDaysInput.value.replace(/[^0-9]/g, "");
    if (marketplaceCleanupDaysInput.value !== digitsOnly) {
      marketplaceCleanupDaysInput.value = digitsOnly;
    }
    updateMarketplaceCleanupControls();
  });
  deleteOldMarketplaceListingsButton?.addEventListener("click", async () => {
    const rawDays = marketplaceCleanupDaysInput?.value.trim() ?? "";
    const daysOld = Number(rawDays);
    if (!/^\d+$/.test(rawDays) || !Number.isSafeInteger(daysOld) || daysOld < 0) {
      updateMarketplaceCleanupControls();
      return;
    }
    const confirmed = await requestDeleteConfirmation(
      "Delete old Marketplace listings?",
      daysOld === 0 ? "This permanently deletes every active listing currently found in your Facebook Marketplace account, including listings created today. This cannot be undone." : `This permanently deletes every active listing in your Facebook Marketplace account that is older than ${daysOld} ${daysOld === 1 ? "day" : "days"}. This cannot be undone.`
    );
    if (!confirmed) return;
    isMarketplaceCleanupActive = true;
    if (marketplaceCleanupProgress) marketplaceCleanupProgress.hidden = false;
    marketplaceCleanupLog?.replaceChildren();
    if (marketplaceCleanupCount)
      marketplaceCleanupCount.textContent = "0 listings scanned";
    if (marketplaceCleanupPercent) marketplaceCleanupPercent.textContent = "0%";
    if (marketplaceCleanupProgressBar)
      marketplaceCleanupProgressBar.style.width = "0%";
    if (marketplaceCleanupDeleted) marketplaceCleanupDeleted.textContent = "0";
    if (marketplaceCleanupFailed) marketplaceCleanupFailed.textContent = "0";
    if (marketplaceCleanupRemaining)
      marketplaceCleanupRemaining.textContent = "0";
    if (marketplaceCleanupMessage) {
      marketplaceCleanupMessage.textContent = "Preparing Marketplace cleanup\u2026";
    }
    updateMarketplaceCleanupControls();
    renderMarketplaceListings();
    scrollProgressPanelToBottom(marketplaceCleanupProgress);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "DELETE_OLD_MARKETPLACE_LISTINGS",
        daysOld
      });
      if (!response?.ok) {
        throw new Error(
          response?.error ?? "Unable to start Marketplace cleanup."
        );
      }
    } catch (error) {
      isMarketplaceCleanupActive = false;
      if (marketplaceCleanupMessage) {
        marketplaceCleanupMessage.textContent = error instanceof Error ? error.message : "Unable to start Marketplace cleanup.";
      }
      updateMarketplaceCleanupControls();
      renderMarketplaceListings();
    }
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
  marketplaceProgressPostedFilterButton?.addEventListener("click", () => {
    toggleMarketplacePostingLogFilter("posted");
  });
  marketplaceProgressFailedFilterButton?.addEventListener("click", () => {
    toggleMarketplacePostingLogFilter("failed");
  });
  marketplaceIntervalMinInput?.addEventListener("change", () => {
    normalizeMarketplacePostingInterval();
    void saveMarketplacePostingSettings();
  });
  marketplaceIntervalMaxInput?.addEventListener("change", () => {
    normalizeMarketplacePostingInterval();
    void saveMarketplacePostingSettings();
  });
  marketplaceGeminiApiKeyInput?.addEventListener("input", () => {
    if (geminiApiKeyInput) {
      geminiApiKeyInput.value = marketplaceGeminiApiKeyInput.value;
    }
  });
  marketplaceGeminiApiKeyInput?.addEventListener("change", () => {
    void saveMarketplacePostingSettings();
  });
  marketplaceGeminiApiKeyInput?.addEventListener("blur", () => {
    void saveMarketplacePostingSettings();
  });
  marketplaceGeminiPromptInput?.addEventListener("change", () => {
    void saveMarketplacePostingSettings();
  });
  marketplaceGeminiPromptInput?.addEventListener("blur", () => {
    void saveMarketplacePostingSettings();
  });
  marketplaceGeminiRewriteToggle?.addEventListener("change", () => {
    void saveMarketplacePostingSettings();
  });
  marketplaceShuffleItemsToggle?.addEventListener("change", () => {
    void saveMarketplacePostingSettings();
  });
  postSelectedMarketplaceItemsButton?.addEventListener("click", () => {
    const selectedListings = savedMarketplaceListings.filter(
      (listing) => isSupportedMarketplacePostingListing(listing) && selectedMarketplaceListingIds.has(listing.id)
    );
    void startMarketplaceItemQueue(selectedListings).catch((error) => {
      showMarketplaceSaveListingStatus(
        error instanceof Error ? error.message : "Could not start Marketplace posting. Please try again.",
        true
      );
      if (marketplacePostingStatusMessage) {
        marketplacePostingStatusMessage.textContent = error instanceof Error ? error.message : "Could not start Marketplace posting. Please try again.";
      }
    });
  });
  pauseMarketplacePostingButton?.addEventListener("click", async () => {
    if (!isMarketplacePostingActive || isMarketplacePauseRequestPending || isMarketplaceStopRequestPending) {
      return;
    }
    const shouldResume = isMarketplacePostingPaused;
    isMarketplacePauseRequestPending = true;
    setMarketplacePostingActive(true);
    try {
      const request = {
        type: shouldResume ? "RESUME_MARKETPLACE_POSTING" : "PAUSE_MARKETPLACE_POSTING"
      };
      const response = await chrome.runtime.sendMessage(request);
      if (!response?.ok) {
        throw new Error(response?.error ?? "Could not pause or resume Marketplace posting. Please try again.");
      }
      isMarketplacePostingPaused = !shouldResume;
    } catch (error) {
      if (marketplacePostingStatusMessage) {
        marketplacePostingStatusMessage.textContent = error instanceof Error ? error.message : "Could not pause or resume Marketplace posting. Please try again.";
      }
    } finally {
      isMarketplacePauseRequestPending = false;
      setMarketplacePostingActive(isMarketplacePostingActive);
    }
  });
  stopMarketplacePostingButton?.addEventListener("click", async () => {
    if (!isMarketplacePostingActive || isMarketplaceStopRequestPending) {
      return;
    }
    isMarketplaceStopRequestPending = true;
    setMarketplacePostingActive(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "STOP_MARKETPLACE_POSTING" });
      if (!response?.ok) {
        throw new Error(response?.error ?? "Could not stop Marketplace posting. Please try again.");
      }
    } catch (error) {
      isMarketplaceStopRequestPending = false;
      if (marketplacePostingStatusMessage) {
        marketplacePostingStatusMessage.textContent = error instanceof Error ? error.message : "Could not stop Marketplace posting. Please try again.";
      }
      setMarketplacePostingActive(true);
    }
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
  geminiCustomPromptInput?.addEventListener("change", () => {
    void saveGeminiCustomPrompt();
  });
  geminiCustomPromptInput?.addEventListener("blur", () => {
    void saveGeminiCustomPrompt();
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
      proMaxPostsPreference = DEFAULT_MAX_POSTS;
    } else if (currentExtensionAccess?.access.tier !== "free") {
      proMaxPostsPreference = value;
    }
    updatePostingReadiness();
    scheduleSaveSidePanelSession();
  });
  function setGroupCommentSyncStatus(message, retry = false) {
    if (groupCommentSyncStatus) groupCommentSyncStatus.textContent = message;
    if (groupCommentRetryButton) groupCommentRetryButton.hidden = !retry;
  }
  function parseGroupCommentSettings(value) {
    if (!value || typeof value !== "object") return void 0;
    const settings = value;
    if (typeof settings.enabled !== "boolean" || !Array.isArray(settings.options) || !settings.options.every((option) => typeof option === "string")) return void 0;
    return { enabled: settings.enabled, options: settings.options };
  }
  async function loadCloudGroupCommentSettings() {
    const access = currentExtensionAccess;
    if (!access?.active) return;
    const generation = ++groupCommentSettingsGeneration;
    groupCommentSettingsLoaded = false;
    groupCommentOptions = [...DEFAULT_GROUP_COMMENT_OPTIONS];
    if (groupCommentEnabledToggle) groupCommentEnabledToggle.checked = false;
    renderGroupCommentOptions();
    setGroupCommentSyncStatus("Loading your saved comments\u2026");
    try {
      await groupCommentSaveQueue;
      if (generation !== groupCommentSettingsGeneration) return;
      const headers = { Authorization: `Bearer ${access.sessionToken}` };
      const response = await fetch(`${AUTH_API_BASE_URL}/api/group-comment-settings`, { headers });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load comment settings.");
      let settings = parseGroupCommentSettings(payload.settings);
      if (payload.settings === null) {
        if (generation !== groupCommentSettingsGeneration) return;
        const initial = legacyGroupCommentSettings?.ownerUserId === access.user.id ? { enabled: legacyGroupCommentSettings.enabled, options: [...legacyGroupCommentSettings.options] } : { enabled: false, options: [...DEFAULT_GROUP_COMMENT_OPTIONS] };
        const created = await fetch(`${AUTH_API_BASE_URL}/api/group-comment-settings`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(initial)
        });
        const result = await created.json();
        if (!created.ok) throw new Error(result.error ?? "Unable to save comment settings.");
        settings = parseGroupCommentSettings(result.settings);
      }
      if (!settings) throw new Error("Invalid comment settings response.");
      if (generation !== groupCommentSettingsGeneration || currentExtensionAccess?.user.id !== access.user.id) return;
      groupCommentOptions = settings.options.length ? settings.options : [""];
      if (groupCommentEnabledToggle) groupCommentEnabledToggle.checked = settings.enabled;
      groupCommentSettingsLoaded = true;
      groupCommentSavedVersion = groupCommentEditVersion;
      if (legacyGroupCommentSettings?.ownerUserId === access.user.id) legacyGroupCommentSettings = void 0;
      renderGroupCommentOptions();
      setGroupCommentSyncStatus("Saved to your Google account.");
      await saveSidePanelSession();
    } catch (error) {
      if (generation !== groupCommentSettingsGeneration) return;
      setGroupCommentSyncStatus(error instanceof Error ? error.message : "Unable to load comments.", true);
    }
  }
  function scheduleSaveGroupCommentSettings() {
    groupCommentEditVersion++;
    setGroupCommentSyncStatus("Unsaved changes\u2026");
    if (groupCommentSaveTimer !== void 0) window.clearTimeout(groupCommentSaveTimer);
    groupCommentSaveTimer = window.setTimeout(() => {
      groupCommentSaveTimer = void 0;
      void flushGroupCommentSettingsSave();
    }, 500);
  }
  function flushGroupCommentSettingsSave() {
    if (groupCommentSaveTimer !== void 0) {
      window.clearTimeout(groupCommentSaveTimer);
      groupCommentSaveTimer = void 0;
    }
    const access = currentExtensionAccess;
    if (!groupCommentSettingsLoaded || !access?.active) return groupCommentSaveQueue;
    if (groupCommentEditVersion === groupCommentSavedVersion) return groupCommentSaveQueue;
    const generation = groupCommentSettingsGeneration;
    const version = groupCommentEditVersion;
    const settings = {
      enabled: Boolean(groupCommentEnabledToggle?.checked),
      options: [...groupCommentOptions]
    };
    const body = JSON.stringify(settings);
    groupCommentSaveQueue = groupCommentSaveQueue.then(async () => {
      if (generation !== groupCommentSettingsGeneration || version <= groupCommentSavedVersion) return;
      setGroupCommentSyncStatus("Saving to your account\u2026");
      try {
        const response = await fetch(`${AUTH_API_BASE_URL}/api/group-comment-settings`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${access.sessionToken}`, "Content-Type": "application/json" },
          body,
          keepalive: new TextEncoder().encode(body).byteLength <= 6e4
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? "Unable to save comments.");
        }
        if (generation === groupCommentSettingsGeneration) groupCommentSavedVersion = version;
        if (generation === groupCommentSettingsGeneration && version === groupCommentEditVersion) {
          setGroupCommentSyncStatus("Saved to your Google account.");
        }
      } catch (error) {
        if (generation === groupCommentSettingsGeneration && version === groupCommentEditVersion) {
          setGroupCommentSyncStatus(error instanceof Error ? `${error.message} Changes aren't saved yet.` : "Changes aren't saved yet.", true);
        }
      }
    });
    return groupCommentSaveQueue;
  }
  groupCommentRetryButton?.addEventListener("click", () => {
    if (groupCommentSettingsLoaded) void flushGroupCommentSettingsSave();
    else void loadCloudGroupCommentSettings();
  });
  function updateGroupCommentSettings() {
    if (groupCommentEnabledToggle) {
      groupCommentEnabledToggle.disabled = !groupCommentSettingsLoaded;
    }
    const enabled = groupCommentSettingsLoaded && Boolean(groupCommentEnabledToggle?.checked);
    groupCommentOptionsContainer?.querySelectorAll("textarea, button").forEach((control) => {
      control.disabled = !enabled;
    });
    if (groupCommentAddButton) {
      groupCommentAddButton.disabled = !enabled;
    }
  }
  function renderGroupCommentOptions() {
    if (!groupCommentOptionsContainer) return;
    groupCommentOptionsContainer.replaceChildren();
    const count = document.querySelector("#group-comment-options-count");
    if (count) {
      count.textContent = `${groupCommentOptions.length} ${groupCommentOptions.length === 1 ? "option" : "options"}`;
    }
    groupCommentOptions.forEach((text, index) => {
      const field = document.createElement("div");
      field.className = "field group-comment-option";
      const heading = document.createElement("div");
      heading.className = "group-comment-option__heading";
      const label = document.createElement("label");
      label.htmlFor = `group-comment-option-${index}`;
      const number = document.createElement("span");
      number.className = "group-comment-option__number";
      number.textContent = String(index + 1).padStart(2, "0");
      label.append(number, document.createTextNode(`Comment ${index + 1}`));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "group-comment-button group-comment-option__remove button-89";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove comment option ${index + 1}`);
      remove.addEventListener("click", () => {
        groupCommentOptions.splice(index, 1);
        if (groupCommentOptions.length === 0) groupCommentOptions.push("");
        renderGroupCommentOptions();
        groupCommentOptionsContainer?.querySelector(`#group-comment-option-${Math.min(index, groupCommentOptions.length - 1)}`)?.focus();
        scheduleSaveGroupCommentSettings();
      });
      const input = document.createElement("textarea");
      input.id = label.htmlFor;
      input.rows = 4;
      input.maxLength = 1e4;
      input.value = text;
      input.placeholder = "Write the comment you want to add to your posts...";
      input.spellcheck = true;
      input.setAttribute("aria-describedby", "group-comment-note");
      input.addEventListener("input", () => {
        groupCommentOptions[index] = input.value;
        scheduleSaveGroupCommentSettings();
      });
      input.addEventListener("change", () => {
        void flushGroupCommentSettingsSave();
      });
      heading.append(label, remove);
      field.append(heading, input);
      groupCommentOptionsContainer.append(field);
    });
    updateGroupCommentSettings();
  }
  groupCommentEnabledToggle?.addEventListener("change", () => {
    updateGroupCommentSettings();
    scheduleSaveGroupCommentSettings();
  });
  groupCommentAddButton?.addEventListener("click", () => {
    if (groupCommentOptions.length >= 50) {
      showToast("You can add up to 50 comment options.", "warning");
      return;
    }
    groupCommentOptions.push("");
    renderGroupCommentOptions();
    groupCommentOptionsContainer?.querySelector(`#group-comment-option-${groupCommentOptions.length - 1}`)?.focus();
    scheduleSaveGroupCommentSettings();
  });
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
      const request = {
        type: shouldResume ? "RESUME_UI_POSTING" : "PAUSE_UI_POSTING"
      };
      const response = await chrome.runtime.sendMessage(request);
      if (!response?.ok) {
        throw new Error(
          response?.error ?? (shouldResume ? "Unable to resume posting." : "Unable to pause posting.")
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
        error instanceof Error ? error.message : shouldResume ? "Unable to resume posting." : "Unable to pause posting.",
        "error"
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
      const response = await chrome.runtime.sendMessage({
        type: "STOP_UI_POSTING"
      });
      if (!response?.ok) {
        throw new Error(response?.error ?? "Unable to stop posting.");
      }
    } catch (error) {
      isStopRequestPending = false;
      updatePostingButtonState();
      showToast(
        error instanceof Error ? error.message : "Unable to stop posting.",
        "error"
      );
    }
  });
  startPostingButton?.addEventListener("click", async () => {
    if (isPostingActive) {
      return;
    }
    if (!hasActiveExtensionAccess()) {
      showToast("Sign in with Google to continue posting.", "warning");
      return;
    }
    if (!startPostingButton) {
      return;
    }
    const selectedGroupIdList = Array.from(selectedGroupIds);
    if (selectedGroupIdList.length === 0) {
      showToast("Please select at least one group.", "warning");
      return;
    }
    const selectedPreparedPosts = preparedPosts.filter((post) => post.selected);
    if (selectedPreparedPosts.length === 0) {
      showToast("Please add and select at least one reusable post.", "warning");
      return;
    }
    const minimumDelaySeconds = Number(
      postIntervalMinInput?.value ?? MIN_SLEEP_SECONDS
    );
    const maximumDelaySeconds = Number(
      postIntervalMaxInput?.value ?? DEFAULT_MAX_SLEEP_SECONDS
    );
    if (!isValidPostingInterval(minimumDelaySeconds, maximumDelaySeconds)) {
      showToast(
        `Enter whole numbers of at least ${MIN_SLEEP_SECONDS} seconds for both waits. The longest wait must be at least as long as the shortest wait.`,
        "warning"
      );
      return;
    }
    let maxPosts = Number(maxPostsInput?.value ?? DEFAULT_MAX_POSTS);
    if (!Number.isInteger(maxPosts) || maxPosts < MIN_MAX_POSTS) {
      showToast(
        "Enter a whole number of at least 1 for the number of posts to submit.",
        "warning"
      );
      return;
    }
    try {
      const access = await refreshAccessEntitlements();
      const remaining = access.remaining.group_posts_today;
      if (remaining === 0) {
        const nextSlot = access.reset_at.group_posts_today ? ` The allowance resets ${formatAccessResetTime(access.reset_at.group_posts_today)}.` : "";
        showToast(
          `Your Free account has used all ${FREE_MAX_GROUP_POSTS} Group posts for today.${nextSlot}`,
          "warning"
        );
        return;
      }
      if (access.tier === "free" && remaining !== null) {
        maxPosts = Math.min(FREE_MAX_GROUP_POSTS, remaining);
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not check how many posts you have left. Please try again.",
        "error"
      );
      return;
    }
    const selectedGroups = groupsInSelectionOrder(loadedGroups, selectedGroupIdList);
    if (selectedGroups.length === 0) {
      showToast(
        "Your selected groups are no longer available. Click Find my groups, select them again, and try posting.",
        "warning"
      );
      return;
    }
    if (groupCommentEnabledToggle?.checked && !groupCommentOptions.some((option) => option.trim())) {
      showToast("Write at least one comment, or turn off comments before starting.", "warning");
      return;
    }
    const postingStartedAt = Date.now();
    const postingGroups = selectedGroups;
    const postingPreparedPosts = selectedPreparedPosts;
    isPostingActive = true;
    isPostingPaused = false;
    isStopRequestPending = false;
    isPauseResumeRequestPending = false;
    updatePostingButtonState();
    updateGroupsStatus("Getting ready to post...", 0);
    resetPostingProgress(postingGroups.length, maxPosts);
    latestGroupsPostingTiming = createPendingPostingTiming(postingStartedAt);
    renderPostingTiming(latestGroupsPostingTiming, groupsPostingTimingElements);
    scrollPostingProgressIntoView();
    try {
      await saveGeminiCustomPrompt();
      const watermark = await watermarkControls.snapshot();
      const posts = [];
      for (const { id, body, images } of postingPreparedPosts) {
        const watermarkedImages = [];
        for (const image of images) {
          watermarkedImages.push(await watermarkImage(image, watermark));
        }
        posts.push({ id, body, images: watermarkedImages });
      }
      const request = {
        type: "START_UI_POSTING",
        startedAt: postingStartedAt,
        groups: postingGroups.map((group) => ({
          id: group.id,
          name: group.name,
          url: group.url
        })),
        posts,
        minimumDelaySeconds,
        maximumDelaySeconds,
        maxPosts,
        groupCommentEnabled: groupCommentSettingsLoaded && Boolean(groupCommentEnabledToggle?.checked),
        groupCommentOptions: [...groupCommentOptions]
      };
      const response = await chrome.runtime.sendMessage(request);
      if (!response?.ok) {
        throw new Error(response?.error ?? "Could not start posting. Please try again.");
      }
    } catch (error) {
      if (latestGroupsPostingTiming) {
        latestGroupsPostingTiming = finishPendingPostingTiming(
          latestGroupsPostingTiming
        );
        renderPostingTiming(
          latestGroupsPostingTiming,
          groupsPostingTimingElements
        );
      }
      isPostingActive = false;
      isPostingPaused = false;
      isStopRequestPending = false;
      isPauseResumeRequestPending = false;
      updatePostingReadiness();
      showToast(
        error instanceof Error ? error.message : "Could not start posting. Please try again.",
        "error"
      );
    }
  });
  updatePostingReadiness();
  updateGeminiStatus();
  window.addEventListener("beforeunload", () => {
    flushSidePanelSessionSave();
    void flushGroupCommentSettingsSave();
    clearImagePreviewUrls();
  });
  authLoginButton?.addEventListener("click", () => {
    void signInWithGoogle();
  });
  authLogoutButton?.addEventListener("click", () => {
    void signOutGoogleUser();
  });
  function hasActiveExtensionAccess() {
    return currentExtensionAccess?.active === true;
  }
  async function initializeExtensionAccess() {
    setAccessBusyState("Checking your Google account...");
    try {
      const storage = await chrome.storage.local.get([
        AUTH_SESSION_STORAGE_KEY,
        AUTH_SIGNED_OUT_STORAGE_KEY
      ]);
      const storedSession = parseStoredAuthSession(
        storage[AUTH_SESSION_STORAGE_KEY]
      );
      if (storedSession && await restoreApplicationSession(storedSession)) {
        updateExtensionAccessUi();
        return;
      }
      if (storage[AUTH_SIGNED_OUT_STORAGE_KEY] === true) {
        showSignedOut(
          "Save your posts and listings, choose where to share them, and let Postika post them for you."
        );
        return;
      }
      await exchangeGoogleIdentityToken(false);
    } catch (error) {
      currentExtensionAccess = void 0;
      showSignedOut(googleSignInErrorMessage(error, false));
    }
  }
  async function signInWithGoogle() {
    setAccessBusyState("Opening Google sign-in...");
    try {
      await exchangeGoogleIdentityToken(true);
      await Promise.all([loadCloudPreparedPosts(), loadMarketplaceListings(), loadCloudGroupCommentSettings()]);
    } catch (error) {
      currentExtensionAccess = void 0;
      showSignedOut(googleSignInErrorMessage(error, true));
    }
  }
  async function exchangeGoogleIdentityToken(interactive) {
    const result = await chrome.identity.getAuthToken({ interactive });
    const googleToken = typeof result === "string" ? result : result?.token?.trim();
    if (!googleToken) {
      throw new Error(
        interactive ? "We couldn't complete Google sign-in. Please try again." : "Save your posts and listings, choose where to share them, and let Postika post them for you."
      );
    }
    currentGoogleAccessToken = googleToken;
    const response = await fetch(`${AUTH_API_BASE_URL}/api/auth/google`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${googleToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.session_token || !payload.expires_at || !payload.user?.id || !payload.user.email || !payload.access) {
      throw new Error(
        payload.error ?? `Google sign-in failed with HTTP ${response.status} at ${AUTH_API_BASE_URL}.`
      );
    }
    const user = {
      id: payload.user.id,
      email: payload.user.email,
      emailVerified: payload.user.email_verified === true,
      displayName: payload.user.display_name,
      avatarUrl: payload.user.avatar_url,
      timezone: payload.user.timezone
    };
    const storedSession = {
      sessionToken: payload.session_token,
      expiresAt: payload.expires_at,
      user
    };
    currentExtensionAccess = {
      active: true,
      ...storedSession,
      access: payload.access
    };
    await chrome.storage.local.set({
      [AUTH_SESSION_STORAGE_KEY]: storedSession
    });
    await chrome.storage.local.remove(AUTH_SIGNED_OUT_STORAGE_KEY);
    updateExtensionAccessUi();
  }
  async function restoreApplicationSession(session) {
    const response = await fetch(`${AUTH_API_BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${session.sessionToken}` }
    });
    if (!response.ok) {
      await chrome.storage.local.remove(AUTH_SESSION_STORAGE_KEY);
      return false;
    }
    const payload = await response.json();
    if (!payload.user?.id || !payload.user.email || !payload.access) {
      await chrome.storage.local.remove(AUTH_SESSION_STORAGE_KEY);
      return false;
    }
    currentExtensionAccess = {
      active: true,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      user: {
        id: payload.user.id,
        email: payload.user.email,
        emailVerified: payload.user.email_verified === true,
        displayName: payload.user.display_name,
        avatarUrl: payload.user.avatar_url,
        timezone: payload.user.timezone
      },
      access: payload.access
    };
    return true;
  }
  function parseStoredAuthSession(value) {
    if (!value || typeof value !== "object") {
      return void 0;
    }
    const session = value;
    if (typeof session.sessionToken !== "string" || typeof session.expiresAt !== "string" || !session.user || typeof session.user.id !== "string" || typeof session.user.email !== "string") {
      return void 0;
    }
    return session;
  }
  async function signOutGoogleUser() {
    setAccessBusyState("Signing out...");
    await flushGroupCommentSettingsSave();
    groupCommentSettingsGeneration++;
    groupCommentSettingsLoaded = false;
    groupCommentOptions = [...DEFAULT_GROUP_COMMENT_OPTIONS];
    if (groupCommentEnabledToggle) groupCommentEnabledToggle.checked = false;
    renderGroupCommentOptions();
    setGroupCommentSyncStatus("Sign in to save comments to your account.");
    const appSessionToken = currentExtensionAccess?.sessionToken;
    if (appSessionToken) {
      await fetch(`${AUTH_API_BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${appSessionToken}` }
      }).catch(() => void 0);
    }
    await chrome.storage.local.remove(AUTH_SESSION_STORAGE_KEY);
    await chrome.storage.local.set({ [AUTH_SIGNED_OUT_STORAGE_KEY]: true });
    let googleToken = currentGoogleAccessToken;
    if (!googleToken) {
      const result = await chrome.identity.getAuthToken({ interactive: false }).catch(() => void 0);
      googleToken = typeof result === "string" ? result : result?.token;
    }
    if (googleToken) {
      await chrome.identity.removeCachedAuthToken({ token: googleToken });
    }
    currentGoogleAccessToken = void 0;
    currentExtensionAccess = void 0;
    preparedPosts = [];
    savedMarketplaceListings = [];
    selectedMarketplaceListingIds.clear();
    renderPreparedPosts();
    renderMarketplaceListings();
    showSignedOut(
      "You're signed out. Continue with Google whenever you're ready."
    );
  }
  function authenticatedRequestHeaders() {
    const sessionToken = currentExtensionAccess?.sessionToken;
    if (!sessionToken) {
      throw new Error("Sign in with Google to continue.");
    }
    return { Authorization: `Bearer ${sessionToken}` };
  }
  async function refreshAccessEntitlements() {
    if (!currentExtensionAccess) {
      throw new Error("Sign in with Google to continue.");
    }
    const response = await fetch(`${AUTH_API_BASE_URL}/api/me`, {
      headers: authenticatedRequestHeaders()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access) {
      throw new Error(
        payload.error ?? "Unable to refresh your account allowance."
      );
    }
    currentExtensionAccess.access = payload.access;
    updateExtensionAccessUi();
    return payload.access;
  }
  function formatAccessUsage(used, limit) {
    return limit === null ? "Unlimited" : `${used} of ${limit}`;
  }
  function renderAccessMeter(elements, used, limit) {
    const { value, meter } = elements;
    if (value) {
      value.textContent = formatAccessUsage(used, limit);
    }
    if (!meter) {
      return;
    }
    const percentage = limit === null ? 100 : limit <= 0 ? used > 0 ? 100 : 0 : Math.min(100, Math.max(0, used / limit * 100));
    meter.style.setProperty("--access-progress", `${percentage}%`);
    meter.classList.toggle("access-meter__track--warning", percentage >= 80);
    meter.classList.toggle("access-meter__track--full", percentage >= 100);
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuenow", String(used));
    meter.setAttribute("aria-valuetext", formatAccessUsage(used, limit));
    if (limit === null) {
      meter.removeAttribute("aria-valuemax");
    } else {
      meter.setAttribute("aria-valuemax", String(limit));
    }
  }
  function formatAccessResetTime(value) {
    const timezone = currentExtensionAccess?.user.timezone ?? "UTC";
    const reset = new Date(value);
    if (Number.isNaN(reset.getTime())) {
      return `midnight (${timezone})`;
    }
    try {
      return `${new Intl.DateTimeFormat(void 0, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone
      }).format(reset)} (${timezone})`;
    } catch {
      return reset.toLocaleString();
    }
  }
  function renderAccessSummary(access) {
    if (accessSummary) {
      accessSummary.hidden = !access;
    }
    if (!access) {
      if (accessUpgrade) {
        accessUpgrade.hidden = true;
      }
      return;
    }
    if (accessUpgrade) {
      accessUpgrade.hidden = access.tier !== "free";
    }
    if (accessTierBadge) {
      accessTierBadge.textContent = access.tier.toUpperCase();
    }
    accessSummary?.classList.toggle("access-summary--pro", access.tier === "pro");
    if (accessUsageDashboard) {
      accessUsageDashboard.hidden = access.tier === "pro";
    }
    if (accessProSummary) {
      accessProSummary.hidden = access.tier !== "pro";
    }
    if (access.tier !== "pro") {
      renderAccessMeter(
        accessMeters.savedGroupPosts,
        access.usage.saved_group_posts,
        access.limits.saved_group_posts
      );
      renderAccessMeter(
        accessMeters.savedMarketplaceListings,
        access.usage.saved_marketplace_listings,
        access.limits.saved_marketplace_listings
      );
      renderAccessMeter(
        accessMeters.groupPostsToday,
        access.usage.group_posts_today,
        access.limits.group_posts_today
      );
      renderAccessMeter(
        accessMeters.marketplaceListingsToday,
        access.usage.marketplace_listings_today,
        access.limits.marketplace_listings_today
      );
    }
    const nextReset = [
      access.remaining.group_posts_today === 0 ? access.reset_at.group_posts_today : void 0,
      access.remaining.marketplace_listings_today === 0 ? access.reset_at.marketplace_listings_today : void 0
    ].filter((value) => Boolean(value)).map((value) => new Date(value)).filter((value) => !Number.isNaN(value.getTime())).sort((left, right) => left.getTime() - right.getTime())[0];
    if (accessResetMessage && accessResetMessageCopy) {
      const timezone = currentExtensionAccess?.user.timezone ?? "UTC";
      accessResetMessage.classList.toggle(
        "access-summary__reset--pro",
        access.tier === "pro"
      );
      if (access.tier === "pro") {
        accessResetMessage.hidden = false;
        accessResetMessageCopy.textContent = access.pro_lifetime ? "Lifetime Pro access." : access.pro_expires_at ? `Pro access expires ${formatAccessResetTime(access.pro_expires_at)}.` : "Pro access.";
      } else {
        accessResetMessage.hidden = false;
        accessResetMessageCopy.textContent = nextReset ? `Daily limits reset at midnight (${timezone}). Your allowance resets ${formatAccessResetTime(nextReset.toISOString())}.` : `Daily limits reset at midnight (${timezone}).`;
      }
    }
  }
  function updateExtensionAccessUi() {
    const access = currentExtensionAccess;
    const active = access?.active === true;
    updateAccountCardVisibility(active);
    if (createForm) {
      createForm.hidden = !active;
    }
    if (authSessionPill) {
      authSessionPill.hidden = !active;
    }
    if (authUserEmail) {
      authUserEmail.textContent = access?.user.email ?? "";
    }
    if (authPanelTitle) {
      authPanelTitle.hidden = false;
      authPanelTitle.textContent = active ? `Welcome${access.user.displayName ? `, ${access.user.displayName}` : ""}.` : "Bulk posting, minus the busywork.";
    }
    if (authWelcomeArt) {
      authWelcomeArt.hidden = active;
    }
    if (authBenefits) {
      authBenefits.hidden = active;
    }
    if (authSigninNote) {
      authSigninNote.hidden = active;
    }
    if (authStatusMessage) {
      authStatusMessage.textContent = active ? "Your saved Groups posts and Marketplace listings are connected to this Google account." : "Save your posts and listings, choose where to share them, and let Postika post them for you.";
    }
    if (authLoginButton) {
      authLoginButton.hidden = active;
      authLoginButton.disabled = false;
    }
    if (authLogoutButton) {
      authLogoutButton.hidden = !active;
      authLogoutButton.disabled = false;
      authLogoutButton.textContent = "Sign out";
    }
    renderAccessSummary(access?.access);
    if (maxPostsInput && access?.access) {
      const isFree = access.access.tier === "free";
      const wasDisabled = maxPostsInput.disabled;
      if (isFree) {
        if (!wasDisabled) {
          const currentValue = Number(maxPostsInput.value);
          if (Number.isInteger(currentValue) && currentValue >= MIN_MAX_POSTS) {
            proMaxPostsPreference = currentValue;
          }
        }
        maxPostsInput.value = String(FREE_MAX_GROUP_POSTS);
        maxPostsInput.min = String(FREE_MAX_GROUP_POSTS);
        maxPostsInput.max = String(FREE_MAX_GROUP_POSTS);
        maxPostsInput.disabled = true;
        maxPostsInput.title = "Free accounts can publish up to 5 successful Group posts per day.";
        if (maxPostsNote) {
          maxPostsNote.textContent = "The Free plan allows 5 group posts per day, including posts awaiting approval. Failed attempts do not count.";
        }
      } else {
        maxPostsInput.disabled = false;
        maxPostsInput.min = String(MIN_MAX_POSTS);
        maxPostsInput.removeAttribute("max");
        maxPostsInput.removeAttribute("title");
        if (wasDisabled) {
          maxPostsInput.value = String(proMaxPostsPreference);
        }
        if (maxPostsNote) {
          maxPostsNote.textContent = "Posting stops after this many submissions are accepted. Posts awaiting group approval also count. Failed attempts do not count. Postika repeats your selected groups if needed.";
        }
      }
    }
    updatePostingReadiness();
    updatePreparedPostSaveButtonState();
    updateMarketplaceSaveListingButtonState();
  }
  function showSignedOut(message) {
    updateAccountCardVisibility(false);
    if (createForm) {
      createForm.hidden = true;
    }
    if (authPanelTitle) {
      authPanelTitle.hidden = false;
      authPanelTitle.textContent = "Bulk posting, minus the busywork.";
    }
    if (authWelcomeArt) {
      authWelcomeArt.hidden = false;
    }
    if (authBenefits) {
      authBenefits.hidden = false;
    }
    if (authSigninNote) {
      authSigninNote.hidden = false;
    }
    if (authStatusMessage) {
      authStatusMessage.textContent = message;
    }
    if (authSessionPill) {
      authSessionPill.hidden = true;
    }
    if (authUserEmail) {
      authUserEmail.textContent = "";
    }
    renderAccessSummary();
    if (authLoginButton) {
      authLoginButton.hidden = false;
      authLoginButton.disabled = false;
    }
    if (authLogoutButton) {
      authLogoutButton.hidden = true;
      authLogoutButton.disabled = false;
      authLogoutButton.textContent = "Sign out";
    }
    updatePostingReadiness();
  }
  function setAccessBusyState(message) {
    updateAccountCardVisibility(false);
    if (createForm) {
      createForm.hidden = true;
    }
    if (authPanelTitle) {
      authPanelTitle.hidden = false;
      authPanelTitle.textContent = "Checking your Google account...";
    }
    if (authWelcomeArt) {
      authWelcomeArt.hidden = true;
    }
    if (authBenefits) {
      authBenefits.hidden = true;
    }
    if (authSigninNote) {
      authSigninNote.hidden = true;
    }
    if (authStatusMessage) {
      authStatusMessage.textContent = message;
    }
    if (authSessionPill) {
      authSessionPill.hidden = true;
    }
    renderAccessSummary();
    if (authLoginButton) {
      authLoginButton.hidden = true;
    }
    if (authLogoutButton) {
      authLogoutButton.hidden = true;
    }
    updatePostingReadiness();
  }
  function googleSignInErrorMessage(error, interactive) {
    const message = error instanceof Error ? error.message.trim() : "";
    const normalizedMessage = message.toLowerCase();
    if (normalizedMessage.includes("did not approve") || normalizedMessage.includes("access denied") || normalizedMessage.includes("user rejected") || normalizedMessage.includes("cancel")) {
      return "Sign-in was cancelled. Continue with Google whenever you're ready.";
    }
    if (!interactive) {
      return "Save your posts and listings, choose where to share them, and let Postika post them for you.";
    }
    return "We couldn't complete Google sign-in. Please try again.";
  }
  function fileToUiPostImage(file) {
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
          dataUrl: reader.result
        });
      });
      reader.addEventListener("error", () => {
        reject(reader.error ?? new Error(`Unable to read ${file.name}.`));
      });
      reader.readAsDataURL(file);
    });
  }
  function collectMarketplaceListingFields() {
    const fields = {};
    if (selectedMarketplaceListingType) {
      fields["marketplace-listing-type"] = selectedMarketplaceListingType;
    }
    marketplaceListingFields?.querySelectorAll("input[name]:not(:disabled), textarea[name]:not(:disabled)").forEach((control) => {
      if (control instanceof HTMLInputElement && control.type === "file") {
        return;
      }
      fields[control.name] = control instanceof HTMLInputElement && control.type === "checkbox" ? control.checked : control.value;
    });
    return fields;
  }
  async function saveMarketplaceListing() {
    if (!selectedMarketplaceListingType) {
      showMarketplaceSaveListingStatus(
        "Select a listing type before saving.",
        true
      );
      return;
    }
    if (!isMarketplaceListingFormComplete()) {
      showMarketplaceSaveListingStatus(
        "Complete all listing fields and add at least one photo before saving.",
        true
      );
      updateMarketplaceSaveListingButtonState();
      return;
    }
    isMarketplaceListingSaving = true;
    if (saveMarketplaceListingButton) {
      saveMarketplaceListingButton.disabled = true;
      saveMarketplaceListingButton.textContent = "Saving\u2026";
    }
    try {
      const form = new FormData();
      form.set(
        "payload",
        JSON.stringify({
          listing_type: selectedMarketplaceListingType,
          fields: collectMarketplaceListingFields()
        })
      );
      selectedMarketplaceImageFiles.forEach(
        (file) => form.append("images", file, file.name)
      );
      const editingId = editingMarketplaceListingId;
      const response = await fetch(
        editingId ? `${AUTH_API_BASE_URL}/api/marketplace-listings/${encodeURIComponent(editingId)}` : `${AUTH_API_BASE_URL}/api/marketplace-listings`,
        {
          method: editingId ? "PUT" : "POST",
          headers: authenticatedRequestHeaders(),
          body: form
        }
      );
      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Unable to save this listing.")
        );
      }
      showMarketplaceSaveListingStatus(
        `Listing ${editingId ? "updated" : "saved"} with ${selectedMarketplaceImageFiles.length} ${selectedMarketplaceImageFiles.length === 1 ? "photo" : "photos"}.`
      );
      await Promise.all([loadMarketplaceListings(), refreshAccessEntitlements()]);
      clearMarketplaceListingEditor(false);
      showToast(
        editingId ? "Marketplace listing updated." : "Marketplace listing saved.",
        "success"
      );
    } catch (error) {
      console.error("Unable to save Marketplace listing", error);
      showMarketplaceSaveListingStatus(
        error instanceof Error ? error.message : "Unable to save this listing. Please try again.",
        true
      );
    } finally {
      isMarketplaceListingSaving = false;
      if (saveMarketplaceListingButton) {
        saveMarketplaceListingButton.textContent = editingMarketplaceListingId ? "Update listing" : "Save listing";
      }
      updateMarketplaceSaveListingButtonState();
    }
  }
  async function loadMarketplaceListings() {
    if (savedMarketplaceListingsStatus) {
      savedMarketplaceListingsStatus.textContent = "Loading saved listings\u2026";
      savedMarketplaceListingsStatus.removeAttribute("data-error");
    }
    try {
      const response = await fetch(
        `${AUTH_API_BASE_URL}/api/marketplace-listings`,
        {
          headers: authenticatedRequestHeaders()
        }
      );
      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Unable to load Marketplace listings.")
        );
      }
      const payload = await response.json();
      savedMarketplaceListings = Array.isArray(payload.listings) ? payload.listings : [];
      const savedItemIds = new Set(
        savedMarketplaceListings.filter(isSupportedMarketplacePostingListing).map((listing) => listing.id)
      );
      selectedMarketplaceListingIds = new Set(
        [...selectedMarketplaceListingIds].filter((id) => savedItemIds.has(id))
      );
      renderMarketplaceListings();
    } catch (error) {
      if (savedMarketplaceListingsStatus) {
        savedMarketplaceListingsStatus.textContent = error instanceof Error ? error.message : "Unable to load Marketplace listings.";
        savedMarketplaceListingsStatus.dataset.error = "true";
      }
    }
  }
  function renderMarketplaceListings() {
    if (!savedMarketplaceListingsList) {
      return;
    }
    if (savedMarketplaceListingsCount) {
      savedMarketplaceListingsCount.textContent = String(
        savedMarketplaceListings.length
      );
    }
    if (savedMarketplaceListingsStatus) {
      savedMarketplaceListingsStatus.textContent = savedMarketplaceListings.length === 0 ? "Saved listings will appear here." : `${savedMarketplaceListings.length} saved ${savedMarketplaceListings.length === 1 ? "listing" : "listings"}.`;
      savedMarketplaceListingsStatus.removeAttribute("data-error");
    }
    updateMarketplaceListingSelectionState();
    const cards = savedMarketplaceListings.map((listing) => {
      const card = document.createElement("article");
      card.className = "saved-marketplace-listing";
      const firstImage = [...listing.images].sort(
        (left, right) => left.position - right.position
      )[0];
      let media;
      if (firstImage) {
        const image = document.createElement("img");
        image.className = "saved-marketplace-listing__thumbnail";
        image.src = firstImage.url;
        image.alt = "";
        media = image;
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "saved-marketplace-listing__thumbnail saved-marketplace-listing__placeholder";
        placeholder.textContent = "No photo";
        media = placeholder;
      }
      const content = document.createElement("div");
      content.className = "saved-marketplace-listing__content";
      if (isSupportedMarketplacePostingListing(listing)) {
        const selector = document.createElement("label");
        selector.className = "saved-marketplace-listing__selector";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedMarketplaceListingIds.has(listing.id);
        checkbox.disabled = isMarketplacePostingActive || isMarketplaceCleanupActive;
        checkbox.setAttribute(
          "aria-label",
          `Select ${marketplaceListingDisplayTitle(listing)} for posting`
        );
        const selectorText = document.createElement("span");
        selectorText.textContent = "Select for posting";
        selector.append(checkbox, selectorText);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            selectedMarketplaceListingIds.add(listing.id);
          } else {
            selectedMarketplaceListingIds.delete(listing.id);
          }
          card.classList.toggle(
            "saved-marketplace-listing--selected",
            checkbox.checked
          );
          updateMarketplaceListingSelectionState();
        });
        content.append(selector);
        card.classList.toggle(
          "saved-marketplace-listing--selected",
          checkbox.checked
        );
      }
      const title = document.createElement("strong");
      title.className = "saved-marketplace-listing__title";
      title.textContent = marketplaceListingDisplayTitle(listing);
      const meta = document.createElement("p");
      meta.className = "saved-marketplace-listing__meta";
      const price = String(listing.fields["marketplace-price"] ?? "");
      meta.textContent = [
        marketplaceListingTypeLabel(listing.listing_type),
        price ? `Price: ${price}` : "No price",
        `${listing.images.length} photos`
      ].join(" \xB7 ");
      const actions = document.createElement("div");
      actions.className = "saved-marketplace-listing__actions";
      if (isSupportedMarketplacePostingListing(listing)) {
        const postButton = document.createElement("button");
        postButton.type = "button";
        postButton.className = "saved-marketplace-listing__post button-89";
        postButton.textContent = "Post to Facebook";
        const postingLimitReached = currentExtensionAccess?.access.remaining.marketplace_listings_today === 0;
        postButton.disabled = isMarketplacePostingActive || isMarketplaceCleanupActive || postingLimitReached;
        postButton.title = postingLimitReached ? "Your Free account has used its Marketplace post for today" : "Post this listing to Facebook Marketplace";
        postButton.addEventListener("click", () => {
          void postMarketplaceItem(listing, postButton);
        });
        actions.append(postButton);
      }
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "button-89";
      editButton.textContent = "Edit";
      editButton.disabled = isMarketplacePostingActive || isMarketplaceCleanupActive;
      editButton.addEventListener("click", () => {
        void editMarketplaceListing(listing.id);
      });
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "saved-marketplace-listing__delete button-89 button-89--danger";
      deleteButton.textContent = "Delete";
      deleteButton.disabled = isMarketplacePostingActive || isMarketplaceCleanupActive;
      deleteButton.addEventListener("click", () => {
        void deleteMarketplaceListing(listing.id, deleteButton);
      });
      actions.append(editButton, deleteButton);
      content.append(title, meta, actions);
      card.append(media, content);
      return card;
    });
    savedMarketplaceListingsList.replaceChildren(...cards);
  }
  function updateMarketplaceListingSelectionState() {
    const itemListings = savedMarketplaceListings.filter(
      isSupportedMarketplacePostingListing
    );
    const selectedCount = itemListings.filter(
      (listing) => selectedMarketplaceListingIds.has(listing.id)
    ).length;
    if (marketplaceListingsSelectionCount) {
      marketplaceListingsSelectionCount.textContent = `${selectedCount} ${selectedCount === 1 ? "listing" : "listings"} selected`;
    }
    if (marketplaceListingsSelectAllCheckbox) {
      marketplaceListingsSelectAllCheckbox.checked = itemListings.length > 0 && selectedCount === itemListings.length;
      marketplaceListingsSelectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < itemListings.length;
      marketplaceListingsSelectAllCheckbox.disabled = itemListings.length === 0 || isMarketplacePostingActive || isMarketplaceCleanupActive;
    }
    if (postSelectedMarketplaceItemsButton) {
      const postingLimitReached = currentExtensionAccess?.access.remaining.marketplace_listings_today === 0;
      postSelectedMarketplaceItemsButton.disabled = selectedCount === 0 || isMarketplacePostingActive || isMarketplaceCleanupActive || postingLimitReached;
      postSelectedMarketplaceItemsButton.title = postingLimitReached ? "Your Free account has used its Marketplace post for today" : "Post the selected listings to Facebook Marketplace";
    }
  }
  async function postMarketplaceItem(listing, button) {
    button.disabled = true;
    button.textContent = "Preparing\u2026";
    try {
      const started = await startMarketplaceItemQueue([listing]);
      if (!started) {
        button.disabled = false;
        button.textContent = "Post to Facebook";
        return;
      }
      button.textContent = "Waiting to post";
    } catch (error) {
      button.disabled = false;
      button.textContent = "Post to Facebook";
      showMarketplaceSaveListingStatus(
        error instanceof Error ? error.message : "Unable to publish Marketplace listing.",
        true
      );
    }
  }
  function scrollMarketplacePostingProgressIntoView() {
    scrollProgressPanelToBottom(marketplacePostingProgress);
  }
  async function startMarketplaceItemQueue(selectedListings) {
    const minimumDelaySeconds = Number(marketplaceIntervalMinInput?.value ?? 0);
    const maximumDelaySeconds = Number(marketplaceIntervalMaxInput?.value ?? 0);
    if (!isValidPostingInterval(minimumDelaySeconds, maximumDelaySeconds)) {
      throw new Error(
        "Marketplace posting intervals must be whole numbers of at least 60 seconds, and the maximum cannot be below the minimum."
      );
    }
    if (selectedListings.length === 0) {
      throw new Error("Select at least one saved listing before posting.");
    }
    const shareToSuggestedGroups = await requestMarketplaceAudienceChoice();
    if (shareToSuggestedGroups === void 0) {
      return false;
    }
    const postingStartedAt = Date.now();
    const access = await refreshAccessEntitlements();
    const remaining = access.remaining.marketplace_listings_today;
    if (remaining !== null && selectedListings.length > remaining) {
      const nextSlot = access.reset_at.marketplace_listings_today ? ` The allowance resets ${formatAccessResetTime(access.reset_at.marketplace_listings_today)}.` : "";
      throw new Error(
        remaining === 0 ? `Your Free account has used its Marketplace post for today.${nextSlot}` : `Your Free account has ${remaining} Marketplace ${remaining === 1 ? "post" : "posts"} remaining today. Select no more than ${remaining}.${nextSlot}`
      );
    }
    if (marketplaceGeminiRewriteToggle?.checked && !marketplaceGeminiApiKeyInput?.value.trim()) {
      throw new Error("Add a Gemini API key or disable description rewriting.");
    }
    const orderedListings = marketplaceShuffleItemsToggle?.checked ? shuffleItems(selectedListings) : selectedListings;
    isMarketplacePostingPaused = false;
    isMarketplaceStopRequestPending = false;
    isMarketplacePauseRequestPending = false;
    setMarketplacePostingActive(true);
    latestMarketplacePostingTiming = void 0;
    resetPostingTiming(marketplacePostingTimingElements);
    latestMarketplacePostingTiming = createPendingPostingTiming(postingStartedAt);
    renderPostingTiming(
      latestMarketplacePostingTiming,
      marketplacePostingTimingElements
    );
    if (marketplacePostingProgressCard) {
      marketplacePostingProgressCard.hidden = false;
    }
    scrollMarketplacePostingProgressIntoView();
    if (marketplacePostingLog) {
      marketplacePostingLog.replaceChildren();
    }
    marketplacePostingLogFilter = "all";
    applyPostingLogFilter(
      marketplacePostingLog,
      marketplacePostingLogFilter,
      marketplaceProgressPostedFilterButton,
      marketplaceProgressFailedFilterButton
    );
    if (marketplacePostingStatusMessage) {
      marketplacePostingStatusMessage.textContent = `Preparing ${orderedListings.length} selected ${orderedListings.length === 1 ? "listing" : "listings"}\u2026`;
    }
    if (marketplacePostingStatusCount) {
      marketplacePostingStatusCount.textContent = `0/${orderedListings.length} successful posts`;
    }
    if (marketplacePostingProgressPercent) {
      marketplacePostingProgressPercent.textContent = "0%";
    }
    if (marketplacePostingProgressBar) {
      marketplacePostingProgressBar.style.width = "0%";
    }
    if (marketplacePostingProgressSuccess) {
      marketplacePostingProgressSuccess.textContent = "0";
    }
    if (marketplacePostingProgressFailed) {
      marketplacePostingProgressFailed.textContent = "0";
    }
    if (marketplacePostingProgressRemaining) {
      marketplacePostingProgressRemaining.textContent = String(
        orderedListings.length
      );
    }
    try {
      await saveMarketplacePostingSettings();
      const watermark = await watermarkControls.snapshot();
      const listings = [];
      for (let index = 0; index < orderedListings.length; index += 1) {
        const listing = orderedListings[index];
        if (marketplacePostingStatusMessage) {
          marketplacePostingStatusMessage.textContent = `Downloading photos for listing ${index + 1}/${orderedListings.length}\u2026`;
        }
        listings.push(await buildMarketplacePostingListing(listing, index, watermark));
      }
      const response = await chrome.runtime.sendMessage({
        type: "START_MARKETPLACE_POSTING",
        startedAt: postingStartedAt,
        listings,
        shareToSuggestedGroups,
        minimumDelaySeconds,
        maximumDelaySeconds,
        rewriteDescriptions: Boolean(marketplaceGeminiRewriteToggle?.checked),
        geminiApiKey: marketplaceGeminiApiKeyInput?.value.trim() ?? "",
        customPrompt: marketplaceGeminiPromptInput?.value.trim() ?? ""
      });
      if (!response?.ok) {
        throw new Error(
          response?.error ?? "Could not start Marketplace posting. Please try again."
        );
      }
      return true;
    } catch (error) {
      if (latestMarketplacePostingTiming) {
        latestMarketplacePostingTiming = finishPendingPostingTiming(
          latestMarketplacePostingTiming
        );
        renderPostingTiming(
          latestMarketplacePostingTiming,
          marketplacePostingTimingElements
        );
      }
      setMarketplacePostingActive(false);
      throw error;
    }
  }
  async function buildMarketplacePostingListing(listing, listingIndex, watermark) {
    const images = [];
    for (const image of [...listing.images].sort((left, right) => left.position - right.position)) {
      const original = await fileToUiPostImage(await cloudMarketplaceImageToFile(image));
      images.push(await watermarkImage(original, watermark));
    }
    if (listing.listing_type === "vehicle") {
      const field = (name) => String(listing.fields[name] ?? "").trim();
      const vehicleType = marketplaceVehicleOptionLabel(
        field("marketplace-vehicle-type")
      );
      const year = field("marketplace-year");
      const make = field("marketplace-vehicle-make");
      const model = field("marketplace-vehicle-model");
      const mileage = field("marketplace-vehicle-mileage");
      const price2 = field("marketplace-price");
      const bodyStyle = marketplaceVehicleOptionLabel(
        field("marketplace-body-style")
      );
      const condition2 = marketplaceVehicleOptionLabel(
        field("marketplace-vehicle-condition")
      );
      const fuelType = marketplaceVehicleOptionLabel(
        field("marketplace-fuel-type")
      );
      const transmission = marketplaceVehicleOptionLabel(
        field("marketplace-transmission")
      );
      const exteriorColor = marketplaceVehicleOptionLabel(
        field("marketplace-exterior-color")
      );
      const interiorColor = marketplaceVehicleOptionLabel(
        field("marketplace-interior-color")
      );
      const location = field("marketplace-location");
      if (!vehicleType || !year || !make || !model || !mileage || !price2 || !bodyStyle || !condition2 || !fuelType || !transmission || !exteriorColor || !interiorColor || !location || images.length === 0) {
        throw new Error(
          `\u201C${marketplaceListingDisplayTitle(listing)}\u201D is missing required vehicle details, location, or photos.`
        );
      }
      return {
        listingType: "vehicle",
        id: listing.id,
        vehicleType,
        year,
        make,
        model,
        mileage,
        price: price2,
        bodyStyle,
        cleanTitle: listing.fields["marketplace-clean-title"] === true,
        condition: condition2,
        fuelType,
        transmission,
        exteriorColor,
        interiorColor,
        description: field("marketplace-description"),
        location,
        images: images.slice(0, 20),
        listingIndex
      };
    }
    const title = String(listing.fields["marketplace-title"] ?? "").trim();
    const price = String(listing.fields["marketplace-price"] ?? "").trim();
    const category = String(listing.fields["marketplace-category"] ?? "").trim();
    const condition = marketplaceFacebookConditionLabel(
      String(listing.fields["marketplace-condition"] ?? "")
    );
    if (!title || !price || !category || !condition || listing.images.length === 0) {
      throw new Error(
        `\u201C${marketplaceListingDisplayTitle(listing)}\u201D needs a title, price, category, condition, and at least one photo.`
      );
    }
    return {
      listingType: "item",
      id: listing.id,
      title,
      price,
      category,
      condition,
      description: String(listing.fields["marketplace-description"] ?? ""),
      images,
      listingIndex
    };
  }
  function isSupportedMarketplacePostingListing(listing) {
    return listing.listing_type === "item" || listing.listing_type === "vehicle";
  }
  function marketplaceVehicleOptionLabel(value) {
    const labels = {
      car_truck: "Car/Truck",
      rv_camper: "RV/Camper",
      commercial_industrial: "Commercial/Industrial",
      small_car: "Small Car",
      very_good: "Very good",
      plug_in_hybrid: "Plug-in hybrid",
      manual_transmission: "Manual transmission",
      automatic_transmission: "Automatic transmission",
      off_white: "Off white"
    };
    return labels[value] ?? value.split("_").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }
  function setMarketplacePostingActive(active) {
    isMarketplacePostingActive = active;
    updateMarketplaceCleanupControls();
    if (pauseMarketplacePostingButton) {
      pauseMarketplacePostingButton.hidden = !active;
      pauseMarketplacePostingButton.disabled = isMarketplaceStopRequestPending || isMarketplacePauseRequestPending;
      pauseMarketplacePostingButton.dataset.paused = String(
        isMarketplacePostingPaused
      );
      setButtonContent(
        pauseMarketplacePostingButton,
        isMarketplacePauseRequestPending ? isMarketplacePostingPaused ? "Resuming\u2026" : "Pausing\u2026" : isMarketplacePostingPaused ? "Resume" : "Pause",
        isMarketplacePauseRequestPending
      );
    }
    if (stopMarketplacePostingButton) {
      stopMarketplacePostingButton.hidden = !active;
      stopMarketplacePostingButton.disabled = isMarketplaceStopRequestPending;
      setButtonContent(
        stopMarketplacePostingButton,
        isMarketplaceStopRequestPending ? "Stopping\u2026" : "Stop",
        isMarketplaceStopRequestPending
      );
    }
    document.querySelectorAll(
      ".saved-marketplace-listing__actions button"
    ).forEach((button) => {
      button.disabled = active;
      if (!active && button.classList.contains("saved-marketplace-listing__post")) {
        button.textContent = "Post to Facebook";
      }
    });
    document.querySelectorAll(
      ".saved-marketplace-listing__selector input"
    ).forEach((checkbox) => {
      checkbox.disabled = active;
    });
    updateMarketplaceListingSelectionState();
  }
  function marketplaceFacebookConditionLabel(value) {
    return {
      new: "New",
      used_like_new: "Used - Like New",
      used_good: "Used - Good",
      used_fair: "Used - Fair"
    }[value] ?? "";
  }
  function marketplaceListingDisplayTitle(listing) {
    const title = String(listing.fields["marketplace-title"] ?? "").trim();
    const make = String(listing.fields["marketplace-vehicle-make"] ?? "").trim();
    const model = String(
      listing.fields["marketplace-vehicle-model"] ?? ""
    ).trim();
    return title || [make, model].filter(Boolean).join(" ") || marketplaceListingTypeLabel(listing.listing_type);
  }
  function marketplaceListingTypeLabel(type) {
    return type === "item" ? "Item for sale" : type === "vehicle" ? "Vehicle for sale" : "Home for sale or rent";
  }
  async function deleteMarketplaceListing(listingId, button) {
    const confirmed = await requestDeleteConfirmation(
      "Delete Marketplace listing?",
      "This permanently removes the saved listing and all of its photos."
    );
    if (!confirmed) {
      return;
    }
    button.disabled = true;
    button.textContent = "Deleting\u2026";
    try {
      const response = await fetch(
        `${AUTH_API_BASE_URL}/api/marketplace-listings/${encodeURIComponent(listingId)}`,
        { method: "DELETE", headers: authenticatedRequestHeaders() }
      );
      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Unable to delete Marketplace listing.")
        );
      }
      if (editingMarketplaceListingId === listingId) {
        clearMarketplaceListingEditor();
      }
      savedMarketplaceListings = savedMarketplaceListings.filter(
        (listing) => listing.id !== listingId
      );
      selectedMarketplaceListingIds.delete(listingId);
      renderMarketplaceListings();
      await refreshAccessEntitlements();
      showToast("Marketplace listing deleted.", "success");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Delete";
      showMarketplaceSaveListingStatus(
        error instanceof Error ? error.message : "Unable to delete Marketplace listing.",
        true
      );
    }
  }
  async function editMarketplaceListing(listingId) {
    const listing = savedMarketplaceListings.find(
      (candidate) => candidate.id === listingId
    );
    if (!listing) {
      return;
    }
    clearMarketplaceListingEditor(false);
    const listingTypeOption = listingTypeOptionElements.find(
      (option) => option.dataset.value === listing.listing_type
    );
    if (!listingTypeOption) {
      showMarketplaceSaveListingStatus("Unsupported listing type.", true);
      return;
    }
    selectListingType(listingTypeOption, true);
    marketplaceListingFields?.querySelectorAll("input[name], textarea[name]").forEach((control) => {
      if (control.type === "file") {
        return;
      }
      const value = listing.fields[control.name];
      if (control instanceof HTMLInputElement && control.type === "checkbox") {
        control.checked = value === true;
      } else if (typeof value === "string") {
        control.value = value;
      }
    });
    applyMarketplaceSelectValues(listing.fields);
    if (marketplaceTitleCount) {
      marketplaceTitleCount.textContent = `${marketplaceTitleInput?.value.length ?? 0} / 200`;
    }
    try {
      selectedMarketplaceImageFiles = await Promise.all(
        [...listing.images].sort((left, right) => left.position - right.position).map(cloudMarketplaceImageToFile)
      );
    } catch (error) {
      showMarketplaceSaveListingStatus(
        error instanceof Error ? error.message : "Unable to load listing photos.",
        true
      );
      return;
    }
    editingMarketplaceListingId = listing.id;
    syncMarketplaceImagesInput();
    renderMarketplacePhotoPreviews();
    if (saveMarketplaceListingButton) {
      saveMarketplaceListingButton.textContent = "Update listing";
    }
    if (cancelMarketplaceListingEditButton) {
      cancelMarketplaceListingEditButton.hidden = false;
    }
    if (listingTypeTrigger) {
      listingTypeTrigger.disabled = true;
    }
    updateMarketplaceSaveListingButtonState();
    revealCardFor(listingTypeSelect);
    listingTypeSelect?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function applyMarketplaceSelectValues(fields) {
    selectSavedOption(
      marketplaceCategoryOptionElements,
      String(fields["marketplace-category"] ?? ""),
      selectMarketplaceCategory,
      (option) => option.dataset.category === fields["marketplace-category-group"]
    );
    selectSavedOption(
      marketplaceConditionOptionElements,
      String(fields["marketplace-condition"] ?? ""),
      selectMarketplaceCondition
    );
    selectSavedOption(
      marketplaceVehicleTypeOptionElements,
      String(fields["marketplace-vehicle-type"] ?? ""),
      selectMarketplaceVehicleType
    );
    selectSavedOption(
      marketplaceYearOptionElements,
      String(fields["marketplace-year"] ?? ""),
      selectMarketplaceYear
    );
    selectSavedOption(
      marketplaceBodyStyleOptionElements,
      String(fields["marketplace-body-style"] ?? ""),
      selectMarketplaceBodyStyle
    );
    selectSavedOption(
      marketplaceVehicleConditionOptionElements,
      String(fields["marketplace-vehicle-condition"] ?? ""),
      selectMarketplaceVehicleCondition
    );
    selectSavedOption(
      marketplaceFuelTypeOptionElements,
      String(fields["marketplace-fuel-type"] ?? ""),
      selectMarketplaceFuelType
    );
    selectSavedOption(
      marketplaceTransmissionOptionElements,
      String(fields["marketplace-transmission"] ?? "automatic_transmission"),
      selectMarketplaceTransmission
    );
    selectSavedOption(
      marketplaceColorDropdowns.exterior.optionElements,
      String(fields["marketplace-exterior-color"] ?? ""),
      (option) => selectMarketplaceColor("exterior", option)
    );
    selectSavedOption(
      marketplaceColorDropdowns.interior.optionElements,
      String(fields["marketplace-interior-color"] ?? ""),
      (option) => selectMarketplaceColor("interior", option)
    );
    selectSavedOption(
      marketplaceRentalTypeOptionElements,
      String(fields["marketplace-rental-type"] ?? ""),
      selectMarketplaceRentalType
    );
  }
  function selectSavedOption(options, value, select, extraMatch = () => true) {
    if (!value) {
      return;
    }
    const option = options.find(
      (candidate) => candidate.dataset.value === value && extraMatch(candidate)
    );
    if (option) {
      select(option);
    }
  }
  async function cloudMarketplaceImageToFile(image) {
    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error("Unable to download a Marketplace listing image.");
    }
    const blob = await response.blob();
    const pathname = new URL(image.url).pathname;
    const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1)) || "marketplace-image";
    return new File([blob], name, { type: blob.type });
  }
  function clearMarketplaceListingEditor(hideStatus = true) {
    editingMarketplaceListingId = void 0;
    selectedMarketplaceListingType = void 0;
    selectedMarketplaceImageFiles = [];
    marketplaceListingFields?.querySelectorAll("input[name], textarea[name]").forEach((control) => {
      if (control instanceof HTMLInputElement && control.type === "checkbox") {
        control.checked = false;
      } else if (control.type !== "file") {
        control.value = "";
      }
    });
    const resetOptions = (options) => {
      options.forEach((option) => option.setAttribute("aria-selected", "false"));
    };
    [
      listingTypeOptionElements,
      marketplaceCategoryOptionElements,
      marketplaceConditionOptionElements,
      marketplaceVehicleTypeOptionElements,
      marketplaceYearOptionElements,
      marketplaceBodyStyleOptionElements,
      marketplaceVehicleConditionOptionElements,
      marketplaceFuelTypeOptionElements,
      marketplaceTransmissionOptionElements,
      marketplaceColorDropdowns.exterior.optionElements,
      marketplaceColorDropdowns.interior.optionElements,
      marketplaceRentalTypeOptionElements
    ].forEach(resetOptions);
    if (listingTypeValue) listingTypeValue.textContent = "Select listing type";
    if (listingTypeSelectedIcon)
      listingTypeSelectedIcon.innerHTML = listingTypeDefaultIconMarkup;
    if (marketplaceCategoryValue)
      marketplaceCategoryValue.textContent = "Select category";
    if (marketplaceCategorySelectedIcon)
      marketplaceCategorySelectedIcon.innerHTML = marketplaceCategoryDefaultIconMarkup;
    if (marketplaceConditionValue)
      marketplaceConditionValue.textContent = "Select condition";
    if (marketplaceVehicleTypeValue)
      marketplaceVehicleTypeValue.textContent = "Select vehicle type";
    if (marketplaceYearValue) marketplaceYearValue.textContent = "Select year";
    if (marketplaceBodyStyleValue)
      marketplaceBodyStyleValue.textContent = "Select body style";
    if (marketplaceVehicleConditionValue)
      marketplaceVehicleConditionValue.textContent = "Select vehicle condition";
    if (marketplaceFuelTypeValue)
      marketplaceFuelTypeValue.textContent = "Select fuel type";
    if (marketplaceTransmissionValue)
      marketplaceTransmissionValue.textContent = "Automatic transmission";
    if (marketplaceTransmissionInput)
      marketplaceTransmissionInput.value = "automatic_transmission";
    const automaticTransmission = marketplaceTransmissionOptionElements.find(
      (option) => option.dataset.value === "automatic_transmission"
    );
    automaticTransmission?.setAttribute("aria-selected", "true");
    if (marketplaceColorDropdowns.exterior.value)
      marketplaceColorDropdowns.exterior.value.textContent = "Select exterior color";
    if (marketplaceColorDropdowns.interior.value)
      marketplaceColorDropdowns.interior.value.textContent = "Select interior color";
    if (marketplaceRentalTypeValue)
      marketplaceRentalTypeValue.textContent = "Select rental type";
    if (marketplaceTitleCount) marketplaceTitleCount.textContent = "0 / 200";
    marketplacePhotosField?.classList.add("marketplace-photos--disabled");
    marketplacePhotoDropzone?.setAttribute("aria-disabled", "true");
    if (marketplaceImagesInput) marketplaceImagesInput.disabled = true;
    if (marketplacePhotoLimit) marketplacePhotoLimit.textContent = "\u2014";
    if (marketplacePhotoGuidance)
      marketplacePhotoGuidance.textContent = "Select a listing type first.";
    configureMarketplaceVehicleTypeField();
    syncMarketplaceImagesInput();
    renderMarketplacePhotoPreviews();
    if (saveMarketplaceListingButton) {
      saveMarketplaceListingButton.textContent = "Save listing";
    }
    updateMarketplaceSaveListingButtonState();
    if (cancelMarketplaceListingEditButton) {
      cancelMarketplaceListingEditButton.hidden = true;
    }
    if (listingTypeTrigger) {
      listingTypeTrigger.disabled = false;
    }
    if (hideStatus) hideMarketplaceSaveListingStatus();
  }
  function showMarketplaceSaveListingStatus(message, isError = false) {
    if (isError) revealCardFor(marketplaceSaveListingStatus);
    if (!marketplaceSaveListingStatus) {
      return;
    }
    marketplaceSaveListingStatus.textContent = message;
    marketplaceSaveListingStatus.dataset.error = String(isError);
    marketplaceSaveListingStatus.hidden = false;
  }
  function hideMarketplaceSaveListingStatus() {
    if (!marketplaceSaveListingStatus) {
      return;
    }
    marketplaceSaveListingStatus.hidden = true;
    marketplaceSaveListingStatus.removeAttribute("data-error");
  }
  async function initializeSidePanelSession() {
    isRestoringSidePanelSession = true;
    try {
      const storage = await chrome.storage.local.get([
        SIDE_PANEL_SESSION_STORAGE_KEY
      ]);
      const session = storage[SIDE_PANEL_SESSION_STORAGE_KEY];
      if (!session || typeof session !== "object") {
        renderImagePreviews();
        renderPreparedPosts();
        return;
      }
      const legacyDelaySeconds = typeof session.delaySeconds === "number" ? Math.max(session.delaySeconds, MIN_SLEEP_SECONDS) : void 0;
      if (postIntervalMinInput) {
        const savedMinimum = typeof session.minimumDelaySeconds === "number" ? session.minimumDelaySeconds : legacyDelaySeconds;
        const shouldMigratePreviousDefault = session.intervalSettingsVersion !== 2 && savedMinimum === PREVIOUS_MIN_SLEEP_SECONDS;
        postIntervalMinInput.value = String(
          shouldMigratePreviousDefault ? MIN_SLEEP_SECONDS : Math.max(savedMinimum ?? MIN_SLEEP_SECONDS, MIN_SLEEP_SECONDS)
        );
      }
      if (postIntervalMaxInput) {
        const restoredMinimum = Number(postIntervalMinInput?.value);
        const savedMaximum = typeof session.maximumDelaySeconds === "number" ? session.maximumDelaySeconds : legacyDelaySeconds;
        postIntervalMaxInput.value = String(
          session.intervalSettingsVersion === 2 && savedMaximum !== void 0 ? Math.max(savedMaximum, restoredMinimum) : Math.max(
            DEFAULT_MAX_SLEEP_SECONDS,
            savedMaximum ?? DEFAULT_MAX_SLEEP_SECONDS,
            restoredMinimum
          )
        );
      }
      if (maxPostsInput && typeof session.maxPosts === "number") {
        proMaxPostsPreference = Number.isInteger(session.maxPosts) && session.maxPosts >= MIN_MAX_POSTS ? session.maxPosts : DEFAULT_MAX_POSTS;
        maxPostsInput.value = String(proMaxPostsPreference);
      }
      if (Array.isArray(session.groupCommentOptions) || typeof session.groupCommentText === "string") {
        const options = Array.isArray(session.groupCommentOptions) ? session.groupCommentOptions.filter((option) => typeof option === "string") : typeof session.groupCommentText === "string" ? [session.groupCommentText] : [];
        legacyGroupCommentSettings = {
          enabled: session.groupCommentEnabled === true,
          options: options.length ? options : [""],
          ownerUserId: typeof session.groupCommentOwnerUserId === "string" ? session.groupCommentOwnerUserId : void 0
        };
      }
      if (groupsSearchInput && typeof session.groupsSearchQuery === "string") {
        groupsSearchInput.value = session.groupsSearchQuery;
        groupsSearchQuery = session.groupsSearchQuery;
      }
      if (Array.isArray(session.expandedCards)) {
        restoreExpandedCards(session.expandedCards.filter((id) => typeof id === "string"));
      } else if (session.groupsVisible !== false && session.loadedGroups?.length) {
        revealCardFor(groupsList);
      }
      imagePreviewsVisible = session.imagePreviewsVisible === true;
      if (Array.isArray(session.selectedGroupIds)) {
        selectedGroupIds = new Set(
          session.selectedGroupIds.filter(
            (groupId) => typeof groupId === "string"
          )
        );
      }
      syncPostImagesInput();
      if (Array.isArray(session.loadedGroups) && session.loadedGroups.length > 0) {
        renderGroups(session.loadedGroups.filter(isRestorableGroup));
        updateGroupsStatus(
          `Restored ${loadedGroups.length} loaded groups.`,
          loadedGroups.length
        );
      } else {
        updatePostingReadiness();
      }
      renderImagePreviews();
      renderPreparedPosts();
    } catch (error) {
      console.log(
        "Unable to restore side panel session.",
        error instanceof Error ? error.message : error
      );
      renderImagePreviews();
      renderPreparedPosts();
    } finally {
      renderGroupCommentOptions();
      isRestoringSidePanelSession = false;
      await saveSidePanelSession();
    }
  }
  function isRestorableGroup(value) {
    return typeof value === "object" && value !== null && typeof value.id === "string" && typeof value.name === "string" && typeof value.url === "string";
  }
  function dataUrlToFile(dataUrl, name, type) {
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
    if (saveSidePanelSessionTimer !== void 0) {
      window.clearTimeout(saveSidePanelSessionTimer);
    }
    saveSidePanelSessionTimer = window.setTimeout(() => {
      saveSidePanelSessionTimer = void 0;
      void saveSidePanelSession();
    }, 400);
  }
  function flushSidePanelSessionSave() {
    if (saveSidePanelSessionTimer !== void 0) {
      window.clearTimeout(saveSidePanelSessionTimer);
      saveSidePanelSessionTimer = void 0;
    }
    void saveSidePanelSession();
  }
  async function saveSidePanelSession() {
    try {
      const session = {
        minimumDelaySeconds: Number(
          postIntervalMinInput?.value ?? MIN_SLEEP_SECONDS
        ),
        maximumDelaySeconds: Number(
          postIntervalMaxInput?.value ?? DEFAULT_MAX_SLEEP_SECONDS
        ),
        intervalSettingsVersion: 2,
        maxPosts: currentExtensionAccess?.access.tier === "free" ? proMaxPostsPreference : Number(maxPostsInput?.value ?? DEFAULT_MAX_POSTS),
        ...legacyGroupCommentSettings ? {
          groupCommentEnabled: legacyGroupCommentSettings.enabled,
          groupCommentOptions: legacyGroupCommentSettings.options,
          ...legacyGroupCommentSettings.ownerUserId ? { groupCommentOwnerUserId: legacyGroupCommentSettings.ownerUserId } : {}
        } : {},
        loadedGroups,
        selectedGroupIds: Array.from(selectedGroupIds),
        groupsSearchQuery,
        expandedCards: expandedCardIds(),
        imagePreviewsVisible
      };
      await chrome.storage.local.set({
        [SIDE_PANEL_SESSION_STORAGE_KEY]: session
      });
    } catch (error) {
      console.log(
        "Unable to save side panel session.",
        error instanceof Error ? error.message : error
      );
    }
  }
  function resetPostingProgress(total, successTarget) {
    latestGroupsPostingTiming = void 0;
    resetPostingTiming(groupsPostingTimingElements);
    if (postingProgress) {
      postingProgress.hidden = false;
    }
    if (postingProgressTitle) {
      postingProgressTitle.textContent = successTarget ? `0/${successTarget} posts submitted` : `0/${total} groups processed`;
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
      postingProgressCurrent.textContent = "Getting ready to post...";
    }
    postingProgressLog?.replaceChildren();
    groupsPostingLogFilter = "all";
    applyPostingLogFilter(
      postingProgressLog,
      groupsPostingLogFilter,
      postingProgressPostedFilterButton,
      postingProgressFailedFilterButton,
      postingProgressPendingFilterButton
    );
  }
  function scrollPostingProgressIntoView() {
    scrollProgressPanelToBottom(postingProgress);
  }
  function scrollProgressPanelToBottom(panel) {
    if (!panel) return;
    revealCardFor(panel);
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        const card = panel.closest("details.card-accordion");
        const animations = card?.querySelector(".card-accordion__icon svg")?.getAnimations() ?? [];
        await Promise.all(animations.map((animation) => animation.finished.catch(() => {
        })));
        if (card && !card.open) return;
        panel.scrollIntoView({
          behavior: "smooth",
          block: "end",
          inline: "nearest"
        });
      });
    });
  }
  function shuffleItems(items) {
    const shuffledItems = [...items];
    for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffledItems[index], shuffledItems[swapIndex]] = [
        shuffledItems[swapIndex],
        shuffledItems[index]
      ];
    }
    return shuffledItems;
  }
  async function initializeGeminiSettings() {
    await chrome.storage.local.remove(["geminiIncludeHashtags", "marketplaceGeminiIncludeHashtags"]);
    const storage = await chrome.storage.local.get([
      GEMINI_API_KEY_STORAGE_KEY,
      GEMINI_REWRITE_ENABLED_STORAGE_KEY,
      GEMINI_CUSTOM_PROMPT_STORAGE_KEY
    ]);
    if (geminiApiKeyInput) {
      geminiApiKeyInput.value = typeof storage[GEMINI_API_KEY_STORAGE_KEY] === "string" ? storage[GEMINI_API_KEY_STORAGE_KEY] : "";
    }
    if (geminiRewriteToggle) {
      geminiRewriteToggle.checked = storage[GEMINI_REWRITE_ENABLED_STORAGE_KEY] === true;
    }
    if (geminiCustomPromptInput) {
      geminiCustomPromptInput.value = typeof storage[GEMINI_CUSTOM_PROMPT_STORAGE_KEY] === "string" ? storage[GEMINI_CUSTOM_PROMPT_STORAGE_KEY] : "";
    }
    updateGeminiStatus();
  }
  async function saveGeminiApiKey() {
    const value = geminiApiKeyInput?.value.trim() ?? "";
    if (marketplaceGeminiApiKeyInput) {
      marketplaceGeminiApiKeyInput.value = value;
    }
    await chrome.storage.local.set({
      [GEMINI_API_KEY_STORAGE_KEY]: value
    });
    updateGeminiStatus();
  }
  async function saveGeminiRewriteEnabled() {
    await chrome.storage.local.set({
      [GEMINI_REWRITE_ENABLED_STORAGE_KEY]: Boolean(geminiRewriteToggle?.checked)
    });
  }
  async function saveGeminiCustomPrompt() {
    await chrome.storage.local.set({
      [GEMINI_CUSTOM_PROMPT_STORAGE_KEY]: geminiCustomPromptInput?.value.trim() ?? ""
    });
  }
  async function initializeMarketplacePostingSettings() {
    const storage = await chrome.storage.local.get([
      GEMINI_API_KEY_STORAGE_KEY,
      MARKETPLACE_GEMINI_REWRITE_ENABLED_STORAGE_KEY,
      MARKETPLACE_GEMINI_CUSTOM_PROMPT_STORAGE_KEY,
      MARKETPLACE_MIN_INTERVAL_STORAGE_KEY,
      MARKETPLACE_MAX_INTERVAL_STORAGE_KEY,
      MARKETPLACE_SHUFFLE_ITEMS_STORAGE_KEY
    ]);
    if (marketplaceGeminiApiKeyInput) {
      marketplaceGeminiApiKeyInput.value = typeof storage[GEMINI_API_KEY_STORAGE_KEY] === "string" ? storage[GEMINI_API_KEY_STORAGE_KEY] : "";
    }
    if (marketplaceGeminiRewriteToggle) {
      marketplaceGeminiRewriteToggle.checked = storage[MARKETPLACE_GEMINI_REWRITE_ENABLED_STORAGE_KEY] === true;
    }
    if (marketplaceGeminiPromptInput) {
      marketplaceGeminiPromptInput.value = typeof storage[MARKETPLACE_GEMINI_CUSTOM_PROMPT_STORAGE_KEY] === "string" ? storage[MARKETPLACE_GEMINI_CUSTOM_PROMPT_STORAGE_KEY] : "";
    }
    if (marketplaceIntervalMinInput) {
      marketplaceIntervalMinInput.value = String(
        Number.isInteger(storage[MARKETPLACE_MIN_INTERVAL_STORAGE_KEY]) ? storage[MARKETPLACE_MIN_INTERVAL_STORAGE_KEY] : MIN_SLEEP_SECONDS
      );
    }
    if (marketplaceIntervalMaxInput) {
      marketplaceIntervalMaxInput.value = String(
        Number.isInteger(storage[MARKETPLACE_MAX_INTERVAL_STORAGE_KEY]) ? storage[MARKETPLACE_MAX_INTERVAL_STORAGE_KEY] : DEFAULT_MAX_SLEEP_SECONDS
      );
    }
    if (marketplaceShuffleItemsToggle) {
      marketplaceShuffleItemsToggle.checked = storage[MARKETPLACE_SHUFFLE_ITEMS_STORAGE_KEY] === true;
    }
    normalizeMarketplacePostingInterval();
    updateMarketplaceListingSelectionState();
  }
  async function initializeMarketplaceCleanupSettings() {
    updateMarketplaceCleanupControls();
  }
  function normalizeMarketplacePostingInterval() {
    if (!marketplaceIntervalMinInput || !marketplaceIntervalMaxInput) {
      return;
    }
    const enteredMinimum = Number(marketplaceIntervalMinInput.value);
    const minimum = Number.isInteger(enteredMinimum) && enteredMinimum >= MIN_SLEEP_SECONDS ? enteredMinimum : MIN_SLEEP_SECONDS;
    const enteredMaximum = Number(marketplaceIntervalMaxInput.value);
    const maximum = Number.isInteger(enteredMaximum) && enteredMaximum >= minimum ? enteredMaximum : Math.max(DEFAULT_MAX_SLEEP_SECONDS, minimum);
    marketplaceIntervalMinInput.value = String(minimum);
    marketplaceIntervalMaxInput.value = String(maximum);
  }
  async function saveMarketplacePostingSettings() {
    const apiKey = marketplaceGeminiApiKeyInput?.value.trim() ?? "";
    if (geminiApiKeyInput) {
      geminiApiKeyInput.value = apiKey;
    }
    await chrome.storage.local.set({
      [GEMINI_API_KEY_STORAGE_KEY]: apiKey,
      [MARKETPLACE_GEMINI_REWRITE_ENABLED_STORAGE_KEY]: Boolean(
        marketplaceGeminiRewriteToggle?.checked
      ),
      [MARKETPLACE_GEMINI_CUSTOM_PROMPT_STORAGE_KEY]: marketplaceGeminiPromptInput?.value.trim() ?? "",
      [MARKETPLACE_MIN_INTERVAL_STORAGE_KEY]: Number(
        marketplaceIntervalMinInput?.value ?? MIN_SLEEP_SECONDS
      ),
      [MARKETPLACE_MAX_INTERVAL_STORAGE_KEY]: Number(
        marketplaceIntervalMaxInput?.value ?? DEFAULT_MAX_SLEEP_SECONDS
      ),
      [MARKETPLACE_SHUFFLE_ITEMS_STORAGE_KEY]: Boolean(
        marketplaceShuffleItemsToggle?.checked
      )
    });
    updateGeminiStatus();
  }
})();
