export function groupsInSelectionOrder<T extends { id: string }>(
  groups: T[],
  selectedIds: Iterable<string>,
): T[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  return Array.from(selectedIds).flatMap((id) => {
    const group = byId.get(id);
    return group ? [group] : [];
  });
}

export function shuffleGroups<T>(groups: T[], random: () => number = Math.random): T[] {
  const shuffled = [...groups];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
