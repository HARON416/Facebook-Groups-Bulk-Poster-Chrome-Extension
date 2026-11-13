import { loadLocale } from "wuchale/load-utils";

export const localeStorageKey = "postika:language";
export const supportedLocales = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "ar", name: "العربية", flag: "🇸🇦" },
] as const;

type MessageKey = keyof ReturnType<typeof translatedMessages>;
type MessageArguments<Key extends MessageKey> = ReturnType<
  typeof translatedMessages
>[Key] extends (...args: infer Arguments) => string
  ? Arguments
  : [];

function translatedMessages() {
  return {
    appName: "Postika",
    language: "Language",
    settingsAndSupport: "Settings & support",
    darkMode: "Dark mode",
    downloadDesktopApp: "Download desktop app",
    whatsappDeveloper: "WhatsApp developer",
    emailDeveloper: "Email developer",
    themePreferenceLoadFailure:
      "Could not load the appearance setting. Using light mode.",
    themePreferenceSaveFailure:
      "Could not save the appearance setting. It will reset when Postika closes.",
    languageCouldNotLoad: "Could not load the selected language.",
    clearLanguageSearch: "Clear language search",
    searchLanguages: "Search languages…",
    searchLanguagesLabel: "Search languages",
    allLanguages: "All languages",
    noLanguagesFound: "No languages found",
    tryDifferentSearch: "Try a different search.",
    groupPosting: "Group posting",
    postingSteps: "Posting steps",
    createPostStep: "Create post",
    selectGroupsStep: "Select groups",
    reviewPostStep: "Review & post",
    stepOneOfThree: "Step 1 of 3",
    stepTwoOfThree: "Step 2 of 3",
    stepThreeOfThree: "Step 3 of 3",
    createYourPost: "Create your post",
    textFormatting: "Text formatting",
    headingOne: "Heading 1",
    headingTwo: "Heading 2",
    bold: "Bold",
    italic: "Italic",
    undo: "Undo",
    redo: "Redo",
    bulletedList: "Bulleted list",
    numberedList: "Numbered list",
    quote: "Quote",
    moreFormatting: "More formatting",
    groupsPrerequisite:
      "Sign in to Facebook in a Chrome tab. Postika opens your joined-groups page.",
    postText: "Post text",
    postPlaceholder: "Write what you want to share...",
    chooseImages: "Choose images",
    browseOrDropImages: "Click to browse or drag and drop images here",
    imagesSectionTitle: "Images",
    imagesRequired: "Required",
    selectedImagesCount: (count: number) => `${count} images selected`,
    addMorePhotos: "Add more",
    nextSelectGroups: "Next: select groups",
    selectYourGroups: "Select your groups",
    findMyGroups: "Find my groups",
    refreshGroups: "Refresh groups",
    couldNotRestoreDraftImages:
      "Could not restore saved images. Please add them again.",
    couldNotSaveDraftImages:
      "Could not save your images. They may not be available next time.",
    findGroupsHelp: "Select the groups where you want to post.",
    loadedCount: (count: number) => `${count} loaded`,
    selectAllGroups: "Select all groups",
    searchGroups: "Search groups",
    searchYourGroups: "Search your groups",
    selectedGroupsCount: (count: number) => `${count} groups selected`,
    noGroupsToShow: "Your groups will appear here.",
    selectOneGroup: "Select at least one group to continue.",
    addTextAndImageToContinue:
      "Add post text and at least one image to continue.",
    addPostTextToContinue: "Add post text to continue.",
    addImageToContinue: "Add at least one image to continue.",
    back: "Back",
    nextReviewPost: "Next: review post",
    reviewPost: "Review & post",
    yourPost: "Your post",
    editPost: "Edit post",
    groups: "Groups",
    editGroups: "Edit groups",
    selectedGroups: "Selected groups",
    completePostText: "Complete post text",
    timeBetweenPosts: "Time between posts",
    intervalDescription:
      "Postika chooses a different wait time within your range between posts.",
    shortestWait: "Shortest wait (seconds)",
    longestWait: "Longest wait (seconds)",
    intervalHelp:
      "Both waits must be at least 60 seconds. For example, 60 to 300 means a wait of 1 to 5 minutes.",
    postNow: "Post now",
    schedule: "Schedule",
    scheduleQueueTitle: "Schedule your queue",
    confirmSchedule: "Confirm schedule",
    cancel: "Cancel",
    scheduleTimezoneNotice: (zone: string) =>
      `Time zone: ${zone}. Keep Chrome open and your computer awake. Facebook may ask you to sign in when posting starts.`,
    chooseDateAndTime: "Choose a date and time",
    chooseWeekdayForPost: "Choose a weekday for this post",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    selectDate: "Select date",
    selectTime: "Select time",
    twentyFourHourClock: "Time format: 24-hour",
    hour: "Hour",
    minute: "Minute",
    increaseHour: "Increase hour",
    decreaseHour: "Decrease hour",
    increaseMinute: "Increase minute",
    decreaseMinute: "Decrease minute",
    morning: "Morning",
    afternoon: "Afternoon",
    evening: "Evening",
    futureDateRequired: "Choose a date and time in the future.",
    scheduled: "Scheduled",
    scheduledFor: (date: string) =>
      `Scheduled for ${date}. Keep Chrome open and your computer awake.`,
    queueScheduled: "Your queue is scheduled.",
    cancelScheduledQueue: "Cancel scheduled queue",
    scheduledPostingCancelled: "Scheduled posting cancelled.",
    couldNotScheduleQueue:
      "Could not schedule this queue. Check that Chrome storage is available and try again.",
    scheduledQueueStartFailure:
      "The scheduled queue could not be started. Please schedule it again.",
    schedulingQueue: "Scheduling this queue...",
    activity: "Activity",
    postingProgress: "Posting progress",
    groupPostingTime: "Group posting time",
    timeSpent: "Time spent",
    currentPost: "Current post",
    groupLabel: (current: number, total: number) => `Group ${current}/${total}`,
    posted: "posted",
    awaitingApproval: "awaiting approval",
    failed: "failed",
    leftToSubmit: "left to submit",
    postingNotStarted: "Posting has not started.",
    pause: "Pause",
    stop: "Stop",
    resume: "Resume",
    photoPreview: "Photo preview",
    closePhotoPreview: "Close photo preview",
    previousPhoto: "View previous photo",
    nextPhoto: "View next photo",
    photosInPostOrder: "Photos in post order",
    dismissNotification: "Dismiss notification",
    notifications: "Notifications",
    success: "Success",
    pleaseCheck: "Please check",
    somethingWentWrong: "Something went wrong",
    information: "Information",
    noGroupsFound: "No groups found.",
    noGroupsMatch: (query: string) => `No groups match "${query}".`,
    selectedGroupsSection: "Selected Groups",
    noSelectedGroupsMatch: "No selected groups match this search.",
    noSelectedGroupsYet: "No groups selected yet.",
    otherGroups: "Other Groups",
    noRemainingGroupsMatch: "No remaining groups match this search.",
    noOtherGroups: "No other groups available.",
    findAndSelectGroups: "Find and select the groups you want to post to",
    postingAlreadyInProgress: "Group posting is already in progress.",
    posting: "Posting…",
    resuming: "Resuming…",
    pausing: "Pausing…",
    stopping: "Stopping…",
    activeTime: "Active time",
    pausedAt: "Paused at",
    elapsed: "Elapsed",
    lastItem: "Last item",
    currentItem: "Current item",
    itemTime: "Item time",
    underOneSecond: "under 1s",
    hoursShort: (hours: number) => `${hours}h`,
    minutesShort: (minutes: number) => `${minutes}m`,
    secondsShort: (seconds: number) => `${seconds}s`,
    copyFacebookResponse: "Copy Facebook failure response",
    responseCopied: "Facebook failure response copied.",
    unableToCopyResponse: "Unable to copy the Facebook response.",
    done: "Done",
    pending: "Pending",
    fail: "Fail",
    limit: "Limit",
    next: "Next",
    post: "Post",
    info: "Info",
    loading: "Loading...",
    findingJoinedGroups: "Finding the groups you have joined...",
    openingFacebookGroups:
      "Opening Facebook to find the groups you have joined...",
    unableToLoadGroups: "Unable to load groups.",
    finishedLoadingGroups: (count: string) =>
      `Finished loading ${count} groups.`,
    couldNotFindGroups:
      "Could not find your groups. Check that you are signed into Facebook and try again.",
    unableToAddImages: "Unable to add images.",
    imageFilesOnly: "Only image files can be added.",
    duplicateImageSkipped: (count: string) =>
      `${count} duplicate image was skipped.`,
    duplicateImagesSkipped: (count: string) =>
      `${count} duplicate images were skipped.`,
    imagePreviewReorder: (current: number, total: number) =>
      `Image ${current} of ${total}. Click to preview; drag or use Alt+Left/Right to reorder.`,
    removeImage: (name: string) => `Remove ${name}`,
    unableToResume: "Unable to resume posting.",
    unableToPause: "Unable to pause posting.",
    unableToStop: "Unable to stop posting.",
    selectAtLeastOneGroup: "Please select at least one group.",
    addPostAndImage:
      "Write your post and add at least one image before posting.",
    invalidPostingInterval: (minimum: number) =>
      `Enter whole numbers of at least ${minimum} seconds for both waits. The longest wait must be at least as long as the shortest wait.`,
    groupsNoLongerAvailable:
      "Your selected groups are no longer available. Click Find my groups, select them again, and try posting.",
    gettingReadyToPost: "Getting ready to post...",
    couldNotStartPosting: "Could not start posting. Please try again.",
    unableToReadFile: (name: string) => `Unable to read ${name}.`,
    restoredGroups: (count: string) => `Restored ${count} loaded groups.`,
    unableToRestore: "Unable to restore side panel session.",
    unableToSaveSession: "Unable to save side panel session.",
    groupExtractionStarting: "Starting group extraction...",
    openFacebookFirst:
      "Open Facebook first. This extension only works on facebook.com.",
    selectPostBeforePosting: "Select at least one post before posting.",
    preparingCurrentTab: "Preparing current tab...",
    openingJoinedGroupsPage: "Opening Facebook joined groups page...",
    joinedGroupsPageLoaded: "Facebook joined groups page loaded.",
    changingGroupSort:
      "Changing joined groups sort to trigger Facebook groups request...",
    waitingForGroupsRequest: "Waiting for fresh Facebook groups request...",
    capturedGroupsRequest: "Captured groups request. Preparing extraction...",
    fetchingGroupsPage: (page: string) => `Fetching groups page ${page}...`,
    loadedGroupsSoFar: (count: string) => `Loaded ${count} groups so far.`,
    fetchingNextGroupsPage: (count: string) =>
      `Fetching next page. ${count} groups loaded.`,
    groupsRequestFailed: (status: string) =>
      `Facebook groups request failed with ${status}.`,
    unableToFetchGroups: "Unable to fetch groups.",
    noActiveTabForPosting: "Unable to find the active tab for posting.",
    unableToOpenJoinedGroups:
      "Unable to open joined groups in the current tab.",
    unableToTriggerGroupsSort: "Unable to trigger joined groups sort.",
    groupsSortChanged:
      "The joined groups sort control changed. Please load groups again.",
    unableToReadGroups: "Unable to read groups from joined groups tab.",
    noGroupDataReturned: "Facebook did not return group data.",
    noVisibleGroupComposer:
      "None of the selected Groups has a visible post composer. Select another standard Group and try again.",
    photoUploadSetupFailed:
      "Could not set up photo uploads from your first post. Please start posting again.",
    postingRequestValuesMissing:
      "Facebook did not provide the request values needed to continue. Try again.",
    unconfirmedFirstPost:
      "Facebook did not confirm whether the first post was submitted. Check Facebook before trying again.",
    incompatibleGroupStarter: (starter: string, next: string) =>
      `${starter} does not allow Postika to start posting. Trying ${next} instead...`,
    pausedDuration: (duration: string) => `Paused ${duration}`,
    pausedDurationShort: (duration: string) => `paused ${duration}`,
    freshPostRequestCaptured: (kind: string, group: string) =>
      `Fresh ${kind} request values captured from ${group}.`,
    photoImagePreview: "Post image preview",
    viewPhoto: (index: number, name: string) => `View photo ${index}: ${name}`,
    postsSubmitted: (count: number, target: number) =>
      `${count}/${target} posts submitted`,
    groupsProcessed: (count: number, total: number) =>
      `${count}/${total} groups processed`,
    queue: "Queue",
    groupNumber: (current: number, total: number) =>
      `Group ${current}/${total}`,
    completedPosts: (count: number, duration: string, failed: string) =>
      `Completed ${count} posts in ${duration}${failed}.`,
    failedCount: (count: number) => ` · ${count} failed`,
    nextPostIn: (duration: string) => `Next post in ${duration}`,
    postingPaused: "Posting paused.",
    postingPausedOffline:
      "Internet connection lost. Posting paused until the connection returns.",
    postingResumed: "Posting resumed.",
    postingResumedOnline: "Internet connection restored. Resuming posting.",
    postingStillPausedOnline:
      "Internet connection restored. Posting remains paused until you resume.",
    postingPausedBefore: (group: string) => `Posting paused before ${group}.`,
    postingInProgress: "Posting is already in progress.",
    waitForQueue:
      "Wait for the current posts to finish, or stop posting before starting again.",
    preparingFirstPost: "Preparing the first post...",
    continuingAutomatically: "Continuing to post automatically...",
    preparingPostForGroup: (current: string, total: string, group: string) =>
      `Preparing post ${current}/${total} for ${group}...`,
    uploadingPostImages: (current: string, total: string, group: string) =>
      `Uploading images from post ${current}/${total} for ${group}...`,
    preparingTextPost: (current: string, total: string, group: string) =>
      `Preparing text-only post ${current}/${total} for ${group}...`,
    postingToGroup: (current: string, total: string, group: string) =>
      `Posting post ${current}/${total} to ${group}...`,
    pendingPost: "Your post is pending",
    postedToGroup: (group: string) => `Posted to ${group}.`,
    postedSuccessfullyToGroup: (group: string) =>
      `Posted successfully to ${group}.`,
    pendingApprovalDetail:
      "Your post is awaiting admin approval. If the admin team approves it, it'll become visible in the group.",
    postingFinished: (count: string) =>
      `Posting finished: ${count} posts were submitted.`,
    postingFinishedWithFailures: (posted: string, failed: string) =>
      `Posting finished: ${posted} posts were submitted and ${failed} groups failed.`,
    accountTemporarilyBlocked:
      "Facebook temporarily blocked posting on this account. Queue stopped. Try again later.",
    failedToPostToGroup: (group: string) => `Failed to post to ${group}.`,
    unknownGroup: "the first Group",
    facebookPendingLimit: (group: string) =>
      `Facebook rejected the post to ${group} because this Group cannot accept more pending content from your account.`,
    automaticPostingStopped: "Automatic posting stopped.",
    manualStop: "Posting stopped by user.",
    onlyPostedActivity: "Show only posted activity",
    onlyAwaitingApproval: "Show only posts waiting for approval",
    onlyFailedActivity: "Show only failed activity",
    groupCountSingular: (count: number) => `${count} group`,
    groupCountPlural: (count: number) => `${count} groups`,
    selected: "selected",
    fromLoaded: (count: number) => `from ${count} loaded`,
    result: (count: number) => `${count} result`,
    results: (count: number) => `${count} results`,
    oneGroupSelectedContinue: "1 group selected. Continue to review your post.",
    groupsSelectedContinue: (count: number) =>
      `${count} groups selected. Continue to review your post.`,
    oneImageCount: "1 image",
    imageCount: (count: number) => `${count} images`,
    oneGroupSelected: "1 group selected",
    groupsSelectedCount: (count: number) => `${count} groups selected`,
  };
}

