export const JOINED_GROUPS_URL =
  "https://web.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added";

export const GROUPS_QUERY_FRIENDLY_NAME =
  "GroupsCometAllJoinedGroupsSectionPaginationQuery";

export type FacebookGroup = {
  id: string;
  name: string;
  url: string;
  viewer_join_state?: string;
  viewer_last_visited_time?: number;
};

export type LoadGroupsRequest = {
  type: "LOAD_GROUPS";
};

export type LoadGroupsResponse = {
  ok: boolean;
  groups?: FacebookGroup[];
  error?: string;
};

export type GroupExtractionStatusMessage = {
  type: "GROUP_EXTRACTION_STATUS";
  message: string;
  loadedCount: number;
  done?: boolean;
};

export type SimpleGroup = {
  id: string;
  name: string;
  url: string;
};

export type UiPostImage = {
  name: string;
  type: string;
  dataUrl: string;
};

export type UiPreparedPost = {
  id: string;
  body: string;
  images: UiPostImage[];
};

export type StartUiPostingRequest = {
  type: "START_UI_POSTING";
  startedAt: number;
  groups: SimpleGroup[];
  posts: UiPreparedPost[];
  minimumDelaySeconds: number;
  maximumDelaySeconds: number;
  maxPosts: number;
  groupCommentEnabled?: boolean;
  groupCommentOptions?: string[];
};

export type StopUiPostingRequest = {
  type: "STOP_UI_POSTING";
};

export type PauseUiPostingRequest = {
  type: "PAUSE_UI_POSTING";
};

export type ResumeUiPostingRequest = {
  type: "RESUME_UI_POSTING";
};

export type PostingTiming = {
  startedAt: number;
  updatedAt: number;
  elapsedMs: number;
  itemElapsedMs: number;
  pausedMs: number;
  isPaused: boolean;
  isComplete: boolean;
};

export type UiPostingStatusMessage = {
  type: "UI_POSTING_STATUS";
  status:
    | "idle"
    | "posting"
    | "waiting"
    | "paused"
    | "posted"
    | "pending"
    | "failed"
    | "rate_limited"
    | "stopped"
    | "done";
  message: string;
  detail?: string;
  responseBody?: string;
  current: number;
  total: number;
  groupId?: string;
  groupName?: string;
  successCount?: number;
  pendingCount?: number;
  failedCount?: number;
  processedCount?: number;
  successTarget?: number;
  timing?: PostingTiming;
  error?: string;
};

export type UiPostingResponse = {
  ok: boolean;
  error?: string;
};

export type AccessLimitValues = {
  saved_group_posts: number | null;
  saved_marketplace_listings: number | null;
  group_posts_today: number | null;
  marketplace_listings_today: number | null;
};

export type AccessEntitlements = {
  tier: "free" | "pro";
  pro_expires_at?: string;
  pro_lifetime?: boolean;
  limits: AccessLimitValues;
  usage: {
    saved_group_posts: number;
    saved_marketplace_listings: number;
    group_posts_today: number;
    marketplace_listings_today: number;
  };
  remaining: AccessLimitValues;
  reset_at: {
    group_posts_today?: string;
    marketplace_listings_today?: string;
  };
};

export type AccessEntitlementsUpdatedMessage = {
  type: "ACCESS_ENTITLEMENTS_UPDATED";
  access: AccessEntitlements;
};

export type MarketplaceItemListing = {
  listingType: "item";
  id: string;
  title: string;
  price: string;
  category: string;
  condition: string;
  description: string;
  images: UiPostImage[];
  listingIndex: number;
};

export type MarketplaceVehicleListing = {
  listingType: "vehicle";
  id: string;
  vehicleType: string;
  year: string;
  make: string;
  model: string;
  mileage: string;
  price: string;
  bodyStyle: string;
  cleanTitle: boolean;
  condition: string;
  fuelType: string;
  transmission: string;
  exteriorColor: string;
  interiorColor: string;
  description: string;
  location: string;
  images: UiPostImage[];
  listingIndex: number;
};

export type MarketplacePostingListing =
  | MarketplaceItemListing
  | MarketplaceVehicleListing;

export type StartMarketplaceItemPostingRequest = {
  type: "START_MARKETPLACE_POSTING";
  startedAt: number;
  listings: MarketplacePostingListing[];
  shareToSuggestedGroups: boolean;
  minimumDelaySeconds: number;
  maximumDelaySeconds: number;
  rewriteDescriptions: boolean;
  geminiApiKey: string;
  customPrompt: string;
};

