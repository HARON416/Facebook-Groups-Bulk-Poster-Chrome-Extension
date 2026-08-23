import type {
  CreateMarketplaceItemListingRequest,
  CreateMarketplaceVehicleListingRequest,
  MarketplaceItemListing,
  MarketplaceItemPostingResponse,
  MarketplaceVehicleListing,
  UiPostImage,
} from "./config";

const LOG_PREFIX = "[Facebook Marketplace Item Poster]";
const CONTENT_SCRIPT_MARKER = "__facebookMarketplaceItemPosterLoaded";
const CREATE_ITEM_PATH = "/marketplace/create/item";
const CREATE_VEHICLE_PATH = "/marketplace/create/vehicle";
const AUDIENCE_PATH = "/marketplace/create/item?step=audience";
const PUBLISH_SUCCESS_PATH = "/marketplace/you/selling";
const LIMIT_REACHED_TEXT = "limit reached";
const TECHNICAL_ERROR_TEXT =
  "something isn't working. this may be because of a technical error we're working to fix.";

const marketplaceGlobal = globalThis as typeof globalThis &
  Record<string, unknown>;
let marketplacePostingPaused = false;
let marketplacePostingStopped = false;

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

async function runMarketplacePostingStep<T>(action: () => Promise<T>) {
  while (marketplacePostingPaused && !marketplacePostingStopped) {
    await sleep(250);
  }
  if (marketplacePostingStopped) {
    throw new Error("Marketplace posting stopped by user.");
  }
  return action();
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().toLowerCase();
}

function primaryText(element: Element) {
  const lines = (element.textContent ?? "")
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean);
  return lines[0] ?? "";
}

function normalizedComparableText(value: string | null | undefined) {
  return normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function isVisible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

function clickElement(element: HTMLElement) {
  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  for (const type of [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
  ]) {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      }),
    );
  }
}

async function waitFor<T>(
  find: () => T | undefined,
  timeoutMs: number,
  errorMessage: string,
  intervalMs = 250,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = find();
    if (result !== undefined) {
      return result;
    }
    await sleep(intervalMs);
  }
  throw new Error(errorMessage);
}

async function waitForOptional<T>(
  find: () => T | undefined,
  timeoutMs = 3_000,
  intervalMs = 250,
): Promise<T | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = find();
    if (result !== undefined) {
      return result;
    }
    await sleep(intervalMs);
  }
  return undefined;
}

function setControlledValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(control, value);
  control.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      data: value,
      inputType: "insertText",
    }),
  );
  control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

async function uiPostImageToFile(image: UiPostImage) {
  const response = await fetch(image.dataUrl);
  const blob = await response.blob();
  return new File([blob], image.name, { type: image.type || blob.type });
}

async function uploadImages(images: UiPostImage[]) {
  if (images.length === 0) {
    throw new Error("A Marketplace listing requires at least one photo.");
  }
  const fileInput = await waitFor(
    () =>
      Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
      ).find((input) => input.accept.toLowerCase().includes("image")),
    30_000,
    "Facebook's Marketplace photo input did not appear.",
  );
  const files = await Promise.all(images.map(uiPostImageToFile));
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(
    new Event("input", { bubbles: true, composed: true }),
  );
  fileInput.dispatchEvent(
    new Event("change", { bubbles: true, composed: true }),
  );
  console.log(LOG_PREFIX, "Uploaded images", files.length);
  await sleep(1_500);
}

async function selectLocation(value: string) {
  if (!value) {
    return;
  }
  const locationWasFilled = await fillTextField("Location", value, true);
  if (!locationWasFilled) {
    return;
  }
  const normalizedLocation = normalizeText(value);
  await waitFor(
    () => {
      const options = Array.from(
        document.querySelectorAll<HTMLElement>(
          'ul[role="listbox"] > li[role="option"]',
        ),
      ).filter(isVisible);
      const option =
        options.find((candidate) => {
          const title = candidate.querySelector<HTMLElement>("span[id]");
          return normalizeText(title?.textContent) === normalizedLocation;
        }) ?? options[0];
      if (!option) {
        return undefined;
      }
      const interactiveOption =
        option.querySelector<HTMLElement>(
          '[role="option"][data-visualcompletion="ignore-dynamic"]',
        ) ?? option;
      clickElement(interactiveOption);
      return true;
    },
    12_000,
    `Facebook did not offer a matching location for “${value}”.`,
    400,
  );
  await sleep(500);
}

