export type PostingWizardState = {
  body: string;
  html: string;
  images: File[];
  groups: { id: string; name: string }[];
  busy: boolean;
};

export type PostingWizardMessages = {
  nextSelectGroups: string;
  addTextAndImage: string;
  addText: string;
  addImage: string;
  selectOneGroup: string;
  oneGroupSelectedContinue: string;
  groupsSelectedContinue: (count: number) => string;
  oneImageCount: string;
  imageCount: (count: number) => string;
  oneGroupSelected: string;
  groupsSelectedCount: (count: number) => string;
};

export function initializePostingWizard(
  getState: () => PostingWizardState,
  onStepChange: () => void,
  getMessages: () => PostingWizardMessages,
) {
  let step = 1;
  const panels = [1, 2, 3].map(
    (number) => document.querySelector<HTMLElement>(`#posting-step-${number}`)!,
  );
  const tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-posting-step]"),
  );
  const composeNext =
    document.querySelector<HTMLButtonElement>("#compose-next-btn")!;
  const composeGuidance = document.querySelector<HTMLElement>(
    "#compose-next-guidance",
  )!;
  const groupsNext =
    document.querySelector<HTMLButtonElement>("#groups-next-btn")!;
  const backButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-posting-back]"),
  );
  function refresh() {
    const state = getState();
    const messages = getMessages();
    const composed = Boolean(state.body.trim()) && state.images.length > 0;
    const selected = state.groups.length > 0;
    if (state.busy) step = 3;
    panels.forEach((panel, index) => {
      panel.hidden = index + 1 !== step;
      panel.classList.toggle(
        "posting-step--posting",
        index === 2 && state.busy,
      );
    });
    tabs.forEach((button, index) => {
      const number = index + 1;
      button.disabled =
        state.busy || (number > 1 && !composed) || (number === 3 && !selected);
      if (number === step) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      button.classList.toggle("posting-steps__complete", number < step);
    });
    composeNext.disabled = state.busy || !composed;
    composeGuidance.hidden = state.busy || composed;
    composeGuidance.textContent = composeGuidance.hidden
      ? ""
      : !state.body.trim() && state.images.length === 0
        ? messages.addTextAndImage
        : !state.body.trim()
          ? messages.addText
          : messages.addImage;
    composeNext.textContent = messages.nextSelectGroups;
    groupsNext.disabled = state.busy || !composed || !selected;
    backButtons.forEach((button) => {
      button.disabled = state.busy;
    });
    document.querySelector("#groups-step-guidance")!.textContent = selected
      ? state.groups.length === 1
        ? messages.oneGroupSelectedContinue
        : messages.groupsSelectedContinue(state.groups.length)
      : messages.selectOneGroup;
    document.querySelector<HTMLElement>("#review-post-summary")!.innerHTML =
      state.html;
    document.querySelector("#review-image-count")!.textContent =
      state.images.length === 1
        ? messages.oneImageCount
        : messages.imageCount(state.images.length);
    document.querySelector("#review-groups-summary")!.textContent =
      state.groups.length === 1
        ? messages.oneGroupSelected
        : messages.groupsSelectedCount(state.groups.length);
    const reviewGroups = document.querySelector<HTMLUListElement>(
      "#review-groups-list",
    )!;
    reviewGroups.replaceChildren(
      ...state.groups.map((group) => {
        const item = document.createElement("li");
        item.textContent = group.name;
        return item;
      }),
    );
  }

  function show(number: number) {
    const state = getState();
    if (state.busy) return;
    const composed = Boolean(state.body.trim()) && state.images.length > 0;
    step = !composed
      ? 1
      : number === 3 && state.groups.length === 0
        ? 2
        : number;
    refresh();
    document
      .querySelector<HTMLElement>(`#posting-step-heading-${step}`)
      ?.focus();
    onStepChange();
  }
  tabs.forEach((button) =>
    button.addEventListener("click", () =>
      show(Number(button.dataset.postingStep)),
    ),
  );
  backButtons.forEach((button) =>
    button.addEventListener("click", () =>
      show(Number(button.dataset.postingBack)),
    ),
  );
  composeNext.addEventListener("click", () => show(2));
  groupsNext.addEventListener("click", () => show(3));
  refresh();
  return {
    refresh,
    show,
    get step() {
      return step;
    },
  };
}
