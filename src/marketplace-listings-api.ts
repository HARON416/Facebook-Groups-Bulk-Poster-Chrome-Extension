export type SessionConfig = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  cookie: string;
  fbDtsg: string;
  lsd: string;
  userId: string;
  aaid: string;
  rev: string;
  hsi: string;
  hs: string;
  s: string;
  jazoest: string;
  docId: string;
};

export type MarketplaceListing = {
  id: string;
  title: string;
  price: string;
  photoUrl: string;
  shareUrl: string;
  creationTime: number;
  views: number;
  isSold: boolean;
  isLive: boolean;
};

type MarketplacePageResult = {
  listings: MarketplaceListing[];
  nextCursor: string | null;
  hasMore: boolean;
};

const getMarketplaceGraphqlUrl = (session: SessionConfig) =>
  new URL(session.url, window.location.origin).toString();

const createMarketplacePageBody = (
  session: SessionConfig,
  options: { count?: number; cursor?: string | null; order?: string },
) => {
  const body = new URLSearchParams(session.body);
  const originalVariables = JSON.parse(body.get("variables") ?? "{}") as Record<
    string,
    unknown
  >;
  const capturedCount = Number(originalVariables.count);
  const variables: Record<string, unknown> = {
    ...originalVariables,
    count:
      options.count ?? (Number.isFinite(capturedCount) ? capturedCount : 10),
    order:
      options.order ??
      (typeof originalVariables.order === "string"
        ? originalVariables.order
        : "CREATION_TIMESTAMP_DESC"),
  };
  if (options.cursor) variables.cursor = options.cursor;
  else delete variables.cursor;
  body.set("variables", JSON.stringify(variables));
  body.set("__spin_t", String(Math.floor(Date.now() / 1000)));
  return body;
};

const getMarketplaceRequestHeaders = (
  session: SessionConfig,
  body: URLSearchParams,
): HeadersInit => ({
  accept: "*/*",
  "content-type": "application/x-www-form-urlencoded",
  "x-asbd-id": session.headers["x-asbd-id"] ?? "359341",
  "x-fb-friendly-name":
    session.headers["x-fb-friendly-name"] ??
    "MarketplaceYouSellingFastActiveSectionPaginationQuery",
  "x-fb-lsd": session.headers["x-fb-lsd"] ?? body.get("lsd") ?? session.lsd,
});

export const captureMarketplacePaginationRequest = async (
  onScrollAttempt?: (attempt: number) => void,
): Promise<SessionConfig> =>
  new Promise((resolve, reject) => {
    const targetFriendlyName =
      "MarketplaceYouSellingFastActiveSectionPaginationQuery";
    const captureEventName = "__soar_marketplace_graphql_captured__";
    let scrollTimeout: ReturnType<typeof setTimeout> | undefined;
    let overallTimeout: ReturnType<typeof setTimeout> | undefined;
    let scrollAttempt = 0;

    const cleanup = () => {
      window.removeEventListener(captureEventName, onCapture);
      if (scrollTimeout) clearTimeout(scrollTimeout);
      if (overallTimeout) clearTimeout(overallTimeout);
    };
    const onCapture = (event: Event) => {
      cleanup();
      resolve(
        JSON.parse((event as CustomEvent<string>).detail) as SessionConfig,
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
          pageScroller.scrollHeight,
        );
      }
      window.scrollBy({ top: distance, behavior: "auto" });

      scrollTimeout = setTimeout(scroll, 1_500);
    };
    overallTimeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${targetFriendlyName} after ${scrollAttempt} scroll attempts`,
        ),
      );
    }, 90_000);
    scroll();
  });

export const fetchMarketplacePage = async (
  session: SessionConfig,
  options: { count?: number; cursor?: string | null; order?: string } = {},
): Promise<MarketplacePageResult> => {
  const count = options.count ?? 10;
  const body = createMarketplacePageBody(session, options);
  const response = await fetch(getMarketplaceGraphqlUrl(session), {
    method: "POST",
    headers: getMarketplaceRequestHeaders(session, body),
    body: body.toString(),
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const parsed = JSON.parse(lines[0]);
  const edges: any[] =
    parsed?.data?.viewer?.marketplace_listing_sets?.edges ?? [];
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
      isLive: listing.is_live,
    } satisfies MarketplaceListing;
  });
  const lastEdge = edges[edges.length - 1];
  return {
    listings,
    nextCursor: lastEdge?.cursor ?? null,
    hasMore: edges.length === count,
  };
};

export const fetchAllListings = async (
  session: SessionConfig,
  onProgress: (progress: {
    page: number;
    totalListings: number;
    pageListings: number;
    hasMore: boolean;
  }) => void,
) => {
  const allListings: MarketplaceListing[] = [];
  let cursor: string | null = null;
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
      hasMore: result.hasMore,
    });
    if (result.hasMore)
      await new Promise((resolve) => setTimeout(resolve, 500));
  } while (cursor);
  return allListings;
};

export async function deleteMarketplaceListing(
  session: SessionConfig,
  listingId: string,
): Promise<boolean> {
  const variables = {
    input: {
      actor_id: session.userId,
      client_mutation_id: "1",
      batch_delete_variants: true,
      for_sale_item_id: listingId,
      referral_surface: null,
      surface: "MARKETPLACE_PAGE_SELLING",
    },
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
    __spin_t: String(Math.floor(Date.now() / 1000)),
  });
  const response = await fetch("https://www.facebook.com/api/graphql/", {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
      "x-asbd-id": session.headers["x-asbd-id"] ?? "359341",
      "x-fb-friendly-name": "useCometMarketplaceForSaleItemDeleteMutation",
      "x-fb-lsd": session.lsd,
    },
    body: body.toString(),
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const parsedResponses = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line)) as any[];
  const errors = parsedResponses.flatMap((parsed) =>
    Array.isArray(parsed?.errors) ? parsed.errors : [],
  );
  if (errors.length)
    throw new Error(`Delete failed: ${JSON.stringify(errors)}`);
  const matchingDeleteResult = parsedResponses
    .map((parsed) => parsed.data?.commerce_for_sale_item_delete)
    .filter(Boolean)
    .find((result) => result.deleted_for_sale_item_id === listingId);
  if (!matchingDeleteResult) {
    throw new Error("Delete failed: response did not confirm this listing");
  }
  return true;
}