let cachedLocale = "";
let cachedMessages: ReturnType<typeof translatedMessages> | undefined;

export function msg<Key extends MessageKey>(
  key: Key,
  ...values: MessageArguments<Key>
): string {
  const locale = currentLocale;
  if (!cachedMessages || cachedLocale !== locale) {
    cachedMessages = translatedMessages();
    cachedLocale = locale;
  }
  const message = cachedMessages[key];
  return String(
    typeof message === "function"
      ? Reflect.apply(message, undefined, values)
      : message,
  );
}

let currentLocale = "en";
let localeChange = Promise.resolve();

export function getLocale(): string {
  return currentLocale;
}

export function setLocale(value: string, persist = true): Promise<void> {
  const locale = supportedLocales.some(({ code }) => code === value)
    ? value
    : "en";
  localeChange = localeChange
    .catch(() => undefined)
    .then(async () => {
      await loadLocale(locale);
      currentLocale = locale;
      cachedMessages = undefined;
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
      if (persist) {
        try {
          localStorage.setItem(localeStorageKey, locale);
        } catch {
          // The current selection still applies when storage is unavailable.
        }
      }
      updateLanguageTrigger();
      applyStaticTranslations();
      window.dispatchEvent(new Event("postika:locale-changed"));
    });
  return localeChange;
}

