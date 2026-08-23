import type {
  MarketplaceCleanupStatusMessage,
  MarketplaceItemPostingResponse,
} from "./config";
import {
  captureMarketplacePaginationRequest,
  deleteMarketplaceListing,
  fetchAllListings,
  type SessionConfig,
} from "./marketplace-listings-api";

const SELLING_PATH = "/marketplace/you/selling";
const MARKER = "__facebookMarketplaceCleanupLoaded";
const cleanupGlobal = globalThis as typeof globalThis & Record<string, unknown>;
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function notify(partial: Omit<MarketplaceCleanupStatusMessage, "type">) {
  void chrome.runtime.sendMessage({
    type: "MARKETPLACE_CLEANUP_STATUS",
    ...partial,
  } satisfies MarketplaceCleanupStatusMessage);
}

function getCreationDate(creationTime: number) {
  return new Date(
    creationTime < 1_000_000_000_000 ? creationTime * 1000 : creationTime,
  );
}

function isOlderThan(creationTime: number, days: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1_000;
  return getCreationDate(creationTime).getTime() < cutoff;
}

async function runCleanup(
  daysOld: number,
  activeSession: SessionConfig | undefined,
): Promise<number> {
  if (window.location.pathname !== SELLING_PATH) {
    throw new Error(
      "Marketplace cleanup only works on the Facebook Marketplace selling page.",
    );
  }
  if (new URLSearchParams(window.location.search).get("action") !== "delete") {
    throw new Error(
      "Marketplace cleanup requires the ?action=delete query parameter.",
    );
  }
  if (!Number.isSafeInteger(daysOld) || daysOld < 0) {
    throw new Error("Days old must be a whole number of 0 or greater.");
  }

  notify({
    status: "preparing",
    message: "Loading selling listings…",
    processed: 0,
    total: 0,
    deletedCount: 0,
    failedCount: 0,
  });
  if (document.readyState !== "complete") {
    await new Promise<void>((resolve) =>
      window.addEventListener("load", () => resolve(), { once: true }),
    );
  }
  await wait(3000);

  let session:
    | Awaited<ReturnType<typeof captureMarketplacePaginationRequest>>
    | undefined = activeSession;
  if (session) {
    notify({
      status: "scanning",
      message: "Captured active listings from the loaded Marketplace page.",
      processed: 0,
      total: 0,
      deletedCount: 0,
      failedCount: 0,
    });
  }
  if (!session) {
    notify({
      status: "scanning",
      message: "Watching active Marketplace pagination request…",
      processed: 0,
      total: 0,
      deletedCount: 0,
      failedCount: 0,
    });
    try {
      session = await captureMarketplacePaginationRequest((attempt) => {
        notify({
          status: "scanning",
          message: `Scrolling selling listings to capture active pagination (attempt ${attempt})…`,
          processed: 0,
          total: 0,
          deletedCount: 0,
          failedCount: 0,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Timed out waiting for ")) {
        notify({
          status: "warning",
          message: "Active Marketplace pagination was not triggered.",
          processed: 0,
          total: 0,
          deletedCount: 0,
          failedCount: 0,
          error:
            "There may not be enough active listings to load another page, or Facebook did not expose the expected pagination request.",
        });
        return 0;
      } else {
        throw error;
      }
    }
  }
  const listingsById = new Map<
    string,
    Awaited<ReturnType<typeof fetchAllListings>>[number]
  >();
  if (session) {
    const activeListings = await fetchAllListings(
      session,
      ({ page, totalListings, pageListings, hasMore }) => {
        notify({
          status: "scanning",
          message: `Fetched active page ${page} (${pageListings} new, ${totalListings} active total)${hasMore ? "…" : "."}`,
          processed: totalListings,
          total: 0,
          deletedCount: 0,
          failedCount: 0,
        });
      },
    );
    activeListings.forEach((listing) => listingsById.set(listing.id, listing));
  }
  const listings = Array.from(listingsById.values());
  const oldListings = listings.filter((listing) =>
    isOlderThan(listing.creationTime, daysOld),
  );

  if (oldListings.length === 0) {
    notify({
      status: "done",
      message:
        daysOld === 0
          ? "No active Marketplace listings were found."
          : `No active Marketplace listings older than ${daysOld} ${daysOld === 1 ? "day" : "days"} were found.`,
      processed: 0,
      total: 0,
      deletedCount: 0,
      failedCount: 0,
    });
    return 0;
  }

  let deletedCount = 0;
  let failedCount = 0;
  for (let index = 0; index < oldListings.length; index += 1) {
    const listing = oldListings[index];
    if (!listing) continue;
    notify({
      status: "deleting",
      message: `Deleting “${listing.title || "Untitled listing"}” (${index + 1}/${oldListings.length})…`,
      processed: index,
      total: oldListings.length,
      deletedCount,
      failedCount,
      listingId: listing.id,
      listingTitle: listing.title,
    });
    try {
      if (!session) {
        throw new Error("Active listings session is unavailable.");
      }
      await deleteMarketplaceListing(session, listing.id);
      deletedCount += 1;
      notify({
        status: "deleted",
        message: `Deleted “${listing.title || "Untitled listing"}”.`,
        processed: index + 1,
        total: oldListings.length,
        deletedCount,
        failedCount,
        listingId: listing.id,
        listingTitle: listing.title,
      });
      await wait(500);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      failedCount += 1;
      notify({
        status: "failed",
        message: `Failed to delete “${listing.title || "Untitled listing"}”.`,
        processed: index + 1,
        total: oldListings.length,
        deletedCount,
        failedCount,
        listingId: listing.id,
        listingTitle: listing.title,
        error: errorMessage,
      });
      await wait(1000);
    }
  }

  notify({
    status: "done",
    message: `Marketplace cleanup complete: ${deletedCount} deleted, ${failedCount} failed.`,
    processed: oldListings.length,
    total: oldListings.length,
    deletedCount,
    failedCount,
  });
  return deletedCount;
}

if (cleanupGlobal[MARKER] !== true) {
  cleanupGlobal[MARKER] = true;
  chrome.runtime.onMessage.addListener(
    (
      request: {
        type: "RUN_MARKETPLACE_CLEANUP_IN_PAGE";
        runId: string;
        daysOld: number;
        activeSession?: SessionConfig;
      },
      _sender,
      sendResponse: (response: MarketplaceItemPostingResponse) => void,
    ) => {
      if (request.type !== "RUN_MARKETPLACE_CLEANUP_IN_PAGE") return false;
      sendResponse({ ok: true });
      void runCleanup(request.daysOld, request.activeSession)
        .then((deletedCount) => {
          void chrome.runtime.sendMessage({
            type: "MARKETPLACE_CLEANUP_FINISHED",
            runId: request.runId,
            ok: true,
            deletedCount,
          });
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          notify({
            status: "failed",
            message: "Marketplace cleanup failed.",
            processed: 0,
            total: 0,
            deletedCount: 0,
            failedCount: 0,
            error: message,
          });
          void chrome.runtime.sendMessage({
            type: "MARKETPLACE_CLEANUP_FINISHED",
            runId: request.runId,
            ok: false,
            error: message,
          });
        });
      return false;
    },
  );
}
