"use strict";
(() => {
  // src/marketplace-listings-api.ts
  var getMarketplaceGraphqlUrl = (session) => new URL(session.url, window.location.origin).toString();
  var createMarketplacePageBody = (session, options) => {
    const body = new URLSearchParams(session.body);
    const originalVariables = JSON.parse(body.get("variables") ?? "{}");
    const capturedCount = Number(originalVariables.count);
    const variables = {
      ...originalVariables,
      count: options.count ?? (Number.isFinite(capturedCount) ? capturedCount : 10),
      order: options.order ?? (typeof originalVariables.order === "string" ? originalVariables.order : "CREATION_TIMESTAMP_DESC")
    };
    if (options.cursor) variables.cursor = options.cursor;
    else delete variables.cursor;
    body.set("variables", JSON.stringify(variables));
    body.set("__spin_t", String(Math.floor(Date.now() / 1e3)));
    return body;
  };
  var getMarketplaceRequestHeaders = (session, body) => ({
    accept: "*/*",
    "content-type": "application/x-www-form-urlencoded",
    "x-asbd-id": session.headers["x-asbd-id"] ?? "359341",
    "x-fb-friendly-name": session.headers["x-fb-friendly-name"] ?? "MarketplaceYouSellingFastActiveSectionPaginationQuery",
    "x-fb-lsd": session.headers["x-fb-lsd"] ?? body.get("lsd") ?? session.lsd
  });
  var captureMarketplacePaginationRequest = async (onScrollAttempt) => new Promise((resolve, reject) => {
    const targetFriendlyName = "MarketplaceYouSellingFastActiveSectionPaginationQuery";
    const captureEventName = "__soar_marketplace_graphql_captured__";
    let scrollTimeout;
    let overallTimeout;
    let scrollAttempt = 0;
    const cleanup = () => {
      window.removeEventListener(captureEventName, onCapture);
      if (scrollTimeout) clearTimeout(scrollTimeout);
      if (overallTimeout) clearTimeout(overallTimeout);
    };
    const onCapture = (event) => {
      cleanup();
      resolve(
        JSON.parse(event.detail)
      );
    };
    window.addEventListener(captureEventName, onCapture);
    const scroll = () => {
      scrollAttempt += 1;
      onScrollAttempt?.(scrollAttempt);
      const pageScroller = document.scrollingElement;
      const distance = Math.max(window.innerHeight * 0.9, 900);
      if (pageScroller) {
        pageScroller.scrollTop = Math.min(
          pageScroller.scrollTop + distance,
          pageScroller.scrollHeight
        );
      }
      window.scrollBy({ top: distance, behavior: "auto" });
      scrollTimeout = setTimeout(scroll, 1500);
    };
    overallTimeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${targetFriendlyName} after ${scrollAttempt} scroll attempts`
        )
      );
    }, 9e4);
    scroll();
  });
  var fetchMarketplacePage = async (session, options = {}) => {
    const count = options.count ?? 10;
    const body = createMarketplacePageBody(session, options);
    const response = await fetch(getMarketplaceGraphqlUrl(session), {
      method: "POST",
      headers: getMarketplaceRequestHeaders(session, body),
      body: body.toString(),
      credentials: "include"
    });
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    const lines = text.split("\n").filter((line) => line.trim() !== "");
    const parsed = JSON.parse(lines[0]);
    const edges = parsed?.data?.viewer?.marketplace_listing_sets?.edges ?? [];
    const listings = edges.map((edge) => {
      const listing = edge.node.first_listing;
      return {
        id: listing.id,
        title: listing.marketplace_listing_title,
        price: listing.formatted_price?.text ?? "",
        photoUrl: listing.primary_listing_photo?.image?.uri ?? "",
        shareUrl: listing.share_uri,
        creationTime: listing.creation_time,
        views: listing.listing_insights?.insights?.[0]?.count ?? 0,
        isSold: listing.is_sold,
        isLive: listing.is_live
      };
    });
    const lastEdge = edges[edges.length - 1];
    return {
      listings,
      nextCursor: lastEdge?.cursor ?? null,
      hasMore: edges.length === count
    };
  };
  var fetchAllListings = async (session, onProgress) => {
    const allListings = [];
    let cursor = null;
    let page = 0;
    do {
      const result = await fetchMarketplacePage(session, { cursor });
      allListings.push(...result.listings);
      cursor = result.nextCursor;
      page += 1;
      onProgress({
        page,
        totalListings: allListings.length,
        pageListings: result.listings.length,
        hasMore: result.hasMore
      });
      if (result.hasMore)
        await new Promise((resolve) => setTimeout(resolve, 500));
    } while (cursor);
    return allListings;
  };
  async function deleteMarketplaceListing(session, listingId) {
    const variables = {
      input: {
        actor_id: session.userId,
        client_mutation_id: "1",
        batch_delete_variants: true,
        for_sale_item_id: listingId,
        referral_surface: null,
        surface: "MARKETPLACE_PAGE_SELLING"
      }
    };
    const body = new URLSearchParams({
      av: session.userId,
      __aaid: session.aaid,
      __user: session.userId,
      __a: "1",
      __req: "1",
      __hs: session.hs,
      dpr: "1",
      __ccg: "EXCELLENT",
      __rev: session.rev,
      __s: session.s,
      __hsi: session.hsi,
      __crn: "comet.fbweb.MarketplaceSellingUIMRoute",
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: "useCometMarketplaceForSaleItemDeleteMutation",
      server_timestamps: "true",
      variables: JSON.stringify(variables),
      doc_id: "30073389588942699",
      fb_dtsg: session.fbDtsg,
      jazoest: session.jazoest,
      lsd: session.lsd,
      __spin_r: session.rev,
      __spin_b: "trunk",
      __spin_t: String(Math.floor(Date.now() / 1e3))
    });
    const response = await fetch("https://www.facebook.com/api/graphql/", {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded",
        "x-asbd-id": session.headers["x-asbd-id"] ?? "359341",
        "x-fb-friendly-name": "useCometMarketplaceForSaleItemDeleteMutation",
        "x-fb-lsd": session.lsd
      },
      body: body.toString(),
      credentials: "include"
    });
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    const parsedResponses = text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
    const errors = parsedResponses.flatMap(
      (parsed) => Array.isArray(parsed?.errors) ? parsed.errors : []
    );
    if (errors.length)
      throw new Error(`Delete failed: ${JSON.stringify(errors)}`);
    const matchingDeleteResult = parsedResponses.map((parsed) => parsed.data?.commerce_for_sale_item_delete).filter(Boolean).find((result) => result.deleted_for_sale_item_id === listingId);
    if (!matchingDeleteResult) {
      throw new Error("Delete failed: response did not confirm this listing");
    }
    return true;
  }

  // src/marketplace-cleanup.ts
  var SELLING_PATH = "/marketplace/you/selling";
  var MARKER = "__facebookMarketplaceCleanupLoaded";
  var cleanupGlobal = globalThis;
  var wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function notify(partial) {
    void chrome.runtime.sendMessage({
      type: "MARKETPLACE_CLEANUP_STATUS",
      ...partial
    });
  }
  function getCreationDate(creationTime) {
    return new Date(
      creationTime < 1e12 ? creationTime * 1e3 : creationTime
    );
  }
  function isOlderThan(creationTime, days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1e3;
    return getCreationDate(creationTime).getTime() < cutoff;
  }
  async function runCleanup(daysOld, activeSession) {
    if (window.location.pathname !== SELLING_PATH) {
      throw new Error(
        "Marketplace cleanup only works on the Facebook Marketplace selling page."
      );
    }
    if (new URLSearchParams(window.location.search).get("action") !== "delete") {
      throw new Error(
        "Marketplace cleanup requires the ?action=delete query parameter."
      );
    }
    if (!Number.isSafeInteger(daysOld) || daysOld < 0) {
      throw new Error("Days old must be a whole number of 0 or greater.");
    }
    notify({
      status: "preparing",
      message: "Loading selling listings\u2026",
      processed: 0,
      total: 0,
      deletedCount: 0,
      failedCount: 0
    });
    if (document.readyState !== "complete") {
      await new Promise(
        (resolve) => window.addEventListener("load", () => resolve(), { once: true })
      );
    }
    await wait(3e3);
    let session = activeSession;
    if (session) {
      notify({
        status: "scanning",
        message: "Captured active listings from the loaded Marketplace page.",
        processed: 0,
        total: 0,
        deletedCount: 0,
        failedCount: 0
      });
    }
    if (!session) {
      notify({
        status: "scanning",
        message: "Watching active Marketplace pagination request\u2026",
        processed: 0,
        total: 0,
        deletedCount: 0,
        failedCount: 0
      });
      try {
        session = await captureMarketplacePaginationRequest((attempt) => {
          notify({
            status: "scanning",
            message: `Scrolling selling listings to capture active pagination (attempt ${attempt})\u2026`,
            processed: 0,
            total: 0,
            deletedCount: 0,
            failedCount: 0
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
            error: "There may not be enough active listings to load another page, or Facebook did not expose the expected pagination request."
          });
          return 0;
        } else {
          throw error;
        }
      }
    }
    const listingsById = /* @__PURE__ */ new Map();
    if (session) {
      const activeListings = await fetchAllListings(
        session,
        ({ page, totalListings, pageListings, hasMore }) => {
          notify({
            status: "scanning",
            message: `Fetched active page ${page} (${pageListings} new, ${totalListings} active total)${hasMore ? "\u2026" : "."}`,
            processed: totalListings,
            total: 0,
            deletedCount: 0,
            failedCount: 0
          });
        }
      );
      activeListings.forEach((listing) => listingsById.set(listing.id, listing));
    }
    const listings = Array.from(listingsById.values());
    const oldListings = listings.filter(
      (listing) => isOlderThan(listing.creationTime, daysOld)
    );
    if (oldListings.length === 0) {
      notify({
        status: "done",
        message: daysOld === 0 ? "No active Marketplace listings were found." : `No active Marketplace listings older than ${daysOld} ${daysOld === 1 ? "day" : "days"} were found.`,
        processed: 0,
        total: 0,
        deletedCount: 0,
        failedCount: 0
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
        message: `Deleting \u201C${listing.title || "Untitled listing"}\u201D (${index + 1}/${oldListings.length})\u2026`,
        processed: index,
        total: oldListings.length,
        deletedCount,
        failedCount,
        listingId: listing.id,
        listingTitle: listing.title
      });
      try {
        if (!session) {
          throw new Error("Active listings session is unavailable.");
        }
        await deleteMarketplaceListing(session, listing.id);
        deletedCount += 1;
        notify({
          status: "deleted",
          message: `Deleted \u201C${listing.title || "Untitled listing"}\u201D.`,
          processed: index + 1,
          total: oldListings.length,
          deletedCount,
          failedCount,
          listingId: listing.id,
          listingTitle: listing.title
        });
        await wait(500);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        failedCount += 1;
        notify({
          status: "failed",
          message: `Failed to delete \u201C${listing.title || "Untitled listing"}\u201D.`,
          processed: index + 1,
          total: oldListings.length,
          deletedCount,
          failedCount,
          listingId: listing.id,
          listingTitle: listing.title,
          error: errorMessage
        });
        await wait(1e3);
      }
    }
    notify({
      status: "done",
      message: `Marketplace cleanup complete: ${deletedCount} deleted, ${failedCount} failed.`,
      processed: oldListings.length,
      total: oldListings.length,
      deletedCount,
      failedCount
    });
    return deletedCount;
  }
  if (cleanupGlobal[MARKER] !== true) {
    cleanupGlobal[MARKER] = true;
    chrome.runtime.onMessage.addListener(
      (request, _sender, sendResponse) => {
        if (request.type !== "RUN_MARKETPLACE_CLEANUP_IN_PAGE") return false;
        sendResponse({ ok: true });
        void runCleanup(request.daysOld, request.activeSession).then((deletedCount) => {
          void chrome.runtime.sendMessage({
            type: "MARKETPLACE_CLEANUP_FINISHED",
            runId: request.runId,
            ok: true,
            deletedCount
          });
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          notify({
            status: "failed",
            message: "Marketplace cleanup failed.",
            processed: 0,
            total: 0,
            deletedCount: 0,
            failedCount: 0,
            error: message
          });
          void chrome.runtime.sendMessage({
            type: "MARKETPLACE_CLEANUP_FINISHED",
            runId: request.runId,
            ok: false,
            error: message
          });
        });
        return false;
      }
    );
  }
})();
