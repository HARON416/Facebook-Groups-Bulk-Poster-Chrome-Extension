export function initializeCardAccordions(onChange: () => void) {
  document.querySelectorAll<HTMLDetailsElement>("#create-form details.card-accordion")
    .forEach((card) => card.addEventListener("toggle", onChange));
}

export function expandedCardIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>("#create-form details.card-accordion[open]"))
    .map((card) => card.id);
}

export function restoreExpandedCards(ids: string[]) {
  // Older sessions may contain multiple open cards. Restore just the first
  // surviving card, consistent with the exclusive native details group.
  const expanded = ids.find((id) => document.getElementById(id)?.matches("#create-form details.card-accordion"));
  document.querySelectorAll<HTMLDetailsElement>("#create-form details.card-accordion")
    .forEach((card) => { card.open = card.id === expanded; });
}

export function revealCardFor(element: Element | null) {
  let card = element?.closest<HTMLDetailsElement>("details.card-accordion");
  while (card) {
    card.open = true;
    card = card.parentElement?.closest<HTMLDetailsElement>("details.card-accordion");
  }
}
