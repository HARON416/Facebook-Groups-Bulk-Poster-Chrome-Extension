import type {
  AccessEntitlements,
  AccessEntitlementsUpdatedMessage,
  FacebookGroup,
  GroupPostingStrategy,
  GroupExtractionStatusMessage,
  LoadGroupsResponse,
  MarketplaceCleanupStatusMessage,
  DeleteOldMarketplaceListingsRequest,
  PauseMarketplacePostingRequest,
  PauseUiPostingRequest,
  MarketplaceItemPostingResponse,
  MarketplaceItemPostingStatusMessage,
  ResumeUiPostingRequest,
  ResumeMarketplacePostingRequest,
  StartMarketplaceItemPostingRequest,
  StopUiPostingRequest,
  StopMarketplacePostingRequest,
  StartUiPostingRequest,
  StatusBannerTone,
  UiPostImage,
  UiPreparedPost,
  UiPostingResponse,
  UiPostingStatusMessage,
} from "./config";
import { AUTH_API_BASE_URL } from "./auth-config";

const GEMINI_API_KEY_STORAGE_KEY = "geminiApiKey";
const GEMINI_REWRITE_ENABLED_STORAGE_KEY = "geminiRewriteEnabled";
const GEMINI_CUSTOM_PROMPT_STORAGE_KEY = "geminiCustomPrompt";
const GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY = "geminiIncludeHashtags";
const MARKETPLACE_GEMINI_REWRITE_ENABLED_STORAGE_KEY =
  "marketplaceGeminiRewriteEnabled";
const MARKETPLACE_GEMINI_CUSTOM_PROMPT_STORAGE_KEY =
  "marketplaceGeminiCustomPrompt";
const MARKETPLACE_GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY =
  "marketplaceGeminiIncludeHashtags";
const MARKETPLACE_MIN_INTERVAL_STORAGE_KEY = "marketplaceMinimumDelaySeconds";
const MARKETPLACE_MAX_INTERVAL_STORAGE_KEY = "marketplaceMaximumDelaySeconds";
const MARKETPLACE_SHUFFLE_ITEMS_STORAGE_KEY = "marketplaceShuffleItems";
const AUTH_SESSION_STORAGE_KEY = "googleAuthSession";
const AUTH_SIGNED_OUT_STORAGE_KEY = "googleAuthSignedOut";
const SIDE_PANEL_SESSION_STORAGE_KEY = "sidePanelSession";
const MIN_SLEEP_SECONDS = 60;
const PREVIOUS_MIN_SLEEP_SECONDS = 120;
const DEFAULT_MAX_SLEEP_SECONDS = 300;
const DEFAULT_MAX_POSTS = 200;
const FREE_MAX_GROUP_POSTS = 20;
const MIN_MAX_POSTS = 1;
const toastRegion = document.querySelector<HTMLElement>("#toast-region");

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
  toast.setAttribute("role", tone === "error" ? "alert" : "status");

  const accent = document.createElement("span");
  accent.className = "toast-card__accent";
  accent.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "toast-card__content";
  const title = document.createElement("strong");
  title.textContent =
    tone === "success"
      ? "Success"
      : tone === "warning"
        ? "Please check"
        : tone === "error"
          ? "Something went wrong"
          : "Information";
  const copy = document.createElement("span");
  copy.textContent = message;
  content.append(title, copy);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-card__close";
  close.setAttribute("aria-label", "Dismiss notification");
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

const accessSummary = document.querySelector<HTMLElement>("#access-summary");
const accessTierBadge =
  document.querySelector<HTMLElement>("#access-tier-badge");
const accessSavedUsage = document.querySelector<HTMLElement>(
  "#access-saved-usage",
);
const accessPublishingUsage = document.querySelector<HTMLElement>(
  "#access-publishing-usage",
);
const accessResetMessage = document.querySelector<HTMLElement>(
  "#access-reset-message",
);
const accessUpgrade = document.querySelector<HTMLElement>("#access-upgrade");

type SidePanelSession = {
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
};

type StoredPreparedPost = UiPreparedPost & {
  selected: boolean;
};

type SavedMarketplaceListingFieldValue = string | boolean;

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
const groupsPhotoDropzone =
  document.querySelector<HTMLElement>("#image-picker");
const groupsPhotoStatus = document.querySelector<HTMLElement>(
  "#groups-photo-status",
);
const imagePreviewList = document.querySelector<HTMLElement>(
  "#image-preview-list",
);
const savePreparedPostButton = document.querySelector<HTMLButtonElement>(
  "#save-prepared-post-btn",
);
const cancelPostEditButton = document.querySelector<HTMLButtonElement>(
  "#cancel-post-edit-btn",
);
const preparedPostsList = document.querySelector<HTMLElement>(
  "#prepared-posts-list",
);
const preparedPostsCount = document.querySelector<HTMLElement>(
  "#prepared-posts-count",
);
const preparedPostsSelectAll = document.querySelector<HTMLElement>(
  "#prepared-posts-select-all",
);
const preparedPostsSelectAllCheckbox = document.querySelector<HTMLInputElement>(
  "#prepared-posts-select-all-checkbox",
);
const postIntervalMinInput = document.querySelector<HTMLInputElement>(
  "#post-interval-min-input",
);
const postIntervalMaxInput = document.querySelector<HTMLInputElement>(
  "#post-interval-max-input",
);
const maxPostsInput =
  document.querySelector<HTMLInputElement>("#max-posts-input");
