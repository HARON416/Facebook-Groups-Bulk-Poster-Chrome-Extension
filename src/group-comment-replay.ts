export const COMMENT_MUTATION_FRIENDLY_NAME = "useCometUFICreateCommentMutation";

export type CommentRequestTemplate = {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  formData: Record<string, string>;
};
export type CommentCapture = {
  template?: CommentRequestTemplate;
  responseText?: string;
  status?: number;
  error?: string;
};
export type CommentBrowserSession = { actorId: string; fingerprint: string; storeId: string; tabId: number };
export type CommentReplaySession = { template: CommentRequestTemplate; sourcePostId: string; sequence: number; browserSession: CommentBrowserSession };

// Serialized into Facebook's MAIN world: all dependencies must be local.
export function installCommentRequestCaptureInPage(groupId: string, comment: string, sourcePostId: string, expectedFeedbackId?: string): void {
  const scope = globalThis as typeof globalThis & Record<string, any>;
  const key = "__postikaCommentRequestCapture";
  scope[key]?.restore?.();
  const state: CommentCapture & { restore?: () => void } = {};
  scope[key] = state;
  const capture = (url: string, body: string, headers: Record<string, string>) => {
    if (state.template) return false;
    const target = new URL(url, location.href);
    if (target.origin !== location.origin || target.pathname !== "/api/graphql/") return false;
    const formData = Object.fromEntries(new URLSearchParams(body));
    if (formData.fb_api_req_friendly_name !== "useCometUFICreateCommentMutation" &&
        headers["x-fb-friendly-name"] !== "useCometUFICreateCommentMutation") return false;
    try {
      const variables = JSON.parse(formData.variables);
      if (variables.groupID !== groupId || variables.input?.message?.text !== comment) return false;
      const feedbackId = variables.input?.feedback_id;
      let matchesPost = expectedFeedbackId ? feedbackId === expectedFeedbackId : false;
      if (!expectedFeedbackId && typeof feedbackId === "string") {
        try { matchesPost = atob(feedbackId) === `feedback:${sourcePostId}`; } catch { matchesPost = false; }
      }
      if (!matchesPost) {
        state.error = "The captured comment targets a different or unverifiable post. Comment replay stopped.";
        return false;
      }
    } catch { return false; }
    state.template = { url: target.href, method: "POST", body, headers, formData };
    return true;
  };
  const originalFetch = scope.fetch as typeof fetch;
  const wrappedFetch: typeof fetch = async (resource, init) => {
    let matched = false;
    try {
      const request = new Request(resource, init);
      if (request.method === "POST" && request.url.includes("/api/graphql/")) {
        matched = capture(request.url, await request.clone().text(), Object.fromEntries(request.headers.entries()));
      }
    } catch { /* Forward requests even if they cannot be inspected. */ }
    try {
      const response = await originalFetch.call(scope, resource, init);
      if (matched) {
        state.status = response.status;
        void response.clone().text().then((text) => { state.responseText = text; })
          .catch(() => { state.error = "The UI comment response could not be read."; });
      }
      return response;
    } catch (error) {
      if (matched) state.error = "The UI comment request failed. Its outcome is unknown; it will not be retried.";
      throw error;
    }
  };
  scope.fetch = wrappedFetch;
  const prototype = XMLHttpRequest.prototype;
  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  const originalSetHeader = prototype.setRequestHeader;
  const requests = new WeakMap<XMLHttpRequest, { url: string; method: string; headers: Record<string, string> }>();
  const wrappedOpen = function (this: XMLHttpRequest, ...args: any[]) {
    requests.set(this, { url: String(args[1]), method: String(args[0]), headers: {} });
    return (originalOpen as any).apply(this, args);
  };
  const wrappedSetHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const request = requests.get(this);
    if (request) request.headers[name.toLowerCase()] = value;
    return originalSetHeader.call(this, name, value);
  };
  const wrappedSend = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const request = requests.get(this);
    const matched = request?.method.toUpperCase() === "POST" &&
      (typeof body === "string" || body instanceof URLSearchParams) &&
      capture(request.url, String(body), { ...request.headers });
    if (matched) this.addEventListener("loadend", () => {
      state.status = this.status;
      try {
        state.responseText = this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
        if (!this.status) state.error = "The UI comment request failed. Its outcome is unknown; it will not be retried.";
      } catch { state.error = "The UI comment response could not be read."; }
    }, { once: true });
    return originalSend.call(this, body);
  };
  prototype.open = wrappedOpen as typeof originalOpen;
  prototype.setRequestHeader = wrappedSetHeader;
  prototype.send = wrappedSend;
  state.restore = () => {
    if (scope.fetch === wrappedFetch) scope.fetch = originalFetch;
    if (prototype.open === wrappedOpen) prototype.open = originalOpen;
    if (prototype.send === wrappedSend) prototype.send = originalSend;
    if (prototype.setRequestHeader === wrappedSetHeader) prototype.setRequestHeader = originalSetHeader;
  };
}

export function readCommentRequestCaptureInPage(cleanup: boolean): CommentCapture {
  const scope = globalThis as typeof globalThis & Record<string, any>;
  const key = "__postikaCommentRequestCapture";
  const state = scope[key];
  const result = state ? { template: state.template, responseText: state.responseText, status: state.status, error: state.error } : {};
  if (cleanup) { state?.restore?.(); delete scope[key]; }
  return result;
}

