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

export type UiPostingPost = {
  id: string;
  body: string;
  html: string;
  images: UiPostImage[];
};

export type StartUiPostingRequest = {
  type: "START_UI_POSTING";
  startedAt: number;
  scheduledAt?: string;
  groups: SimpleGroup[];
  posts: UiPostingPost[];
  minimumDelaySeconds: number;
  maximumDelaySeconds: number;
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
    | "scheduled"
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
  scheduledAt?: string;
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

export type GetPostingQueueStatusRequest = {
  type: "GET_POSTING_QUEUE_STATUS";
};

export type PostingQueueStatusResponse = {
  groups?: UiPostingStatusMessage;
};

export type CreatePostRequest = {
  type: "CREATE_POST";
  body: string;
  html: string;
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
  | LoadGroupsRequest
  | StartUiPostingRequest
  | StopUiPostingRequest
  | PauseUiPostingRequest
  | ResumeUiPostingRequest
  | GetPostingQueueStatusRequest;