async function setCleanTitle(enabled: boolean, skipIfMissing = false) {
  if (!enabled) {
    return;
  }
  const findInput = () =>
    document.querySelector<HTMLInputElement>('input[name="title_status"]') ??
    undefined;
  const input = skipIfMissing
    ? await waitForOptional(findInput)
    : await waitFor(
        findInput,
        10_000,
        "Facebook's clean-title control did not appear.",
      );
  if (!input) {
    console.info(LOG_PREFIX, "Skipping unavailable field", "Clean title");
    return;
  }
  if (!input.checked) {
    clickElement(input);
  }
}

function findMarketplaceLabels() {
  return Array.from(document.querySelectorAll("label")).filter(isVisible);
}

function marketplaceFieldLabelText(label: HTMLLabelElement) {
  const labelledByIds = (label.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  for (const id of labelledByIds) {
    const labelledElement = document.getElementById(id);
    const text = normalizeText(labelledElement?.textContent);
    if (text) {
      return text;
    }
  }
  const titledSpan = label.querySelector<HTMLElement>("span[id]");
  return normalizeText(titledSpan?.textContent) || primaryText(label);
}

async function fillTextField(
  fieldName: string,
  value: string,
  skipIfMissing = false,
) {
  if (!value) {
    return;
  }
  const findLabel = () =>
    findMarketplaceLabels().find(
      (candidate) =>
        marketplaceFieldLabelText(candidate) === normalizeText(fieldName),
    );
  const label = skipIfMissing
    ? await waitForOptional(findLabel)
    : await waitFor(
        findLabel,
        15_000,
        `Facebook's ${fieldName} field did not appear.`,
      );
  if (!label) {
    console.info(LOG_PREFIX, "Skipping unavailable field", fieldName);
    return false;
  }
  const control = label.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );
  if (!control) {
    throw new Error(`Facebook's ${fieldName} input could not be found.`);
  }
  control.scrollIntoView({ behavior: "smooth", block: "center" });
  control.focus({ preventScroll: true });
  await sleep(500);
  setControlledValue(control, value);
  return true;
}

async function selectDrawerOption(
  fieldName: string,
  value: string,
  alternativeValues: string[] = [],
  skipIfMissing = false,
) {
  if (!value) {
    return;
  }
  const findLabel = () =>
    findMarketplaceLabels().find(
      (candidate) =>
        marketplaceFieldLabelText(candidate) === normalizeText(fieldName),
    );
  const label = skipIfMissing
    ? await waitForOptional(findLabel)
    : await waitFor(
        findLabel,
        15_000,
        `Facebook's ${fieldName} field did not appear.`,
      );
  if (!label) {
    console.info(LOG_PREFIX, "Skipping unavailable field", fieldName);
    return undefined;
  }
  clickElement(label);
  await sleep(600);

  const normalizedTargets = [value, ...alternativeValues]
    .map(normalizeText)
    .filter(Boolean);
  const selectedLabel = await waitFor(
    () => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="option"], [role="dialog"] [role="button"], [role="listbox"] [role="button"]',
        ),
      ).filter(isVisible);
      const exact = candidates.find((candidate) =>
        normalizedTargets.includes(primaryText(candidate)),
      );
      const partial = candidates.find((candidate) => {
        const candidateText = primaryText(candidate);
        return normalizedTargets.some(
          (target) =>
            candidateText.includes(target) || target.includes(candidateText),
        );
      });
      const match = exact ?? partial;
      if (!match) {
        return undefined;
      }
      const matchedLabel = primaryText(match);
      clickElement(match);
      return matchedLabel;
    },
    8_000,
    `Unable to select ${fieldName}: ${value}.`,
    400,
  );
  await sleep(400);
  return selectedLabel;
}

async function selectVehicleType(value: string, skipIfMissing = false) {
  const equivalentLabels =
    normalizeText(value) === "car/truck" ? ["Car/Van"] : [];
  return selectDrawerOption(
    "Vehicle type",
    value,
    equivalentLabels,
    skipIfMissing,
  );
}