function preferredLocale(): string {
  try {
    const saved = localStorage.getItem(localeStorageKey);
    if (supportedLocales.some(({ code }) => code === saved)) return saved!;
  } catch {
    // Continue with the browser preference.
  }
  for (const preference of navigator.languages ?? [navigator.language]) {
    const language = preference.toLowerCase().split(/[-_]/, 1)[0];
    if (language === "es" || language === "ar") return language;
  }
  return "en";
}

export async function initializeI18n(): Promise<void> {
  await setLocale(preferredLocale(), false);
  initializeLanguagePicker();
}

const staticTranslations: Array<[string, MessageKey]> = [
  ["#groups-workflow", "groupPosting"],
  [".posting-steps", "postingSteps"],
  ["#posting-step-1 .posting-step-heading small", "stepOneOfThree"],
  ["#posting-step-2 .posting-step-heading small", "stepTwoOfThree"],
  ["#posting-step-3 .posting-step-heading small", "stepThreeOfThree"],
  ['[data-posting-step="1"] strong', "createPostStep"],
  ['[data-posting-step="2"] strong', "selectGroupsStep"],
  ['[data-posting-step="3"] strong', "reviewPostStep"],
  ["#posting-step-heading-1", "createYourPost"],
  ['[role="toolbar"]', "textFormatting"],
  ['[data-format="h1"]', "headingOne"],
  ['[data-format="h2"]', "headingTwo"],
  ['[data-format="bold"]', "bold"],
  ['[data-format="italic"]', "italic"],
  ['[data-history="undo"]', "undo"],
  ['[data-history="redo"]', "redo"],
  ["#rich-text-more-label", "moreFormatting"],
  ['[data-format="unordered-list"]', "bulletedList"],
  ['[data-format="ordered-list"]', "numberedList"],
  ['[data-format="quote"]', "quote"],
  ["#post-body-input", "postText"],
  [".groups-photo-dropzone strong", "chooseImages"],
  [".groups-photo-dropzone small", "browseOrDropImages"],
  ["#posting-step-2 .posting-step-heading h2", "selectYourGroups"],
  ["#groups-prerequisite", "groupsPrerequisite"],
  ["#groups-status-message", "findGroupsHelp"],
  ["#groups-status-count", "loadedCount"],
  ["#groups-select-all span", "selectAllGroups"],
  ['label[for="groups-search-input"]', "searchGroups"],
  ["#groups-search-input", "searchYourGroups"],
  ["#groups-selection-count", "selectedGroupsCount"],
  ["#groups-list.empty-state", "noGroupsToShow"],
  ["#groups-step-guidance", "selectOneGroup"],
  ["#compose-next-btn", "nextSelectGroups"],
  [".step-back", "back"],
  ["#groups-next-btn", "nextReviewPost"],
  ["#posting-step-heading-3", "reviewPost"],
  [".review-summary h3", "yourPost"],
  [".review-edit", "editPost"],
  [".review-summary:nth-of-type(2) h3", "groups"],
  [".review-summary:nth-of-type(2) .review-edit", "editGroups"],
  ["#review-post-summary", "completePostText"],
  ["#review-groups-list", "selectedGroups"],
  [".interval-card__heading strong", "timeBetweenPosts"],
  [".interval-card__heading small", "intervalDescription"],
  ['label[for="post-interval-min-input"]', "shortestWait"],
  ['label[for="post-interval-max-input"]', "longestWait"],
  [".interval-card .section-note", "intervalHelp"],
  ["#start-posting-btn", "postNow"],
  ["#open-schedule-btn", "schedule"],
  ["#schedule-panel-heading", "scheduleQueueTitle"],
  ["#cancel-schedule-btn", "cancel"],
  ["#confirm-schedule-btn", "confirmSchedule"],
  [".section-heading__eyebrow", "activity"],
  ["#posting-progress-title", "postingProgress"],
  ["#posting-timing", "groupPostingTime"],
  ["#posting-timing-label", "timeSpent"],
  ["#posting-item-timing-label", "currentPost"],
  ["#posting-progress-filter-posted", "posted"],
  ["#posting-progress-filter-pending", "awaitingApproval"],
  ["#posting-progress-filter-failed", "failed"],
  [".posting-progress__stats > span", "leftToSubmit"],
  ["#posting-progress-current", "postingNotStarted"],
  ["#pause-posting-btn", "pause"],
  ["#stop-posting-btn", "stop"],
  ["#photo-lightbox-title", "photoPreview"],
  ["#photo-lightbox-close", "closePhotoPreview"],
  ["#photo-lightbox-previous", "previousPhoto"],
  ["#photo-lightbox-next", "nextPhoto"],
  ["#photo-lightbox-thumbnails", "photosInPostOrder"],
  ["#toast-region", "notifications"],
];

