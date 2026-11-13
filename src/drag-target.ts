export interface DragBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function overlappingTarget<T extends { bounds: DragBounds }>(
  dragged: DragBounds,
  targets: readonly T[],
  clip: DragBounds,
): T | undefined {
  let best: T | undefined;
  let bestArea = -1;
  let bestDistance = Infinity;

  for (const target of targets) {
    const visible = {
      left: Math.max(target.bounds.left, clip.left),
      top: Math.max(target.bounds.top, clip.top),
      right: Math.min(target.bounds.right, clip.right),
      bottom: Math.min(target.bounds.bottom, clip.bottom),
    };
    if (visible.right <= visible.left || visible.bottom <= visible.top) {
      continue;
    }

    const width =
      Math.min(dragged.right, visible.right) -
      Math.max(dragged.left, visible.left);
    const height =
      Math.min(dragged.bottom, visible.bottom) -
      Math.max(dragged.top, visible.top);
    if (width < 0 || height < 0) {
      continue;
    }

    const area = width * height;
    const distance =
      (dragged.left + dragged.right - visible.left - visible.right) ** 2 +
      (dragged.top + dragged.bottom - visible.top - visible.bottom) ** 2;
    if (
      area > bestArea ||
      (area === bestArea && distance < bestDistance)
    ) {
      best = target;
      bestArea = area;
      bestDistance = distance;
    }
  }

  return best;
}