async function selectVehicleBodyStyle(
  value: string,
  facebookVehicleType: string | undefined,
  skipIfMissing = false,
) {
  const canonicalValue = normalizedComparableText(value);
  const usesCarVanLabels = normalizeText(facebookVehicleType) === "car/van";
  const equivalents: Record<string, { carTruck: string[]; carVan: string[] }> =
    {
      coupe: { carTruck: ["Coupe"], carVan: ["Coupé", "Coupe"] },
      truck: { carTruck: ["Truck"], carVan: ["Van"] },
      sedan: { carTruck: ["Sedan"], carVan: ["Saloon"] },
      hatchback: { carTruck: ["Hatchback"], carVan: ["Hatchback"] },
      suv: { carTruck: ["SUV"], carVan: ["4×4", "4x4"] },
      convertible: { carTruck: ["Convertible"], carVan: ["Convertible"] },
      wagon: { carTruck: ["Wagon"], carVan: ["Estate"] },
      minivan: {
        carTruck: ["Minivan"],
        carVan: ["MPV/People carrier", "MPV/People Carrier"],
      },
      smallcar: { carTruck: ["Small Car"], carVan: ["Small car"] },
      other: { carTruck: ["Other"], carVan: ["Other"] },
    };
  const mapping = equivalents[canonicalValue];
  if (!mapping) {
    throw new Error(`Unsupported vehicle body style: “${value}”.`);
  }
  const labels = usesCarVanLabels ? mapping.carVan : mapping.carTruck;
  await selectDrawerOption(
    "Body style",
    labels[0],
    labels.slice(1),
    skipIfMissing,
  );
}

function findMakeOptionText(option: HTMLElement) {
  const firstVisibleSpan = Array.from(
    option.querySelectorAll<HTMLElement>("span"),
  ).find((span) => isVisible(span) && normalizeText(span.textContent));
  return firstVisibleSpan?.textContent ?? option.innerText;
}

function findDropdownScrollContainer(listbox: HTMLElement) {
  let candidate: HTMLElement | null = listbox;
  for (let depth = 0; candidate && depth < 6; depth += 1) {
    if (candidate.scrollHeight > candidate.clientHeight + 4) {
      return candidate;
    }
    candidate = candidate.parentElement;
    if (candidate === document.body) {
      break;
    }
  }
  return undefined;
}

async function selectVehicleMake(value: string, skipIfMissing = false) {
  if (!value) {
    return;
  }
  const findLabel = () =>
    findMarketplaceLabels().find(
      (candidate) => marketplaceFieldLabelText(candidate) === "make",
    );
  const label = skipIfMissing
    ? await waitForOptional(findLabel)
    : await waitFor(findLabel, 15_000, "Facebook's Make field did not appear.");
  if (!label) {
    console.info(LOG_PREFIX, "Skipping unavailable field", "Make");
    return;
  }
  label.scrollIntoView({ behavior: "smooth", block: "center" });

  const editableControl = Array.from(
    label.querySelectorAll<HTMLInputElement>("input"),
  ).find(
    (input) =>
      input.type !== "hidden" &&
      !input.disabled &&
      !input.readOnly &&
      isVisible(input),
  );
  if (editableControl) {
    editableControl.focus({ preventScroll: true });
    await sleep(500);
    setControlledValue(editableControl, value);
    return;
  }

  clickElement(label);
  const listbox = await waitFor(
    () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="listbox"]'),
      ).find(
        (candidate) =>
          isVisible(candidate) &&
          candidate.querySelector('[role="option"]') !== null,
      ),
    12_000,
    "Facebook's Make options did not appear.",
    300,
  );
  const target = normalizedComparableText(value);
  const scrollContainer = findDropdownScrollContainer(listbox);
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const options = Array.from(
      listbox.querySelectorAll<HTMLElement>('[role="option"]'),
    ).filter(
      (option) =>
        isVisible(option) && option.querySelector('[role="option"]') === null,
    );
    const match = options.find(
      (option) =>
        normalizedComparableText(findMakeOptionText(option)) === target,
    );
    if (match) {
      clickElement(match);
      await sleep(500);
      return;
    }

    if (!scrollContainer) {
      break;
    }
    const previousTop = scrollContainer.scrollTop;
    const maximumTop = Math.max(
      scrollContainer.scrollHeight - scrollContainer.clientHeight,
      0,
    );
    if (previousTop >= maximumTop - 2) {
      break;
    }
    scrollContainer.scrollTop = Math.min(
      previousTop + Math.max(scrollContainer.clientHeight * 0.75, 180),
      maximumTop,
    );
    scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(400);
    if (scrollContainer.scrollTop <= previousTop) {
      break;
    }
  }

  throw new Error(
    `Facebook does not offer “${value}” in the Make dropdown for this account or region.`,
  );
}

function findActionButton(label: string) {
  const normalizedLabel = normalizeText(label);
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      `div[aria-label], button[aria-label], [role="button"]`,
    ),
  ).find(
    (candidate) =>
      isVisible(candidate) &&
      (normalizeText(candidate.getAttribute("aria-label")) ===
        normalizedLabel ||
        primaryText(candidate) === normalizedLabel),
  );
}