function applyStaticTranslations(): void {
  for (const [selector, key] of staticTranslations) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) continue;
    const value = msg(key);
    if (
      selector === "#post-body-input" ||
      selector === "#groups-search-input"
    ) {
      element.setAttribute(
        selector === "#post-body-input" ? "aria-label" : "aria-label",
        value,
      );
      if (selector === "#post-body-input") {
        element.setAttribute("aria-placeholder", msg("postPlaceholder"));
        element.dataset.placeholder = msg("postPlaceholder");
      } else {
        element.setAttribute("placeholder", value);
      }
    } else if (
      selector.startsWith("[data-format=") ||
      selector.startsWith("[data-history=")
    ) {
      element.setAttribute("aria-label", value);
      element.setAttribute("title", value);
    } else if (
      selector === "#photo-lightbox-close" ||
      selector === "#photo-lightbox-previous" ||
      selector === "#photo-lightbox-next"
    ) {
      element.setAttribute("aria-label", value);
    } else if (
      selector === "#groups-status-count" ||
      selector === "#groups-selection-count"
    ) {
      const count = Number.parseInt(element.textContent ?? "", 10) || 0;
      element.textContent = msg(
        selector === "#groups-status-count"
          ? "loadedCount"
          : "selectedGroupsCount",
        count,
      );
    } else if (
      selector === "#groups-select-all span" ||
      selector === ".posting-progress__stats > span"
    ) {
      const count = element.querySelector("strong");
      if (count)
        element.replaceChildren(count, document.createTextNode(` ${value}`));
      else element.textContent = value;
    } else if (
      selector === "#groups-workflow" ||
      selector === ".posting-steps" ||
      selector === '[role="toolbar"]' ||
      selector === "#review-post-summary" ||
      selector === "#review-groups-list" ||
      selector === "#posting-timing" ||
      selector === "#toast-region"
    ) {
      element.setAttribute("aria-label", value);
    } else if (selector.includes("nth-of-type(2)")) {
      const target = document.querySelector<HTMLElement>(
        selector.startsWith(".review-summary")
          ? selector
          : ".review-summary:nth-of-type(2) h3",
      );
      if (target) target.textContent = value;
    } else if (selector === ".step-back") {
      document.querySelectorAll<HTMLElement>(selector).forEach((item) => {
        item.textContent = value;
      });
    } else if (selector === ".review-summary h3") {
      document
        .querySelectorAll<HTMLElement>(selector)
        .forEach((item, index) => {
          item.textContent = msg(index === 0 ? "yourPost" : "groups");
        });
    } else if (selector === ".review-edit") {
      document
        .querySelectorAll<HTMLElement>(selector)
        .forEach((item, index) => {
          item.textContent = msg(index === 0 ? "editPost" : "editGroups");
        });
    } else if (selector === ".section-heading__eyebrow") {
      element.textContent = value;
    } else if (
      selector === "#posting-progress-filter-posted" ||
      selector === "#posting-progress-filter-pending" ||
      selector === "#posting-progress-filter-failed"
    ) {
      element.setAttribute(
        "title",
        msg(
          selector.endsWith("posted")
            ? "onlyPostedActivity"
            : selector.endsWith("pending")
              ? "onlyAwaitingApproval"
              : "onlyFailedActivity",
        ),
      );
      const count = element.querySelector("strong");
      if (count)
        element.replaceChildren(count, document.createTextNode(` ${value}`));
    } else if (selector === "#groups-next-btn") {
      element.textContent = value;
    } else {
      element.textContent = value;
    }
  }
}

