/** Prepare a complete replacement before writing, and commit snapshots in order. */
export function createDraftSaver<Snapshot>(
  prepare: (snapshot: Snapshot) => Promise<Record<string, unknown>>,
  write: (values: Record<string, unknown>) => Promise<void>,
) {
  let pending = Promise.resolve();
  return (snapshot: Snapshot): Promise<void> => {
    const result = pending.then(async () => {
      const values = await prepare(snapshot);
      await write(values);
    });
    // A failed save must not prevent a later retry from running.
    pending = result.catch(() => {});
    return result;
  };
}