function isEnabled(element: HTMLElement) {
  return (
    element.getAttribute("aria-disabled") !== "true" &&
    !(element instanceof HTMLButtonElement && element.disabled)
  );
}

async function clickEnabledAction(label: string, timeoutMs: number) {
  const button = await waitFor(
    () => {
      const candidate = findActionButton(label);
      return candidate && isEnabled(candidate) ? candidate : undefined;
    },
    timeoutMs,
    `Facebook's ${label} button did not become available.`,
    500,
  );
  clickElement(button);
}

async function waitForAudienceStep() {
  await waitFor(
    () =>
      window.location.href.includes(AUDIENCE_PATH) ||
      new URL(window.location.href).searchParams.get("step") === "audience"
        ? true
        : undefined,
    120_000,
    "Facebook did not reach the Marketplace audience step.",
    1_000,
  );
  await sleep(2_000);
}

async function setAudienceGroupsSelected(
  selected: boolean,
  startFromBottom: boolean,
) {
  const groups = Array.from(
    document.querySelectorAll<HTMLElement>('div[role="checkbox"]'),
  ).filter(isVisible);
  const orderedGroups = startFromBottom ? [...groups].reverse() : groups;
  for (const group of orderedGroups) {
    if (group.getAttribute("aria-checked") !== String(selected)) {
      clickElement(group);
      await sleep(100);
    }
  }
  console.log(
    LOG_PREFIX,
    selected ? "Selected audience groups" : "Cleared audience groups",
    orderedGroups.length,
  );
}

async function waitForPublishing(title: string) {
  await waitFor(
    () => {
      if (window.location.href.includes(PUBLISH_SUCCESS_PATH)) {
        return true;
      }
      const pageText = normalizeText(document.body?.innerText);
      if (pageText.includes(TECHNICAL_ERROR_TEXT)) {
        throw new Error(
          "Facebook reported a technical error while publishing the item.",
        );
      }
      return undefined;
    },
    120_000,
    `Facebook timed out while publishing ${title}.`,
    1_000,
  );
}

async function createMarketplaceItem(
  listing: MarketplaceItemListing,
  shareToSuggestedGroups: boolean,
) {
  if (!window.location.pathname.includes(CREATE_ITEM_PATH)) {
    throw new Error("The Facebook tab is not on the create Item listing page.");
  }
  const pageText = normalizeText(document.body?.innerText);
  if (pageText.includes(LIMIT_REACHED_TEXT)) {
    throw new Error(
      "Facebook Marketplace listing limit reached. Try again later.",
    );
  }

  await runMarketplacePostingStep(() => uploadImages(listing.images));
  await runMarketplacePostingStep(() =>
    fillTextField("Title", listing.title, true),
  );
  await runMarketplacePostingStep(() =>
    fillTextField("Price", listing.price, true),
  );
  await runMarketplacePostingStep(() =>
    selectDrawerOption("Category", listing.category, [], true),
  );
  await runMarketplacePostingStep(() =>
    selectDrawerOption("Condition", listing.condition, [], true),
  );
  await runMarketplacePostingStep(() =>
    fillTextField("Description", listing.description, true),
  );

  if (
    normalizeText(document.body?.innerText).includes(
      "please upload at least one photo.",
    )
  ) {
    throw new Error("Facebook did not accept the uploaded photos.");
  }

  await runMarketplacePostingStep(() => clickEnabledAction("Next", 120_000));
  await runMarketplacePostingStep(waitForAudienceStep);
  await runMarketplacePostingStep(() =>
    setAudienceGroupsSelected(
      shareToSuggestedGroups,
      listing.listingIndex % 2 !== 0,
    ),
  );
  await runMarketplacePostingStep(() => clickEnabledAction("Publish", 120_000));
  await waitForPublishing(listing.title);
  console.log(LOG_PREFIX, "Published item", listing.title);
}