function updateLanguageTrigger(): void {
  const selected = supportedLocales.find(({ code }) => code === currentLocale);
  const flag = document.querySelector<HTMLElement>("#language-flag");
  const name = document.querySelector<HTMLElement>("#language-name");
  const trigger =
    document.querySelector<HTMLButtonElement>("#language-trigger");
  if (selected && flag && name && trigger) {
    flag.textContent = selected.flag;
    name.textContent = selected.name;
    trigger.setAttribute("aria-label", `${msg("language")}: ${selected.name}`);
  }
  const search = document.querySelector<HTMLInputElement>("#language-search");
  search?.setAttribute("placeholder", msg("searchLanguages"));
  search?.setAttribute("aria-label", msg("searchLanguagesLabel"));
  document
    .querySelector("#language-options")
    ?.setAttribute("aria-label", msg("allLanguages"));
  const empty = document.querySelector<HTMLElement>("#language-empty");
  if (empty) {
    const [heading, description] =
      empty.querySelectorAll<HTMLElement>("strong, span");
    if (heading) heading.textContent = msg("noLanguagesFound");
    if (description) description.textContent = msg("tryDifferentSearch");
  }
  const menuHeading = document.querySelector<HTMLElement>(
    "#language-menu-heading",
  );
  if (menuHeading) menuHeading.textContent = msg("allLanguages");
}