export type StopMarketplacePostingRequest = {
  type: "STOP_MARKETPLACE_POSTING";
};

export type PauseMarketplacePostingRequest = {
  type: "PAUSE_MARKETPLACE_POSTING";
};

export type ResumeMarketplacePostingRequest = {
  type: "RESUME_MARKETPLACE_POSTING";
};

export type GetPostingQueueStatusRequest = {
  type: "GET_POSTING_QUEUE_STATUS";
};

export type GeminiErrorPrompt = {
  type: "GEMINI_ERROR_PROMPT";
  id: string;
  queue: "groups" | "marketplace";
  error: string;
};

export type PostingQueueStatusResponse = {
  geminiPrompts?: GeminiErrorPrompt[];
  groups?: UiPostingStatusMessage;
  marketplace?: MarketplaceItemPostingStatusMessage;
};

export type DeleteOldMarketplaceListingsRequest = {
  type: "DELETE_OLD_MARKETPLACE_LISTINGS";
  daysOld: number;
};

export type MarketplaceSellingRequestCapturedMessage = {
  type: "MARKETPLACE_SELLING_REQUEST_CAPTURED";
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  };
};

export type MarketplaceCleanupFinishedMessage = {
  type: "MARKETPLACE_CLEANUP_FINISHED";
  runId: string;
  ok: boolean;
  deletedCount?: number;
  error?: string;
};

export type MarketplaceCleanupStatusMessage = {
  type: "MARKETPLACE_CLEANUP_STATUS";
  status:
    | "preparing"
    | "scanning"
    | "warning"
    | "deleting"
    | "deleted"
    | "failed"
    | "done";
  message: string;
  processed: number;
  total: number;
  deletedCount: number;
  failedCount: number;
  listingId?: string;
  listingTitle?: string;
  error?: string;
};

export type MarketplaceItemPostingStatusMessage = {
  type: "MARKETPLACE_ITEM_POSTING_STATUS";
  status:
    | "preparing"
    | "posting"
    | "waiting"
    | "paused"
    | "posted"
    | "failed"
    | "stopped"
    | "done";
  message: string;
  current: number;
  total: number;
  listingId?: string;
  listingTitle?: string;
  successCount: number;
  failedCount: number;
  waitSeconds?: number;
  timing?: PostingTiming;
  error?: string;
};

export type CreateMarketplaceItemListingRequest = {
  type: "CREATE_MARKETPLACE_ITEM_LISTING";
  listing: MarketplaceItemListing;
  shareToSuggestedGroups: boolean;
};

export type CreateMarketplaceVehicleListingRequest = {
  type: "CREATE_MARKETPLACE_VEHICLE_LISTING";
  listing: MarketplaceVehicleListing;
  shareToSuggestedGroups: boolean;
};

export type MarketplaceItemPostingResponse = {
  ok: boolean;
  error?: string;
};

export type CreatePostRequest = {
  type: "CREATE_POST";
  body: string;
  images: UiPostImage[];
};

export type CreatePostResponse = {
  ok: boolean;
  composerFound: boolean;
  composerClicked: boolean;
  spanCount: number;
  error?: string;
};

export type StatusBannerTone = "info" | "success" | "warning" | "error";

export type StatusBannerMessage = {
  type: "STATUS_BANNER";
  message: string;
  tone?: StatusBannerTone;
  detail?: string;
};

export type ClearStatusBannerMessage = {
  type: "CLEAR_STATUS_BANNER";
};

export type ExtensionRequest =
  | { type: "RESOLVE_GEMINI_ERROR"; id: string; action: "continue" | "stop" }
  | LoadGroupsRequest
  | StartUiPostingRequest
  | StartMarketplaceItemPostingRequest
  | DeleteOldMarketplaceListingsRequest
  | MarketplaceSellingRequestCapturedMessage
  | MarketplaceCleanupFinishedMessage
  | StopMarketplacePostingRequest
  | PauseMarketplacePostingRequest
  | ResumeMarketplacePostingRequest
  | StopUiPostingRequest
  | PauseUiPostingRequest
  | ResumeUiPostingRequest
  | GetPostingQueueStatusRequest;
