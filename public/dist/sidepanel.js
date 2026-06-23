"use strict";
(() => {
  // src/auth-config.ts
  var AUTH_API_BASE_URL = "https://api.facebook-groups-bulk-poster.softwrhq.com";

  // src/sidepanel.ts
  var GEMINI_API_KEY_STORAGE_KEY = "geminiApiKey";
  var GEMINI_REWRITE_ENABLED_STORAGE_KEY = "geminiRewriteEnabled";
  var EXTENSION_INSTALL_ID_STORAGE_KEY = "extensionInstallId";
  var EXTENSION_ACTIVATION_ID_STORAGE_KEY = "extensionActivationId";
  var MIN_SLEEP_SECONDS = 120;
  var TRIAL_CONTACT_EMAIL = "haronkibetrutoh@gmail.com";
  var TRIAL_CONTACT_WHATSAPP = "254718448461";
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
  var imagePreviewList = document.querySelector(
    "#image-preview-list"
  );
  var postSleepInput = document.querySelector("#post-sleep-input");
  var geminiApiKeyInput = document.querySelector(
    "#gemini-api-key-input"
  );
  var geminiRewriteToggle = document.querySelector(
    "#gemini-rewrite-toggle"
  );
  var shuffleGroupsToggle = document.querySelector(
    "#shuffle-groups-toggle"
  );
  var geminiStatusMessage = document.querySelector(
    "#gemini-status-message"
  );
  var geminiStatusCount = document.querySelector(
    "#gemini-status-count"
  );
  var createForm = document.querySelector("#create-form");
  var pausePostingButton = document.querySelector("#pause-posting-btn");
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
  var postingProgressFailed = document.querySelector(
    "#posting-progress-failed"
  );
  var postingProgressRemaining = document.querySelector(
    "#posting-progress-remaining"
  );
  var postingProgressCurrent = document.querySelector(
    "#posting-progress-current"
  );
  var postingProgressLog = document.querySelector(
    "#posting-progress-log"
  );
  var authLoginButton = document.querySelector("#auth-login-btn");
  var authSignupButton = document.querySelector("#auth-signup-btn");
  var authLogoutButton = document.querySelector("#auth-logout-btn");
  var authStatusMessage = document.querySelector(
    "#auth-status-message"
  );
  var authPanelTitle = document.querySelector("#auth-panel-title");
  var authSessionPill = document.querySelector("#auth-session-pill");
  var authUserEmail = document.querySelector("#auth-user-email");
  var selectedImagePreviewUrls = [];
  var selectedImageFiles = [];
  var loadedGroups = [];
  var selectedGroupIds = /* @__PURE__ */ new Set();
  var groupsSearchQuery = "";
  var groupsVisible = true;
  var imagePreviewsVisible = false;
  var isPostingActive = false;
  var isPostingPaused = false;
  var isStopRequestPending = false;
  var isPauseResumeRequestPending = false;
  var currentExtensionAccess;
  void initializeGeminiSettings();
  void initializeExtensionAccess();
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
      groupsVisible = true;
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
    groupsList.hidden = !groupsVisible;
    const groupsSearchField = groupsSearchInput?.closest(".field");
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
    const visibleGroups = normalizedQuery.length ? groups.filter(
      (group) => `${group.name} ${group.url}`.toLowerCase().includes(normalizedQuery)
    ) : groups;
    if (visibleGroups.length === 0) {
      groupsList.className = "empty-state";
      groupsList.textContent = `No groups match "${groupsSearchQuery.trim()}".`;
      updatePostingReadiness();
      return;
    }
    const selectedGroups = visibleGroups.filter(
      (group) => selectedGroupIds.has(group.id)
    );
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
      geminiStatusMessage.textContent = rewriteEnabled ? hasKey ? "Gemini rewrite is enabled." : "Gemini rewrite is enabled, but no API key is saved yet." : "Gemini rewrite is off.";
    }
    if (geminiStatusCount) {
      geminiStatusCount.textContent = hasKey ? rewriteEnabled ? "Ready" : "Key saved" : "No key";
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
    });
    groupsSelectionCount.className = "selection-count groups-summary";
    groupsSelectionCount.replaceChildren(summary, toggleButton);
  }
  function updatePostingReadiness() {
    const isAuthenticated = hasActiveExtensionAccess();
    const selectedGroupsCount = getSelectedGroupsCount();
    const hasPostBody = (postBodyInput?.value.trim().length ?? 0) > 0;
    const sleepTime = Number(postSleepInput?.value ?? 0);
    const hasValidSleepTime = Number.isFinite(sleepTime) && sleepTime >= MIN_SLEEP_SECONDS;
    updateGroupsSelectionSummary();
    updateGroupsSelectAllState();
    updatePostingButtonState(
      isAuthenticated,
      hasPostBody,
      selectedGroupsCount,
      hasValidSleepTime
    );
    if (loadGroupsButton) {
      loadGroupsButton.disabled = !isAuthenticated;
    }
  }
  function updatePostingButtonState(isAuthenticated = hasActiveExtensionAccess(), hasPostBody = (postBodyInput?.value.trim().length ?? 0) > 0, selectedGroupsCount = getSelectedGroupsCount(), hasValidSleepTime = (() => {
    const sleepTime = Number(postSleepInput?.value ?? 0);
    return Number.isFinite(sleepTime) && sleepTime >= MIN_SLEEP_SECONDS;
  })()) {
    if (!startPostingButton) {
      return;
    }
    if (isPostingActive) {
      startPostingButton.disabled = isStopRequestPending;
      setButtonContent(
        startPostingButton,
        isStopRequestPending ? "Stopping..." : "Stop Posting",
        isStopRequestPending
      );
      startPostingButton.classList.add("start-posting-btn--stop");
      updatePausePostingButtonState();
      return;
    }
    startPostingButton.classList.remove("start-posting-btn--stop");
    startPostingButton.disabled = !(isAuthenticated && hasPostBody && selectedGroupsCount > 0 && hasValidSleepTime);
    setButtonContent(startPostingButton, "START POSTING");
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
      isPostingPaused
    );
    const label = isPauseResumeRequestPending ? isPostingPaused ? "Resuming..." : "Pausing..." : isPostingPaused ? "Resume Posting" : "Pause Posting";
    setButtonContent(pausePostingButton, label, isPauseResumeRequestPending);
  }
  function setButtonContent(button, label, showLoader = false) {
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
    (message) => {
      if (message.type === "GROUP_EXTRACTION_STATUS") {
        updateGroupsStatus(message.message, message.loadedCount);
      }
      if (message.type === "UI_POSTING_STATUS") {
        updateUiPostingStatus(message);
      }
    }
  );
  function updateUiPostingStatus(message) {
    if (message.status === "posting" || message.status === "waiting" || message.status === "paused" || message.status === "posted" || message.status === "failed") {
      isPostingActive = true;
      isPostingPaused = message.status === "paused";
      if (message.status === "paused") {
        isPauseResumeRequestPending = false;
      }
      isStopRequestPending = false;
    }
    updatePostingProgress(message);
    if (groupsStatusMessage) {
      groupsStatusMessage.textContent = message.error ? `${message.message}: ${message.error}` : message.message;
    }
    if (groupsStatusCount) {
      groupsStatusCount.textContent = `${message.successCount ?? 0}/${message.total} posted`;
    }
    if (message.status === "stopped" || message.status === "done" || message.status === "rate_limited") {
      isPostingActive = false;
      isPostingPaused = false;
      isStopRequestPending = false;
      isPauseResumeRequestPending = false;
      updatePostingReadiness();
    }
  }
  function updatePostingProgress(message) {
    if (postingProgress) {
      postingProgress.hidden = false;
    }
    const successCount = message.successCount ?? 0;
    const failedCount = message.failedCount ?? 0;
    const processedCount = message.processedCount ?? Math.min(message.total, successCount + failedCount);
    const remainingCount = Math.max(message.total - processedCount, 0);
    const percent = message.total > 0 ? Math.round(processedCount / message.total * 100) : 0;
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
      const prefix = message.current > 0 && message.total > 0 ? `Group ${message.current}/${message.total}` : "Queue";
      postingProgressCurrent.textContent = message.groupName ? `${prefix}: ${message.groupName}` : message.message;
    }
    appendPostingProgressLog(message);
  }
  function appendPostingProgressLog(message) {
    if (!postingProgressLog) {
      return;
    }
    const existingWaitingItem = message.status === "waiting" ? postingProgressLog.querySelector(
      `li[data-status="waiting"][data-group-id="${CSS.escape(
        message.groupId ?? "queue"
      )}"]`
    ) : void 0;
    const item = existingWaitingItem ?? document.createElement("li");
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
    body.append(text);
    if (count || message.error) {
      const meta = document.createElement("span");
      meta.className = "posting-progress__log-meta";
      meta.textContent = [count, message.error].filter(Boolean).join(" \xB7 ");
      body.append(meta);
    }
    item.replaceChildren(badge, body);
    if (!existingWaitingItem) {
      postingProgressLog.prepend(item);
    }
  }
  function getPostingStatusLabel(status) {
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
      const response = await chrome.runtime.sendMessage({ type: "LOAD_GROUPS" });
      if (!response?.ok) {
        throw new Error(response?.error ?? "Unable to load groups.");
      }
      const groups = response.groups ?? [];
      groupsVisible = true;
      renderGroups(groups);
      updateGroupsStatus(
        `Finished loading ${groups.length} groups.`,
        groups.length
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
        const groupsSearchField = groupsSearchInput.closest(".field");
        if (groupsSearchField) {
          groupsSearchField.hidden = false;
        }
      }
      groupsList.className = "empty-state";
      groupsList.textContent = error instanceof Error ? error.message : "Unable to load groups.";
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
  function removeSelectedImage(indexToRemove) {
    selectedImageFiles = selectedImageFiles.filter(
      (_file, index) => index !== indexToRemove
    );
    if (selectedImageFiles.length === 0) {
      imagePreviewsVisible = false;
    }
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
    const summary = document.createElement("div");
    summary.className = "image-preview-summary";
    const count = document.createElement("span");
    count.textContent = `${selectedImageFiles.length} ${selectedImageFiles.length === 1 ? "image" : "images"} selected`;
    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "image-preview-summary__toggle";
    toggleButton.textContent = imagePreviewsVisible ? "Hide previews" : "View previews";
    toggleButton.addEventListener("click", () => {
      imagePreviewsVisible = !imagePreviewsVisible;
      renderImagePreviews();
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
    const newImageFiles = Array.from(postImagesInput.files ?? []).filter(
      (file) => file.type.startsWith("image/")
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
  pausePostingButton?.addEventListener("click", async () => {
    if (!isPostingActive || isPauseResumeRequestPending || isStopRequestPending) {
      return;
    }
    isPauseResumeRequestPending = true;
    updatePausePostingButtonState();
    updatePostingButtonState();
    try {
      const request = {
        type: isPostingPaused ? "RESUME_UI_POSTING" : "PAUSE_UI_POSTING"
      };
      const response = await chrome.runtime.sendMessage(request);
      if (!response?.ok) {
        throw new Error(
          response?.error ?? (isPostingPaused ? "Unable to resume posting." : "Unable to pause posting.")
        );
      }
      if (isPostingPaused) {
        isPostingPaused = false;
        isPauseResumeRequestPending = false;
        updatePausePostingButtonState();
        updatePostingButtonState();
      }
    } catch (error) {
      isPauseResumeRequestPending = false;
      updatePausePostingButtonState();
      updatePostingButtonState();
      alert(
        error instanceof Error ? error.message : isPostingPaused ? "Unable to resume posting." : "Unable to pause posting."
      );
    }
  });
  startPostingButton?.addEventListener("click", async () => {
    if (isPostingActive) {
      if (isStopRequestPending || !startPostingButton) {
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
        alert(
          error instanceof Error ? error.message : "Unable to stop posting."
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
    const sleepTime = Number(postSleepInput?.value ?? MIN_SLEEP_SECONDS);
    if (!Number.isFinite(sleepTime) || sleepTime < MIN_SLEEP_SECONDS) {
      alert(`Sleep time must be at least ${MIN_SLEEP_SECONDS} seconds`);
      return;
    }
    const selectedGroups = loadedGroups.filter(
      (group) => selectedGroupIdList.includes(group.id)
    );
    if (selectedGroups.length === 0) {
      alert("Selected groups are no longer loaded. Click Load Groups and try again.");
      return;
    }
    const postingGroups = shuffleGroupsToggle?.checked ? shuffleGroups(selectedGroups) : selectedGroups;
    isPostingActive = true;
    isPostingPaused = false;
    isStopRequestPending = false;
    isPauseResumeRequestPending = false;
    updatePostingButtonState();
    updateGroupsStatus("Preparing GraphQL posting...", 0);
    resetPostingProgress(postingGroups.length);
    scrollPostingProgressIntoView();
    try {
      const images = await Promise.all(selectedImageFiles.map(fileToUiPostImage));
      const request = {
        type: "START_UI_POSTING",
        body: postText,
        groups: postingGroups.map((group) => ({
          id: group.id,
          name: group.name,
          url: group.url
        })),
        images,
        delaySeconds: sleepTime
      };
      const response = await chrome.runtime.sendMessage(request);
      if (!response?.ok) {
        throw new Error(response?.error ?? "Unable to start GraphQL posting.");
      }
    } catch (error) {
      isPostingActive = false;
      isPostingPaused = false;
      isStopRequestPending = false;
      isPauseResumeRequestPending = false;
      updatePostingReadiness();
      alert(
        error instanceof Error ? error.message : "Unable to start GraphQL posting."
      );
    }
  });
  updatePostingReadiness();
  updateGeminiStatus();
  window.addEventListener("beforeunload", clearImagePreviewUrls);
  authLoginButton?.addEventListener("click", () => {
    openContactEmail();
  });
  authSignupButton?.addEventListener("click", () => {
    openContactWhatsApp();
  });
  authLogoutButton?.addEventListener("click", () => {
    void initializeExtensionAccess();
  });
  function hasActiveExtensionAccess() {
    return currentExtensionAccess?.active === true;
  }
  async function initializeExtensionAccess() {
    setAccessBusyState("Checking your trial access...");
    try {
      const identity = await getOrCreateExtensionIdentity();
      const response = await fetch(`${AUTH_API_BASE_URL}/api/extension-access/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          install_id: identity.installId,
          activation_id: identity.activationId
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.activation_id || !payload.trial_expires_at) {
        throw new Error(payload.error ?? "Unable to check trial access.");
      }
      currentExtensionAccess = {
        active: payload.active === true,
        accessType: payload.access_type ?? "expired",
        activationId: payload.activation_id,
        trialExpiresAt: payload.trial_expires_at,
        lifetimeActive: payload.lifetime_active === true,
        activatedAt: payload.activated_at
      };
      await chrome.storage.local.set({
        [EXTENSION_ACTIVATION_ID_STORAGE_KEY]: payload.activation_id
      });
      updateExtensionAccessUi();
    } catch (error) {
      currentExtensionAccess = void 0;
      showAccessUnavailable(
        error instanceof Error ? error.message : "Unable to check trial access."
      );
    }
  }
  async function getOrCreateExtensionIdentity() {
    const storage = await chrome.storage.local.get([
      EXTENSION_INSTALL_ID_STORAGE_KEY,
      EXTENSION_ACTIVATION_ID_STORAGE_KEY
    ]);
    const installId = typeof storage[EXTENSION_INSTALL_ID_STORAGE_KEY] === "string" ? storage[EXTENSION_INSTALL_ID_STORAGE_KEY] : crypto.randomUUID();
    const activationId = typeof storage[EXTENSION_ACTIVATION_ID_STORAGE_KEY] === "string" ? storage[EXTENSION_ACTIVATION_ID_STORAGE_KEY] : generateActivationId();
    await chrome.storage.local.set({
      [EXTENSION_INSTALL_ID_STORAGE_KEY]: installId,
      [EXTENSION_ACTIVATION_ID_STORAGE_KEY]: activationId
    });
    return { installId, activationId };
  }
  function generateActivationId() {
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
      authPanelTitle.textContent = active ? access?.accessType === "lifetime" ? "Lifetime access is active." : "Your 7-day trial is active." : "Your trial has ended.";
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
  function showAccessUnavailable(message) {
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
      void chrome.storage.local.get(EXTENSION_ACTIVATION_ID_STORAGE_KEY).then((storage) => {
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
  function setAccessBusyState(message) {
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
  function getAccessStatusMessage(access) {
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
      `Hi, I want to activate lifetime access.

Activation ID: ${activationId}`
    );
    void chrome.tabs.create({
      url: `mailto:${TRIAL_CONTACT_EMAIL}?subject=${subject}&body=${body}`
    });
  }
  function openContactWhatsApp() {
    const activationId = currentExtensionAccess?.activationId ?? "";
    const text = encodeURIComponent(
      `Hi, I want to activate lifetime access for Facebook Groups Bulk Poster. Activation ID: ${activationId}`
    );
    void chrome.tabs.create({
      url: `https://wa.me/${TRIAL_CONTACT_WHATSAPP}?text=${text}`
    });
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
  function resetPostingProgress(total) {
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
      block: "start"
    });
  }
  function shuffleGroups(groups) {
    const shuffledGroups = [...groups];
    for (let index = shuffledGroups.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffledGroups[index], shuffledGroups[swapIndex]] = [
        shuffledGroups[swapIndex],
        shuffledGroups[index]
      ];
    }
    return shuffledGroups;
  }
  async function initializeGeminiSettings() {
    const storage = await chrome.storage.local.get([
      GEMINI_API_KEY_STORAGE_KEY,
      GEMINI_REWRITE_ENABLED_STORAGE_KEY
    ]);
    if (geminiApiKeyInput) {
      geminiApiKeyInput.value = typeof storage[GEMINI_API_KEY_STORAGE_KEY] === "string" ? storage[GEMINI_API_KEY_STORAGE_KEY] : "";
    }
    if (geminiRewriteToggle) {
      geminiRewriteToggle.checked = storage[GEMINI_REWRITE_ENABLED_STORAGE_KEY] === true;
    }
    updateGeminiStatus();
  }
  async function saveGeminiApiKey() {
    const value = geminiApiKeyInput?.value.trim() ?? "";
    await chrome.storage.local.set({
      [GEMINI_API_KEY_STORAGE_KEY]: value
    });
    updateGeminiStatus();
  }
  async function saveGeminiRewriteEnabled() {
    await chrome.storage.local.set({
      [GEMINI_REWRITE_ENABLED_STORAGE_KEY]: Boolean(
        geminiRewriteToggle?.checked
      )
    });
  }
  function formatExpiry(value) {
    if (!value) {
      return "soon";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "soon";
    }
    return date.toLocaleString();
  }
})();