function initializeLanguagePicker(): void {
  const trigger =
    document.querySelector<HTMLButtonElement>("#language-trigger");
  const menu = document.querySelector<HTMLElement>("#language-menu");
  const search = document.querySelector<HTMLInputElement>("#language-search");
  const list = document.querySelector<HTMLElement>("#language-options");
  if (!trigger || !menu || !search || !list) return;
  const close = (restoreFocus = false) => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    search.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  };
  const render = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = supportedLocales.filter(({ name }) =>
      name.toLocaleLowerCase().includes(query),
    );
    list.replaceChildren();
    for (const locale of matches) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "language-option";
      option.role = "option";
      option.id = `language-option-${locale.code}`;
      option.setAttribute(
        "aria-selected",
        String(locale.code === currentLocale),
      );
      option.dataset.locale = locale.code;
      const label = document.createElement("span");
      label.className = "language-option__label";
      const flag = document.createElement("span");
      flag.className = "language-option__flag";
      flag.setAttribute("aria-hidden", "true");
      flag.textContent = locale.flag;
      const name = document.createElement("span");
      name.className = "language-option__name";
      name.textContent = locale.name;
      label.append(flag, name);
      option.append(label);
      if (locale.code === currentLocale) {
        const check = document.createElement("span");
        check.className = "language-option__check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = "✓";
        option.append(check);
      }
      option.addEventListener("click", () => {
        void setLocale(locale.code)
          .then(() => close(true))
          .catch((error: unknown) => {
            console.error("Could not change the language.", error);
            window.dispatchEvent(new Event("postika:locale-error"));
          });
      });
      option.addEventListener("keydown", (event) => {
        const options = Array.from(
          list.querySelectorAll<HTMLButtonElement>(".language-option"),
        );
        const index = options.indexOf(option);
        const targetIndex =
          event.key === "ArrowDown"
            ? Math.min(index + 1, options.length - 1)
            : event.key === "ArrowUp"
              ? Math.max(index - 1, 0)
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : -1;
        if (targetIndex >= 0) {
          event.preventDefault();
          options[targetIndex]?.focus();
        } else if (event.key === "Escape") {
          event.preventDefault();
          close(true);
        }
      });
      list.append(option);
    }
    const heading = document.querySelector<HTMLElement>(
      "#language-menu-heading",
    );
    if (heading) {
      heading.textContent = query
        ? matches.length === 1
          ? msg("result", matches.length)
          : msg("results", matches.length)
        : msg("allLanguages");
    }
    const empty = document.querySelector<HTMLElement>("#language-empty");
    if (empty) empty.hidden = matches.length > 0;
  };
  window.addEventListener("postika:locale-changed", render);
  trigger.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    trigger.setAttribute("aria-expanded", String(!menu.hidden));
    search.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) {
      search.value = "";
      render();
      search.focus();
    }
  });
  search.addEventListener("input", render);
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      list
        .querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?.click() ??
        list.querySelector<HTMLButtonElement>(".language-option")?.click();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const options = Array.from(
        list.querySelectorAll<HTMLButtonElement>(".language-option"),
      );
      const selected = options.findIndex(
        (option) => option.getAttribute("aria-selected") === "true",
      );
      const fallback = event.key === "ArrowDown" ? 0 : options.length - 1;
      options[selected >= 0 ? selected : fallback]?.focus();
    } else if (event.key === "Tab" && !event.shiftKey) {
      close();
    }
  });
  menu.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (
        !menu.contains(document.activeElement) &&
        document.activeElement !== trigger
      )
        close();
    }, 0);
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      event.target instanceof Node &&
      !menu.contains(event.target) &&
      !trigger.contains(event.target)
    )
      close();
  });
  updateLanguageTrigger();
  render();
}
