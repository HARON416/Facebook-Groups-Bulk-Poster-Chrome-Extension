/** Self-contained because Chrome serializes this function into the page. */
export function inspectPageReadinessInPage(expectedUrlPart: string): boolean {
  type Observation = {
    target: Element;
    url: string;
    lastChangedAt: number;
    observer: MutationObserver;
  };
  const page = window as typeof window & {
    __postikaPageReadiness?: Observation;
  };
  const cleanup = () => {
    page.__postikaPageReadiness?.observer.disconnect();
    delete page.__postikaPageReadiness;
  };

  if (!location.href.includes(expectedUrlPart) || document.readyState !== "complete" || !document.body) {
    cleanup();
    return false;
  }

  const target = document.querySelector('[role="main"]') ?? document.body;
  let observation = page.__postikaPageReadiness;
  if (!observation || observation.target !== target || observation.url !== location.href) {
    cleanup();
    observation = {
      target,
      url: location.href,
      lastChangedAt: Date.now(),
      observer: new MutationObserver(() => {
        if (page.__postikaPageReadiness) {
          page.__postikaPageReadiness.lastChangedAt = Date.now();
        }
      }),
    };
    observation.observer.observe(target, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-busy", "aria-hidden", "hidden", "disabled"],
    });
    page.__postikaPageReadiness = observation;
  }

  const busy = Array.from(target.querySelectorAll('[aria-busy="true"]'));
  if (target.getAttribute("aria-busy") === "true") busy.push(target);
  const visiblyBusy = busy.some((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  });
  // This quiet interval defines stability; it never limits total waiting time.
  if (visiblyBusy || Date.now() - observation.lastChangedAt < 1_500) return false;
  cleanup();
  return true;
}
