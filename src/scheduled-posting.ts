import type { StartUiPostingRequest } from "./config";

const DATABASE_NAME = "postika-scheduled-posting";
const STORE_NAME = "queues";
const ACTIVE_QUEUE_KEY = "active";

export type ScheduledPosting = {
  request: StartUiPostingRequest;
  scheduledAt: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open scheduled queue storage."));
    request.onblocked = () =>
      reject(new Error("Scheduled queue storage is blocked by another page."));
  });
}

export async function saveScheduledPosting(
  posting: ScheduledPosting,
): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(posting, ACTIVE_QUEUE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("Could not save the scheduled posting queue."),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error("Saving the scheduled posting queue was interrupted."),
        );
    });
  } finally {
    database.close();
  }
}

export async function getScheduledPosting(): Promise<
  ScheduledPosting | undefined
> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_QUEUE_KEY);
      request.onsuccess = () =>
        resolve(request.result as ScheduledPosting | undefined);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not read the scheduled queue."));
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error("Reading the scheduled queue was interrupted."),
        );
    });
  } finally {
    database.close();
  }
}

export async function takeScheduledPosting(): Promise<
  ScheduledPosting | undefined
> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_QUEUE_KEY);
      let posting: ScheduledPosting | undefined;
      request.onsuccess = () => {
        posting = request.result as ScheduledPosting | undefined;
        if (posting) store.delete(ACTIVE_QUEUE_KEY);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Could not claim the scheduled queue."));
      transaction.oncomplete = () => resolve(posting);
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("Could not claim the scheduled queue."),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error("Claiming the scheduled queue was interrupted."),
        );
    });
  } finally {
    database.close();
  }
}

export async function removeScheduledPosting(): Promise<boolean> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ACTIVE_QUEUE_KEY);
      let existed = false;
      request.onsuccess = () => {
        existed = request.result !== undefined;
        if (existed) store.delete(ACTIVE_QUEUE_KEY);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Could not cancel the scheduled queue."));
      transaction.oncomplete = () => resolve(existed);
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("Could not cancel the scheduled queue."),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error("Cancelling the scheduled queue was interrupted."),
        );
    });
  } finally {
    database.close();
  }
}