async function createMarketplaceVehicle(
  listing: MarketplaceVehicleListing,
  shareToSuggestedGroups: boolean,
) {
  if (!window.location.pathname.includes(CREATE_VEHICLE_PATH)) {
    throw new Error(
      "The Facebook tab is not on the create Vehicle listing page.",
    );
  }
  if (normalizeText(document.body?.innerText).includes(LIMIT_REACHED_TEXT)) {
    throw new Error(
      "Facebook Marketplace listing limit reached. Try again later.",
    );
  }

  const facebookVehicleType = await runMarketplacePostingStep(() =>
    selectVehicleType(listing.vehicleType, true),
  );
  await runMarketplacePostingStep(() =>
    uploadImages(listing.images.slice(0, 20)),
  );
  await runMarketplacePostingStep(() => selectLocation(listing.location));
  await runMarketplacePostingStep(() =>
    selectDrawerOption("Year", listing.year, [], true),
  );
  await runMarketplacePostingStep(() => selectVehicleMake(listing.make, true));
  await runMarketplacePostingStep(() =>
    fillTextField("Model", listing.model, true),
  );
  await runMarketplacePostingStep(() =>
    fillTextField("Mileage", listing.mileage, true),
  );
  await runMarketplacePostingStep(() =>
    fillTextField("Price", listing.price, true),
  );
  await runMarketplacePostingStep(() =>
    selectVehicleBodyStyle(listing.bodyStyle, facebookVehicleType, true),
  );
  await runMarketplacePostingStep(() =>
    setCleanTitle(listing.cleanTitle, true),
  );
  await runMarketplacePostingStep(() =>
    selectDrawerOption("Vehicle condition", listing.condition, [], true),
  );
  await runMarketplacePostingStep(() =>
    selectDrawerOption("Fuel type", listing.fuelType, [], true),
  );
  await runMarketplacePostingStep(() =>
    selectDrawerOption("Transmission", listing.transmission, [], true),
  );
  await runMarketplacePostingStep(() =>
    selectDrawerOption("Exterior color", listing.exteriorColor, [], true),
  );
  await runMarketplacePostingStep(() =>
    selectDrawerOption("Interior color", listing.interiorColor, [], true),
  );
  await runMarketplacePostingStep(() =>
    fillTextField("Description", listing.description, true),
  );

  await runMarketplacePostingStep(() => clickEnabledAction("Next", 120_000));
  await runMarketplacePostingStep(waitForAudienceStep);
  await runMarketplacePostingStep(() =>
    setAudienceGroupsSelected(
      shareToSuggestedGroups,
      listing.listingIndex % 2 !== 0,
    ),
  );
  await runMarketplacePostingStep(() => clickEnabledAction("Publish", 120_000));
  await waitForPublishing(`${listing.year} ${listing.make} ${listing.model}`);
  console.log(
    LOG_PREFIX,
    "Published vehicle",
    listing.year,
    listing.make,
    listing.model,
  );
}

if (marketplaceGlobal[CONTENT_SCRIPT_MARKER] !== true) {
  marketplaceGlobal[CONTENT_SCRIPT_MARKER] = true;
  chrome.runtime.onMessage.addListener(
    (
      request:
        | CreateMarketplaceItemListingRequest
        | CreateMarketplaceVehicleListingRequest
        | {
            type:
              | "PAUSE_MARKETPLACE_POSTING"
              | "RESUME_MARKETPLACE_POSTING"
              | "STOP_MARKETPLACE_POSTING"
              | "SHOW_MARKETPLACE_DESCRIPTION_GENERATING";
          },
      _sender,
      sendResponse: (response: MarketplaceItemPostingResponse) => void,
    ) => {
      if (request.type === "SHOW_MARKETPLACE_DESCRIPTION_GENERATING") {
        void fillTextField(
          "Description",
          "Generating Description with Gemini AI…",
          true,
        )
          .then((filled) =>
            sendResponse({
              ok: Boolean(filled),
              error: filled
                ? undefined
                : "Facebook's Description field is unavailable.",
            }),
          )
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to show the Gemini description status.",
            }),
          );
        return true;
      }
      if (request.type === "PAUSE_MARKETPLACE_POSTING") {
        marketplacePostingPaused = true;
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "RESUME_MARKETPLACE_POSTING") {
        marketplacePostingPaused = false;
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "STOP_MARKETPLACE_POSTING") {
        marketplacePostingStopped = true;
        marketplacePostingPaused = false;
        sendResponse({ ok: true });
        return false;
      }
      if (
        request.type !== "CREATE_MARKETPLACE_ITEM_LISTING" &&
        request.type !== "CREATE_MARKETPLACE_VEHICLE_LISTING"
      ) {
        return false;
      }
      marketplacePostingPaused = false;
      marketplacePostingStopped = false;
      const posting =
        request.type === "CREATE_MARKETPLACE_ITEM_LISTING"
          ? createMarketplaceItem(
              request.listing,
              request.shareToSuggestedGroups,
            )
          : createMarketplaceVehicle(
              request.listing,
              request.shareToSuggestedGroups,
            );
      void posting
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          console.error(LOG_PREFIX, error);
          sendResponse({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Unable to publish Marketplace item.",
          });
        });
      return true;
    },
  );
}