export function validateCommentTemplate(template: CommentRequestTemplate): void {
  const url = new URL(template.url);
  if (url.protocol !== "https:" || !["www.facebook.com", "web.facebook.com"].includes(url.hostname) ||
      url.pathname !== "/api/graphql/" || url.username || url.password || url.port || template.method !== "POST" || !/^\d+$/.test(template.formData.doc_id ?? "")) {
    throw new Error("The captured comment request is not a valid Facebook comment mutation.");
  }
  const variables = JSON.parse(template.formData.variables);
  if ((template.formData.fb_api_req_friendly_name ?? template.headers["x-fb-friendly-name"]) !== COMMENT_MUTATION_FRIENDLY_NAME ||
      !variables.input?.feedback_id || typeof variables.input?.message?.text !== "string" || !variables.groupID ||
      !template.formData.fb_dtsg || !template.formData.lsd || !/^\d+$/.test(template.formData.__user ?? "")) {
    throw new Error("The UI comment request is missing required session or comment values.");
  }
  if (template.headers["x-fb-lsd"] && template.headers["x-fb-lsd"] !== template.formData.lsd) {
    throw new Error("The captured comment has conflicting LSD session tokens. Restart the queue to capture fresh values.");
  }
  if (template.headers["x-fb-friendly-name"] && template.headers["x-fb-friendly-name"] !== COMMENT_MUTATION_FRIENDLY_NAME) {
    throw new Error("The captured comment has a conflicting mutation header.");
  }
}

export function validateCommentSessionBinding(template: CommentRequestTemplate, expectedActorId: string): void {
  validateCommentTemplate(template);
  const variables = JSON.parse(template.formData.variables);
  const actorIds = [template.formData.__user, template.formData.av, variables.input.actor_id].filter((value) => value !== undefined);
  if (!actorIds.every((value) => String(value) === expectedActorId)) {
    throw new Error("The comment request belongs to a different Facebook account or actor. Restart posting with the intended account.");
  }
}

export function commentFeedbackId(session: CommentReplaySession, post: { feedbackId?: string; postId?: string; postUrl?: string }, groupId: string): string | undefined {
  let postId = /^\d+$/.test(post.postId ?? "") ? post.postId : undefined;
  if (post.postUrl) {
    try {
      const url = new URL(post.postUrl);
      const match = url.pathname.match(/^\/groups\/([^/]+)\/(?:permalink|posts)\/(\d+)\/?$/);
      if (url.protocol !== "https:" || !["www.facebook.com", "web.facebook.com"].includes(url.hostname) || match?.[1] !== groupId) return undefined;
      if (postId && postId !== match[2]) return undefined;
      postId = match[2];
    } catch { return undefined; }
  }
  if (post.feedbackId) {
    try {
      const decoded = atob(post.feedbackId);
      if (postId && /^feedback:\d+$/.test(decoded) && decoded !== `feedback:${postId}`) return undefined;
    } catch { /* An opaque feedback ID can still be provided by this post's response. */ }
    return post.feedbackId;
  }
  if (!postId) return undefined;
  // Only derive this format after validating it against the first real UI comment.
  const original = JSON.parse(session.template.formData.variables).input.feedback_id;
  try {
    if (atob(original) === `feedback:${session.sourcePostId}`) return btoa(`feedback:${postId}`);
  } catch { /* Opaque feedback IDs must come from the new post response. */ }
  return undefined;
}

export function buildCommentVariables(session: CommentReplaySession, groupId: string, feedbackId: string, text: string): string {
  validateCommentSessionBinding(session.template, session.browserSession.actorId);
  if (!text.trim() || !/^\d+$/.test(groupId) || !feedbackId) throw new Error("The new comment target or text is missing.");
  const variables = JSON.parse(session.template.formData.variables);
  variables.groupID = groupId;
  variables.input.feedback_id = feedbackId;
  variables.input.message = { text, ranges: [] };
  variables.input.attachments = null;
  variables.input.client_mutation_id = String(++session.sequence);
  const tokenPrefix = typeof variables.input.idempotence_token === "string" &&
    variables.input.idempotence_token.startsWith("client:") ? "client:" : "";
  variables.input.idempotence_token = tokenPrefix + crypto.randomUUID();
  // These belong to the source story, rather than the authenticated session.
  variables.input.tracking = [];
  variables.input.is_tracking_encrypted = false;
  variables.focusCommentID = null;
  return JSON.stringify(variables);
}

export function parseCommentResponse(text: string): { success: boolean; commentId?: string; error?: string } {
  try {
    const normalized = text.trim().replace(/^for\s*\(;;\);\s*/, "");
    // GraphQL can deliver newline-delimited incremental responses.
    const objects: any[] = [];
    let start = 0, depth = 0, quoted = false, escaped = false;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized[i];
      if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === "{") { if (!depth) start = i; depth++; }
      else if (char === "}") { depth--; if (!depth) objects.push(JSON.parse(normalized.slice(start, i + 1))); }
    }
    let commentId: string | undefined;
    const visit = (value: any): void => {
      if (!value || typeof value !== "object") return;
      if (value.errors?.length || value.error || value.errorSummary) throw new Error(value.errors?.[0]?.message ?? value.errorSummary ?? "Facebook rejected the comment.");
      if (value.comment_create) {
        const created = value.comment_create;
        const id = created.feedback_comment_edge?.node?.id ?? created.comment?.id;
        if (typeof id === "string" && id) commentId = id;
      }
      for (const entry of Object.values(value)) visit(entry);
    };
    objects.forEach(visit);
    if (!commentId) return { success: false, error: "Facebook did not confirm a created comment. Its outcome is unknown; it will not be retried." };
    return { success: true, commentId };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : "The comment response could not be parsed." }; }
}