const maxPostsNote = document.querySelector<HTMLElement>("#max-posts-note");
const geminiApiKeyInput = document.querySelector<HTMLInputElement>(
  "#gemini-api-key-input",
);
const geminiRewriteToggle = document.querySelector<HTMLInputElement>(
  "#gemini-rewrite-toggle",
);
const geminiCustomPromptInput = document.querySelector<HTMLTextAreaElement>(
  "#gemini-custom-prompt-input",
);
const geminiHashtagsToggle = document.querySelector<HTMLInputElement>(
  "#gemini-hashtags-toggle",
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
const groupsTab = document.querySelector<HTMLButtonElement>("#groups-tab");
const marketplaceTab =
  document.querySelector<HTMLButtonElement>("#marketplace-tab");
const groupsTabPanel = document.querySelector<HTMLElement>("#groups-tab-panel");
const marketplaceTabPanel = document.querySelector<HTMLElement>(
  "#marketplace-tab-panel",
);
const marketplaceCleanupCard = document.querySelector<HTMLElement>(
  ".marketplace-cleanup-card",
);
const marketplaceSavedListingsCard = document.querySelector<HTMLElement>(
  ".marketplace-saved-card",
);
const marketplacePostingPreferencesCard = document.querySelector<HTMLElement>(
  ".marketplace-posting-preferences-card",
);
const listingTypeSelect = document.querySelector<HTMLElement>(
  "#listing-type-select",
);
const listingTypeTrigger = document.querySelector<HTMLButtonElement>(
  "#listing-type-trigger",
);
const listingTypeOptions = document.querySelector<HTMLElement>(
  "#listing-type-options",
);
const listingTypeValue = document.querySelector<HTMLElement>(
  "#listing-type-value",
);
const listingTypeSelectedIcon = document.querySelector<HTMLElement>(
  "#listing-type-selected-icon",
);
const listingTypeDefaultIconMarkup = listingTypeSelectedIcon?.innerHTML ?? "";
const marketplaceListingTypeInput = document.querySelector<HTMLInputElement>(
  "#marketplace-listing-type-input",
);
const listingTypeOptionElements = Array.from(
  document.querySelectorAll<HTMLElement>(".custom-select__option"),
);
const marketplacePhotosField = document.querySelector<HTMLElement>(
  "#marketplace-photos-field",
);
const marketplaceListingFields = document.querySelector<HTMLElement>(
  "#marketplace-listing-fields",
);
const saveMarketplaceListingButton = document.querySelector<HTMLButtonElement>(
  "#save-marketplace-listing-btn",
);
const cancelMarketplaceListingEditButton =
  document.querySelector<HTMLButtonElement>(
    "#cancel-marketplace-listing-edit-btn",
  );
const marketplaceSaveListingStatus = document.querySelector<HTMLElement>(
  "#marketplace-save-listing-status",
);
const savedMarketplaceListingsList = document.querySelector<HTMLElement>(
  "#saved-marketplace-listings-list",
);
const savedMarketplaceListingsCount = document.querySelector<HTMLElement>(
  "#saved-marketplace-listings-count",
);
const savedMarketplaceListingsStatus = document.querySelector<HTMLElement>(
  "#saved-marketplace-listings-status",
);
const marketplaceListingsSelectAllCheckbox =
  document.querySelector<HTMLInputElement>(
    "#marketplace-listings-select-all-checkbox",
  );
const marketplaceListingsSelectionCount = document.querySelector<HTMLElement>(
  "#marketplace-listings-selection-count",
);
const marketplaceIntervalMinInput = document.querySelector<HTMLInputElement>(
  "#marketplace-interval-min-input",
);
const marketplaceIntervalMaxInput = document.querySelector<HTMLInputElement>(
  "#marketplace-interval-max-input",
);
const marketplaceGeminiApiKeyInput = document.querySelector<HTMLInputElement>(
  "#marketplace-gemini-api-key-input",
);
const marketplaceGeminiPromptInput =
  document.querySelector<HTMLTextAreaElement>(
    "#marketplace-gemini-prompt-input",
  );
const marketplaceGeminiRewriteToggle = document.querySelector<HTMLInputElement>(
  "#marketplace-gemini-rewrite-toggle",
);
const marketplaceGeminiHashtagsToggle =
  document.querySelector<HTMLInputElement>(
    "#marketplace-gemini-hashtags-toggle",
  );
const marketplaceShuffleItemsToggle = document.querySelector<HTMLInputElement>(
  "#marketplace-shuffle-items-toggle",
);
const marketplacePostingStatusMessage = document.querySelector<HTMLElement>(
  "#marketplace-posting-status-message",
);
const marketplacePostingStatusCount = document.querySelector<HTMLElement>(
  "#marketplace-posting-status-count",
);
const marketplacePostingLog = document.querySelector<HTMLOListElement>(
  "#marketplace-posting-log",
);
const marketplaceCleanupDaysInput = document.querySelector<HTMLInputElement>(
  "#marketplace-cleanup-days-input",
);
const deleteOldMarketplaceListingsButton =
  document.querySelector<HTMLButtonElement>(
    "#delete-old-marketplace-listings-btn",
  );
const marketplaceCleanupProgress = document.querySelector<HTMLElement>(
  "#marketplace-cleanup-progress",
);
const marketplaceCleanupCount = document.querySelector<HTMLElement>(
  "#marketplace-cleanup-count",
);
const marketplaceCleanupPercent = document.querySelector<HTMLElement>(
  "#marketplace-cleanup-percent",
);
const marketplaceCleanupProgressBar = document.querySelector<HTMLElement>(
  "#marketplace-cleanup-progress-bar",
);
const marketplaceCleanupDeleted = document.querySelector<HTMLElement>(
  "#marketplace-cleanup-deleted",
);
const marketplaceCleanupFailed = document.querySelector<HTMLElement>(
  "#marketplace-cleanup-failed",
);
const marketplaceCleanupRemaining = document.querySelector<HTMLElement>(
  "#marketplace-cleanup-remaining",
);
const marketplaceCleanupMessage = document.querySelector<HTMLElement>(
  "#marketplace-cleanup-message",
);
const marketplaceCleanupLog = document.querySelector<HTMLOListElement>(
  "#marketplace-cleanup-log",
);
const marketplacePostingProgressCard = document.querySelector<HTMLElement>(
  "#marketplace-posting-progress-card",
);
const marketplacePostingProgress = document.querySelector<HTMLElement>(
  "#marketplace-posting-progress",
);
const marketplacePostingProgressPercent = document.querySelector<HTMLElement>(
  "#marketplace-posting-progress-percent",
);
const marketplacePostingProgressBar = document.querySelector<HTMLElement>(
  "#marketplace-posting-progress-bar",
);
const marketplacePostingProgressSuccess = document.querySelector<HTMLElement>(
  "#marketplace-posting-progress-success",
);
const marketplacePostingProgressFailed = document.querySelector<HTMLElement>(
  "#marketplace-posting-progress-failed",
);
const marketplacePostingProgressRemaining = document.querySelector<HTMLElement>(
  "#marketplace-posting-progress-remaining",
);
const marketplaceProgressPostedFilterButton =
  document.querySelector<HTMLButtonElement>(
    "#marketplace-progress-filter-posted",
  );
const marketplaceProgressFailedFilterButton =
  document.querySelector<HTMLButtonElement>(
    "#marketplace-progress-filter-failed",
  );
const pauseMarketplacePostingButton = document.querySelector<HTMLButtonElement>(
  "#pause-marketplace-posting-btn",
);
const stopMarketplacePostingButton = document.querySelector<HTMLButtonElement>(
  "#stop-marketplace-posting-btn",
);
const postSelectedMarketplaceItemsButton =
  document.querySelector<HTMLButtonElement>(
    "#post-selected-marketplace-items-btn",
  );
const marketplacePhotoDropzone = document.querySelector<HTMLElement>(
  "#marketplace-photo-dropzone",
);
const marketplaceImagesInput = document.querySelector<HTMLInputElement>(
  "#marketplace-images-input",
);
const marketplacePhotoCount = document.querySelector<HTMLElement>(
  "#marketplace-photo-count",
);
const marketplacePhotoLimit = document.querySelector<HTMLElement>(
  "#marketplace-photo-limit",
);
const marketplacePhotoGuidance = document.querySelector<HTMLElement>(
  "#marketplace-photo-guidance",
);
const marketplacePhotoStatus = document.querySelector<HTMLElement>(
  "#marketplace-photo-status",
);
const marketplacePhotoPreviews = document.querySelector<HTMLElement>(
  "#marketplace-photo-previews",
);
const marketplaceTitleInput = document.querySelector<HTMLInputElement>(
  "#marketplace-title-input",
);
const marketplaceTitleCount = document.querySelector<HTMLElement>(
  "#marketplace-title-count",
);
const marketplacePriceInput = document.querySelector<HTMLInputElement>(
  "#marketplace-price-input",
);
const marketplaceCategorySelect = document.querySelector<HTMLElement>(
  "#marketplace-category-select",
);
const marketplaceCategoryTrigger = document.querySelector<HTMLButtonElement>(
  "#marketplace-category-trigger",
);
const marketplaceCategoryOptions = document.querySelector<HTMLElement>(
  "#marketplace-category-options",
);
const marketplaceCategoryValue = document.querySelector<HTMLElement>(
  "#marketplace-category-value",
);
const marketplaceCategorySelectedIcon = document.querySelector<HTMLElement>(
  "#marketplace-category-selected-icon",
);
const marketplaceCategoryDefaultIconMarkup =
  marketplaceCategorySelectedIcon?.innerHTML ?? "";
const marketplaceCategoryInput = document.querySelector<HTMLInputElement>(
  "#marketplace-category-input",
);
const marketplaceCategoryGroupInput = document.querySelector<HTMLInputElement>(
  "#marketplace-category-group-input",
);
const marketplaceConditionSelect = document.querySelector<HTMLElement>(
  "#marketplace-condition-select",
);
const marketplaceConditionTrigger = document.querySelector<HTMLButtonElement>(
  "#marketplace-condition-trigger",
);
const marketplaceConditionOptions = document.querySelector<HTMLElement>(
  "#marketplace-condition-options",
);
const marketplaceConditionValue = document.querySelector<HTMLElement>(
  "#marketplace-condition-value",
);
const marketplaceConditionInput = document.querySelector<HTMLInputElement>(
  "#marketplace-condition-input",
);
const marketplaceConditionOptionElements = Array.from(
  document.querySelectorAll<HTMLElement>(
    "#marketplace-condition-options .condition-select__option",
  ),
);
const marketplaceVehicleTypeField = document.querySelector<HTMLElement>(
  "#marketplace-vehicle-type-field",
);
const marketplaceVehicleTypeSelect = document.querySelector<HTMLElement>(
  "#marketplace-vehicle-type-select",
);
const marketplaceVehicleTypeTrigger = document.querySelector<HTMLButtonElement>(
  "#marketplace-vehicle-type-trigger",
);
const marketplaceVehicleTypeOptions = document.querySelector<HTMLElement>(
  "#marketplace-vehicle-type-options",
);
const marketplaceVehicleTypeValue = document.querySelector<HTMLElement>(
  "#marketplace-vehicle-type-value",
);
const marketplaceVehicleTypeInput = document.querySelector<HTMLInputElement>(
  "#marketplace-vehicle-type-input",
);
const marketplaceVehicleTypeOptionElements = Array.from(
  document.querySelectorAll<HTMLElement>(".vehicle-type-select__option"),
);
const marketplaceYearField = document.querySelector<HTMLElement>(
  "#marketplace-year-field",
);
const marketplaceYearSelect = document.querySelector<HTMLElement>(
  "#marketplace-year-select",
);
const marketplaceYearTrigger = document.querySelector<HTMLButtonElement>(
  "#marketplace-year-trigger",
);
const marketplaceYearOptions = document.querySelector<HTMLElement>(
  "#marketplace-year-options",
);
const marketplaceYearValue = document.querySelector<HTMLElement>(
  "#marketplace-year-value",
);
const marketplaceYearInput = document.querySelector<HTMLInputElement>(
  "#marketplace-year-input",
);
const marketplaceVehicleDetailsFields = document.querySelector<HTMLElement>(
  "#marketplace-vehicle-details-fields",
);
const marketplaceVehicleMileageInput = document.querySelector<HTMLInputElement>(
  "#marketplace-vehicle-mileage-input",
);
const marketplaceVehicleMileageField = document.querySelector<HTMLElement>(
  "#marketplace-vehicle-mileage-field",
);
const marketplaceBodyStyleSelect = document.querySelector<HTMLElement>(
  "#marketplace-body-style-select",
);
const marketplaceBodyStyleTrigger = document.querySelector<HTMLButtonElement>(
  "#marketplace-body-style-trigger",
);
const marketplaceBodyStyleOptions = document.querySelector<HTMLElement>(
  "#marketplace-body-style-options",
);
const marketplaceBodyStyleValue = document.querySelector<HTMLElement>(
  "#marketplace-body-style-value",
);
const marketplaceBodyStyleInput = document.querySelector<HTMLInputElement>(
  "#marketplace-body-style-input",
);
const marketplaceBodyStyleOptionElements = Array.from(
  document.querySelectorAll<HTMLElement>(".body-style-select__option"),
);
const marketplaceVehicleConditionSelect = document.querySelector<HTMLElement>(
  "#marketplace-vehicle-condition-select",
);
const marketplaceVehicleConditionTrigger =
  document.querySelector<HTMLButtonElement>(
    "#marketplace-vehicle-condition-trigger",
  );
const marketplaceVehicleConditionOptions = document.querySelector<HTMLElement>(
  "#marketplace-vehicle-condition-options",
);
const marketplaceVehicleConditionValue = document.querySelector<HTMLElement>(
  "#marketplace-vehicle-condition-value",
);
const marketplaceVehicleConditionInput =
  document.querySelector<HTMLInputElement>(
    "#marketplace-vehicle-condition-input",
  );
const marketplaceVehicleConditionOptionElements = Array.from(
  document.querySelectorAll<HTMLElement>(".vehicle-condition-select__option"),
);
const marketplaceFuelTypeSelect = document.querySelector<HTMLElement>(
  "#marketplace-fuel-type-select",
);
const marketplaceFuelTypeTrigger = document.querySelector<HTMLButtonElement>(
  "#marketplace-fuel-type-trigger",
);
const marketplaceFuelTypeOptions = document.querySelector<HTMLElement>(
  "#marketplace-fuel-type-options",
);
const marketplaceFuelTypeValue = document.querySelector<HTMLElement>(
  "#marketplace-fuel-type-value",
);
const marketplaceFuelTypeInput = document.querySelector<HTMLInputElement>(
  "#marketplace-fuel-type-input",
);
const marketplaceFuelTypeOptionElements = Array.from(
  document.querySelectorAll<HTMLElement>(".fuel-type-select__option"),
);
const marketplaceTransmissionSelect = document.querySelector<HTMLElement>(
  "#marketplace-transmission-select",
);
const marketplaceTransmissionTrigger =
  document.querySelector<HTMLButtonElement>(
    "#marketplace-transmission-trigger",
  );
const marketplaceTransmissionOptions = document.querySelector<HTMLElement>(
  "#marketplace-transmission-options",
);
const marketplaceTransmissionValue = document.querySelector<HTMLElement>(
  "#marketplace-transmission-value",
);
const marketplaceTransmissionInput = document.querySelector<HTMLInputElement>(
  "#marketplace-transmission-input",
);
const marketplaceTransmissionOptionElements = Array.from(
  document.querySelectorAll<HTMLElement>(".transmission-select__option"),
);
const MARKETPLACE_VEHICLE_COLORS = [
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
  "Turquoise",
] as const;
type MarketplaceVehicleColorKind = "exterior" | "interior";
const marketplaceColorDropdowns = {
  exterior: {
    select: document.querySelector<HTMLElement>(
      "#marketplace-exterior-color-select",
    ),
    trigger: document.querySelector<HTMLButtonElement>(
      "#marketplace-exterior-color-trigger",
    ),
    options: document.querySelector<HTMLElement>(
      "#marketplace-exterior-color-options",
    ),
    value: document.querySelector<HTMLElement>(
      "#marketplace-exterior-color-value",
    ),
    input: document.querySelector<HTMLInputElement>(
      "#marketplace-exterior-color-input",
    ),
    optionElements: [] as HTMLElement[],
  },
  interior: {
    select: document.querySelector<HTMLElement>(
      "#marketplace-interior-color-select",
    ),
    trigger: document.querySelector<HTMLButtonElement>(
      "#marketplace-interior-color-trigger",
    ),
    options: document.querySelector<HTMLElement>(
      "#marketplace-interior-color-options",
    ),
    value: document.querySelector<HTMLElement>(
      "#marketplace-interior-color-value",
    ),
    input: document.querySelector<HTMLInputElement>(
      "#marketplace-interior-color-input",
    ),
    optionElements: [] as HTMLElement[],
  },
};
const marketplaceRentalTypeField = document.querySelector<HTMLElement>(
  "#marketplace-rental-type-field",
);
const marketplaceRentalTypeSelect = document.querySelector<HTMLElement>(
  "#marketplace-rental-type-select",
);
const marketplaceRentalTypeTrigger = document.querySelector<HTMLButtonElement>(
  "#marketplace-rental-type-trigger",
);
const marketplaceRentalTypeOptions = document.querySelector<HTMLElement>(
  "#marketplace-rental-type-options",
);
const marketplaceRentalTypeValue = document.querySelector<HTMLElement>(
  "#marketplace-rental-type-value",
);
const marketplaceRentalTypeInput = document.querySelector<HTMLInputElement>(
  "#marketplace-rental-type-input",
);
const marketplaceRentalTypeOptionElements = Array.from(
  document.querySelectorAll<HTMLElement>(".rental-type-select__option"),
);
const marketplaceHomeDetailsFields = document.querySelector<HTMLElement>(
  "#marketplace-home-details-fields",
);
const marketplaceVehicleExtraFields = Array.from(
  document.querySelectorAll<HTMLElement>("[data-vehicle-extra]"),
);
const marketplaceTitleField = document.querySelector<HTMLElement>(
  "#marketplace-title-field",
);
const marketplacePriceField = document.querySelector<HTMLElement>(
  "#marketplace-price-field",
);
const marketplaceCategoryField = document.querySelector<HTMLElement>(
  "#marketplace-category-field",
);
const marketplaceConditionField = document.querySelector<HTMLElement>(
  "#marketplace-condition-field",
);
const marketplaceDescriptionField = document.querySelector<HTMLElement>(
  "#marketplace-description-field",
);
const marketplaceLocationField = document.querySelector<HTMLElement>(
  "#marketplace-location-field",
);
const marketplaceBedroomsInput = document.querySelector<HTMLInputElement>(
  "#marketplace-bedrooms-input",
);
const marketplaceBathroomsInput = document.querySelector<HTMLInputElement>(
  "#marketplace-bathrooms-input",
);
const marketplacePhotoLightbox = document.querySelector<HTMLElement>(
  "#marketplace-photo-lightbox",
);
const marketplacePhotoLightboxBackdrop = document.querySelector<HTMLElement>(
  "#marketplace-photo-lightbox-backdrop",
);
const marketplacePhotoLightboxClose = document.querySelector<HTMLButtonElement>(
  "#marketplace-photo-lightbox-close",
);
const marketplacePhotoLightboxTitle = document.querySelector<HTMLElement>(
  "#marketplace-photo-lightbox-title",
);
const marketplacePhotoLightboxImage = document.querySelector<HTMLImageElement>(
  "#marketplace-photo-lightbox-image",
);
const marketplacePhotoLightboxCounter = document.querySelector<HTMLElement>(
  "#marketplace-photo-lightbox-counter",
);
const marketplacePhotoLightboxFilename = document.querySelector<HTMLElement>(
  "#marketplace-photo-lightbox-filename",
);
const marketplacePhotoLightboxPrevious =
  document.querySelector<HTMLButtonElement>(
    "#marketplace-photo-lightbox-previous",
  );
const marketplacePhotoLightboxNext = document.querySelector<HTMLButtonElement>(
  "#marketplace-photo-lightbox-next",
);
const marketplacePhotoLightboxThumbnails = document.querySelector<HTMLElement>(
  "#marketplace-photo-lightbox-thumbnails",
);
const pausePostingButton =
  document.querySelector<HTMLButtonElement>("#pause-posting-btn");
const stopPostingButton =
  document.querySelector<HTMLButtonElement>("#stop-posting-btn");
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
const postingProgressPending = document.querySelector<HTMLElement>(
  "#posting-progress-pending",
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
const postingProgressPostedFilterButton =
  document.querySelector<HTMLButtonElement>("#posting-progress-filter-posted");
const postingProgressPendingFilterButton =
  document.querySelector<HTMLButtonElement>("#posting-progress-filter-pending");
const postingProgressFailedFilterButton =
  document.querySelector<HTMLButtonElement>("#posting-progress-filter-failed");
const authLoginButton =
  document.querySelector<HTMLButtonElement>("#auth-login-btn");
const authLogoutButton =
  document.querySelector<HTMLButtonElement>("#auth-logout-btn");
const authStatusMessage = document.querySelector<HTMLElement>(
  "#auth-status-message",
);
const authPanelTitle = document.querySelector<HTMLElement>("#auth-panel-title");
const authSessionPill =
  document.querySelector<HTMLElement>("#auth-session-pill");
const authUserEmail = document.querySelector<HTMLElement>("#auth-user-email");
const deleteConfirmation = document.querySelector<HTMLElement>(
  "#delete-confirmation",
);
const deleteConfirmationBackdrop = document.querySelector<HTMLButtonElement>(
  "#delete-confirmation-backdrop",
);
const deleteConfirmationTitle = document.querySelector<HTMLElement>(
  "#delete-confirmation-title",
);
const deleteConfirmationMessage = document.querySelector<HTMLElement>(
  "#delete-confirmation-message",
);
const deleteConfirmationCancel = document.querySelector<HTMLButtonElement>(
  "#delete-confirmation-cancel",
);
const deleteConfirmationConfirm = document.querySelector<HTMLButtonElement>(
  "#delete-confirmation-confirm",
);
const groupPostingStrategyChoice = document.querySelector<HTMLElement>(
  "#group-posting-strategy-choice",
);
const groupPostingStrategyChoiceBackdrop =
  document.querySelector<HTMLButtonElement>(
    "#group-posting-strategy-choice-backdrop",
  );
const groupPostingStrategyChoiceCancel =
  document.querySelector<HTMLButtonElement>(
    "#group-posting-strategy-choice-cancel",
  );
const groupPostingStrategyChoiceSelectedOrder =
  document.querySelector<HTMLButtonElement>(
    "#group-posting-strategy-choice-selected-order",
  );
const groupPostingStrategyChoiceBalanced =
  document.querySelector<HTMLButtonElement>(
    "#group-posting-strategy-choice-balanced",
  );
const marketplaceAudienceChoice = document.querySelector<HTMLElement>(
  "#marketplace-audience-choice",
);
const marketplaceAudienceChoiceBackdrop =
  document.querySelector<HTMLButtonElement>(
    "#marketplace-audience-choice-backdrop",
  );
const marketplaceAudienceChoiceCancel =
  document.querySelector<HTMLButtonElement>(
    "#marketplace-audience-choice-cancel",
  );
const marketplaceAudienceChoiceMarketplaceOnly =
  document.querySelector<HTMLButtonElement>(
    "#marketplace-audience-choice-marketplace-only",
  );
const marketplaceAudienceChoiceWithGroups =
  document.querySelector<HTMLButtonElement>(
    "#marketplace-audience-choice-with-groups",
  );
const selectedImagePreviewUrls: string[] = [];
const marketplacePhotoPreviewUrls: string[] = [];
const marketplacePhotoLightboxUrls: string[] = [];
const MARKETPLACE_PHOTO_LIMITS = {
  item: 10,
  vehicle: 20,
  home: 50,
} as const;
type MarketplaceListingType = keyof typeof MARKETPLACE_PHOTO_LIMITS;
type CloudMarketplaceListing = {
  id: string;
  listing_type: MarketplaceListingType;
  fields: Record<string, string | boolean>;
  images: { url: string; position: number }[];
  created_at: string;
  updated_at: string;
};
type MarketplaceCategoryOption = {
  label: string;
  shipping?: boolean;
};
type MarketplaceCategoryGroup = {
  name: string;
  iconPath: string;
  options: MarketplaceCategoryOption[];
};
const MARKETPLACE_CATEGORY_GROUPS: MarketplaceCategoryGroup[] = [
  {
    name: "Home & Garden",
    iconPath:
      "M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z",
    options: [
      { label: "Tools" },
      { label: "Furniture" },
      { label: "Household", shipping: true },
      { label: "Garden" },
      { label: "Appliances" },
    ],
  },
  {
    name: "Entertainment",
    iconPath:
      "M176,112H152a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16ZM104,96H96V88a8,8,0,0,0-16,0v8H72a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0v-8h8a8,8,0,0,0,0-16ZM241.48,200.65a36,36,0,0,1-54.94,4.81c-.12-.12-.24-.24-.35-.37L146.48,160h-37L69.81,205.09l-.35.37A36.08,36.08,0,0,1,44,216,36,36,0,0,1,8.56,173.75a.68.68,0,0,1,0-.14L24.93,89.52A59.88,59.88,0,0,1,83.89,40H172a60.08,60.08,0,0,1,59,49.25c0,.06,0,.12,0,.18l16.37,84.17a.68.68,0,0,1,0,.14A35.74,35.74,0,0,1,241.48,200.65ZM172,144a44,44,0,0,0,0-88H83.89A43.9,43.9,0,0,0,40.68,92.37l0,.13L24.3,176.59A20,20,0,0,0,58,194.3l41.92-47.59a8,8,0,0,1,6-2.71Zm59.7,32.59-8.74-45A60,60,0,0,1,172,160h-4.2L198,194.31a20.09,20.09,0,0,0,17.46,5.39,20,20,0,0,0,16.23-23.11Z",
    options: [
      { label: "Video Games" },
      { label: "Books, Movies & Music", shipping: true },
    ],
  },
  {
    name: "Clothing & Accessories",
    iconPath:
      "M216,64H176a48,48,0,0,0-96,0H40A16,16,0,0,0,24,80V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64ZM128,32a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm88,168H40V80H80V96a8,8,0,0,0,16,0V80h64V96a8,8,0,0,0,16,0V80h40Z",
    options: [
      { label: "Bags & Luggage", shipping: true },
      { label: "Women's clothing & shoes", shipping: true },
      { label: "Men's clothing & shoes", shipping: true },
      { label: "Jewelry & Accessories", shipping: true },
    ],
  },
  {
    name: "Family",
    iconPath:
      "M178,40c-20.65,0-38.73,8.88-50,23.89C116.73,48.88,98.65,40,78,40a62.07,62.07,0,0,0-62,62c0,70,103.79,126.66,108.21,129a8,8,0,0,0,7.58,0C136.21,228.66,240,172,240,102A62.07,62.07,0,0,0,178,40ZM128,214.8C109.74,204.16,32,155.69,32,102A46.06,46.06,0,0,1,78,56c19.45,0,35.78,10.36,42.6,27a8,8,0,0,0,14.8,0c6.82-16.67,23.15-27,42.6-27a46.06,46.06,0,0,1,46,46C224,155.61,146.24,204.15,128,214.8Z",
    options: [
      { label: "Health & beauty", shipping: true },
      { label: "Pet Supplies" },
      { label: "Baby & kids", shipping: true },
      { label: "Toys & Games", shipping: true },
    ],
  },
  {
    name: "Electronics",
    iconPath:
      "M176,16H80A24,24,0,0,0,56,40V216a24,24,0,0,0,24,24h96a24,24,0,0,0,24-24V40A24,24,0,0,0,176,16ZM72,64H184V192H72Zm8-32h96a8,8,0,0,1,8,8v8H72V40A8,8,0,0,1,80,32Zm96,192H80a8,8,0,0,1-8-8v-8H184v8A8,8,0,0,1,176,224Z",
    options: [
      { label: "Electronics & computers", shipping: true },
      { label: "Mobile phones", shipping: true },
    ],
  },
  {
    name: "Hobbies",
    iconPath:
      "M249.66,46.34l-40-40a8,8,0,0,0-11.31,11.32L200.69,20,140.52,80.16C117.73,68.3,92.21,69.29,76.75,84.74a42.27,42.27,0,0,0-9.39,14.37A8.24,8.24,0,0,1,59.81,104c-14.59.49-27.26,5.72-36.65,15.11C11.08,131.22,6,148.6,8.74,168.07,11.4,186.7,21.07,205.15,36,220s33.34,24.56,52,27.22A71.13,71.13,0,0,0,98.1,248c15.32,0,28.83-5.23,38.76-15.16,9.39-9.39,14.62-22.06,15.11-36.65a8.24,8.24,0,0,1,4.92-7.55,42.12,42.12,0,0,0,14.37-9.39c15.45-15.46,16.44-41,4.58-63.77L236,55.31l2.34,2.34a8,8,0,1,0,11.32-11.31ZM160,167.93a26.12,26.12,0,0,1-8.95,5.83,24.24,24.24,0,0,0-15,21.89c-.36,10.46-4,19.41-10.43,25.88-8.44,8.43-21,11.95-35.36,9.89C75,229.25,59.73,221.19,47.27,208.73S26.75,181,24.58,165.81c-2-14.37,1.46-26.92,9.89-35.36C40.94,124,49.89,120.37,60.35,120h0a24.22,24.22,0,0,0,21.89-15,26.12,26.12,0,0,1,5.83-9c5.49-5.49,13-8.13,21.38-8.13a49.38,49.38,0,0,1,19.13,4.19L108.5,112.19a32,32,0,1,0,35.31,35.31l20.08-20.08C170.41,142.71,169.47,158.41,160,167.93Zm-10.4-61.48a72.9,72.9,0,0,1,5.93,6.75l-15.42,15.42a32.22,32.22,0,0,0-12.68-12.68l15.42-15.43A73,73,0,0,1,149.55,106.45ZM112,128a16,16,0,0,1,16,16h0a16,16,0,1,1-16-16Zm48.85-32.85a86.94,86.94,0,0,0-6.68-6L176,67.31,188.69,80l-21.83,21.82A86.94,86.94,0,0,0,160.86,95.14ZM200,68.68,187.32,56,212,31.31,224.69,44ZM93.66,194.33a8,8,0,0,1-11.31,11.32l-32-32a8,8,0,0,1,11.32-11.31Z",
    options: [
      { label: "Bicycles" },
      { label: "Arts & Crafts" },
      { label: "Sports & Outdoors", shipping: true },
      { label: "Auto parts" },
      { label: "Musical Instruments" },
      { label: "Antiques & Collectibles" },
    ],
  },
  {
    name: "Classifieds",
    iconPath:
      "M240,192h-8V98.67a16,16,0,0,0-7.12-13.31l-88-58.67a16,16,0,0,0-17.75,0l-88,58.67A16,16,0,0,0,24,98.67V192H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM40,98.67,128,40l88,58.66V192H192V136a8,8,0,0,0-8-8H72a8,8,0,0,0-8,8v56H40ZM176,144v16H136V144Zm-56,16H80V144h40ZM80,176h40v16H80Zm56,0h40v16H136Z",
    options: [{ label: "Garage Sale" }, { label: "Miscellaneous" }],
  },
  {
    name: "Vehicles",
    iconPath:
      "M240,104H229.2L201.42,41.5A16,16,0,0,0,186.8,32H69.2a16,16,0,0,0-14.62,9.5L26.8,104H16a8,8,0,0,0,0,16h8v80a16,16,0,0,0,16,16H64a16,16,0,0,0,16-16V184h96v16a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16V120h8a8,8,0,0,0,0-16ZM69.2,48H186.8l24.89,56H44.31ZM64,200H40V184H64Zm128,0V184h24v16Zm24-32H40V120H216ZM56,144a8,8,0,0,1,8-8H80a8,8,0,0,1,0,16H64A8,8,0,0,1,56,144Zm112,0a8,8,0,0,1,8-8h16a8,8,0,0,1,0,16H176A8,8,0,0,1,168,144Z",
    options: [],
  },
];
let selectedImageFiles: File[] = [];
let selectedMarketplaceImageFiles: File[] = [];
let groupPhotoAdditionQueue = Promise.resolve();
let marketplacePhotoAdditionQueue = Promise.resolve();
const imageContentSignatureCache = new WeakMap<File, Promise<string>>();
let selectedMarketplaceListingType: MarketplaceListingType | undefined;
let savedMarketplaceListings: CloudMarketplaceListing[] = [];
let selectedMarketplaceListingIds = new Set<string>();
let isMarketplacePostingActive = false;
let isMarketplacePostingPaused = false;
let isMarketplaceStopRequestPending = false;
let isMarketplacePauseRequestPending = false;
let isMarketplaceListingSaving = false;
let isMarketplaceCleanupActive = false;
type PostingLogFilter = "all" | "posted" | "pending" | "failed";
let groupsPostingLogFilter: PostingLogFilter = "all";
let marketplacePostingLogFilter: PostingLogFilter = "all";
let editingMarketplaceListingId: string | undefined;
let draggedMarketplacePhotoIndex: number | undefined;
let draggedGroupPhotoIndex: number | undefined;
let marketplacePhotoLightboxIndex = 0;
let marketplacePhotoLightboxReturnFocus: HTMLElement | undefined;
let photoLightboxSource: "groups" | "marketplace" = "marketplace";
let marketplaceCategoryOptionElements: HTMLElement[] = [];
let marketplaceYearOptionElements: HTMLElement[] = [];
let preparedPosts: StoredPreparedPost[] = [];
let editingPreparedPostId: string | undefined;
let loadedGroups: FacebookGroup[] = [];
let selectedGroupIds = new Set<string>();
let groupsSearchQuery = "";
let groupsVisible = true;
let imagePreviewsVisible = false;
let isPostingActive = false;
let isPostingPaused = false;
let isStopRequestPending = false;
let isPauseResumeRequestPending = false;
let saveSidePanelSessionTimer: number | undefined;
let isRestoringSidePanelSession = false;
let proMaxPostsPreference = DEFAULT_MAX_POSTS;
let deleteConfirmationResolver: ((confirmed: boolean) => void) | undefined;
let deleteConfirmationReturnFocus: HTMLElement | undefined;
let marketplaceAudienceChoiceResolver:
  | ((shareToSuggestedGroups: boolean | undefined) => void)
  | undefined;
let marketplaceAudienceChoiceReturnFocus: HTMLElement | undefined;
let groupPostingStrategyChoiceResolver:
  | ((strategy: GroupPostingStrategy | undefined) => void)
  | undefined;
let groupPostingStrategyChoiceReturnFocus: HTMLElement | undefined;
let currentExtensionAccess:
  | {
      active: true;
      sessionToken: string;
      expiresAt: string;
      user: AuthenticatedGoogleUser;
      access: AccessEntitlements;
    }
  | undefined;
let currentGoogleAccessToken: string | undefined;

type AuthenticatedGoogleUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  avatarUrl?: string;
  timezone?: string;
};

type StoredAuthSession = {
  sessionToken: string;
  expiresAt: string;
  user: AuthenticatedGoogleUser;
};

if (marketplaceSavedListingsCard && marketplacePostingPreferencesCard) {
  marketplaceSavedListingsCard.before(marketplacePostingPreferencesCard);
}
if (marketplaceTabPanel && marketplaceCleanupCard) {
  marketplaceTabPanel.append(marketplaceCleanupCard);
}

void initializeGeminiSettings();
void initializeMarketplacePostingSettings();
void initializeMarketplaceCleanupSettings();
void initializeApplication();
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
initializeGroupPostingStrategyChoice();
initializeMarketplaceAudienceChoice();

async function initializeApplication() {
  await initializeSidePanelSession();
  await initializeExtensionAccess();
  if (hasActiveExtensionAccess()) {
    await Promise.all([loadCloudPreparedPosts(), loadMarketplaceListings()]);
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
      deleteConfirmationConfirm,
    ].filter((button): button is HTMLButtonElement => Boolean(button));
    if (focusable.length === 0) {
      return;
    }
    const currentIndex = focusable.indexOf(
      document.activeElement as HTMLButtonElement,
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

function requestDeleteConfirmation(
  title: string,
  message: string,
): Promise<boolean> {
  if (
    !deleteConfirmation ||
    !deleteConfirmationTitle ||
    !deleteConfirmationMessage ||
    !deleteConfirmationConfirm
  ) {
    return Promise.resolve(false);
  }
  if (deleteConfirmationResolver) {
    closeDeleteConfirmation(false);
  }
  deleteConfirmationTitle.textContent = title;
  deleteConfirmationMessage.textContent = message;
  deleteConfirmationReturnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  deleteConfirmation.hidden = false;
  document.body.classList.add("delete-confirmation-open");
  deleteConfirmationConfirm.focus();
  return new Promise((resolve) => {
    deleteConfirmationResolver = resolve;
  });
}

function closeDeleteConfirmation(confirmed: boolean) {
  if (!deleteConfirmationResolver) {
    return;
  }
  const resolve = deleteConfirmationResolver;
  const returnFocus = deleteConfirmationReturnFocus;
  deleteConfirmationResolver = undefined;
  deleteConfirmationReturnFocus = undefined;
  if (deleteConfirmation) {
    deleteConfirmation.hidden = true;
  }
  document.body.classList.remove("delete-confirmation-open");
  resolve(confirmed);
  returnFocus?.focus();
}

function initializeGroupPostingStrategyChoice() {
  groupPostingStrategyChoiceCancel?.addEventListener("click", () => {
    closeGroupPostingStrategyChoice(undefined);
  });
  groupPostingStrategyChoiceBackdrop?.addEventListener("click", () => {
    closeGroupPostingStrategyChoice(undefined);
  });
  groupPostingStrategyChoiceSelectedOrder?.addEventListener("click", () => {
    closeGroupPostingStrategyChoice("selected_order");
  });
  groupPostingStrategyChoiceBalanced?.addEventListener("click", () => {
    closeGroupPostingStrategyChoice("balanced");
  });
  groupPostingStrategyChoice?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeGroupPostingStrategyChoice(undefined);
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = [
      groupPostingStrategyChoiceCancel,
      groupPostingStrategyChoiceSelectedOrder,
      groupPostingStrategyChoiceBalanced,
    ].filter((button): button is HTMLButtonElement => Boolean(button));
    if (focusable.length === 0) {
      return;
    }
    const currentIndex = focusable.indexOf(
      document.activeElement as HTMLButtonElement,
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

function requestGroupPostingStrategyChoice(): Promise<
  GroupPostingStrategy | undefined
> {
  if (
    !groupPostingStrategyChoice ||
    !groupPostingStrategyChoiceSelectedOrder ||
    !groupPostingStrategyChoiceBalanced
  ) {
    return Promise.resolve(undefined);
  }
  if (groupPostingStrategyChoiceResolver) {
    closeGroupPostingStrategyChoice(undefined);
  }
  groupPostingStrategyChoiceReturnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  groupPostingStrategyChoice.hidden = false;
  document.body.classList.add("group-posting-strategy-choice-open");
  groupPostingStrategyChoiceBalanced.focus();
  return new Promise((resolve) => {
    groupPostingStrategyChoiceResolver = resolve;
  });
}

function closeGroupPostingStrategyChoice(
  strategy: GroupPostingStrategy | undefined,
) {
  if (!groupPostingStrategyChoiceResolver) {
    return;
  }
  const resolve = groupPostingStrategyChoiceResolver;
  const returnFocus = groupPostingStrategyChoiceReturnFocus;
  groupPostingStrategyChoiceResolver = undefined;
  groupPostingStrategyChoiceReturnFocus = undefined;
  if (groupPostingStrategyChoice) {
    groupPostingStrategyChoice.hidden = true;
  }
  document.body.classList.remove("group-posting-strategy-choice-open");
  resolve(strategy);
  returnFocus?.focus();
}

function initializeMarketplaceAudienceChoice() {
  marketplaceAudienceChoiceCancel?.addEventListener("click", () => {
    closeMarketplaceAudienceChoice(undefined);
  });
  marketplaceAudienceChoiceBackdrop?.addEventListener("click", () => {
    closeMarketplaceAudienceChoice(undefined);
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
      closeMarketplaceAudienceChoice(undefined);
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = [
      marketplaceAudienceChoiceCancel,
      marketplaceAudienceChoiceMarketplaceOnly,
      marketplaceAudienceChoiceWithGroups,
    ].filter((button): button is HTMLButtonElement => Boolean(button));
    if (focusable.length === 0) {
      return;
    }
    const currentIndex = focusable.indexOf(
      document.activeElement as HTMLButtonElement,
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

function requestMarketplaceAudienceChoice(): Promise<boolean | undefined> {
  if (
    !marketplaceAudienceChoice ||
    !marketplaceAudienceChoiceMarketplaceOnly ||
    !marketplaceAudienceChoiceWithGroups
  ) {
    return Promise.resolve(undefined);
  }
  if (marketplaceAudienceChoiceResolver) {
    closeMarketplaceAudienceChoice(undefined);
  }
  marketplaceAudienceChoiceReturnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  marketplaceAudienceChoice.hidden = false;
  document.body.classList.add("marketplace-audience-choice-open");
  marketplaceAudienceChoiceMarketplaceOnly.focus();
  return new Promise((resolve) => {
    marketplaceAudienceChoiceResolver = resolve;
  });
}

function closeMarketplaceAudienceChoice(
  shareToSuggestedGroups: boolean | undefined,
) {
  if (!marketplaceAudienceChoiceResolver) {
    return;
  }
  const resolve = marketplaceAudienceChoiceResolver;
  const returnFocus = marketplaceAudienceChoiceReturnFocus;
  marketplaceAudienceChoiceResolver = undefined;
  marketplaceAudienceChoiceReturnFocus = undefined;
  if (marketplaceAudienceChoice) {
    marketplaceAudienceChoice.hidden = true;
  }
  document.body.classList.remove("marketplace-audience-choice-open");
  resolve(shareToSuggestedGroups);
  returnFocus?.focus();
}

type WorkspaceTab = "groups" | "marketplace";

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
  document
    .querySelectorAll<HTMLButtonElement>(".condition-select__trigger")
    .forEach((trigger) => {
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
        "path",
      );
      path.setAttribute(
        "d",
        "M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z",
      );
      svg.append(path);
      icon.append(svg);
      trigger.prepend(icon);
    });
}

function initializeDropdownChevronIcons() {
  document
    .querySelectorAll<HTMLElement>(
      ".custom-select__chevron, .category-select__chevron, .condition-select__chevron",
    )
    .forEach((chevron) => {
      const createChevron = (className: string, pathData: string) => {
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.classList.add(className);
        svg.setAttribute("width", "32");
        svg.setAttribute("height", "32");
        svg.setAttribute("fill", "currentColor");
        svg.setAttribute("viewBox", "0 0 256 256");
        svg.setAttribute("aria-hidden", "true");

        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute("d", pathData);
        svg.append(path);
        return svg;
      };

      const downChevron = createChevron(
        "dropdown-chevron__down",
        "M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z",
      );
      const upChevron = createChevron(
        "dropdown-chevron__up",
        "M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z",
      );
      chevron.replaceChildren(downChevron, upChevron);
    });
}

function selectWorkspaceTab(tab: WorkspaceTab) {
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
marketplaceTab?.addEventListener("click", () =>
  selectWorkspaceTab("marketplace"),
);

function openListingTypeDropdown(focusIndex?: number, focusDirection = 1) {
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

  if (focusIndex !== undefined) {
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

function selectListingType(option: HTMLElement, allowDisabled = false) {
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

  configureMarketplacePhotoUploader(value as MarketplaceListingType);
  configureMarketplaceVehicleTypeField(value as MarketplaceListingType);
  updateMarketplaceSaveListingButtonState();

  closeListingTypeDropdown(true);
}

function configureMarketplacePhotoUploader(type: MarketplaceListingType) {
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
      limit,
    );
    showMarketplacePhotoStatus(
      `${removedCount} ${removedCount === 1 ? "photo was" : "photos were"} removed to match the ${limit}-photo limit.`,
      true,
    );
  } else {
    hideMarketplacePhotoStatus();
  }

  syncMarketplaceImagesInput();
  renderMarketplacePhotoPreviews();
  updateMarketplaceSaveListingButtonState();
}

function configureMarketplaceVehicleTypeField(type?: MarketplaceListingType) {
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
    vehicleSelected,
  );
  setMarketplaceFieldAvailability(marketplaceRentalTypeField, homeSelected);
  setMarketplaceFieldAvailability(marketplaceHomeDetailsFields, homeSelected);
  setMarketplaceFieldAvailability(
    marketplaceTitleField,
    itemSelected || homeSelected,
  );
  setMarketplaceFieldAvailability(marketplacePriceField, listingSelected);
  setMarketplaceFieldAvailability(
    marketplaceCategoryField,
    itemSelected || homeSelected,
  );
  setMarketplaceFieldAvailability(
    marketplaceConditionField,
    itemSelected || homeSelected,
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

function arrangeMarketplaceListingFields(type?: MarketplaceListingType) {
  if (
    !marketplaceListingFields ||
    !marketplacePhotosField ||
    !marketplaceVehicleTypeField ||
    !marketplaceTitleField ||
    !marketplacePriceField ||
    !marketplaceCategoryField ||
    !marketplaceDescriptionField ||
    !marketplaceLocationField
  ) {
    return;
  }

  if (type === "vehicle") {
    marketplaceListingFields.insertBefore(
      marketplaceVehicleTypeField,
      marketplacePhotosField,
    );
    marketplacePhotosField.insertAdjacentElement(
      "afterend",
      marketplaceLocationField,
    );
    marketplaceVehicleMileageField?.insertAdjacentElement(
      "afterend",
      marketplacePriceField,
    );
    return;
  }

  marketplacePhotosField.insertAdjacentElement(
    "afterend",
    marketplaceVehicleTypeField,
  );
  marketplaceTitleField.insertAdjacentElement(
    "afterend",
    marketplacePriceField,
  );
  marketplaceDescriptionField.insertAdjacentElement(
    "afterend",
    marketplaceLocationField,
  );
}

function setMarketplaceFieldAvailability(
  container: HTMLElement | null,
  available: boolean,
) {
  if (!container) {
    return;
  }

  container.hidden = !available;
  container
    .querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement
    >("input, button, textarea")
    .forEach((control) => {
      control.disabled = !available;
    });
}

function isMarketplaceListingFormComplete() {
  if (
    !selectedMarketplaceListingType ||
    selectedMarketplaceImageFiles.length === 0 ||
    !marketplaceListingFields
  ) {
    return false;
  }

  const controls = Array.from(
    marketplaceListingFields.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input[name]:not(:disabled), textarea[name]:not(:disabled)"),
  ).filter(
    (control) =>
      !(control instanceof HTMLInputElement) ||
      (control.type !== "file" && control.type !== "checkbox"),
  );

  if (!controls.every((control) => control.value.trim().length > 0)) {
    return false;
  }

  if (selectedMarketplaceListingType === "vehicle") {
    const mileage = Number(marketplaceVehicleMileageInput?.value ?? 0);
    if (!Number.isInteger(mileage) || mileage < 300 || mileage > 1_000_000) {
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
  const savedLimitReached =
    !editingMarketplaceListingId &&
    currentExtensionAccess?.access.remaining.saved_marketplace_listings === 0;
  saveMarketplaceListingButton.disabled =
    isMarketplaceListingSaving || !complete || savedLimitReached;
  saveMarketplaceListingButton.title = savedLimitReached
    ? "Free accounts can save up to 5 Marketplace listings. Upgrade to add unlimited listings."
    : complete
      ? editingMarketplaceListingId
        ? "Update this listing"
        : "Save this listing"
      : "Complete all listing fields and add at least one photo";
}

function updatePreparedPostSaveButtonState() {
  if (!savePreparedPostButton) {
    return;
  }
  const savedLimitReached =
    !editingPreparedPostId &&
    currentExtensionAccess?.access.remaining.saved_group_posts === 0;
  const hasRequiredContent =
    (postBodyInput?.value.trim().length ?? 0) > 0 &&
    selectedImageFiles.length > 0;
  savePreparedPostButton.disabled = savedLimitReached || !hasRequiredContent;
  savePreparedPostButton.title = savedLimitReached
    ? "Free accounts can save up to 5 prepared Group posts. Upgrade to add unlimited posts."
    : !hasRequiredContent
      ? "Add a post body and at least one image"
      : editingPreparedPostId
        ? "Update this prepared post"
        : "Add this prepared post";
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

function queueMarketplacePhotos(files: File[]) {
  marketplacePhotoAdditionQueue = marketplacePhotoAdditionQueue
    .then(() => addMarketplacePhotos(files))
    .catch((error: unknown) => {
      showMarketplacePhotoStatus(
        error instanceof Error ? error.message : "Unable to add photos.",
        true,
      );
    });
}

async function addMarketplacePhotos(files: File[]) {
  if (!selectedMarketplaceListingType) {
    showMarketplacePhotoStatus(
      "Select a listing type before adding photos.",
      true,
    );
    return;
  }

  const limit = MARKETPLACE_PHOTO_LIMITS[selectedMarketplaceListingType];
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  const { uniqueImages, duplicateCount } = await removeDuplicateImages(
    imageFiles,
    selectedMarketplaceImageFiles,
  );
  const remainingSlots = Math.max(
    limit - selectedMarketplaceImageFiles.length,
    0,
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
      true,
    );
  } else if (rejectedForType > 0) {
    showMarketplacePhotoStatus("Only image files can be added.", true);
  } else if (duplicateCount > 0) {
    showMarketplacePhotoStatus(
      `${duplicateCount} duplicate ${duplicateCount === 1 ? "photo was" : "photos were"} skipped.`,
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
      selectedMarketplaceImageFiles.length,
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
      `Photo ${index + 1} of ${selectedMarketplaceImageFiles.length}. Click to preview or drag to reorder.`,
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
      if (
        draggedMarketplacePhotoIndex === undefined ||
        draggedMarketplacePhotoIndex === index
      ) {
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

      if (draggedMarketplacePhotoIndex === undefined) {
        return;
      }

      moveMarketplacePhoto(draggedMarketplacePhotoIndex, index);
    });

    preview.addEventListener("dragend", () => {
      draggedMarketplacePhotoIndex = undefined;
      marketplacePhotoPreviews
        .querySelectorAll<HTMLElement>(".marketplace-photo-preview")
        .forEach((candidate) => {
          candidate.classList.remove(
            "marketplace-photo-preview--dragging",
            "marketplace-photo-preview--drop-target",
          );
        });
    });

    preview.addEventListener("keydown", (event) => {
      if (
        event.target === preview &&
        (event.key === "Enter" || event.key === " ")
      ) {
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

function moveMarketplacePhoto(fromIndex: number, toIndex: number) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= selectedMarketplaceImageFiles.length ||
    toIndex >= selectedMarketplaceImageFiles.length
  ) {
    return;
  }

  const [movedPhoto] = selectedMarketplaceImageFiles.splice(fromIndex, 1);
  if (!movedPhoto) {
    return;
  }

  selectedMarketplaceImageFiles.splice(toIndex, 0, movedPhoto);
  draggedMarketplacePhotoIndex = undefined;
  syncMarketplaceImagesInput();
  renderMarketplacePhotoPreviews();
  showMarketplacePhotoStatus("Photo order updated.");
}

function openMarketplacePhotoLightbox(index: number, returnFocus: HTMLElement) {
  openPhotoLightbox("marketplace", index, returnFocus);
}

function openGroupsPhotoLightbox(index: number, returnFocus: HTMLElement) {
  openPhotoLightbox("groups", index, returnFocus);
}

function getPhotoLightboxFiles() {
  return photoLightboxSource === "groups"
    ? selectedImageFiles
    : selectedMarketplaceImageFiles;
}

function openPhotoLightbox(
  source: "groups" | "marketplace",
  index: number,
  returnFocus: HTMLElement,
) {
  const files =
    source === "groups" ? selectedImageFiles : selectedMarketplaceImageFiles;
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
    marketplacePhotoLightboxTitle.textContent =
      source === "groups" ? "Post image preview" : "Photo preview";
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
  const previewUrl =
    marketplacePhotoLightboxUrls[marketplacePhotoLightboxIndex];
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
    marketplacePhotoLightboxPrevious.disabled =
      marketplacePhotoLightboxIndex === 0;
  }
  if (marketplacePhotoLightboxNext) {
    marketplacePhotoLightboxNext.disabled =
      marketplacePhotoLightboxIndex === files.length - 1;
  }

  marketplacePhotoLightboxThumbnails
    ?.querySelectorAll<HTMLButtonElement>(
      ".marketplace-photo-lightbox__thumbnail",
    )
    .forEach((thumbnail, index) => {
      const active = index === marketplacePhotoLightboxIndex;
      thumbnail.classList.toggle(
        "marketplace-photo-lightbox__thumbnail--active",
        active,
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

function moveMarketplacePhotoLightbox(direction: -1 | 1) {
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
  marketplacePhotoLightboxReturnFocus = undefined;
}

function showMarketplacePhotoStatus(message: string, isError = false) {
  if (!marketplacePhotoStatus) {
    return;
  }

  marketplacePhotoStatus.hidden = false;
  marketplacePhotoStatus.textContent = message;
  marketplacePhotoStatus.classList.toggle(
    "marketplace-photo-status--error",
    isError,
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

function focusListingTypeOption(index: number, direction = 1) {
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
      (option) => option.getAttribute("aria-selected") === "true",
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

function createMarketplaceCategoryIcon(pathData: string) {
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
      groupElement.append(createMarketplaceCategoryOption(group, undefined));
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

    const options = group.options.map((option) =>
      createMarketplaceCategoryOption(group, option),
    );
    groupElement.append(heading, ...options);
    return groupElement;
  });

  marketplaceCategoryOptions.replaceChildren(...groups);
  marketplaceCategoryOptionElements = Array.from(
    marketplaceCategoryOptions.querySelectorAll<HTMLElement>(
      ".category-select__option",
    ),
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
          marketplaceCategoryOptionElements.length - 1,
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

function createMarketplaceCategoryOption(
  group: MarketplaceCategoryGroup,
  option: MarketplaceCategoryOption | undefined,
) {
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
  check.textContent = "✓";
  optionElement.append(copy, check);
  return optionElement;
}

function openMarketplaceCategoryDropdown(focusIndex?: number) {
  if (
    !marketplaceCategorySelect ||
    !marketplaceCategoryTrigger ||
    !marketplaceCategoryOptions
  ) {
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

  if (focusIndex !== undefined) {
    marketplaceCategoryOptionElements[focusIndex]?.focus();
  }
}

function closeMarketplaceCategoryDropdown(returnFocus = false) {
  if (
    !marketplaceCategorySelect ||
    !marketplaceCategoryTrigger ||
    !marketplaceCategoryOptions
  ) {
    return;
  }

  marketplaceCategoryOptions.hidden = true;
  marketplaceCategoryOptions.style.maxHeight = "";
  marketplaceCategorySelect.classList.remove(
    "category-select--open",
    "category-select--open-upward",
  );
  marketplaceCategoryTrigger.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    marketplaceCategoryTrigger.focus();
  }
}

function positionMarketplaceCategoryDropdown() {
  if (
    !marketplaceCategorySelect ||
    !marketplaceCategoryTrigger ||
    !marketplaceCategoryOptions ||
    marketplaceCategoryOptions.hidden
  ) {
    return;
  }

  marketplaceCategorySelect.classList.remove("category-select--open-upward");
  marketplaceCategoryOptions.style.maxHeight = "";

  const viewportPadding = 12;
  const triggerRect = marketplaceCategoryTrigger.getBoundingClientRect();
  const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
  const spaceBelow = Math.max(
    window.innerHeight - triggerRect.bottom - viewportPadding,
    0,
  );
  const preferredHeight = Math.min(
    marketplaceCategoryOptions.scrollHeight,
    window.innerHeight * 0.65,
    420,
  );
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableSpace = openUpward ? spaceAbove : spaceBelow;

  marketplaceCategorySelect.classList.toggle(
    "category-select--open-upward",
    openUpward,
  );
  marketplaceCategoryOptions.style.maxHeight = `${Math.max(
    Math.min(preferredHeight, availableSpace - 7),
    120,
  )}px`;
}

function selectMarketplaceCategory(option: HTMLElement) {
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

  const selectedIcon = option
    .closest<HTMLElement>(".category-select__group")
    ?.querySelector(".category-select__group-icon svg")
    ?.cloneNode(true);
  if (marketplaceCategorySelectedIcon && selectedIcon) {
    marketplaceCategorySelectedIcon.replaceChildren(selectedIcon);
  }

  closeMarketplaceCategoryDropdown(true);
}

function focusMarketplaceCategoryOption(index: number) {
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
      (option) => option.getAttribute("aria-selected") === "true",
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
    event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0,
  );
});

function openMarketplaceConditionDropdown(focusIndex?: number) {
  if (
    !marketplaceConditionSelect ||
    !marketplaceConditionTrigger ||
    !marketplaceConditionOptions
  ) {
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

  if (focusIndex !== undefined) {
    marketplaceConditionOptionElements[focusIndex]?.focus();
  }
}

function closeMarketplaceConditionDropdown(returnFocus = false) {
  if (
    !marketplaceConditionSelect ||
    !marketplaceConditionTrigger ||
    !marketplaceConditionOptions
  ) {
    return;
  }

  marketplaceConditionOptions.hidden = true;
  marketplaceConditionOptions.style.maxHeight = "";
  marketplaceConditionSelect.classList.remove(
    "condition-select--open",
    "condition-select--open-upward",
  );
  marketplaceConditionTrigger.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    marketplaceConditionTrigger.focus();
  }
}

function selectMarketplaceCondition(option: HTMLElement) {
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

function focusMarketplaceConditionOption(index: number) {
  const optionCount = marketplaceConditionOptionElements.length;
  if (optionCount === 0) {
    return;
  }

  const wrappedIndex = (index + optionCount) % optionCount;
  marketplaceConditionOptionElements[wrappedIndex]?.focus();
}

function positionMarketplaceConditionDropdown() {
  if (
    !marketplaceConditionSelect ||
    !marketplaceConditionTrigger ||
    !marketplaceConditionOptions ||
    marketplaceConditionOptions.hidden
  ) {
    return;
  }

  marketplaceConditionSelect.classList.remove("condition-select--open-upward");
  marketplaceConditionOptions.style.maxHeight = "";

  const viewportPadding = 12;
  const triggerRect = marketplaceConditionTrigger.getBoundingClientRect();
  const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
  const spaceBelow = Math.max(
    window.innerHeight - triggerRect.bottom - viewportPadding,
    0,
  );
  const preferredHeight = Math.min(
    marketplaceConditionOptions.scrollHeight,
    window.innerHeight * 0.55,
    280,
  );
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableSpace = openUpward ? spaceAbove : spaceBelow;

  marketplaceConditionSelect.classList.toggle(
    "condition-select--open-upward",
    openUpward,
  );
  marketplaceConditionOptions.style.maxHeight = `${Math.max(
    Math.min(preferredHeight, availableSpace - 7),
    120,
  )}px`;
}

marketplaceConditionTrigger?.addEventListener("click", () => {
  if (marketplaceConditionOptions?.hidden) {
    const selectedIndex = marketplaceConditionOptionElements.findIndex(
      (option) => option.getAttribute("aria-selected") === "true",
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
    event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0,
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
        marketplaceConditionOptionElements.length - 1,
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

  const options: HTMLElement[] = [];
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
    check.textContent = "✓";
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

function openMarketplaceYearDropdown(focusIndex?: number) {
  if (
    !marketplaceYearSelect ||
    !marketplaceYearTrigger ||
    !marketplaceYearOptions
  ) {
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

  if (focusIndex !== undefined) {
    marketplaceYearOptionElements[focusIndex]?.focus();
  }
}

function closeMarketplaceYearDropdown(returnFocus = false) {
  if (
    !marketplaceYearSelect ||
    !marketplaceYearTrigger ||
    !marketplaceYearOptions
  ) {
    return;
  }

  marketplaceYearOptions.hidden = true;
  marketplaceYearOptions.style.maxHeight = "";
  marketplaceYearSelect.classList.remove(
    "condition-select--open",
    "condition-select--open-upward",
  );
  marketplaceYearTrigger.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    marketplaceYearTrigger.focus();
  }
}

function selectMarketplaceYear(option: HTMLElement) {
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

function focusMarketplaceYearOption(index: number) {
  const optionCount = marketplaceYearOptionElements.length;
  if (optionCount === 0) {
    return;
  }

  const wrappedIndex = (index + optionCount) % optionCount;
  marketplaceYearOptionElements[wrappedIndex]?.focus();
}

function positionMarketplaceYearDropdown() {
  if (
    !marketplaceYearSelect ||
    !marketplaceYearTrigger ||
    !marketplaceYearOptions ||
    marketplaceYearOptions.hidden
  ) {
    return;
  }

  marketplaceYearSelect.classList.remove("condition-select--open-upward");
  marketplaceYearOptions.style.maxHeight = "";

  const viewportPadding = 12;
  const triggerRect = marketplaceYearTrigger.getBoundingClientRect();
  const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
  const spaceBelow = Math.max(
    window.innerHeight - triggerRect.bottom - viewportPadding,
    0,
  );
  const preferredHeight = Math.min(
    marketplaceYearOptions.scrollHeight,
    window.innerHeight * 0.65,
    420,
  );
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableSpace = openUpward ? spaceAbove : spaceBelow;

  marketplaceYearSelect.classList.toggle(
    "condition-select--open-upward",
    openUpward,
  );
  marketplaceYearOptions.style.maxHeight = `${Math.max(
    Math.min(preferredHeight, availableSpace - 7),
    120,
  )}px`;
}

marketplaceYearTrigger?.addEventListener("click", () => {
  if (marketplaceYearOptions?.hidden) {
    const selectedIndex = marketplaceYearOptionElements.findIndex(
      (option) => option.getAttribute("aria-selected") === "true",
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
    event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0,
  );
});

function openMarketplaceVehicleTypeDropdown(focusIndex?: number) {
  if (
    !marketplaceVehicleTypeSelect ||
    !marketplaceVehicleTypeTrigger ||
    !marketplaceVehicleTypeOptions
  ) {
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

  if (focusIndex !== undefined) {
    focusMarketplaceVehicleTypeOption(focusIndex);
  }
}

function closeMarketplaceVehicleTypeDropdown(returnFocus = false) {
  if (
    !marketplaceVehicleTypeSelect ||
    !marketplaceVehicleTypeTrigger ||
    !marketplaceVehicleTypeOptions
  ) {
    return;
  }

  marketplaceVehicleTypeOptions.hidden = true;
  marketplaceVehicleTypeOptions.style.maxHeight = "";
  marketplaceVehicleTypeSelect.classList.remove(
    "condition-select--open",
    "condition-select--open-upward",
  );
  marketplaceVehicleTypeTrigger.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    marketplaceVehicleTypeTrigger.focus();
  }
}

function selectMarketplaceVehicleType(option: HTMLElement) {
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

function focusMarketplaceVehicleTypeOption(index: number) {
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
  if (
    !marketplaceVehicleTypeSelect ||
    !marketplaceVehicleTypeTrigger ||
    !marketplaceVehicleTypeOptions ||
    marketplaceVehicleTypeOptions.hidden
  ) {
    return;
  }

  marketplaceVehicleTypeSelect.classList.remove(
    "condition-select--open-upward",
  );
  marketplaceVehicleTypeOptions.style.maxHeight = "";

  const viewportPadding = 12;
  const triggerRect = marketplaceVehicleTypeTrigger.getBoundingClientRect();
  const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
  const spaceBelow = Math.max(
    window.innerHeight - triggerRect.bottom - viewportPadding,
    0,
  );
  const preferredHeight = Math.min(
    marketplaceVehicleTypeOptions.scrollHeight,
    window.innerHeight * 0.65,
    360,
  );
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableSpace = openUpward ? spaceAbove : spaceBelow;

  marketplaceVehicleTypeSelect.classList.toggle(
    "condition-select--open-upward",
    openUpward,
  );
  marketplaceVehicleTypeOptions.style.maxHeight = `${Math.max(
    Math.min(preferredHeight, availableSpace - 7),
    120,
  )}px`;
}

marketplaceVehicleTypeTrigger?.addEventListener("click", () => {
  if (marketplaceVehicleTypeOptions?.hidden) {
    const selectedIndex = marketplaceVehicleTypeOptionElements.findIndex(
      (option) => option.getAttribute("aria-selected") === "true",
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
    event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0,
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
        marketplaceVehicleTypeOptionElements.length - 1,
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

function openMarketplaceBodyStyleDropdown(focusIndex?: number) {
  if (
    !marketplaceBodyStyleSelect ||
    !marketplaceBodyStyleTrigger ||
    !marketplaceBodyStyleOptions
  ) {
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

  if (focusIndex !== undefined) {
    marketplaceBodyStyleOptionElements[focusIndex]?.focus();
  }
}

function closeMarketplaceBodyStyleDropdown(returnFocus = false) {
  if (
    !marketplaceBodyStyleSelect ||
    !marketplaceBodyStyleTrigger ||
    !marketplaceBodyStyleOptions
  ) {
    return;
  }

  marketplaceBodyStyleOptions.hidden = true;
  marketplaceBodyStyleOptions.style.maxHeight = "";
  marketplaceBodyStyleSelect.classList.remove(
    "condition-select--open",
    "condition-select--open-upward",
  );
  marketplaceBodyStyleTrigger.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    marketplaceBodyStyleTrigger.focus();
  }
}

function selectMarketplaceBodyStyle(option: HTMLElement) {
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

function focusMarketplaceBodyStyleOption(index: number) {
  const optionCount = marketplaceBodyStyleOptionElements.length;
  if (optionCount === 0) {
    return;
  }

  const wrappedIndex = (index + optionCount) % optionCount;
  marketplaceBodyStyleOptionElements[wrappedIndex]?.focus();
}

function positionMarketplaceBodyStyleDropdown() {
  if (
    !marketplaceBodyStyleSelect ||
    !marketplaceBodyStyleTrigger ||
    !marketplaceBodyStyleOptions ||
    marketplaceBodyStyleOptions.hidden
  ) {
    return;
  }

  marketplaceBodyStyleSelect.classList.remove("condition-select--open-upward");
  marketplaceBodyStyleOptions.style.maxHeight = "";

  const viewportPadding = 12;
  const triggerRect = marketplaceBodyStyleTrigger.getBoundingClientRect();
  const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
  const spaceBelow = Math.max(
    window.innerHeight - triggerRect.bottom - viewportPadding,
    0,
  );
  const preferredHeight = Math.min(
    marketplaceBodyStyleOptions.scrollHeight,
    window.innerHeight * 0.65,
    420,
  );
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableSpace = openUpward ? spaceAbove : spaceBelow;

  marketplaceBodyStyleSelect.classList.toggle(
    "condition-select--open-upward",
    openUpward,
  );
  marketplaceBodyStyleOptions.style.maxHeight = `${Math.max(
    Math.min(preferredHeight, availableSpace - 7),
    120,
  )}px`;
}

marketplaceBodyStyleTrigger?.addEventListener("click", () => {
  if (marketplaceBodyStyleOptions?.hidden) {
    const selectedIndex = marketplaceBodyStyleOptionElements.findIndex(
      (option) => option.getAttribute("aria-selected") === "true",
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
    event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0,
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
        marketplaceBodyStyleOptionElements.length - 1,
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

function openMarketplaceVehicleConditionDropdown(focusIndex?: number) {
  if (
    !marketplaceVehicleConditionSelect ||
    !marketplaceVehicleConditionTrigger ||
    !marketplaceVehicleConditionOptions
  ) {
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

  if (focusIndex !== undefined) {
    marketplaceVehicleConditionOptionElements[focusIndex]?.focus();
  }
}

function closeMarketplaceVehicleConditionDropdown(returnFocus = false) {
  if (
    !marketplaceVehicleConditionSelect ||
    !marketplaceVehicleConditionTrigger ||
    !marketplaceVehicleConditionOptions
  ) {
    return;
  }

  marketplaceVehicleConditionOptions.hidden = true;
  marketplaceVehicleConditionOptions.style.maxHeight = "";
  marketplaceVehicleConditionSelect.classList.remove(
    "condition-select--open",
    "condition-select--open-upward",
  );
  marketplaceVehicleConditionTrigger.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    marketplaceVehicleConditionTrigger.focus();
  }
}

function selectMarketplaceVehicleCondition(option: HTMLElement) {
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

function focusMarketplaceVehicleConditionOption(index: number) {
  const optionCount = marketplaceVehicleConditionOptionElements.length;
  if (optionCount === 0) {
    return;
  }

  const wrappedIndex = (index + optionCount) % optionCount;
  marketplaceVehicleConditionOptionElements[wrappedIndex]?.focus();
}

function positionMarketplaceVehicleConditionDropdown() {
  if (
    !marketplaceVehicleConditionSelect ||
    !marketplaceVehicleConditionTrigger ||
    !marketplaceVehicleConditionOptions ||
    marketplaceVehicleConditionOptions.hidden
  ) {
    return;
  }

  marketplaceVehicleConditionSelect.classList.remove(
    "condition-select--open-upward",
  );
  marketplaceVehicleConditionOptions.style.maxHeight = "";

  const viewportPadding = 12;
  const triggerRect =
    marketplaceVehicleConditionTrigger.getBoundingClientRect();
  const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
  const spaceBelow = Math.max(
    window.innerHeight - triggerRect.bottom - viewportPadding,
    0,
  );
  const preferredHeight = Math.min(
    marketplaceVehicleConditionOptions.scrollHeight,
    window.innerHeight * 0.55,
    280,
  );
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableSpace = openUpward ? spaceAbove : spaceBelow;

  marketplaceVehicleConditionSelect.classList.toggle(
    "condition-select--open-upward",
    openUpward,
  );
  marketplaceVehicleConditionOptions.style.maxHeight = `${Math.max(
    Math.min(preferredHeight, availableSpace - 7),
    120,
  )}px`;
}

marketplaceVehicleConditionTrigger?.addEventListener("click", () => {
  if (marketplaceVehicleConditionOptions?.hidden) {
    const selectedIndex = marketplaceVehicleConditionOptionElements.findIndex(
      (option) => option.getAttribute("aria-selected") === "true",
    );
    openMarketplaceVehicleConditionDropdown(
      selectedIndex >= 0 ? selectedIndex : 0,
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
    event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0,
  );
});

marketplaceVehicleConditionOptionElements.forEach((option, index) => {
  option.addEventListener("click", () =>
    selectMarketplaceVehicleCondition(option),
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
        marketplaceVehicleConditionOptionElements.length - 1,
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

function openMarketplaceFuelTypeDropdown(focusIndex?: number) {
  if (
    !marketplaceFuelTypeSelect ||
    !marketplaceFuelTypeTrigger ||
    !marketplaceFuelTypeOptions
  ) {
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

  if (focusIndex !== undefined) {
    marketplaceFuelTypeOptionElements[focusIndex]?.focus();
  }
}

function closeMarketplaceFuelTypeDropdown(returnFocus = false) {
  if (
    !marketplaceFuelTypeSelect ||
    !marketplaceFuelTypeTrigger ||
    !marketplaceFuelTypeOptions
  ) {
    return;
  }

  marketplaceFuelTypeOptions.hidden = true;
  marketplaceFuelTypeOptions.style.maxHeight = "";
  marketplaceFuelTypeSelect.classList.remove(
    "condition-select--open",
    "condition-select--open-upward",
  );
  marketplaceFuelTypeTrigger.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    marketplaceFuelTypeTrigger.focus();
  }
}

function selectMarketplaceFuelType(option: HTMLElement) {
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

function focusMarketplaceFuelTypeOption(index: number) {
  const optionCount = marketplaceFuelTypeOptionElements.length;
  if (optionCount === 0) {
    return;
  }

  const wrappedIndex = (index + optionCount) % optionCount;
  marketplaceFuelTypeOptionElements[wrappedIndex]?.focus();
}

function positionMarketplaceFuelTypeDropdown() {
  if (
    !marketplaceFuelTypeSelect ||
    !marketplaceFuelTypeTrigger ||
    !marketplaceFuelTypeOptions ||
    marketplaceFuelTypeOptions.hidden
  ) {
    return;
  }

  marketplaceFuelTypeSelect.classList.remove("condition-select--open-upward");
  marketplaceFuelTypeOptions.style.maxHeight = "";

  const viewportPadding = 12;
  const triggerRect = marketplaceFuelTypeTrigger.getBoundingClientRect();
  const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
  const spaceBelow = Math.max(
    window.innerHeight - triggerRect.bottom - viewportPadding,
    0,
  );
  const preferredHeight = Math.min(
    marketplaceFuelTypeOptions.scrollHeight,
    window.innerHeight * 0.65,
    360,
  );
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableSpace = openUpward ? spaceAbove : spaceBelow;

  marketplaceFuelTypeSelect.classList.toggle(
    "condition-select--open-upward",
    openUpward,
  );
  marketplaceFuelTypeOptions.style.maxHeight = `${Math.max(
    Math.min(preferredHeight, availableSpace - 7),
    120,
  )}px`;
}

marketplaceFuelTypeTrigger?.addEventListener("click", () => {
  if (marketplaceFuelTypeOptions?.hidden) {
    const selectedIndex = marketplaceFuelTypeOptionElements.findIndex(
      (option) => option.getAttribute("aria-selected") === "true",
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
    event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0,
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
        marketplaceFuelTypeOptionElements.length - 1,
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

function openMarketplaceTransmissionDropdown(focusIndex?: number) {
  if (
    !marketplaceTransmissionSelect ||
    !marketplaceTransmissionTrigger ||
    !marketplaceTransmissionOptions
  ) {
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

  if (focusIndex !== undefined) {
    marketplaceTransmissionOptionElements[focusIndex]?.focus();
  }
}

function closeMarketplaceTransmissionDropdown(returnFocus = false) {
  if (
    !marketplaceTransmissionSelect ||
    !marketplaceTransmissionTrigger ||
    !marketplaceTransmissionOptions
  ) {
    return;
  }

  marketplaceTransmissionOptions.hidden = true;
  marketplaceTransmissionOptions.style.maxHeight = "";
  marketplaceTransmissionSelect.classList.remove(
    "condition-select--open",
    "condition-select--open-upward",
  );
  marketplaceTransmissionTrigger.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    marketplaceTransmissionTrigger.focus();
  }
}

function selectMarketplaceTransmission(option: HTMLElement) {
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

function focusMarketplaceTransmissionOption(index: number) {
  const optionCount = marketplaceTransmissionOptionElements.length;
  if (optionCount === 0) {
    return;
  }

  const wrappedIndex = (index + optionCount) % optionCount;
  marketplaceTransmissionOptionElements[wrappedIndex]?.focus();
}

function positionMarketplaceTransmissionDropdown() {
  if (
    !marketplaceTransmissionSelect ||
    !marketplaceTransmissionTrigger ||
    !marketplaceTransmissionOptions ||
    marketplaceTransmissionOptions.hidden
  ) {
    return;
  }

  marketplaceTransmissionSelect.classList.remove(
    "condition-select--open-upward",
  );
  marketplaceTransmissionOptions.style.maxHeight = "";

  const viewportPadding = 12;
  const triggerRect = marketplaceTransmissionTrigger.getBoundingClientRect();
  const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
  const spaceBelow = Math.max(
    window.innerHeight - triggerRect.bottom - viewportPadding,
    0,
  );
  const preferredHeight = Math.min(
    marketplaceTransmissionOptions.scrollHeight,
    window.innerHeight * 0.4,
    180,
  );
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableSpace = openUpward ? spaceAbove : spaceBelow;

  marketplaceTransmissionSelect.classList.toggle(
    "condition-select--open-upward",
    openUpward,
  );
  marketplaceTransmissionOptions.style.maxHeight = `${Math.max(
    Math.min(preferredHeight, availableSpace - 7),
    100,
  )}px`;
}

marketplaceTransmissionTrigger?.addEventListener("click", () => {
  if (marketplaceTransmissionOptions?.hidden) {
    const selectedIndex = marketplaceTransmissionOptionElements.findIndex(
      (option) => option.getAttribute("aria-selected") === "true",
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
    event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0,
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
        marketplaceTransmissionOptionElements.length - 1,
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
  (["exterior", "interior"] as MarketplaceVehicleColorKind[]).forEach(
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
            (option) => option.getAttribute("aria-selected") === "true",
          );
          openMarketplaceColorDropdown(
            kind,
            selectedIndex >= 0 ? selectedIndex : 0,
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
          event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0,
        );
      });

      dropdown.optionElements.forEach((option, index) => {
        option.addEventListener("click", () =>
          selectMarketplaceColor(kind, option),
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
              dropdown.optionElements.length - 1,
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
    },
  );
}

function openMarketplaceColorDropdown(
  kind: MarketplaceVehicleColorKind,
  focusIndex?: number,
) {
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
  if (focusIndex !== undefined) {
    dropdown.optionElements[focusIndex]?.focus();
  }
}

function closeMarketplaceColorDropdown(
  kind: MarketplaceVehicleColorKind,
  returnFocus = false,
) {
  const dropdown = marketplaceColorDropdowns[kind];
  if (!dropdown.select || !dropdown.trigger || !dropdown.options) {
    return;
  }

  dropdown.options.hidden = true;
  dropdown.options.style.maxHeight = "";
  dropdown.select.classList.remove(
    "condition-select--open",
    "condition-select--open-upward",
  );
  dropdown.trigger.setAttribute("aria-expanded", "false");
  if (returnFocus) {
    dropdown.trigger.focus();
  }
}

function closeMarketplaceColorDropdowns(except?: MarketplaceVehicleColorKind) {
  (["exterior", "interior"] as MarketplaceVehicleColorKind[]).forEach(
    (kind) => {
      if (kind !== except) {
        closeMarketplaceColorDropdown(kind);
      }
    },
  );
}

function selectMarketplaceColor(
  kind: MarketplaceVehicleColorKind,
  option: HTMLElement,
) {
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

function focusMarketplaceColorOption(
  kind: MarketplaceVehicleColorKind,
  index: number,
) {
  const options = marketplaceColorDropdowns[kind].optionElements;
  if (options.length === 0) {
    return;
  }
  options[(index + options.length) % options.length]?.focus();
}

function positionMarketplaceColorDropdown(kind: MarketplaceVehicleColorKind) {
  const dropdown = marketplaceColorDropdowns[kind];
  if (
    !dropdown.select ||
    !dropdown.trigger ||
    !dropdown.options ||
    dropdown.options.hidden
  ) {
    return;
  }

  dropdown.select.classList.remove("condition-select--open-upward");
  dropdown.options.style.maxHeight = "";
  const viewportPadding = 12;
  const triggerRect = dropdown.trigger.getBoundingClientRect();
  const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
  const spaceBelow = Math.max(
    window.innerHeight - triggerRect.bottom - viewportPadding,
    0,
  );
  const preferredHeight = Math.min(
    dropdown.options.scrollHeight,
    window.innerHeight * 0.65,
    420,
  );
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableSpace = openUpward ? spaceAbove : spaceBelow;

  dropdown.select.classList.toggle("condition-select--open-upward", openUpward);
  dropdown.options.style.maxHeight = `${Math.max(
    Math.min(preferredHeight, availableSpace - 7),
    120,
  )}px`;
}

function openMarketplaceRentalTypeDropdown(focusIndex?: number) {
  if (
    !marketplaceRentalTypeSelect ||
    !marketplaceRentalTypeTrigger ||
    !marketplaceRentalTypeOptions
  ) {
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

  if (focusIndex !== undefined) {
    marketplaceRentalTypeOptionElements[focusIndex]?.focus();
  }
}

function closeMarketplaceRentalTypeDropdown(returnFocus = false) {
  if (
    !marketplaceRentalTypeSelect ||
    !marketplaceRentalTypeTrigger ||
    !marketplaceRentalTypeOptions
  ) {
    return;
  }

  marketplaceRentalTypeOptions.hidden = true;
  marketplaceRentalTypeOptions.style.maxHeight = "";
  marketplaceRentalTypeSelect.classList.remove(
    "condition-select--open",
    "condition-select--open-upward",
  );
  marketplaceRentalTypeTrigger.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    marketplaceRentalTypeTrigger.focus();
  }
}

function selectMarketplaceRentalType(option: HTMLElement) {
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

function focusMarketplaceRentalTypeOption(index: number) {
  const optionCount = marketplaceRentalTypeOptionElements.length;
  if (optionCount === 0) {
    return;
  }
  marketplaceRentalTypeOptionElements[
    (index + optionCount) % optionCount
  ]?.focus();
}

function positionMarketplaceRentalTypeDropdown() {
  if (
    !marketplaceRentalTypeSelect ||
    !marketplaceRentalTypeTrigger ||
    !marketplaceRentalTypeOptions ||
    marketplaceRentalTypeOptions.hidden
  ) {
    return;
  }

  marketplaceRentalTypeSelect.classList.remove("condition-select--open-upward");
  marketplaceRentalTypeOptions.style.maxHeight = "";
  const viewportPadding = 12;
  const triggerRect = marketplaceRentalTypeTrigger.getBoundingClientRect();
  const spaceAbove = Math.max(triggerRect.top - viewportPadding, 0);
  const spaceBelow = Math.max(
    window.innerHeight - triggerRect.bottom - viewportPadding,
    0,
  );
  const preferredHeight = Math.min(
    marketplaceRentalTypeOptions.scrollHeight,
    window.innerHeight * 0.55,
    260,
  );
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const availableSpace = openUpward ? spaceAbove : spaceBelow;

  marketplaceRentalTypeSelect.classList.toggle(
    "condition-select--open-upward",
    openUpward,
  );
  marketplaceRentalTypeOptions.style.maxHeight = `${Math.max(
    Math.min(preferredHeight, availableSpace - 7),
    120,
  )}px`;
}

marketplaceRentalTypeTrigger?.addEventListener("click", () => {
  if (marketplaceRentalTypeOptions?.hidden) {
    const selectedIndex = marketplaceRentalTypeOptionElements.findIndex(
      (option) => option.getAttribute("aria-selected") === "true",
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
    event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0,
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
        marketplaceRentalTypeOptionElements.length - 1,
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
    (["exterior", "interior"] as MarketplaceVehicleColorKind[]).forEach(
      (kind) => {
        if (!marketplaceColorDropdowns[kind].select?.contains(eventTarget)) {
          closeMarketplaceColorDropdown(kind);
        }
      },
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
    "",
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
      true,
    );
    return;
  }
  marketplaceImagesInput?.click();
});

marketplacePhotoDropzone?.addEventListener("dragenter", (event) => {
  event.preventDefault();
  if (!marketplaceImagesInput?.disabled) {
    marketplacePhotoDropzone.classList.add(
      "marketplace-photo-dropzone--dragging",
    );
  }
});

marketplacePhotoDropzone?.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = marketplaceImagesInput?.disabled
      ? "none"
      : "copy";
  }
});

marketplacePhotoDropzone?.addEventListener("dragleave", () => {
  marketplacePhotoDropzone.classList.remove(
    "marketplace-photo-dropzone--dragging",
  );
});

marketplacePhotoDropzone?.addEventListener("drop", (event) => {
  event.preventDefault();
  marketplacePhotoDropzone.classList.remove(
    "marketplace-photo-dropzone--dragging",
  );

  if (marketplaceImagesInput?.disabled) {
    showMarketplacePhotoStatus(
      "Select a listing type before adding photos.",
      true,
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
  toggleButton.setAttribute("aria-controls", "groups-list");
  toggleButton.setAttribute("aria-expanded", String(groupsVisible));

  const toggleIcon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  toggleIcon.setAttribute("width", "32");
  toggleIcon.setAttribute("height", "32");
  toggleIcon.setAttribute("fill", "currentColor");
  toggleIcon.setAttribute("viewBox", "0 0 256 256");
  toggleIcon.setAttribute("aria-hidden", "true");

  const toggleIconPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  toggleIconPath.setAttribute(
    "d",
    groupsVisible
      ? "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,176H48V48H208V208Zm-32-80a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,128Z"
      : "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,176H48V48H208V208Zm-32-80a8,8,0,0,1-8,8H136v32a8,8,0,0,1-16,0V136H88a8,8,0,0,1,0-16h32V88a8,8,0,0,1,16,0v32h32A8,8,0,0,1,176,128Z",
  );
  toggleIcon.append(toggleIconPath);

  const toggleLabel = document.createElement("span");
  toggleLabel.textContent = groupsVisible ? "Collapse groups" : "Expand groups";
  toggleButton.append(toggleIcon, toggleLabel);
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
  const hasSelectedPreparedPosts = preparedPosts.some((post) => post.selected);
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
    hasSelectedPreparedPosts,
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
    Number.isInteger(enteredMaximum) && enteredMaximum >= minimumDelaySeconds
      ? enteredMaximum
      : Math.max(DEFAULT_MAX_SLEEP_SECONDS, minimumDelaySeconds);

  postIntervalMinInput.value = String(minimumDelaySeconds);
  postIntervalMaxInput.value = String(maximumDelaySeconds);
  updatePostingReadiness();
  scheduleSaveSidePanelSession();
}

function updatePostingButtonState(
  isAuthenticated = hasActiveExtensionAccess(),
  hasSelectedPreparedPosts = preparedPosts.some((post) => post.selected),
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
    startPostingButton.disabled = true;
    setButtonContent(startPostingButton, "Posting…");
    updatePausePostingButtonState();
    return;
  }

  startPostingButton.classList.remove("start-posting-btn--stop");
  const hasPostingAllowance =
    currentExtensionAccess?.access.remaining.group_posts_today !== 0;
  startPostingButton.disabled = !(
    isAuthenticated &&
    hasPostingAllowance &&
    hasSelectedPreparedPosts &&
    selectedGroupsCount > 0 &&
    hasValidSleepTime &&
    hasValidMaxPosts
  );
  setButtonContent(startPostingButton, "Start Posting");
  updatePausePostingButtonState();
}

function updatePausePostingButtonState() {
  if (pausePostingButton) {
    pausePostingButton.hidden = !isPostingActive;
    pausePostingButton.disabled =
      isStopRequestPending || isPauseResumeRequestPending;
    pausePostingButton.classList.toggle(
      "pause-posting-btn--resume",
      isPostingPaused,
    );

    const label = isPauseResumeRequestPending
      ? isPostingPaused
        ? "Resuming…"
        : "Pausing…"
      : isPostingPaused
        ? "Resume posting"
        : "Pause posting";
    setButtonContent(pausePostingButton, label, isPauseResumeRequestPending);
  }

  if (stopPostingButton) {
    stopPostingButton.hidden = !isPostingActive;
    stopPostingButton.disabled = isStopRequestPending;
    setButtonContent(
      stopPostingButton,
      isStopRequestPending ? "Stopping…" : "Stop posting",
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

chrome.runtime.onMessage.addListener(
  (
    message:
      | GroupExtractionStatusMessage
      | UiPostingStatusMessage
      | MarketplaceItemPostingStatusMessage
      | MarketplaceCleanupStatusMessage
      | AccessEntitlementsUpdatedMessage,
  ) => {
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

    if (
      message.type === "ACCESS_ENTITLEMENTS_UPDATED" &&
      currentExtensionAccess
    ) {
      currentExtensionAccess.access = message.access;
      updateExtensionAccessUi();
    }
  },
);

function updateMarketplaceCleanupStatus(
  message: MarketplaceCleanupStatusMessage,
) {
  if (marketplaceCleanupProgress) {
    marketplaceCleanupProgress.hidden = false;
  }
  const percent =
    message.total > 0
      ? Math.min(Math.round((message.processed / message.total) * 100), 100)
      : 0;
  if (marketplaceCleanupCount) {
    marketplaceCleanupCount.textContent =
      message.status === "warning"
        ? "Unable to verify listings"
        : message.total > 0
          ? `${message.processed}/${message.total} processed`
          : `${message.processed} listings scanned`;
  }
  if (marketplaceCleanupPercent) {
    marketplaceCleanupPercent.textContent =
      message.status === "warning" ? "—" : `${percent}%`;
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
    marketplaceCleanupRemaining.textContent =
      message.status === "warning"
        ? "—"
        : String(Math.max(message.total - message.processed, 0));
  }
  if (marketplaceCleanupMessage) {
    marketplaceCleanupMessage.textContent = message.error
      ? `${message.message} ${message.error}`
      : message.message;
  }
  appendMarketplaceCleanupLog(message);

  isMarketplaceCleanupActive = !(
    message.status === "done" ||
    message.status === "warning" ||
    (message.status === "failed" && message.total === 0)
  );
  updateMarketplaceCleanupControls();
  renderMarketplaceListings();
}

function appendMarketplaceCleanupLog(message: MarketplaceCleanupStatusMessage) {
  if (!marketplaceCleanupLog) return;
  const updatable =
    message.status === "scanning" || message.status === "deleting"
      ? marketplaceCleanupLog.querySelector<HTMLLIElement>(
          `li[data-status="${message.status}"]`,
        )
      : undefined;
  const item = updatable ?? document.createElement("li");
  item.dataset.status = message.status;
  const badge = document.createElement("span");
  badge.className = "posting-progress__log-badge";
  badge.textContent =
    message.status === "deleted"
      ? "Done"
      : message.status === "warning"
        ? "Warning"
        : message.status === "failed"
          ? "Fail"
          : message.status === "deleting"
            ? "Delete"
            : message.status === "scanning"
              ? "Scan"
              : "Info";
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

function createFacebookResponseCopyButton(
  responseBody: string,
): HTMLButtonElement {
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
    "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z",
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

function updateMarketplaceCleanupControls() {
  const rawDays = marketplaceCleanupDaysInput?.value.trim() ?? "";
  const days = Number(rawDays);
  const validDays =
    /^\d+$/.test(rawDays) && Number.isSafeInteger(days) && days >= 0;
  if (marketplaceCleanupDaysInput) {
    marketplaceCleanupDaysInput.disabled = isMarketplaceCleanupActive;
  }
  if (deleteOldMarketplaceListingsButton) {
    deleteOldMarketplaceListingsButton.disabled =
      isMarketplaceCleanupActive || !validDays || isMarketplacePostingActive;
    setButtonContent(
      deleteOldMarketplaceListingsButton,
      isMarketplaceCleanupActive ? "Cleaning up…" : "Delete old listings",
      isMarketplaceCleanupActive,
    );
  }
}

function updateMarketplaceItemPostingStatus(
  message: MarketplaceItemPostingStatusMessage,
) {
  if (marketplacePostingProgressCard) {
    marketplacePostingProgressCard.hidden = false;
  }
  if (marketplacePostingStatusMessage) {
    marketplacePostingStatusMessage.textContent = message.error
      ? `${message.message} ${message.error}`
      : message.message;
  }
  if (marketplacePostingStatusCount) {
    marketplacePostingStatusCount.textContent = `${message.successCount}/${message.total} successful posts`;
  }
  const processedCount = message.successCount + message.failedCount;
  const remainingCount = Math.max(message.total - processedCount, 0);
  const percent =
    message.total > 0
      ? Math.min(Math.round((processedCount / message.total) * 100), 100)
      : 0;
  if (marketplacePostingProgressPercent) {
    marketplacePostingProgressPercent.textContent = `${percent}%`;
  }
  if (marketplacePostingProgressBar) {
    marketplacePostingProgressBar.style.width = `${percent}%`;
  }
  if (marketplacePostingProgressSuccess) {
    marketplacePostingProgressSuccess.textContent = String(
      message.successCount,
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

function appendMarketplacePostingLog(
  message: MarketplaceItemPostingStatusMessage,
) {
  if (!marketplacePostingLog) {
    return;
  }
  marketplacePostingLog.hidden = false;
  if (message.status !== "waiting" && message.status !== "paused") {
    marketplacePostingLog
      .querySelectorAll<HTMLLIElement>('li[data-status="waiting"]')
      .forEach((item) => item.remove());
  }
  const existingWaitingItem =
    message.status === "waiting" || message.status === "paused"
      ? marketplacePostingLog.querySelector<HTMLLIElement>(
          `li[data-status="${message.status}"][data-listing-id="${CSS.escape(
            message.listingId ?? "queue",
          )}"]`,
        )
      : undefined;
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
  body.append(text);

  const count =
    message.current > 0 && message.total > 0
      ? `${message.current}/${message.total}`
      : "";
  if (count || message.error) {
    const meta = document.createElement("span");
    meta.className = "posting-progress__log-meta";
    meta.textContent = [count, message.error].filter(Boolean).join(" · ");
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
    marketplaceProgressFailedFilterButton,
  );
}

function getMarketplacePostingStatusLabel(
  status: MarketplaceItemPostingStatusMessage["status"],
) {
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
    const status = item.dataset.status;
    item.hidden =
      filter === "posted"
        ? status !== "posted"
        : filter === "pending"
          ? status !== "pending"
          : filter === "failed"
            ? status !== "failed" && status !== "rate_limited"
            : false;
  });
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

function toggleMarketplacePostingLogFilter(
  filter: Exclude<PostingLogFilter, "all">,
) {
  marketplacePostingLogFilter =
    marketplacePostingLogFilter === filter ? "all" : filter;
  applyPostingLogFilter(
    marketplacePostingLog,
    marketplacePostingLogFilter,
    marketplaceProgressPostedFilterButton,
    marketplaceProgressFailedFilterButton,
  );
}

function updateUiPostingStatus(message: UiPostingStatusMessage) {
  if (
    message.status === "posting" ||
    message.status === "waiting" ||
    message.status === "paused" ||
    message.status === "posted" ||
    message.status === "pending" ||
    message.status === "failed"
  ) {
    isPostingActive = true;
    isPostingPaused = message.status === "paused";
    if (message.status === "paused") {
      isPauseResumeRequestPending = false;
    }
  }

  updatePostingProgress(message);

  if (groupsStatusMessage) {
    groupsStatusMessage.textContent = message.error
      ? `${message.message}: ${message.error}`
      : message.message;
  }

  if (groupsStatusCount) {
    const acceptedCount = message.successCount ?? 0;
    const pendingCount = message.pendingCount ?? 0;
    const postedCount = Math.max(acceptedCount - pendingCount, 0);
    groupsStatusCount.textContent =
      message.successTarget !== undefined
        ? `${acceptedCount}/${message.successTarget} accepted · ${postedCount} posted · ${pendingCount} pending`
        : `${postedCount} posted · ${pendingCount} pending`;
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

function updatePostingProgress(message: UiPostingStatusMessage) {
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
    ? Math.max(message.successTarget! - successCount, 0)
    : Math.max(message.total - processedCount, 0);
  const percent = hasSuccessTarget
    ? message.successTarget! > 0
      ? Math.min(Math.round((successCount / message.successTarget!) * 100), 100)
      : 0
    : message.total > 0
      ? Math.round((processedCount / message.total) * 100)
      : 0;

  if (postingProgressTitle) {
    postingProgressTitle.textContent = hasSuccessTarget
      ? `${successCount}/${message.successTarget} accepted submissions`
      : `${processedCount}/${message.total} groups processed`;
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

  if (message.status !== "waiting" && message.status !== "paused") {
    postingProgressLog
      .querySelectorAll<HTMLLIElement>('li[data-status="waiting"]')
      .forEach((item) => item.remove());
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

  if (message.detail) {
    const detail = document.createElement("span");
    detail.className = "posting-progress__log-detail";
    detail.textContent = message.detail;
    body.append(detail);
  }

  if (count || message.error) {
    const meta = document.createElement("span");
    meta.className = "posting-progress__log-meta";
    meta.textContent = [count, message.error].filter(Boolean).join(" · ");
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
  applyPostingLogFilter(
    postingProgressLog,
    groupsPostingLogFilter,
    postingProgressPostedFilterButton,
    postingProgressFailedFilterButton,
    postingProgressPendingFilterButton,
  );
}

function getPostingStatusLabel(status: UiPostingStatusMessage["status"]) {
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
      const groupsSearchField =
        groupsSearchInput.closest<HTMLElement>(".field");
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

function showGroupsPhotoStatus(message: string, isError = false) {
  if (!groupsPhotoStatus) return;
  groupsPhotoStatus.hidden = false;
  groupsPhotoStatus.textContent = message;
  groupsPhotoStatus.classList.toggle(
    "marketplace-photo-status--error",
    isError,
  );
}

function hideGroupsPhotoStatus() {
  if (!groupsPhotoStatus) return;
  groupsPhotoStatus.hidden = true;
  groupsPhotoStatus.textContent = "";
  groupsPhotoStatus.classList.remove("marketplace-photo-status--error");
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
  updatePreparedPostSaveButtonState();
  scheduleSaveSidePanelSession();

  const rejectedForType = files.length - imageFiles.length;
  if (rejectedForType > 0) {
    showGroupsPhotoStatus("Only image files can be added.", true);
  } else if (duplicateCount > 0) {
    showGroupsPhotoStatus(
      `${duplicateCount} duplicate ${duplicateCount === 1 ? "image was" : "images were"} skipped.`,
    );
  } else {
    hideGroupsPhotoStatus();
  }
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
    selectedImageFiles.length > 0,
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
      `Image ${index + 1} of ${selectedImageFiles.length}. Click to preview or drag to reorder.`,
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
      if (
        draggedGroupPhotoIndex === undefined ||
        draggedGroupPhotoIndex === index
      ) {
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
      if (draggedGroupPhotoIndex !== undefined) {
        moveSelectedImage(draggedGroupPhotoIndex, index);
      }
    });

    preview.addEventListener("dragend", () => {
      draggedGroupPhotoIndex = undefined;
      imagePreviewList
        .querySelectorAll<HTMLElement>(".groups-photo-preview")
        .forEach((candidate) => {
          candidate.classList.remove(
            "marketplace-photo-preview--dragging",
            "marketplace-photo-preview--drop-target",
          );
        });
    });

    preview.addEventListener("keydown", (event) => {
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

  imagePreviewList.replaceChildren(...previews);
}

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
  scheduleSaveSidePanelSession();
}

function renderPreparedPosts() {
  if (!preparedPostsList) {
    return;
  }

  const selectedCount = preparedPosts.filter((post) => post.selected).length;

  if (preparedPostsCount) {
    preparedPostsCount.textContent = `${selectedCount} of ${preparedPosts.length} prepared posts selected`;
  }

  if (preparedPostsSelectAll) {
    preparedPostsSelectAll.hidden = preparedPosts.length === 0;
  }

  if (preparedPostsSelectAllCheckbox) {
    preparedPostsSelectAllCheckbox.checked =
      preparedPosts.length > 0 && selectedCount === preparedPosts.length;
    preparedPostsSelectAllCheckbox.indeterminate =
      selectedCount > 0 && selectedCount < preparedPosts.length;
  }

  if (preparedPosts.length === 0) {
    preparedPostsList.className = "empty-state";
    preparedPostsList.textContent = "Add your first prepared post above.";
    updatePostingReadiness();
    updatePreparedPostSaveButtonState();
    return;
  }

  const cards = preparedPosts.map((post, index) => {
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
    title.textContent = `Post ${index + 1}`;

    const mediaCount = document.createElement("span");
    mediaCount.textContent = `${post.images.length} ${
      post.images.length === 1 ? "image" : "images"
    }`;

    selection.append(checkbox, thumbnail, title, mediaCount);

    const excerpt = document.createElement("p");
    excerpt.className = "prepared-post-card__excerpt";
    excerpt.textContent = post.body;

    const actions = document.createElement("div");
    actions.className = "prepared-post-card__actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.disabled = isMarketplacePostingActive;
    editButton.disabled = isMarketplacePostingActive;
    editButton.addEventListener("click", () => editPreparedPost(post.id));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "prepared-post-card__delete";
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

function editPreparedPost(postId: string) {
  const post = preparedPosts.find((candidate) => candidate.id === postId);
  if (!post || !postBodyInput) {
    return;
  }

  editingPreparedPostId = post.id;
  postBodyInput.value = post.body;
  selectedImageFiles = post.images.map((image) =>
    dataUrlToFile(image.dataUrl, image.name, image.type),
  );
  imagePreviewsVisible = false;
  syncPostImagesInput();
  renderImagePreviews();

  if (savePreparedPostButton) {
    savePreparedPostButton.textContent = "Update Prepared Post";
  }
  updatePreparedPostSaveButtonState();
  if (cancelPostEditButton) {
    cancelPostEditButton.hidden = false;
  }

  postBodyInput.focus();
  postBodyInput.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deletePreparedPost(
  postId: string,
  button: HTMLButtonElement,
  card: HTMLElement,
) {
  const confirmed = await requestDeleteConfirmation(
    "Delete prepared post?",
    "This permanently removes the prepared post and all of its photos.",
  );
  if (!confirmed) {
    return;
  }
  button.disabled = true;
  button.textContent = "Deleting…";
  card.classList.add("prepared-post-card--deleting");
  card.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(
      `${AUTH_API_BASE_URL}/api/group-posts/${encodeURIComponent(postId)}`,
      { method: "DELETE", headers: authenticatedRequestHeaders() },
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
    showToast("Prepared post deleted.", "success");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Delete";
    card.classList.remove("prepared-post-card--deleting");
    card.removeAttribute("aria-busy");
    showToast(
      error instanceof Error ? error.message : "Unable to delete post.",
      "error",
    );
  }
}

function clearPreparedPostEditor() {
  editingPreparedPostId = undefined;
  if (postBodyInput) {
    postBodyInput.value = "";
  }
  selectedImageFiles = [];
  imagePreviewsVisible = false;
  syncPostImagesInput();
  renderImagePreviews();
  hideGroupsPhotoStatus();

  if (savePreparedPostButton) {
    savePreparedPostButton.textContent = "Add Prepared Post";
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
      "Add a post body and at least one image before saving the prepared post.",
      "warning",
    );
    return;
  }

  if (savePreparedPostButton) {
    savePreparedPostButton.disabled = true;
    savePreparedPostButton.textContent = editingPreparedPostId
      ? "Updating..."
      : "Adding...";
  }

  try {
    const form = new FormData();
    form.set("body", body);
    selectedImageFiles.forEach((file) =>
      form.append("images", file, file.name),
    );
    const editingId = editingPreparedPostId;
    const response = await fetch(
      editingId
        ? `${AUTH_API_BASE_URL}/api/group-posts/${encodeURIComponent(editingId)}`
        : `${AUTH_API_BASE_URL}/api/group-posts`,
      {
        method: editingId ? "PUT" : "POST",
        headers: authenticatedRequestHeaders(),
        body: form,
      },
    );
    if (!response.ok) {
      throw new Error(
        await readApiError(response, "Unable to save the prepared post."),
      );
    }

    clearPreparedPostEditor();
    await Promise.all([loadCloudPreparedPosts(), refreshAccessEntitlements()]);
    showToast(
      editingId ? "Prepared post updated." : "Prepared post added.",
      "success",
    );
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : "Unable to save the prepared post.",
      "error",
    );
    if (savePreparedPostButton) {
      savePreparedPostButton.textContent = editingPreparedPostId
        ? "Update Prepared Post"
        : "Add Prepared Post";
      updatePreparedPostSaveButtonState();
    }
  }
}

type CloudGroupPost = {
  id: string;
  body: string;
  images: { url: string; position: number }[];
};

async function loadCloudPreparedPosts() {
  try {
    const response = await fetch(`${AUTH_API_BASE_URL}/api/group-posts`, {
      headers: authenticatedRequestHeaders(),
    });
    if (!response.ok) {
      throw new Error(
        await readApiError(response, "Unable to load prepared posts."),
      );
    }
    const payload = (await response.json()) as { posts?: CloudGroupPost[] };
    const posts = Array.isArray(payload.posts) ? payload.posts : [];
    preparedPosts = await Promise.all(
      posts.map(async (post) => ({
        id: post.id,
        body: post.body,
        images: await Promise.all(
          [...post.images]
            .sort((left, right) => left.position - right.position)
            .map(cloudImageToUiPostImage),
        ),
        selected: true,
      })),
    );
    renderPreparedPosts();
  } catch (error) {
    console.error("Unable to load prepared posts", error);
    showToast(
      error instanceof Error ? error.message : "Unable to load prepared posts.",
      "error",
    );
  }
}

async function cloudImageToUiPostImage(image: {
  url: string;
}): Promise<UiPostImage> {
  const response = await fetch(image.url);
  if (!response.ok) {
    throw new Error("Unable to download a prepared post image.");
  }
  const blob = await response.blob();
  const pathname = new URL(image.url).pathname;
  const name =
    decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1)) ||
    "prepared-post-image";
  return fileToUiPostImage(new File([blob], name, { type: blob.type }));
}

async function readApiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
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
  const itemIds = savedMarketplaceListings
    .filter(isSupportedMarketplacePostingListing)
    .map((listing) => listing.id);
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
    daysOld === 0
      ? "This permanently deletes every active listing currently found in your Facebook Marketplace account, including listings created today. This cannot be undone."
      : `This permanently deletes every active listing in your Facebook Marketplace account that is older than ${daysOld} ${daysOld === 1 ? "day" : "days"}. This cannot be undone.`,
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
    marketplaceCleanupMessage.textContent = "Preparing Marketplace cleanup…";
  }
  updateMarketplaceCleanupControls();
  renderMarketplaceListings();
  scrollProgressPanelToBottom(marketplaceCleanupProgress);

  try {
    const response = await chrome.runtime.sendMessage<
      DeleteOldMarketplaceListingsRequest,
      UiPostingResponse
    >({
      type: "DELETE_OLD_MARKETPLACE_LISTINGS",
      daysOld,
    });
    if (!response?.ok) {
      throw new Error(
        response?.error ?? "Unable to start Marketplace cleanup.",
      );
    }
  } catch (error) {
    isMarketplaceCleanupActive = false;
    if (marketplaceCleanupMessage) {
      marketplaceCleanupMessage.textContent =
        error instanceof Error
          ? error.message
          : "Unable to start Marketplace cleanup.";
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
marketplaceGeminiHashtagsToggle?.addEventListener("change", () => {
  void saveMarketplacePostingSettings();
});
marketplaceShuffleItemsToggle?.addEventListener("change", () => {
  void saveMarketplacePostingSettings();
});
postSelectedMarketplaceItemsButton?.addEventListener("click", () => {
  const selectedListings = savedMarketplaceListings.filter(
    (listing) =>
      isSupportedMarketplacePostingListing(listing) &&
      selectedMarketplaceListingIds.has(listing.id),
  );
  void startMarketplaceItemQueue(selectedListings).catch((error: unknown) => {
    showMarketplaceSaveListingStatus(
      error instanceof Error
        ? error.message
        : "Unable to start the Marketplace posting queue.",
      true,
    );
    if (marketplacePostingStatusMessage) {
      marketplacePostingStatusMessage.textContent =
        error instanceof Error
          ? error.message
          : "Unable to start the Marketplace posting queue.";
    }
  });
});

pauseMarketplacePostingButton?.addEventListener("click", async () => {
  if (
    !isMarketplacePostingActive ||
    isMarketplacePauseRequestPending ||
    isMarketplaceStopRequestPending
  ) {
    return;
  }
  const shouldResume = isMarketplacePostingPaused;
  isMarketplacePauseRequestPending = true;
  setMarketplacePostingActive(true);
  try {
    const request:
      | PauseMarketplacePostingRequest
      | ResumeMarketplacePostingRequest = {
      type: shouldResume
        ? "RESUME_MARKETPLACE_POSTING"
        : "PAUSE_MARKETPLACE_POSTING",
    };
    const response = await chrome.runtime.sendMessage<
      PauseMarketplacePostingRequest | ResumeMarketplacePostingRequest,
      UiPostingResponse
    >(request);
    if (!response?.ok) {
      throw new Error(response?.error ?? "Unable to update Marketplace queue.");
    }
    isMarketplacePostingPaused = !shouldResume;
  } catch (error) {
    if (marketplacePostingStatusMessage) {
      marketplacePostingStatusMessage.textContent =
        error instanceof Error
          ? error.message
          : "Unable to update Marketplace queue.";
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
    const response = await chrome.runtime.sendMessage<
      StopMarketplacePostingRequest,
      UiPostingResponse
    >({ type: "STOP_MARKETPLACE_POSTING" });
    if (!response?.ok) {
      throw new Error(response?.error ?? "Unable to stop Marketplace queue.");
    }
  } catch (error) {
    isMarketplaceStopRequestPending = false;
    if (marketplacePostingStatusMessage) {
      marketplacePostingStatusMessage.textContent =
        error instanceof Error
          ? error.message
          : "Unable to stop Marketplace queue.";
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

geminiHashtagsToggle?.addEventListener("change", () => {
  void saveGeminiIncludeHashtags();
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
          (shouldResume
            ? "Unable to resume posting."
            : "Unable to pause posting."),
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
          ? "Unable to resume posting."
          : "Unable to pause posting.",
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
      throw new Error(response?.error ?? "Unable to stop posting.");
    }
  } catch (error) {
    isStopRequestPending = false;
    updatePostingButtonState();
    showToast(
      error instanceof Error ? error.message : "Unable to stop posting.",
      "error",
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
    showToast("Please add and select at least one prepared post.", "warning");
    return;
  }

  const minimumDelaySeconds = Number(
    postIntervalMinInput?.value ?? MIN_SLEEP_SECONDS,
  );
  const maximumDelaySeconds = Number(
    postIntervalMaxInput?.value ?? DEFAULT_MAX_SLEEP_SECONDS,
  );
  if (!isValidPostingInterval(minimumDelaySeconds, maximumDelaySeconds)) {
    showToast(
      `Posting intervals must be whole numbers of at least ${MIN_SLEEP_SECONDS} seconds, and the maximum cannot be below the minimum`,
      "warning",
    );
    return;
  }

  let maxPosts = Number(maxPostsInput?.value ?? DEFAULT_MAX_POSTS);
  if (!Number.isInteger(maxPosts) || maxPosts < MIN_MAX_POSTS) {
    showToast(
      "Maximum number of posts must be a whole number of at least 1.",
      "warning",
    );
    return;
  }

  try {
    const access = await refreshAccessEntitlements();
    const remaining = access.remaining.group_posts_today;
    if (remaining === 0) {
      const nextSlot = access.reset_at.group_posts_today
        ? ` The allowance resets ${formatAccessResetTime(access.reset_at.group_posts_today)}.`
        : "";
      showToast(
        `Your Free account has used all ${FREE_MAX_GROUP_POSTS} Group posts for today.${nextSlot}`,
        "warning",
      );
      return;
    }
    if (access.tier === "free" && remaining !== null) {
      maxPosts = Math.min(FREE_MAX_GROUP_POSTS, remaining);
    }
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : "Unable to check your posting allowance.",
      "error",
    );
    return;
  }

  const selectedGroups = loadedGroups.filter((group) =>
    selectedGroupIdList.includes(group.id),
  );

  if (selectedGroups.length === 0) {
    showToast(
      "Selected groups are no longer loaded. Click Load Groups and try again.",
      "warning",
    );
    return;
  }

  const postingStrategy = await requestGroupPostingStrategyChoice();
  if (!postingStrategy) {
    return;
  }

  const orderedPostingGroups =
    postingStrategy === "selected_order" && shuffleGroupsToggle?.checked
      ? shuffleItems(selectedGroups)
      : selectedGroups;
  const postingGroups = orderedPostingGroups;
  const postingPreparedPosts = shuffleItems(selectedPreparedPosts);

  isPostingActive = true;
  isPostingPaused = false;
  isStopRequestPending = false;
  isPauseResumeRequestPending = false;
  updatePostingButtonState();
  updateGroupsStatus("Preparing GraphQL posting...", 0);
  resetPostingProgress(postingGroups.length, maxPosts);
  scrollPostingProgressIntoView();

  try {
    await Promise.all([saveGeminiCustomPrompt(), saveGeminiIncludeHashtags()]);
    const request: StartUiPostingRequest = {
      type: "START_UI_POSTING",
      groups: postingGroups.map((group) => ({
        id: group.id,
        name: group.name,
        url: group.url,
      })),
      posts: postingPreparedPosts.map(({ id, body, images }) => ({
        id,
        body,
        images,
      })),
      minimumDelaySeconds,
      maximumDelaySeconds,
      maxPosts,
      postingStrategy,
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
    updatePostingReadiness();
    showToast(
      error instanceof Error
        ? error.message
        : "Unable to start GraphQL posting.",
      "error",
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
  void signInWithGoogle();
});

authLogoutButton?.addEventListener("click", () => {
  void signOutGoogleUser();
});

function hasActiveExtensionAccess(): boolean {
  return currentExtensionAccess?.active === true;
}

async function initializeExtensionAccess() {
  setAccessBusyState("Checking your Google account...");

  try {
    const storage = await chrome.storage.local.get([
      AUTH_SESSION_STORAGE_KEY,
      AUTH_SIGNED_OUT_STORAGE_KEY,
    ]);
    const storedSession = parseStoredAuthSession(
      storage[AUTH_SESSION_STORAGE_KEY],
    );
    if (storedSession && (await restoreApplicationSession(storedSession))) {
      updateExtensionAccessUi();
      return;
    }
    if (storage[AUTH_SIGNED_OUT_STORAGE_KEY] === true) {
      showSignedOut(
        "Continue with Google to access your saved posts and listings.",
      );
      return;
    }

    await exchangeGoogleIdentityToken(false);
  } catch (error) {
    currentExtensionAccess = undefined;
    showSignedOut(googleSignInErrorMessage(error, false));
  }
}

async function signInWithGoogle() {
  setAccessBusyState("Opening Google sign-in...");
  try {
    await exchangeGoogleIdentityToken(true);
    await Promise.all([loadCloudPreparedPosts(), loadMarketplaceListings()]);
  } catch (error) {
    currentExtensionAccess = undefined;
    showSignedOut(googleSignInErrorMessage(error, true));
  }
}

async function exchangeGoogleIdentityToken(interactive: boolean) {
  const result = (await chrome.identity.getAuthToken({ interactive })) as
    | string
    | { token?: string }
    | undefined;
  const googleToken =
    typeof result === "string" ? result : result?.token?.trim();
  if (!googleToken) {
    throw new Error(
      interactive
        ? "We couldn't complete Google sign-in. Please try again."
        : "Continue with Google to access your saved posts and listings.",
    );
  }
  currentGoogleAccessToken = googleToken;

  const response = await fetch(`${AUTH_API_BASE_URL}/api/auth/google`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${googleToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    session_token?: string;
    expires_at?: string;
    user?: {
      id?: string;
      email?: string;
      email_verified?: boolean;
      display_name?: string;
      avatar_url?: string;
      timezone?: string;
    };
    access?: AccessEntitlements;
  };
  if (
    !response.ok ||
    !payload.session_token ||
    !payload.expires_at ||
    !payload.user?.id ||
    !payload.user.email ||
    !payload.access
  ) {
    throw new Error(
      payload.error ??
        `Google sign-in failed with HTTP ${response.status} at ${AUTH_API_BASE_URL}.`,
    );
  }

  const user: AuthenticatedGoogleUser = {
    id: payload.user.id,
    email: payload.user.email,
    emailVerified: payload.user.email_verified === true,
    displayName: payload.user.display_name,
    avatarUrl: payload.user.avatar_url,
    timezone: payload.user.timezone,
  };
  const storedSession: StoredAuthSession = {
    sessionToken: payload.session_token,
    expiresAt: payload.expires_at,
    user,
  };
  currentExtensionAccess = {
    active: true,
    ...storedSession,
    access: payload.access,
  };
  await chrome.storage.local.set({
    [AUTH_SESSION_STORAGE_KEY]: storedSession,
  });
  await chrome.storage.local.remove(AUTH_SIGNED_OUT_STORAGE_KEY);
  updateExtensionAccessUi();
}

async function restoreApplicationSession(
  session: StoredAuthSession,
): Promise<boolean> {
  const response = await fetch(`${AUTH_API_BASE_URL}/api/me`, {
    headers: { Authorization: `Bearer ${session.sessionToken}` },
  });
  if (!response.ok) {
    await chrome.storage.local.remove(AUTH_SESSION_STORAGE_KEY);
    return false;
  }
  const payload = (await response.json()) as {
    user?: {
      id?: string;
      email?: string;
      email_verified?: boolean;
      display_name?: string;
      avatar_url?: string;
      timezone?: string;
    };
    access?: AccessEntitlements;
  };
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
      timezone: payload.user.timezone,
    },
    access: payload.access,
  };
  return true;
}

function parseStoredAuthSession(value: unknown): StoredAuthSession | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const session = value as Partial<StoredAuthSession>;
  if (
    typeof session.sessionToken !== "string" ||
    typeof session.expiresAt !== "string" ||
    !session.user ||
    typeof session.user.id !== "string" ||
    typeof session.user.email !== "string"
  ) {
    return undefined;
  }
  return session as StoredAuthSession;
}

async function signOutGoogleUser() {
  setAccessBusyState("Signing out...");
  const appSessionToken = currentExtensionAccess?.sessionToken;
  if (appSessionToken) {
    await fetch(`${AUTH_API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${appSessionToken}` },
    }).catch(() => undefined);
  }
  await chrome.storage.local.remove(AUTH_SESSION_STORAGE_KEY);
  await chrome.storage.local.set({ [AUTH_SIGNED_OUT_STORAGE_KEY]: true });

  let googleToken = currentGoogleAccessToken;
  if (!googleToken) {
    const result = (await chrome.identity
      .getAuthToken({ interactive: false })
      .catch(() => undefined)) as string | { token?: string } | undefined;
    googleToken = typeof result === "string" ? result : result?.token;
  }
  if (googleToken) {
    await chrome.identity.removeCachedAuthToken({ token: googleToken });
  }
  currentGoogleAccessToken = undefined;
  currentExtensionAccess = undefined;
  preparedPosts = [];
  savedMarketplaceListings = [];
  selectedMarketplaceListingIds.clear();
  renderPreparedPosts();
  renderMarketplaceListings();
  showSignedOut(
    "You're signed out. Continue with Google whenever you're ready.",
  );
}

function authenticatedRequestHeaders(): HeadersInit {
  const sessionToken = currentExtensionAccess?.sessionToken;
  if (!sessionToken) {
    throw new Error("Sign in with Google to continue.");
  }
  return { Authorization: `Bearer ${sessionToken}` };
}

async function refreshAccessEntitlements(): Promise<AccessEntitlements> {
  if (!currentExtensionAccess) {
    throw new Error("Sign in with Google to continue.");
  }
  const response = await fetch(`${AUTH_API_BASE_URL}/api/me`, {
    headers: authenticatedRequestHeaders(),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    access?: AccessEntitlements;
  };
  if (!response.ok || !payload.access) {
    throw new Error(
      payload.error ?? "Unable to refresh your account allowance.",
    );
  }
  currentExtensionAccess.access = payload.access;
  updateExtensionAccessUi();
  return payload.access;
}

function formatAccessUsage(used: number, limit: number | null): string {
  return limit === null ? `${used}` : `${used}/${limit}`;
}

function formatAccessResetTime(value: string): string {
  const timezone = currentExtensionAccess?.user.timezone ?? "UTC";
  const reset = new Date(value);
  if (Number.isNaN(reset.getTime())) {
    return `midnight (${timezone})`;
  }
  try {
    return `${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(reset)} (${timezone})`;
  } catch {
    return reset.toLocaleString();
  }
}

function renderAccessSummary(access?: AccessEntitlements) {
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
  if (access.tier === "pro") {
    if (accessSavedUsage) {
      accessSavedUsage.textContent = "Unlimited saved content and publishing";
    }
    if (accessPublishingUsage) {
      accessPublishingUsage.textContent = "No daily posting limits.";
    }
  } else {
    if (accessSavedUsage) {
      accessSavedUsage.textContent = `Saved: Groups ${formatAccessUsage(access.usage.saved_group_posts, access.limits.saved_group_posts)} · Marketplace ${formatAccessUsage(access.usage.saved_marketplace_listings, access.limits.saved_marketplace_listings)}`;
    }
    if (accessPublishingUsage) {
      accessPublishingUsage.textContent = `Today: Groups ${formatAccessUsage(access.usage.group_posts_today, access.limits.group_posts_today)} · Marketplace ${formatAccessUsage(access.usage.marketplace_listings_today, access.limits.marketplace_listings_today)}`;
    }
  }

  const nextReset = [
    access.remaining.group_posts_today === 0
      ? access.reset_at.group_posts_today
      : undefined,
    access.remaining.marketplace_listings_today === 0
      ? access.reset_at.marketplace_listings_today
      : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0];
  if (accessResetMessage) {
    const timezone = currentExtensionAccess?.user.timezone ?? "UTC";
    if (access.tier === "pro") {
      accessResetMessage.hidden = false;
      accessResetMessage.textContent = access.pro_lifetime
        ? "Lifetime Pro access."
        : access.pro_expires_at
          ? `Pro access expires ${formatAccessResetTime(access.pro_expires_at)}.`
          : "Pro access.";
    } else {
      accessResetMessage.hidden = false;
      accessResetMessage.textContent = nextReset
        ? `Daily limits reset at midnight (${timezone}). Your allowance resets ${formatAccessResetTime(nextReset.toISOString())}.`
        : `Daily limits reset at midnight (${timezone}).`;
    }
  }
}

function updateExtensionAccessUi() {
  const access = currentExtensionAccess;
  const active = access?.active === true;

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
    authPanelTitle.textContent = active
      ? `Welcome${access.user.displayName ? `, ${access.user.displayName}` : ""}.`
      : "Welcome";
  }

  if (authStatusMessage) {
    authStatusMessage.textContent = active
      ? "Your saved Groups posts and Marketplace listings are connected to this Google account."
      : "Connect your Google account to continue.";
  }

  if (authLoginButton) {
    authLoginButton.hidden = active;
    authLoginButton.disabled = false;
    authLoginButton.textContent = "Continue with Google";
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
      maxPostsInput.title =
        "Free accounts can publish up to 20 successful Group posts per day.";
      if (maxPostsNote) {
        maxPostsNote.textContent =
          "Free accounts are fixed at 20 successful Group posts per day. Failed attempts do not count.";
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
        maxPostsNote.textContent =
          "Published posts and posts waiting for approval count. Failed attempts do not. The queue cycles through selected Groups again when needed.";
      }
    }
  }

  updatePostingReadiness();
  updatePreparedPostSaveButtonState();
  updateMarketplaceSaveListingButtonState();
}

function showSignedOut(message: string) {
  if (createForm) {
    createForm.hidden = true;
  }
  if (authPanelTitle) {
    authPanelTitle.hidden = false;
    authPanelTitle.textContent = "Welcome";
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
    authLoginButton.textContent = "Continue with Google";
  }
  if (authLogoutButton) {
    authLogoutButton.hidden = true;
    authLogoutButton.disabled = false;
    authLogoutButton.textContent = "Sign out";
  }
  updatePostingReadiness();
}

function setAccessBusyState(message: string) {
  if (createForm) {
    createForm.hidden = true;
  }
  if (authPanelTitle) {
    authPanelTitle.hidden = false;
    authPanelTitle.textContent = "Checking your Google account...";
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

function googleSignInErrorMessage(
  error: unknown,
  interactive: boolean,
): string {
  const message = error instanceof Error ? error.message.trim() : "";
  const normalizedMessage = message.toLowerCase();
  if (
    normalizedMessage.includes("did not approve") ||
    normalizedMessage.includes("access denied") ||
    normalizedMessage.includes("user rejected") ||
    normalizedMessage.includes("cancel")
  ) {
    return "Sign-in was cancelled. Continue with Google whenever you're ready.";
  }
  if (!interactive) {
    return "Continue with Google to access your saved posts and listings.";
  }
  return "We couldn't complete Google sign-in. Please try again.";
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

function collectMarketplaceListingFields(): Record<
  string,
  SavedMarketplaceListingFieldValue
> {
  const fields: Record<string, SavedMarketplaceListingFieldValue> = {};
  if (selectedMarketplaceListingType) {
    fields["marketplace-listing-type"] = selectedMarketplaceListingType;
  }

  marketplaceListingFields
    ?.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input[name]:not(:disabled), textarea[name]:not(:disabled)")
    .forEach((control) => {
      if (control instanceof HTMLInputElement && control.type === "file") {
        return;
      }
      fields[control.name] =
        control instanceof HTMLInputElement && control.type === "checkbox"
          ? control.checked
          : control.value;
    });

  return fields;
}

async function saveMarketplaceListing() {
  if (!selectedMarketplaceListingType) {
    showMarketplaceSaveListingStatus(
      "Select a listing type before saving.",
      true,
    );
    return;
  }

  if (!isMarketplaceListingFormComplete()) {
    showMarketplaceSaveListingStatus(
      "Complete all listing fields and add at least one photo before saving.",
      true,
    );
    updateMarketplaceSaveListingButtonState();
    return;
  }

  isMarketplaceListingSaving = true;
  if (saveMarketplaceListingButton) {
    saveMarketplaceListingButton.disabled = true;
    saveMarketplaceListingButton.textContent = "Saving…";
  }

  try {
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        listing_type: selectedMarketplaceListingType,
        fields: collectMarketplaceListingFields(),
      }),
    );
    selectedMarketplaceImageFiles.forEach((file) =>
      form.append("images", file, file.name),
    );
    const editingId = editingMarketplaceListingId;
    const response = await fetch(
      editingId
        ? `${AUTH_API_BASE_URL}/api/marketplace-listings/${encodeURIComponent(editingId)}`
        : `${AUTH_API_BASE_URL}/api/marketplace-listings`,
      {
        method: editingId ? "PUT" : "POST",
        headers: authenticatedRequestHeaders(),
        body: form,
      },
    );
    if (!response.ok) {
      throw new Error(
        await readApiError(response, "Unable to save this listing."),
      );
    }
    showMarketplaceSaveListingStatus(
      `Listing ${editingId ? "updated" : "saved"} with ${selectedMarketplaceImageFiles.length} ${selectedMarketplaceImageFiles.length === 1 ? "photo" : "photos"}.`,
    );
    await Promise.all([loadMarketplaceListings(), refreshAccessEntitlements()]);
    clearMarketplaceListingEditor(false);
    showToast(
      editingId ? "Marketplace listing updated." : "Marketplace listing saved.",
      "success",
    );
  } catch (error) {
    console.error("Unable to save Marketplace listing", error);
    showMarketplaceSaveListingStatus(
      error instanceof Error
        ? error.message
        : "Unable to save this listing. Please try again.",
      true,
    );
  } finally {
    isMarketplaceListingSaving = false;
    if (saveMarketplaceListingButton) {
      saveMarketplaceListingButton.textContent = editingMarketplaceListingId
        ? "Update listing"
        : "Save listing";
    }
    updateMarketplaceSaveListingButtonState();
  }
}

async function loadMarketplaceListings() {
  if (savedMarketplaceListingsStatus) {
    savedMarketplaceListingsStatus.textContent = "Loading saved listings…";
    savedMarketplaceListingsStatus.removeAttribute("data-error");
  }
  try {
    const response = await fetch(
      `${AUTH_API_BASE_URL}/api/marketplace-listings`,
      {
        headers: authenticatedRequestHeaders(),
      },
    );
    if (!response.ok) {
      throw new Error(
        await readApiError(response, "Unable to load Marketplace listings."),
      );
    }
    const payload = (await response.json()) as {
      listings?: CloudMarketplaceListing[];
    };
    savedMarketplaceListings = Array.isArray(payload.listings)
      ? payload.listings
      : [];
    const savedItemIds = new Set(
      savedMarketplaceListings
        .filter(isSupportedMarketplacePostingListing)
        .map((listing) => listing.id),
    );
    selectedMarketplaceListingIds = new Set(
      [...selectedMarketplaceListingIds].filter((id) => savedItemIds.has(id)),
    );
    renderMarketplaceListings();
  } catch (error) {
    if (savedMarketplaceListingsStatus) {
      savedMarketplaceListingsStatus.textContent =
        error instanceof Error
          ? error.message
          : "Unable to load Marketplace listings.";
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
      savedMarketplaceListings.length,
    );
  }
  if (savedMarketplaceListingsStatus) {
    savedMarketplaceListingsStatus.textContent =
      savedMarketplaceListings.length === 0
        ? "Saved listings will appear here."
        : `${savedMarketplaceListings.length} saved ${savedMarketplaceListings.length === 1 ? "listing" : "listings"}.`;
    savedMarketplaceListingsStatus.removeAttribute("data-error");
  }

  updateMarketplaceListingSelectionState();

  const cards = savedMarketplaceListings.map((listing) => {
    const card = document.createElement("article");
    card.className = "saved-marketplace-listing";

    const firstImage = [...listing.images].sort(
      (left, right) => left.position - right.position,
    )[0];
    let media: HTMLElement;
    if (firstImage) {
      const image = document.createElement("img");
      image.className = "saved-marketplace-listing__thumbnail";
      image.src = firstImage.url;
      image.alt = "";
      media = image;
    } else {
      const placeholder = document.createElement("div");
      placeholder.className =
        "saved-marketplace-listing__thumbnail saved-marketplace-listing__placeholder";
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
      checkbox.disabled =
        isMarketplacePostingActive || isMarketplaceCleanupActive;
      checkbox.setAttribute(
        "aria-label",
        `Select ${marketplaceListingDisplayTitle(listing)} for posting`,
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
          checkbox.checked,
        );
        updateMarketplaceListingSelectionState();
      });
      content.append(selector);
      card.classList.toggle(
        "saved-marketplace-listing--selected",
        checkbox.checked,
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
      `${listing.images.length} photos`,
    ].join(" · ");

    const actions = document.createElement("div");
    actions.className = "saved-marketplace-listing__actions";
    if (isSupportedMarketplacePostingListing(listing)) {
      const postButton = document.createElement("button");
      postButton.type = "button";
      postButton.className = "saved-marketplace-listing__post";
      postButton.textContent = "Post to Facebook";
      const postingLimitReached =
        currentExtensionAccess?.access.remaining.marketplace_listings_today ===
        0;
      postButton.disabled =
        isMarketplacePostingActive ||
        isMarketplaceCleanupActive ||
        postingLimitReached;
      postButton.title = postingLimitReached
        ? "Your Free account has used its 20 Marketplace posts for today"
        : "Post this listing to Facebook Marketplace";
      postButton.addEventListener("click", () => {
        void postMarketplaceItem(listing, postButton);
      });
      actions.append(postButton);
    }
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.disabled =
      isMarketplacePostingActive || isMarketplaceCleanupActive;
    editButton.addEventListener("click", () => {
      void editMarketplaceListing(listing.id);
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "saved-marketplace-listing__delete";
    deleteButton.textContent = "Delete";
    deleteButton.disabled =
      isMarketplacePostingActive || isMarketplaceCleanupActive;
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
    isSupportedMarketplacePostingListing,
  );
  const selectedCount = itemListings.filter((listing) =>
    selectedMarketplaceListingIds.has(listing.id),
  ).length;
  if (marketplaceListingsSelectionCount) {
    marketplaceListingsSelectionCount.textContent = `${selectedCount} ${selectedCount === 1 ? "listing" : "listings"} selected`;
  }
  if (marketplaceListingsSelectAllCheckbox) {
    marketplaceListingsSelectAllCheckbox.checked =
      itemListings.length > 0 && selectedCount === itemListings.length;
    marketplaceListingsSelectAllCheckbox.indeterminate =
      selectedCount > 0 && selectedCount < itemListings.length;
    marketplaceListingsSelectAllCheckbox.disabled =
      itemListings.length === 0 ||
      isMarketplacePostingActive ||
      isMarketplaceCleanupActive;
  }
  if (postSelectedMarketplaceItemsButton) {
    const postingLimitReached =
      currentExtensionAccess?.access.remaining.marketplace_listings_today === 0;
    postSelectedMarketplaceItemsButton.disabled =
      selectedCount === 0 ||
      isMarketplacePostingActive ||
      isMarketplaceCleanupActive ||
      postingLimitReached;
    postSelectedMarketplaceItemsButton.title = postingLimitReached
      ? "Your Free account has used its 20 Marketplace posts for today"
      : "Post the selected listings to Facebook Marketplace";
  }
}

async function postMarketplaceItem(
  listing: CloudMarketplaceListing,
  button: HTMLButtonElement,
) {
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    const started = await startMarketplaceItemQueue([listing]);
    if (!started) {
      button.disabled = false;
      button.textContent = "Post to Facebook";
      return;
    }
    button.textContent = "Queued";
  } catch (error) {
    button.disabled = false;
    button.textContent = "Post to Facebook";
    showMarketplaceSaveListingStatus(
      error instanceof Error
        ? error.message
        : "Unable to publish Marketplace listing.",
      true,
    );
  }
}

function scrollMarketplacePostingProgressIntoView() {
  scrollProgressPanelToBottom(marketplacePostingProgress);
}

async function startMarketplaceItemQueue(
  selectedListings: CloudMarketplaceListing[],
): Promise<boolean> {
  const minimumDelaySeconds = Number(marketplaceIntervalMinInput?.value ?? 0);
  const maximumDelaySeconds = Number(marketplaceIntervalMaxInput?.value ?? 0);
  if (!isValidPostingInterval(minimumDelaySeconds, maximumDelaySeconds)) {
    throw new Error(
      "Marketplace posting intervals must be whole numbers of at least 60 seconds, and the maximum cannot be below the minimum.",
    );
  }
  if (selectedListings.length === 0) {
    throw new Error("Select at least one saved listing before posting.");
  }
  const shareToSuggestedGroups = await requestMarketplaceAudienceChoice();
  if (shareToSuggestedGroups === undefined) {
    return false;
  }
  const access = await refreshAccessEntitlements();
  const remaining = access.remaining.marketplace_listings_today;
  if (remaining !== null && selectedListings.length > remaining) {
    const nextSlot = access.reset_at.marketplace_listings_today
      ? ` The allowance resets ${formatAccessResetTime(access.reset_at.marketplace_listings_today)}.`
      : "";
    throw new Error(
      remaining === 0
        ? `Your Free account has used all 20 Marketplace posts for today.${nextSlot}`
        : `Your Free account has ${remaining} Marketplace ${remaining === 1 ? "post" : "posts"} remaining today. Select no more than ${remaining}.${nextSlot}`,
    );
  }
  if (
    marketplaceGeminiRewriteToggle?.checked &&
    !marketplaceGeminiApiKeyInput?.value.trim()
  ) {
    throw new Error("Add a Gemini API key or disable description rewriting.");
  }

  const orderedListings = marketplaceShuffleItemsToggle?.checked
    ? shuffleItems(selectedListings)
    : selectedListings;
  isMarketplacePostingPaused = false;
  isMarketplaceStopRequestPending = false;
  isMarketplacePauseRequestPending = false;
  setMarketplacePostingActive(true);
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
    marketplaceProgressFailedFilterButton,
  );
  if (marketplacePostingStatusMessage) {
    marketplacePostingStatusMessage.textContent = `Preparing ${orderedListings.length} selected ${orderedListings.length === 1 ? "listing" : "listings"}…`;
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
      orderedListings.length,
    );
  }

  try {
    await saveMarketplacePostingSettings();
    const listings = [];
    for (let index = 0; index < orderedListings.length; index += 1) {
      const listing = orderedListings[index];
      if (marketplacePostingStatusMessage) {
        marketplacePostingStatusMessage.textContent = `Downloading photos for listing ${index + 1}/${orderedListings.length}…`;
      }
      listings.push(await buildMarketplacePostingListing(listing, index));
    }

    const response = await chrome.runtime.sendMessage<
      StartMarketplaceItemPostingRequest,
      MarketplaceItemPostingResponse
    >({
      type: "START_MARKETPLACE_POSTING",
      listings,
      shareToSuggestedGroups,
      minimumDelaySeconds,
      maximumDelaySeconds,
      rewriteDescriptions: Boolean(marketplaceGeminiRewriteToggle?.checked),
      geminiApiKey: marketplaceGeminiApiKeyInput?.value.trim() ?? "",
      customPrompt: marketplaceGeminiPromptInput?.value.trim() ?? "",
      includeHashtags: Boolean(marketplaceGeminiHashtagsToggle?.checked),
    });
    if (!response?.ok) {
      throw new Error(
        response?.error ?? "Unable to start the Marketplace posting queue.",
      );
    }
    return true;
  } catch (error) {
    setMarketplacePostingActive(false);
    throw error;
  }
}

async function buildMarketplacePostingListing(
  listing: CloudMarketplaceListing,
  listingIndex: number,
) {
  const images = await Promise.all(
    [...listing.images]
      .sort((left, right) => left.position - right.position)
      .map(async (image) =>
        fileToUiPostImage(await cloudMarketplaceImageToFile(image)),
      ),
  );
  if (listing.listing_type === "vehicle") {
    const field = (name: string) => String(listing.fields[name] ?? "").trim();
    const vehicleType = marketplaceVehicleOptionLabel(
      field("marketplace-vehicle-type"),
    );
    const year = field("marketplace-year");
    const make = field("marketplace-vehicle-make");
    const model = field("marketplace-vehicle-model");
    const mileage = field("marketplace-vehicle-mileage");
    const price = field("marketplace-price");
    const bodyStyle = marketplaceVehicleOptionLabel(
      field("marketplace-body-style"),
    );
    const condition = marketplaceVehicleOptionLabel(
      field("marketplace-vehicle-condition"),
    );
    const fuelType = marketplaceVehicleOptionLabel(
      field("marketplace-fuel-type"),
    );
    const transmission = marketplaceVehicleOptionLabel(
      field("marketplace-transmission"),
    );
    const exteriorColor = marketplaceVehicleOptionLabel(
      field("marketplace-exterior-color"),
    );
    const interiorColor = marketplaceVehicleOptionLabel(
      field("marketplace-interior-color"),
    );
    const location = field("marketplace-location");
    if (
      !vehicleType ||
      !year ||
      !make ||
      !model ||
      !mileage ||
      !price ||
      !bodyStyle ||
      !condition ||
      !fuelType ||
      !transmission ||
      !exteriorColor ||
      !interiorColor ||
      !location ||
      images.length === 0
    ) {
      throw new Error(
        `“${marketplaceListingDisplayTitle(listing)}” is missing required vehicle details, location, or photos.`,
      );
    }
    return {
      listingType: "vehicle" as const,
      id: listing.id,
      vehicleType,
      year,
      make,
      model,
      mileage,
      price,
      bodyStyle,
      cleanTitle: listing.fields["marketplace-clean-title"] === true,
      condition,
      fuelType,
      transmission,
      exteriorColor,
      interiorColor,
      description: field("marketplace-description"),
      location,
      images: images.slice(0, 20),
      listingIndex,
    };
  }

  const title = String(listing.fields["marketplace-title"] ?? "").trim();
  const price = String(listing.fields["marketplace-price"] ?? "").trim();
  const category = String(listing.fields["marketplace-category"] ?? "").trim();
  const condition = marketplaceFacebookConditionLabel(
    String(listing.fields["marketplace-condition"] ?? ""),
  );
  if (
    !title ||
    !price ||
    !category ||
    !condition ||
    listing.images.length === 0
  ) {
    throw new Error(
      `“${marketplaceListingDisplayTitle(listing)}” needs a title, price, category, condition, and at least one photo.`,
    );
  }

  return {
    listingType: "item" as const,
    id: listing.id,
    title,
    price,
    category,
    condition,
    description: String(listing.fields["marketplace-description"] ?? ""),
    images,
    listingIndex,
  };
}

function isSupportedMarketplacePostingListing(
  listing: CloudMarketplaceListing,
) {
  return listing.listing_type === "item" || listing.listing_type === "vehicle";
}

function marketplaceVehicleOptionLabel(value: string) {
  const labels: Record<string, string> = {
    car_truck: "Car/Truck",
    rv_camper: "RV/Camper",
    commercial_industrial: "Commercial/Industrial",
    small_car: "Small Car",
    very_good: "Very good",
    plug_in_hybrid: "Plug-in hybrid",
    manual_transmission: "Manual transmission",
    automatic_transmission: "Automatic transmission",
    off_white: "Off white",
  };
  return (
    labels[value] ??
    value
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function setMarketplacePostingActive(active: boolean) {
  isMarketplacePostingActive = active;
  updateMarketplaceCleanupControls();
  if (pauseMarketplacePostingButton) {
    pauseMarketplacePostingButton.hidden = !active;
    pauseMarketplacePostingButton.disabled =
      isMarketplaceStopRequestPending || isMarketplacePauseRequestPending;
    pauseMarketplacePostingButton.dataset.paused = String(
      isMarketplacePostingPaused,
    );
    setButtonContent(
      pauseMarketplacePostingButton,
      isMarketplacePauseRequestPending
        ? isMarketplacePostingPaused
          ? "Resuming…"
          : "Pausing…"
        : isMarketplacePostingPaused
          ? "Resume posting"
          : "Pause posting",
      isMarketplacePauseRequestPending,
    );
  }
  if (stopMarketplacePostingButton) {
    stopMarketplacePostingButton.hidden = !active;
    stopMarketplacePostingButton.disabled = isMarketplaceStopRequestPending;
    setButtonContent(
      stopMarketplacePostingButton,
      isMarketplaceStopRequestPending ? "Stopping…" : "Stop posting",
      isMarketplaceStopRequestPending,
    );
  }
  document
    .querySelectorAll<HTMLButtonElement>(
      ".saved-marketplace-listing__actions button",
    )
    .forEach((button) => {
      button.disabled = active;
      if (
        !active &&
        button.classList.contains("saved-marketplace-listing__post")
      ) {
        button.textContent = "Post to Facebook";
      }
    });
  document
    .querySelectorAll<HTMLInputElement>(
      ".saved-marketplace-listing__selector input",
    )
    .forEach((checkbox) => {
      checkbox.disabled = active;
    });
  updateMarketplaceListingSelectionState();
}

function marketplaceFacebookConditionLabel(value: string) {
  return (
    {
      new: "New",
      used_like_new: "Used - Like New",
      used_good: "Used - Good",
      used_fair: "Used - Fair",
    }[value] ?? ""
  );
}

function marketplaceListingDisplayTitle(listing: CloudMarketplaceListing) {
  const title = String(listing.fields["marketplace-title"] ?? "").trim();
  const make = String(listing.fields["marketplace-vehicle-make"] ?? "").trim();
  const model = String(
    listing.fields["marketplace-vehicle-model"] ?? "",
  ).trim();
  return (
    title ||
    [make, model].filter(Boolean).join(" ") ||
    marketplaceListingTypeLabel(listing.listing_type)
  );
}

function marketplaceListingTypeLabel(type: MarketplaceListingType) {
  return type === "item"
    ? "Item for sale"
    : type === "vehicle"
      ? "Vehicle for sale"
      : "Home for sale or rent";
}

async function deleteMarketplaceListing(
  listingId: string,
  button: HTMLButtonElement,
) {
  const confirmed = await requestDeleteConfirmation(
    "Delete Marketplace listing?",
    "This permanently removes the saved listing and all of its photos.",
  );
  if (!confirmed) {
    return;
  }
  button.disabled = true;
  button.textContent = "Deleting…";
  try {
    const response = await fetch(
      `${AUTH_API_BASE_URL}/api/marketplace-listings/${encodeURIComponent(listingId)}`,
      { method: "DELETE", headers: authenticatedRequestHeaders() },
    );
    if (!response.ok) {
      throw new Error(
        await readApiError(response, "Unable to delete Marketplace listing."),
      );
    }
    if (editingMarketplaceListingId === listingId) {
      clearMarketplaceListingEditor();
    }
    savedMarketplaceListings = savedMarketplaceListings.filter(
      (listing) => listing.id !== listingId,
    );
    selectedMarketplaceListingIds.delete(listingId);
    renderMarketplaceListings();
    await refreshAccessEntitlements();
    showToast("Marketplace listing deleted.", "success");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Delete";
    showMarketplaceSaveListingStatus(
      error instanceof Error
        ? error.message
        : "Unable to delete Marketplace listing.",
      true,
    );
  }
}

async function editMarketplaceListing(listingId: string) {
  const listing = savedMarketplaceListings.find(
    (candidate) => candidate.id === listingId,
  );
  if (!listing) {
    return;
  }
  clearMarketplaceListingEditor(false);
  const listingTypeOption = listingTypeOptionElements.find(
    (option) => option.dataset.value === listing.listing_type,
  );
  if (!listingTypeOption) {
    showMarketplaceSaveListingStatus("Unsupported listing type.", true);
    return;
  }
  selectListingType(listingTypeOption, true);

  marketplaceListingFields
    ?.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input[name], textarea[name]")
    .forEach((control) => {
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
      [...listing.images]
        .sort((left, right) => left.position - right.position)
        .map(cloudMarketplaceImageToFile),
    );
  } catch (error) {
    showMarketplaceSaveListingStatus(
      error instanceof Error ? error.message : "Unable to load listing photos.",
      true,
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
  listingTypeSelect?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyMarketplaceSelectValues(
  fields: Record<string, string | boolean>,
) {
  selectSavedOption(
    marketplaceCategoryOptionElements,
    String(fields["marketplace-category"] ?? ""),
    selectMarketplaceCategory,
    (option) =>
      option.dataset.category === fields["marketplace-category-group"],
  );
  selectSavedOption(
    marketplaceConditionOptionElements,
    String(fields["marketplace-condition"] ?? ""),
    selectMarketplaceCondition,
  );
  selectSavedOption(
    marketplaceVehicleTypeOptionElements,
    String(fields["marketplace-vehicle-type"] ?? ""),
    selectMarketplaceVehicleType,
  );
  selectSavedOption(
    marketplaceYearOptionElements,
    String(fields["marketplace-year"] ?? ""),
    selectMarketplaceYear,
  );
  selectSavedOption(
    marketplaceBodyStyleOptionElements,
    String(fields["marketplace-body-style"] ?? ""),
    selectMarketplaceBodyStyle,
  );
  selectSavedOption(
    marketplaceVehicleConditionOptionElements,
    String(fields["marketplace-vehicle-condition"] ?? ""),
    selectMarketplaceVehicleCondition,
  );
  selectSavedOption(
    marketplaceFuelTypeOptionElements,
    String(fields["marketplace-fuel-type"] ?? ""),
    selectMarketplaceFuelType,
  );
  selectSavedOption(
    marketplaceTransmissionOptionElements,
    String(fields["marketplace-transmission"] ?? "automatic_transmission"),
    selectMarketplaceTransmission,
  );
  selectSavedOption(
    marketplaceColorDropdowns.exterior.optionElements,
    String(fields["marketplace-exterior-color"] ?? ""),
    (option) => selectMarketplaceColor("exterior", option),
  );
  selectSavedOption(
    marketplaceColorDropdowns.interior.optionElements,
    String(fields["marketplace-interior-color"] ?? ""),
    (option) => selectMarketplaceColor("interior", option),
  );
  selectSavedOption(
    marketplaceRentalTypeOptionElements,
    String(fields["marketplace-rental-type"] ?? ""),
    selectMarketplaceRentalType,
  );
}

function selectSavedOption(
  options: HTMLElement[],
  value: string,
  select: (option: HTMLElement) => void,
  extraMatch: (option: HTMLElement) => boolean = () => true,
) {
  if (!value) {
    return;
  }
  const option = options.find(
    (candidate) => candidate.dataset.value === value && extraMatch(candidate),
  );
  if (option) {
    select(option);
  }
}

async function cloudMarketplaceImageToFile(image: { url: string }) {
  const response = await fetch(image.url);
  if (!response.ok) {
    throw new Error("Unable to download a Marketplace listing image.");
  }
  const blob = await response.blob();
  const pathname = new URL(image.url).pathname;
  const name =
    decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1)) ||
    "marketplace-image";
  return new File([blob], name, { type: blob.type });
}

function clearMarketplaceListingEditor(hideStatus = true) {
  editingMarketplaceListingId = undefined;
  selectedMarketplaceListingType = undefined;
  selectedMarketplaceImageFiles = [];
  marketplaceListingFields
    ?.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input[name], textarea[name]")
    .forEach((control) => {
      if (control instanceof HTMLInputElement && control.type === "checkbox") {
        control.checked = false;
      } else if (control.type !== "file") {
        control.value = "";
      }
    });

  const resetOptions = (options: HTMLElement[]) => {
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
    marketplaceRentalTypeOptionElements,
  ].forEach(resetOptions);

  if (listingTypeValue) listingTypeValue.textContent = "Select listing type";
  if (listingTypeSelectedIcon)
    listingTypeSelectedIcon.innerHTML = listingTypeDefaultIconMarkup;
  if (marketplaceCategoryValue)
    marketplaceCategoryValue.textContent = "Select category";
  if (marketplaceCategorySelectedIcon)
    marketplaceCategorySelectedIcon.innerHTML =
      marketplaceCategoryDefaultIconMarkup;
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
    (option) => option.dataset.value === "automatic_transmission",
  );
  automaticTransmission?.setAttribute("aria-selected", "true");
  if (marketplaceColorDropdowns.exterior.value)
    marketplaceColorDropdowns.exterior.value.textContent =
      "Select exterior color";
  if (marketplaceColorDropdowns.interior.value)
    marketplaceColorDropdowns.interior.value.textContent =
      "Select interior color";
  if (marketplaceRentalTypeValue)
    marketplaceRentalTypeValue.textContent = "Select rental type";
  if (marketplaceTitleCount) marketplaceTitleCount.textContent = "0 / 200";

  marketplacePhotosField?.classList.add("marketplace-photos--disabled");
  marketplacePhotoDropzone?.setAttribute("aria-disabled", "true");
  if (marketplaceImagesInput) marketplaceImagesInput.disabled = true;
  if (marketplacePhotoLimit) marketplacePhotoLimit.textContent = "—";
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

function showMarketplaceSaveListingStatus(message: string, isError = false) {
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
      SIDE_PANEL_SESSION_STORAGE_KEY,
    ]);
    const session = storage[SIDE_PANEL_SESSION_STORAGE_KEY] as
      | Partial<SidePanelSession>
      | undefined;

    if (!session || typeof session !== "object") {
      renderImagePreviews();
      renderPreparedPosts();
      return;
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
      proMaxPostsPreference =
        Number.isInteger(session.maxPosts) && session.maxPosts >= MIN_MAX_POSTS
          ? session.maxPosts
          : DEFAULT_MAX_POSTS;
      maxPostsInput.value = String(proMaxPostsPreference);
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
    renderPreparedPosts();
  } catch (error) {
    console.log(
      "Unable to restore side panel session.",
      error instanceof Error ? error.message : error,
    );
    renderImagePreviews();
    renderPreparedPosts();
  } finally {
    isRestoringSidePanelSession = false;
    // Re-save the lightweight session shape so legacy base64 images and
    // prepared posts are removed from extension storage after an upgrade.
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
    const session: SidePanelSession = {
      minimumDelaySeconds: Number(
        postIntervalMinInput?.value ?? MIN_SLEEP_SECONDS,
      ),
      maximumDelaySeconds: Number(
        postIntervalMaxInput?.value ?? DEFAULT_MAX_SLEEP_SECONDS,
      ),
      intervalSettingsVersion: 2,
      maxPosts:
        currentExtensionAccess?.access.tier === "free"
          ? proMaxPostsPreference
          : Number(maxPostsInput?.value ?? DEFAULT_MAX_POSTS),
      shuffleGroups: Boolean(shuffleGroupsToggle?.checked),
      loadedGroups,
      selectedGroupIds: Array.from(selectedGroupIds),
      groupsSearchQuery,
      groupsVisible,
      imagePreviewsVisible,
    };

    await chrome.storage.local.set({
      [SIDE_PANEL_SESSION_STORAGE_KEY]: session,
    });
  } catch (error) {
    console.log(
      "Unable to save side panel session.",
      error instanceof Error ? error.message : error,
    );
  }
}

function resetPostingProgress(total: number, successTarget?: number) {
  if (postingProgress) {
    postingProgress.hidden = false;
  }

  if (postingProgressTitle) {
    postingProgressTitle.textContent = successTarget
      ? `0/${successTarget} accepted submissions`
      : `0/${total} groups processed`;
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
    postingProgressCurrent.textContent = "Preparing posting queue...";
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

  // Revealing and populating a progress panel changes its layout. Waiting for
  // two paint frames makes its 100dvh height available before aligning the
  // panel's bottom edge with the bottom of the extension viewport.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      panel.scrollIntoView({
        behavior: "smooth",
        block: "end",
        inline: "nearest",
      });
    });
  });
}

function shuffleItems<T>(items: T[]): T[] {
  const shuffledItems = [...items];

  for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledItems[index], shuffledItems[swapIndex]] = [
      shuffledItems[swapIndex],
      shuffledItems[index],
    ];
  }

  return shuffledItems;
}

async function initializeGeminiSettings() {
  const storage = await chrome.storage.local.get([
    GEMINI_API_KEY_STORAGE_KEY,
    GEMINI_REWRITE_ENABLED_STORAGE_KEY,
    GEMINI_CUSTOM_PROMPT_STORAGE_KEY,
    GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY,
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

  if (geminiCustomPromptInput) {
    geminiCustomPromptInput.value =
      typeof storage[GEMINI_CUSTOM_PROMPT_STORAGE_KEY] === "string"
        ? storage[GEMINI_CUSTOM_PROMPT_STORAGE_KEY]
        : "";
  }

  if (geminiHashtagsToggle) {
    geminiHashtagsToggle.checked =
      storage[GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY] !== false;
  }

  updateGeminiStatus();
}

async function saveGeminiApiKey() {
  const value = geminiApiKeyInput?.value.trim() ?? "";
  if (marketplaceGeminiApiKeyInput) {
    marketplaceGeminiApiKeyInput.value = value;
  }
  await chrome.storage.local.set({
    [GEMINI_API_KEY_STORAGE_KEY]: value,
  });
  updateGeminiStatus();
}

async function saveGeminiRewriteEnabled() {
  await chrome.storage.local.set({
    [GEMINI_REWRITE_ENABLED_STORAGE_KEY]: Boolean(geminiRewriteToggle?.checked),
  });
}

async function saveGeminiCustomPrompt() {
  await chrome.storage.local.set({
    [GEMINI_CUSTOM_PROMPT_STORAGE_KEY]:
      geminiCustomPromptInput?.value.trim() ?? "",
  });
}

async function saveGeminiIncludeHashtags() {
  await chrome.storage.local.set({
    [GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY]: Boolean(
      geminiHashtagsToggle?.checked,
    ),
  });
}

async function initializeMarketplacePostingSettings() {
  const storage = await chrome.storage.local.get([
    GEMINI_API_KEY_STORAGE_KEY,
    MARKETPLACE_GEMINI_REWRITE_ENABLED_STORAGE_KEY,
    MARKETPLACE_GEMINI_CUSTOM_PROMPT_STORAGE_KEY,
    MARKETPLACE_GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY,
    MARKETPLACE_MIN_INTERVAL_STORAGE_KEY,
    MARKETPLACE_MAX_INTERVAL_STORAGE_KEY,
    MARKETPLACE_SHUFFLE_ITEMS_STORAGE_KEY,
  ]);
  if (marketplaceGeminiApiKeyInput) {
    marketplaceGeminiApiKeyInput.value =
      typeof storage[GEMINI_API_KEY_STORAGE_KEY] === "string"
        ? storage[GEMINI_API_KEY_STORAGE_KEY]
        : "";
  }
  if (marketplaceGeminiRewriteToggle) {
    marketplaceGeminiRewriteToggle.checked =
      storage[MARKETPLACE_GEMINI_REWRITE_ENABLED_STORAGE_KEY] === true;
  }
  if (marketplaceGeminiPromptInput) {
    marketplaceGeminiPromptInput.value =
      typeof storage[MARKETPLACE_GEMINI_CUSTOM_PROMPT_STORAGE_KEY] === "string"
        ? storage[MARKETPLACE_GEMINI_CUSTOM_PROMPT_STORAGE_KEY]
        : "";
  }
  if (marketplaceGeminiHashtagsToggle) {
    marketplaceGeminiHashtagsToggle.checked =
      storage[MARKETPLACE_GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY] !== false;
  }
  if (marketplaceIntervalMinInput) {
    marketplaceIntervalMinInput.value = String(
      Number.isInteger(storage[MARKETPLACE_MIN_INTERVAL_STORAGE_KEY])
        ? storage[MARKETPLACE_MIN_INTERVAL_STORAGE_KEY]
        : MIN_SLEEP_SECONDS,
    );
  }
  if (marketplaceIntervalMaxInput) {
    marketplaceIntervalMaxInput.value = String(
      Number.isInteger(storage[MARKETPLACE_MAX_INTERVAL_STORAGE_KEY])
        ? storage[MARKETPLACE_MAX_INTERVAL_STORAGE_KEY]
        : DEFAULT_MAX_SLEEP_SECONDS,
    );
  }
  if (marketplaceShuffleItemsToggle) {
    marketplaceShuffleItemsToggle.checked =
      storage[MARKETPLACE_SHUFFLE_ITEMS_STORAGE_KEY] === true;
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
  const minimum =
    Number.isInteger(enteredMinimum) && enteredMinimum >= MIN_SLEEP_SECONDS
      ? enteredMinimum
      : MIN_SLEEP_SECONDS;
  const enteredMaximum = Number(marketplaceIntervalMaxInput.value);
  const maximum =
    Number.isInteger(enteredMaximum) && enteredMaximum >= minimum
      ? enteredMaximum
      : Math.max(DEFAULT_MAX_SLEEP_SECONDS, minimum);
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
      marketplaceGeminiRewriteToggle?.checked,
    ),
    [MARKETPLACE_GEMINI_CUSTOM_PROMPT_STORAGE_KEY]:
      marketplaceGeminiPromptInput?.value.trim() ?? "",
    [MARKETPLACE_GEMINI_INCLUDE_HASHTAGS_STORAGE_KEY]: Boolean(
      marketplaceGeminiHashtagsToggle?.checked,
    ),
    [MARKETPLACE_MIN_INTERVAL_STORAGE_KEY]: Number(
      marketplaceIntervalMinInput?.value ?? MIN_SLEEP_SECONDS,
    ),
    [MARKETPLACE_MAX_INTERVAL_STORAGE_KEY]: Number(
      marketplaceIntervalMaxInput?.value ?? DEFAULT_MAX_SLEEP_SECONDS,
    ),
    [MARKETPLACE_SHUFFLE_ITEMS_STORAGE_KEY]: Boolean(
      marketplaceShuffleItemsToggle?.checked,
    ),
  });
  updateGeminiStatus();
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
