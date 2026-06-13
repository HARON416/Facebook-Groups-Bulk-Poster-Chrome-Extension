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

export type ExtensionRequest = LoadGroupsRequest;
