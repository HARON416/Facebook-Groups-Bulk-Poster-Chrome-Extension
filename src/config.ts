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

export type StartUiPostingRequest = {
  type: "START_UI_POSTING";
  body: string;
  groups: SimpleGroup[];
  images: UiPostImage[];
  delaySeconds: number;
};

export type UiPostingStatusMessage = {
  type: "UI_POSTING_STATUS";
  status:
    | "idle"
    | "posting"
    | "waiting"
    | "posted"
    | "failed"
    | "rate_limited"
    | "done";
  message: string;
  current: number;
  total: number;
  groupId?: string;
  groupName?: string;
  successCount?: number;
  error?: string;
};

export type UiPostingResponse = {
  ok: boolean;
  error?: string;
};

export interface FindWriteSomethingRequest {
  type: "FIND_WRITE_SOMETHING";
  body?: string;
  images?: UiPostImage[];
}

export type FindWriteSomethingResponse = {
  ok: boolean;
  found: boolean;
  clicked: boolean;
  spanCount: number;
  error?: string;
};

export type ExtensionRequest = LoadGroupsRequest | StartUiPostingRequest;
