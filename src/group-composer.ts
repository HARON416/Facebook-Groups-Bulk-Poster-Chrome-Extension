// Facebook's generated classes are only a fallback for recognizing the label.
// The clamped label and decorative overlay come from the composer button DOM.
const COMPOSER_LABEL_CLASSES = "span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6";

export function isComposerElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    element.isConnected &&
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    !element.closest('[hidden], [aria-hidden="true"]')
  );
}

export function findGroupComposerButton(
  root: Document = document,
): HTMLElement | null {
  const main = root.querySelector('[role="main"]') ?? root;
  const candidates = Array.from(
    main.querySelectorAll<HTMLElement>('div[role="button"][tabindex="0"]'),
  ).filter((button) => {
    if (
      !isComposerElementVisible(button) ||
      button.getAttribute("aria-disabled") === "true"
    )
      return false;
    // Never mistake a navigation control or an action on an existing post for
    // the page's composer opener.
    if (
      button.closest(
        'article, [role="article"], [role="dialog"], [role="navigation"], [role="banner"], [role="complementary"]',
      )
    )
      return false;
    if (button.querySelector('svg, img, input, [contenteditable="true"], a'))
      return false;
    const overlay = button.querySelector(
      '[role="none"][data-visualcompletion="ignore"]',
    );
    if (!overlay || overlay.parentElement !== button) return false;
    const label = Array.from(
      button.querySelectorAll<HTMLSpanElement>("span"),
    ).find(
      (span) =>
        span.style.webkitLineClamp === "2" ||
        span.matches(COMPOSER_LABEL_CLASSES),
    );
    return (
      Boolean(label?.textContent?.trim()) &&
      label?.textContent?.trim() === button.textContent?.trim()
    );
  });
  // Ambiguity is safer to report than clicking an unrelated Facebook control.
  return candidates.length === 1 ? candidates[0] : null;
}

export function findGroupComposerEditor(dialog: Element): HTMLElement | null {
  return (
    Array.from(
      dialog.querySelectorAll<HTMLElement>(
        '[role="textbox"][contenteditable="true"]',
      ),
    ).find(isComposerElementVisible) ?? null
  );
}

export function findGroupComposerDialog(
  root: Document = document,
): HTMLElement | null {
  const dialogs = Array.from(
    root.querySelectorAll<HTMLElement>('[role="dialog"]'),
  ).filter(
    (dialog) =>
      isComposerElementVisible(dialog) && findGroupComposerEditor(dialog),
  );
  return dialogs.length === 1 ? dialogs[0] : null;
}

function composerForm(dialog: Element): HTMLFormElement | null {
  const form = findGroupComposerEditor(dialog)?.closest("form");
  return form && dialog.contains(form) && form.method.toLowerCase() === "post"
    ? form
    : null;
}

export function findGroupComposerMediaInput(
  dialog: Element,
): HTMLInputElement | null {
  const form = composerForm(dialog);
  const inputs = Array.from(
    form?.querySelectorAll<HTMLInputElement>('input[type="file"]') ?? [],
  ).filter(
    (input) =>
      input.isConnected &&
      !input.disabled &&
      input.accept
        .split(",")
        .some((type) => type.trim().toLowerCase().startsWith("image/")),
  );
  // The media input is intentionally hidden, so do not apply visibility checks.
  return inputs.length === 1 ? inputs[0] : null;
}

export function findGroupComposerMediaButton(
  dialog: Element,
): HTMLElement | null {
  const input = findGroupComposerMediaInput(dialog);
  const form = composerForm(dialog);
  for (
    let wrapper = input?.parentElement;
    wrapper && wrapper !== form;
    wrapper = wrapper.parentElement
  ) {
    const buttons = Array.from(
      wrapper.querySelectorAll<HTMLElement>('[role="button"], button'),
    ).filter(isComposerElementVisible);
    if (buttons.length === 1) return buttons[0];
    // Once outside the media control, do not guess among other toolbar actions.
    if (buttons.length > 1) return null;
  }
  return null;
}

export function findGroupComposerPostButton(
  dialog: Element,
): HTMLElement | null {
  const form = composerForm(dialog);
  if (
    !form ||
    !form.querySelector('input[type="submit"], button[type="submit"]')
  )
    return null;
  const buttons = Array.from(
    form.querySelectorAll<HTMLElement>('[role="button"], button'),
  ).filter(isComposerElementVisible);
  const button = buttons[buttons.length - 1];
  if (
    !button ||
    !button.textContent?.trim() ||
    !button.querySelector("span") ||
    button.querySelector("svg, img, i, input") ||
    !button.querySelector('[role="none"][data-visualcompletion="ignore"]')
  )
    return null;
  // The final action fills the composer footer; icon and toolbar buttons do not.
  if (
    button.getBoundingClientRect().width <
    form.getBoundingClientRect().width * 0.8
  )
    return null;
  return button;
}
