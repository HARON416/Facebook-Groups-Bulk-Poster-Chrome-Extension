import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { transform } from "esbuild";

const background = await readFile(new URL("../src/background.ts", import.meta.url), "utf8");
const helperSource = await readFile(new URL("../src/group-comment-setup.ts", import.meta.url), "utf8");
const helperCode = (await transform(helperSource, { loader: "ts", format: "esm" })).code;
const { groupPostPermalink, inspectPostPermalinkLoadInPage } = await import(`data:text/javascript;base64,${Buffer.from(helperCode).toString("base64")}`);
const orderSource = await readFile(new URL("../src/group-posting-order.ts", import.meta.url), "utf8");
const orderCode = (await transform(orderSource, { loader: "ts", format: "esm" })).code;
const { shuffleGroups } = await import(`data:text/javascript;base64,${Buffer.from(orderCode).toString("base64")}`);
const replaySource = await readFile(new URL("../src/group-comment-replay.ts", import.meta.url), "utf8");
const replayCode = (await transform(replaySource, { loader: "ts", format: "esm" })).code;
const { validateCommentTemplate, validateCommentSessionBinding, parseCommentResponse, commentFeedbackId } = await import(`data:text/javascript;base64,${Buffer.from(replayCode).toString("base64")}`);
const queueSource = background.slice(background.indexOf("async function runGraphqlPostingQueue("), background.indexOf("async function ensurePostingTemplates("));
const parserSource = background.slice(background.indexOf("function parsePostResponse("), background.indexOf("function isRateLimitBody(")) +
  background.slice(background.indexOf("function isRecord("), background.indexOf("function cloneJsonRecord(")) +
  background.slice(background.indexOf("class JsonObjectDecoder"));
const queueCode = (await transform(queueSource, { loader: "ts" })).code;
const parserCode = (await transform(parserSource, { loader: "ts" })).code;
const permalink = (groupId) => `https://web.facebook.com/groups/${groupId}/permalink/12345/`;
const published = (groupId) => ({ success: true, postUrl: permalink(groupId) });
const pending = { success: true, pendingApproval: true };

function assertSerializable(value) {
  assert.ok(!["undefined", "function", "symbol", "bigint"].includes(typeof value), "executeScript arguments must be JSON serializable");
  if (typeof value === "number") assert.ok(Number.isFinite(value));
  if (value && typeof value === "object") Object.values(value).forEach(assertSerializable);
}

function queueHarness(results, enabled = true, maxPosts = 3, inspection = {
  loaded: true, stable: true, dialogFound: true, commentFormFound: true, commentEditorFound: true, submitButtonFound: true,
}, commentAction) {
  const events = [];
  const statuses = [];
  const warnings = [];
  let uiIndex = 0;
  let now = 0;
  const groups = ["100", "200", "300"].map((id) => ({ id, name: `Group ${id}`, url: `https://web.facebook.com/groups/${id}/` }));
  const context = vm.createContext({
    URL, Error, TextEncoder, Uint8Array, crypto: webcrypto, groupPostPermalink, inspectPostPermalinkLoadInPage, validateCommentTemplate, validateCommentSessionBinding, parseCommentResponse, commentFeedbackId, installCommentRequestCaptureInPage() {}, readCommentRequestCaptureInPage() {}, inspectPublishedPostPageInPage() {}, interactWithPostCommentFormInPage() {}, Date: { now: () => now },
    MIN_POSTING_DELAY_SECONDS: 60, LAST_GROUP_POSTING_STATUS_STORAGE_KEY: "status",
    activePosting: false, geminiBypassed: {}, activePostingPendingCount: 0,
    MANUAL_STOP_MESSAGE: "stopped", FACEBOOK_PENDING_CONTENT_LIMIT_MESSAGE: "pending limit",
    FacebookPostResponseError: class extends Error {},
    debugLog() {}, debugWarn: (message) => warnings.push(message), latestUiPostingStatus: undefined,
    createQueueTimer: () => ({}),
    shuffleGroups: (groups) => { events.push("shuffle-groups"); return shuffleGroups(groups, () => 0.999999); },
    notifyUiPostingStatus: (status) => { statuses.push(status); context.latestUiPostingStatus = status; },
    throwIfPostingStopped() {},
    waitWhilePostingPaused: async () => events.push("pause-check"),
    getActiveTabForPosting: async () => ({ id: 7 }),
    getFacebookActorId: async () => "1234567890",
    cookieAccount: "1234567890", cookieLogin: "current-session", cookieStore: "0", documentId: 1, tabUrl: "https://web.facebook.com/groups/100/permalink/12345/",
    maybeRewriteDescription: async (text) => text,
    claimPostingUsage: async () => `operation-${uiIndex}`,
    finalizePostingUsage: async (action) => events.push(action),
    isMissingFirstGroupComposerError: () => false,
    isRateLimitError: () => false,
    ensurePostingTemplates: async (tabId, items, original, body, images, total, progress) => {
      events.push(`ui:${items[0].id}`);
      if (uiIndex > 0) assert.equal(progress.successCount, uiIndex);
      const firstPostResult = results[uiIndex++];
      assert.ok(firstPostResult, "unexpected extra UI submission");
      events.push(`capture:${items[0].id}`);
      return { firstGroupPosted: true, firstPostResult, postTemplate: {}, uploadTemplate: {} };
    },
    uploadImagesForGroup: async () => { events.push("graphql-upload"); return ["photo"]; },
    createGraphqlPost: async () => { events.push("graphql-post"); return { success: true, feedbackId: "new-feedback" }; },
    createGraphqlComment: async (tab, session, group, feedback, text) => { events.push(`graphql-comment:${text}`); return { success: true, commentId: "new-comment" }; },
    randomIntegerBetween: () => 60,
    sleepWithPostingCountdown: async () => events.push("delay"),
    sleepWithStopChecks: async (duration) => { now += duration; },
    stopPostingTemplateCapture: () => events.push("cleanup"),
    readFirstPostResponseCapture: async () => undefined,
    waitForPageDomReady: async () => events.push("page-ready"),
    chrome: {
      cookies: {
        getAllCookieStores: async () => [{ id: context.cookieStore, tabIds: [7] }],
        get: async ({ name }) => ({ value: name === "c_user" ? context.cookieAccount : context.cookieLogin }),
      },
      storage: { session: { remove: async () => {} } },
      tabs: {
        update: async (tabId, options) => { context.tabUrl = options.url; events.push(`navigate:${options.url}`); },
        get: async () => ({ status: "complete", url: context.tabUrl }),
        reload: async () => { context.documentId++; events.push("reload-permalink"); },
      },
      scripting: { executeScript: async ({ args, func }) => {
        assertSerializable(args);
        if (func.name === "inspectPostPermalinkLoadInPage") { events.push(`inspect-load:${context.documentId}`); return [{ result: { loaded: true, documentId: context.documentId } }]; }
        if (func.name === "installCommentRequestCaptureInPage") { events.push("arm-comment-capture"); return [{}]; }
        if (func.name === "readCommentRequestCaptureInPage") {
          events.push(args[0] ? "comment-capture-cleanup" : "read-comment-capture");
          return [{ result: { template: {
            url: new URL("/api/graphql/", context.tabUrl).href, method: "POST", body: "", headers: {},
            formData: { __user: "1234567890", doc_id: "123", fb_dtsg: "fresh-token", lsd: "fresh-lsd", fb_api_req_friendly_name: "useCometUFICreateCommentMutation",
              variables: JSON.stringify({ groupID: groups[uiIndex - 1].id, input: { feedback_id: btoa("feedback:12345"), message: { text: "First saved comment" } } }) },
          }, status: 200, responseText: JSON.stringify({ data: { comment_create: { comment: { id: "first-comment" } } } }) } }];
        }
        if (args[2]) {
          events.push(`comment:${args[2]}`);
          if (args[2] === "submit") assert.equal(args[1], "First saved comment");
          return [{ result: commentAction ? commentAction(args[2], now) : { state: args[2] === "check" ? "ready" : args[2] === "submit" ? "submitted" : "preparing" } }];
        }
        events.push(args[1] ? "observer-cleanup" : "inspect-dialog");
        return [{ result: typeof inspection === "function" ? inspection(now) : Array.isArray(inspection) ? inspection[uiIndex - 1] : inspection }];
      } },
    },
  });
  vm.runInContext(queueCode, context);
  const request = {
    startedAt: Date.now(), groups,
    posts: [{ id: "post", body: "description", images: [{ name: "car.jpg" }] }],
    minimumDelaySeconds: 60, maximumDelaySeconds: 60, maxPosts,
    groupCommentEnabled: enabled,
    groupCommentOptions: ["", "First saved comment", "Second saved comment"],
  };
  return { events, statuses, warnings, context, request, run: () => context.runGraphqlPostingQueue(request) };
}

test("posting repeats the shuffled groups and rotates posts without a planner", async () => {
  const h = queueHarness([published("300")], false, 5);
  h.request.groups = [h.request.groups[2], h.request.groups[0], h.request.groups[1]];
  h.request.posts.push({ ...h.request.posts[0], id: "second", body: "second description" });
  const submissions = [];
  const capture = h.context.ensurePostingTemplates;
  h.context.ensurePostingTemplates = async (...args) => {
    submissions.push({ group: args[1][0].id, body: args[3] });
    return capture(...args);
  };
  h.context.createGraphqlPost = async (tab, template, body, photos, group) => {
    submissions.push({ group, body });
    return { success: true };
  };
  h.context.fetch = () => { throw new Error("No group history API calls are needed"); };
  await h.run();
  assert.deepEqual(submissions.map(({ group }) => group), ["300", "100", "200", "300", "100"]);
  assert.deepEqual(submissions.map(({ body }) => body), ["description", "second description", "description", "second description", "description"]);
  assert.equal(h.statuses.at(-1).successCount, 5);
  assert.equal(h.statuses.at(-1).status, "done");
});

test("every posting run shuffles once before UI capture and keeps that order across cycles", async () => {
  const h = queueHarness([published("200")], false, 5);
  const submissions = [];
  h.context.shuffleGroups = (groups) => {
    h.events.push("shuffle-groups");
    return shuffleGroups(groups, () => 0);
  };
  const capture = h.context.ensurePostingTemplates;
  h.context.ensurePostingTemplates = async (...args) => {
    submissions.push(args[1][0].id);
    return capture(...args);
  };
  h.context.createGraphqlPost = async (tab, template, body, photos, group) => {
    submissions.push(group);
    return { success: true };
  };
  await h.run();
  assert.deepEqual(submissions, ["200", "300", "100", "200", "300"]);
  assert.equal(h.events.filter((event) => event === "shuffle-groups").length, 1);
  assert.deepEqual(h.request.groups.map(({ id }) => id), ["100", "200", "300"]);
});

test("failed groups are skipped on later cycles even when comments are disabled", async () => {
  const h = queueHarness([published("100")], false, 4);
  const submissions = [];
  h.context.createGraphqlPost = async (tab, template, body, photos, group) => {
    submissions.push(group);
    return { success: group !== "200", error: group === "200" ? "Group rejected the post" : undefined };
  };
  await h.run();
  assert.deepEqual(submissions, ["200", "300", "100", "300"]);
  assert.equal(h.statuses.at(-1).successCount, 4);
  assert.equal(h.statuses.at(-1).failedCount, 1);
});

test("a queue stops when every group fails instead of retrying forever", async () => {
  const h = queueHarness([], false, 5);
  h.context.ensurePostingTemplates = async () => ({ firstGroupPosted: false, postTemplate: {}, uploadTemplate: {} });
  const submissions = [];
  h.context.createGraphqlPost = async (tab, template, body, photos, group) => {
    submissions.push(group);
    assert.ok(submissions.length <= 3, "a failed group must not be retried");
    return { success: false, error: "Group rejected the post" };
  };
  await h.run();
  assert.deepEqual(submissions, ["100", "200", "300"]);
  assert.equal(h.statuses.at(-1).failedCount, 3);
  assert.equal(h.statuses.at(-1).successCount, 0);
  assert.equal(h.statuses.at(-1).status, "done");
});

test("an unavailable first composer is skipped without reordering the remaining groups", async () => {
  const h = queueHarness([published("200")], false, 4);
  const submissions = [];
  const capture = h.context.ensurePostingTemplates;
  h.context.isMissingFirstGroupComposerError = (error) => error.message === "missing composer";
  h.context.ensurePostingTemplates = async (...args) => {
    submissions.push(args[1][0].id);
    if (args[1][0].id === "100") throw new Error("missing composer");
    return capture(...args);
  };
  h.context.createGraphqlPost = async (tab, template, body, photos, group) => {
    submissions.push(group);
    return { success: true };
  };
  await h.run();
  assert.deepEqual(submissions, ["100", "200", "300", "200", "300"]);
  assert.equal(h.statuses.at(-1).successCount, 4);
  assert.equal(h.statuses.at(-1).failedCount, 1);
  assert.ok(h.events.includes("release"));
});

test("the comment button can take longer than 15 seconds to appear after text entry", async () => {
  const h = queueHarness([published("100")], true, 3, undefined, (action, now) => ({
    state: action === "submit" ? "submitted" : action === "check" && now >= 30000 ? "ready" : "preparing",
    textEntered: true, editorEmpty: false,
  }));
  await h.run();
  assert.ok(h.events.filter((event) => event === "comment:check").length > 60);
  assert.equal(h.events.filter((event) => event === "comment:prepare").length, 1);
  assert.equal(h.events.filter((event) => event === "comment:submit").length, 1);
});

test("empty comment input is retried before waiting for its submit button", async () => {
  let attempts = 0;
  const h = queueHarness([published("100")], true, 3, undefined, (action) => {
    if (action === "prepare") attempts++;
    return {
      state: action === "submit" ? "submitted" : action === "check" && attempts >= 3 ? "ready" : "preparing",
      textEntered: attempts >= 3, editorEmpty: attempts < 3,
    };
  });
  await h.run();
  assert.equal(attempts, 3);
  assert.equal(h.events.filter((event) => event === "comment:submit").length, 1);
});

test("only a valid permalink for the current Facebook group can be inspected", () => {
  assert.equal(groupPostPermalink(published("100"), "100"), permalink("100"));
  assert.equal(groupPostPermalink({ ...published("100"), pendingApproval: true }, "100"), permalink("100"));
  for (const result of [pending,
    published("200"), { success: true, postUrl: "https://evil.test/groups/100/permalink/12345/" },
    { success: true, postUrl: "https://web.facebook.com/groups/100/pending_posts/12345/" },
    { success: false, postUrl: permalink("100") }]) {
    assert.equal(groupPostPermalink(result, "100"), undefined);
  }
});

test("pending responses without a permalink count as accepted submissions", () => {
  const context = vm.createContext({});
  vm.runInContext(parserCode, context);
  const response = JSON.stringify({ data: { story_create: { story: { id: "story", url: null, if_viewer_can_learn_more_about_pending_post: {} } } } });
  const result = context.parsePostResponse(response);
  assert.equal(result.success, true);
  assert.equal(result.pendingApproval, true);
  assert.equal(result.postUrl, undefined);
});

test("UI permalinks open immediately and reload once after loading, before any form inspection", async () => {
  const h = queueHarness([published("100")], true, 1);
  h.context.randomIntegerBetween = () => { throw new Error("No random permalink delay should be requested"); };
  await h.run();
  const navigate = h.events.indexOf(`navigate:${permalink("100")}`);
  const firstLoad = h.events.indexOf("inspect-load:1");
  const reload = h.events.indexOf("reload-permalink");
  const reloaded = h.events.indexOf("inspect-load:2");
  const form = h.events.indexOf("inspect-dialog");
  assert.ok(navigate < firstLoad && firstLoad < reload && reload < reloaded && reloaded < form);
  assert.equal(h.events.filter((event) => event === "reload-permalink").length, 1);
  assert.ok(h.events.includes("comment:submit"));
});

test("reload waits for a new fully loaded document even if the old document still reports complete", async () => {
  const h = queueHarness([published("100")], true, 1);
  let polls = 0;
  h.context.chrome.tabs.reload = async () => { h.events.push("reload-permalink"); };
  const execute = h.context.chrome.scripting.executeScript;
  h.context.chrome.scripting.executeScript = async (injection) => {
    if (injection.func.name === "inspectPostPermalinkLoadInPage" && h.events.includes("reload-permalink")) {
      if (++polls >= 5) h.context.documentId = 2;
    }
    return execute(injection);
  };
  await h.run();
  assert.equal(polls, 5);
  assert.ok(h.events.indexOf("inspect-load:2") < h.events.indexOf("inspect-dialog"));
});

test("waiting for the initial permalink load remains stoppable without reloading or inspecting forms", async () => {
  const h = queueHarness([published("100")], true, 1);
  const execute = h.context.chrome.scripting.executeScript;
  let polls = 0;
  h.context.chrome.scripting.executeScript = async (injection) => {
    if (injection.func.name === "inspectPostPermalinkLoadInPage") { polls++; return [{ result: { loaded: false, documentId: 1 } }]; }
    return execute(injection);
  };
  h.context.throwIfPostingStopped = () => { if (polls >= 5) throw new Error("stopped"); };
  await h.run();
  assert.equal(h.statuses.at(-1).status, "stopped");
  assert.ok(!h.events.includes("reload-permalink"));
  assert.ok(!h.events.includes("inspect-dialog"));
  assert.ok(!h.events.includes("comment:prepare"));
});

test("the first published UI post opens only after fresh templates are captured", async () => {
  const h = queueHarness([published("100")]);
  await h.run();
  assert.ok(h.events.indexOf("capture:100") < h.events.indexOf(`navigate:${permalink("100")}`));
  assert.equal(h.events.filter((event) => event.startsWith("ui:")).length, 1);
  assert.equal(h.events.filter((event) => event === "graphql-post").length, 2);
  assert.ok(h.statuses.some((status) => /First comment posted successfully/.test(status.message)));
  assert.equal(h.events.filter((event) => event === "comment:submit").length, 1);
  assert.ok(h.events.indexOf(`navigate:${permalink("100")}`) < h.events.indexOf("inspect-dialog"));
  assert.ok(h.events.includes("observer-cleanup"));
});

test("pending posts continue through the UI with delays until a permalink is returned", async () => {
  const h = queueHarness([pending, pending, published("300")]);
  await h.run();
  assert.deepEqual(h.events.filter((event) => event.startsWith("ui:")), ["ui:100", "ui:200", "ui:300"]);
  assert.equal(h.events.filter((event) => event === "delay").length, 2);
  assert.ok(h.events.includes(`navigate:${permalink("300")}`));
  assert.ok(!h.events.includes("graphql-post") && !h.events.includes("graphql-upload"));
  assert.equal(h.statuses.at(-1).successCount, 3);
});

test("all-pending submissions stop at the requested limit without navigating", async () => {
  const h = queueHarness([pending, pending], true, 2);
  await h.run();
  assert.ok(!h.events.some((event) => event.startsWith("navigate:")));
  assert.match(h.statuses.at(-1).message, /None allowed comment setup/);
  assert.equal(h.statuses.at(-1).successCount, 2);
});

test("an accepted UI response without any URL continues until a permalink exists", async () => {
  const h = queueHarness([{ success: true }, published("200")], true, 2);
  await h.run();
  assert.deepEqual(h.events.filter((event) => event.startsWith("ui:")), ["ui:100", "ui:200"]);
  assert.ok(h.events.includes(`navigate:${permalink("200")}`));
  assert.ok(!h.events.includes("graphql-post"));
  assert.ok(h.statuses.some((status) => /First comment posted successfully/.test(status.message)));
});

test("comments disabled preserves the existing UI-then-GraphQL queue", async () => {
  const h = queueHarness([published("100")], false, 2);
  await h.run();
  assert.ok(h.events.includes("graphql-post") && h.events.includes("graphql-upload"));
  assert.ok(!h.events.some((event) => event.startsWith("navigate:")));
  assert.equal(h.events.filter((event) => event.startsWith("ui:")).length, 1);
});

test("a missing post dialog continues UI posting within the submission limit", async () => {
  const h = queueHarness([published("100"), pending], true, 2, {
    loaded: true, stable: true, dialogFound: false, commentFormFound: false, commentEditorFound: false, submitButtonFound: false,
  });
  await h.run();
  assert.match(h.statuses.at(-1).message, /None allowed comment setup/);
  assert.equal(h.events.filter((event) => event.startsWith("ui:")).length, 2);
  assert.ok(!h.events.includes("comment:submit"));
  assert.ok(h.events.includes("observer-cleanup"));
});

test("an indefinite page wait remains stoppable and cleans up its observer", async () => {
  const h = queueHarness([published("100")], true, 3, {
    loaded: true, stable: false, dialogFound: true, commentEditorFound: true, submitButtonFound: true,
  });
  h.context.stopRequested = () => h.events.filter((event) => event === "inspect-dialog").length >= 240;
  vm.runInContext('throwIfPostingStopped = () => { if (stopRequested()) throw new Error("stopped"); };', h.context);
  await h.run();
  assert.equal(h.statuses.at(-1).status, "stopped");
  assert.ok(h.events.includes("observer-cleanup"));
  assert.equal(h.events.filter((event) => event.startsWith("ui:")).length, 1);
});

test("page load and DOM settling can take longer than 45 seconds", async () => {
  const h = queueHarness([published("100")], true, 3, (now) => ({
    loaded: now >= 60_000, stable: now >= 75_000,
    dialogFound: true, commentFormFound: true, commentEditorFound: true, submitButtonFound: true,
  }));
  await h.run();
  assert.ok(h.statuses.some((status) => /First comment posted successfully/.test(status.message)));
  assert.equal(h.events.filter((event) => event === "comment:submit").length, 1);
  assert.ok(h.events.includes("observer-cleanup"));
});

test("dialog inspection waits for hydration and a quiet DOM without English labels", async () => {
  const inspectionCode = (await transform(helperSource.replace(/^export /gm, ""), { loader: "ts" })).code;
  let now = 0;
  let mutation;
  let disconnected = 0;
  let busy = false;
  let hidden = false;
  let submitVisible = true;
  const editor = {
    getAttribute: (name) => name === "aria-label" ? "اكتب تعليقًا عامًا…" : null,
    closest: (selector) => selector === "form" ? form : null, getClientRects: () => [{}],
  };
  const submit = { closest: () => null, getClientRects: () => submitVisible ? [{}] : [] };
  const form = {
    closest: () => null, getClientRects: () => [],
    getAttribute: (name) => name === "role" ? "presentation" : null,
    querySelectorAll: () => [submit],
  };
  const dialog = {
    contains: (element) => element === form,
    getAttribute: () => "dynamic-heading-id",
    closest: () => hidden ? {} : null,
    getClientRects: () => [{}], matches: () => busy,
    querySelector: (selector) => selector === "h2" || selector.includes("aria-posinset") ? {} : null,
    querySelectorAll: () => [editor],
  };
  const body = { matches: () => false, querySelector: () => null };
  const doc = {
    readyState: "loading", body,
    querySelectorAll: () => [dialog],
    getElementById: () => ({ textContent: "投稿" }),
  };
  const context = vm.createContext({
    URL, document: doc, location: { pathname: "/groups/100/permalink/12345/" },
    Date: { now: () => now },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    MutationObserver: class {
      constructor(callback) { mutation = callback; }
      observe() {}
      disconnect() { disconnected++; }
    },
  });
  vm.runInContext(inspectionCode, context);
  const inspect = () => context.inspectPublishedPostPageInPage(context.location.pathname);
  assert.equal(inspect().loaded, false);
  doc.readyState = "complete";
  assert.equal(inspect().stable, false);
  now = 2500;
  mutation();
  now = 3500;
  assert.equal(inspect().stable, false, "recent hydration must reset the quiet period");
  now = 4100;
  assert.equal(inspect().stable, true);
  assert.equal(inspect().dialogFound, true);
  assert.equal(inspect().commentFormFound, true);
  assert.equal(inspect().commentEditorFound, true);
  assert.equal(inspect().submitButtonFound, true, "disabled empty submit buttons still count as present");
  submitVisible = false;
  assert.equal(inspect().commentFormFound, true, "a hidden submit button must not reject the editable form");
  assert.equal(inspect().submitButtonFound, false);
  busy = true;
  assert.equal(inspect().stable, false);
  busy = false;
  hidden = true;
  assert.equal(inspect().dialogFound, false);
  context.inspectPublishedPostPageInPage(context.location.pathname, true);
  assert.ok(disconnected > 0);
  assert.equal(context.__postikaCommentSetupDomObserver, undefined);
});

test("a pending post with a permalink but no comment form continues to another UI post", async () => {
  const h = queueHarness([{ ...published("100"), pendingApproval: true }, published("200")], true, 2, [
    { loaded: true, stable: true, dialogFound: true, commentFormFound: false, commentEditorFound: false, submitButtonFound: false },
    { loaded: true, stable: true, dialogFound: true, commentFormFound: true, commentEditorFound: true, submitButtonFound: true },
  ]);
  await h.run();
  assert.deepEqual(h.events.filter((event) => event.startsWith("ui:")), ["ui:100", "ui:200"]);
  assert.ok(h.events.includes(`navigate:${permalink("100")}`));
  assert.ok(h.events.includes(`navigate:${permalink("200")}`));
  assert.ok(h.statuses.some((status) => /does not currently allow Postika to add a comment/.test(status.message)));
  assert.equal(h.events.filter((event) => event === "comment:submit").length, 1);
  assert.ok(h.events.indexOf("ui:200") < h.events.indexOf("comment:prepare"));
  assert.ok(!h.events.includes("graphql-post"));
  assert.equal(h.statuses.at(-1).successCount, 2);
});

test("captured UI comment switches the queue to GraphQL and rotates saved options", async () => {
  const h = queueHarness([published("100")], true, 3);
  await h.run();
  assert.equal(h.events.filter((event) => event.startsWith("ui:")).length, 1);
  assert.equal(h.events.filter((event) => event === "graphql-post").length, 2);
  assert.deepEqual(h.events.filter((event) => event.startsWith("graphql-comment:")), ["graphql-comment:Second saved comment", "graphql-comment:First saved comment"]);
  assert.ok(h.events.indexOf("arm-comment-capture") < h.events.indexOf("comment:submit"));
  assert.ok(h.events.indexOf("read-comment-capture") < h.events.indexOf("graphql-post"));
  assert.ok(h.events.includes("comment-capture-cleanup"));
  assert.equal(h.statuses.at(-1).successCount, 3);
});

test("pending GraphQL posts skip comments without consuming the next option", async () => {
  const h = queueHarness([published("100")], true, 3);
  let index = 0;
  h.context.createGraphqlPost = async () => { h.events.push("graphql-post"); return ++index === 1 ? pending : { success: true, feedbackId: "new-feedback" }; };
  await h.run();
  assert.deepEqual(h.events.filter((event) => event.startsWith("graphql-comment:")), ["graphql-comment:Second saved comment"]);
  assert.ok(h.statuses.some((status) => /Comment skipped.*awaiting approval/.test(status.message)));
  assert.equal(h.events.filter((event) => event.startsWith("ui:")).length, 1);
});

test("an unconfirmed replay stops without repeating the comment or changing accepted post counts", async () => {
  const h = queueHarness([published("100")], true, 3);
  h.context.createGraphqlComment = async () => { h.events.push("failed-comment"); return { success: false, error: "Unconfirmed" }; };
  await h.run();
  assert.equal(h.events.filter((event) => event === "failed-comment").length, 1);
  assert.equal(h.events.filter((event) => event === "graphql-post").length, 1);
  assert.equal(h.statuses.at(-1).successCount, 2);
  assert.match(h.statuses.at(-1).error, /comment was not confirmed/);
});

test("waiting for first UI comment confirmation remains stoppable and restores capture hooks", async () => {
  const h = queueHarness([published("100")]);
  const execute = h.context.chrome.scripting.executeScript;
  let polls = 0;
  h.context.chrome.scripting.executeScript = async (args) => {
    if (args.func.name === "readCommentRequestCaptureInPage" && !args.args[0]) { polls++; return [{ result: {} }]; }
    return execute(args);
  };
  h.context.stopRequested = () => polls >= 100;
  vm.runInContext('throwIfPostingStopped = () => { if (stopRequested()) throw new Error("stopped"); };', h.context);
  await h.run();
  assert.equal(h.statuses.at(-1).status, "stopped");
  assert.ok(h.events.includes("comment-capture-cleanup"));
  assert.equal(h.events.filter((event) => event === "comment:submit").length, 1);
  assert.ok(!h.events.includes("graphql-post"));
});

for (const [changedField, changedValue, reason] of [
  ["cookieAccount", "9876543210", /different account/],
  ["cookieLogin", "changed", /sign-in cookie changed/],
  ["cookieStore", "1", /browser storage/],
]) {
  test(`a changed ${changedField} warns and continues posting and comments`, async () => {
    const h = queueHarness([published("100")], true, 3);
    h.context.sleepWithPostingCountdown = async () => { h.context[changedField] = changedValue; };
    await h.run();
    assert.equal(h.events.filter((event) => event === "graphql-post").length, 2);
    assert.equal(h.events.filter((event) => event.startsWith("graphql-comment:")).length, 2);
    assert.equal(h.statuses.at(-1).successCount, 3);
    assert.equal(h.statuses.at(-1).status, "done");
    assert.ok(h.statuses.some((status) => reason.test(status.message) && /Warning:.*Posting will continue/.test(status.message)));
    assert.equal(h.warnings.filter((warning) => reason.test(warning)).length, 1);
  });
}

test("a login cookie change during UI setup warns without preventing the first comment", async () => {
  const h = queueHarness([published("100")]);
  const execute = h.context.chrome.scripting.executeScript;
  h.context.chrome.scripting.executeScript = async (args) => {
    const result = await execute(args);
    if (args.args?.[2] === "check") h.context.cookieLogin = "new-login-same-account";
    return result;
  };
  await h.run();
  assert.ok(h.events.includes("comment:submit"));
  assert.ok(h.events.includes("graphql-post"));
  assert.ok(h.warnings.some((warning) => /same Facebook account, but its sign-in cookie changed/.test(warning)));
  assert.equal(h.statuses.at(-1).successCount, 3);
});

test("a captured request for another actor cannot initialize comment replay", async () => {
  const h = queueHarness([published("100")]);
  const execute = h.context.chrome.scripting.executeScript;
  h.context.chrome.scripting.executeScript = async (args) => {
    const result = await execute(args);
    if (args.func.name === "readCommentRequestCaptureInPage" && !args.args[0]) result[0].result.template.formData.__user = "9876543210";
    return result;
  };
  await h.run();
  assert.ok(!h.events.includes("graphql-post"));
  assert.match(h.statuses.at(-1).error, /different Facebook account or actor/);
});

test("normal UI navigation between Facebook hosts keeps the same login binding", async () => {
  const h = queueHarness([{ success: true, postUrl: "https://www.facebook.com/groups/100/permalink/12345/" }]);
  await h.run();
  assert.equal(h.events.filter((event) => event === "graphql-post").length, 2);
  assert.equal(h.statuses.at(-1).successCount, 3);
});

test("a Facebook host change warns once and allows posting to continue", async () => {
  const h = queueHarness([published("100")]);
  const browserSession = await h.context.readCommentBrowserSession(7);
  h.context.tabUrl = "https://www.facebook.com/groups/100/permalink/12345/";
  const session = { browserSession, template: { url: "https://web.facebook.com/api/graphql/" } };
  await h.context.assertCommentBrowserSession(session);
  await h.context.assertCommentBrowserSession(session);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0], /page address changed from web\.facebook\.com to www\.facebook\.com/);
  assert.match(h.warnings[0], /Posting will continue/);
});

test("unavailable session information warns without stopping", async () => {
  const h = queueHarness([published("100")]);
  const browserSession = await h.context.readCommentBrowserSession(7);
  h.context.cookieLogin = "";
  await h.context.assertCommentBrowserSession({ browserSession });
  assert.match(h.warnings[0], /could not verify/);
  assert.match(h.warnings[0], /Posting will continue/);
});

test("moving to another page on the same Facebook host does not report a session change", async () => {
  const h = queueHarness([published("100")]);
  const browserSession = await h.context.readCommentBrowserSession(7);
  h.context.tabUrl = "https://web.facebook.com/groups/200/";
  await h.context.assertCommentBrowserSession({ browserSession, template: { url: "https://web.facebook.com/api/graphql/" } });
});

test("comment capture injection uses serializable arguments with and without a response feedback ID", async () => {
  for (const feedbackId of [undefined, "provided-feedback-id"]) {
    const h = queueHarness([{ ...published("100"), feedbackId }], true, 1);
    const execute = h.context.chrome.scripting.executeScript;
    let captureArgs;
    h.context.chrome.scripting.executeScript = async (injection) => {
      if (injection.func.name === "installCommentRequestCaptureInPage") captureArgs = injection.args;
      return execute(injection);
    };
    await h.run();
    assert.equal(captureArgs[3], feedbackId ?? "");
    assert.ok(h.events.includes("comment:submit"));
    assert.ok(h.statuses.some((status) => /First comment posted successfully/.test(status.message)));
  }
});

test("comment options must be nonempty before any UI posting begins", async () => {
  const h = queueHarness([]);
  h.request.groupCommentOptions = ["", "  "];
  await h.run();
  assert.ok(!h.events.some((event) => event.startsWith("ui:")));
  assert.match(h.statuses.at(-1).error, /at least one comment option/);
});

test("translated comment input is scoped to the dialog form and submits only once when enabled", async () => {
  const inspectionCode = (await transform(helperSource.replace(/^export /gm, ""), { loader: "ts" })).code;
  let clicks = 0;
  let disabled = true;
  let hasForm = false;
  let submitVisible = false;
  let pasteWorks = false;
  let nativeWorks = true;
  let postInputClicks = 0;
  let revealAfterTextClick = false;
  let submitMounted = true;
  let revealAfterTextFocus = false;
  const visibleElement = { closest: () => null, getClientRects: () => [{}] };
  const submit = {
    ...visibleElement,
    getClientRects: () => submitVisible ? [{}] : [],
    getAttribute: () => disabled ? "true" : "false",
    hasAttribute: () => false,
    click: () => { clicks++; editor.innerText = ""; },
  };
  const form = { ...visibleElement, getClientRects: () => [],
    getAttribute: (name) => name === "role" ? "presentation" : null,
    querySelectorAll: () => submitMounted ? [submit] : [],
  };
  const editor = {
    ...visibleElement, innerText: "", textContent: "",
    focus() {
      if (revealAfterTextFocus && editor.innerText) {
        submitMounted = true;
        submitVisible = true;
      }
    },
    click() {
      if (editor.innerText) {
        postInputClicks++;
        if (revealAfterTextClick) submitVisible = true;
      }
    },
    dispatchEvent: (event) => {
      if (pasteWorks) editor.innerText = event.clipboardData.getData("text/plain");
    },
    getAttribute: (name) => name === "aria-label" ? "اكتب تعليقًا عامًا…" : null,
    closest: (selector) => selector === "form" && hasForm ? form : null,
  };
  const unrelatedReply = {
    ...editor, getAttribute: () => null,
    closest: (selector) => selector === '[role="article"]' ? {} : selector === "form" ? form : null,
    focus: () => { throw new Error("a reply editor must not be used"); },
  };
  const dialog = {
    ...visibleElement, contains: (element) => element === form,
    getAttribute: () => "new-dynamic-heading",
    querySelector: (selector) => selector === "h2" || selector.includes("aria-posinset") ? {} : null,
    querySelectorAll: () => [unrelatedReply, editor],
  };
  const doc = {
    readyState: "complete", querySelectorAll: () => [dialog],
    getElementById: () => ({ textContent: "Publication de quelqu’un" }),
    execCommand: (command, showUI, text) => { if (nativeWorks) editor.innerText = text; return true; },
    getSelection: () => null,
  };
  const context = vm.createContext({
    document: doc, location: { pathname: "/groups/100/permalink/12345/" },
    setTimeout: (callback) => callback(),
    DataTransfer: class {
      data = new Map();
      setData(type, value) { this.data.set(type, value); }
      getData(type) { return this.data.get(type); }
    },
    ClipboardEvent: class { constructor(type, options) { Object.assign(this, options); } },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  });
  vm.runInContext(inspectionCode, context);
  const act = (action) => context.interactWithPostCommentFormInPage(context.location.pathname, "First comment 🚗\nMore details", action);
  assert.equal((await act("prepare")).state, "unavailable");
  assert.equal(editor.innerText, "");
  hasForm = true;
  editor.innerText = "Another draft";
  assert.equal((await act("prepare")).state, "failed");
  assert.equal(editor.innerText, "Another draft");
  editor.innerText = "";
  assert.equal((await act("prepare")).state, "preparing");
  assert.equal(editor.innerText, "First comment 🚗\nMore details");
  assert.equal(postInputClicks, 1, "the editor must receive a click after text insertion");
  assert.equal((await act("submit")).state, "preparing");
  assert.equal(clicks, 0);
  disabled = false;
  assert.equal((await act("check")).state, "preparing", "enabled but hidden buttons must not be clicked");
  submitVisible = true;
  assert.equal((await act("check")).state, "ready");
  assert.equal((await act("submit")).state, "submitted");
  assert.equal((await act("submit")).state, "submitted");
  assert.equal(clicks, 1);
  await act("cleanup");
  assert.equal(context.__postikaFirstCommentUiSubmission, undefined);
  // A successful execCommand return is insufficient when no text appears.
  nativeWorks = false;
  const emptyAttempt = await act("prepare");
  assert.equal(emptyAttempt.textEntered, false);
  assert.equal(emptyAttempt.editorEmpty, true);
  assert.equal((await act("submit")).state, "preparing");
  assert.equal(clicks, 1);
  // The paste path can activate the Lexical editor without native insertion.
  pasteWorks = true;
  const pasted = await act("prepare");
  assert.equal(pasted.textEntered, true);
  assert.equal(editor.innerText, "First comment 🚗\nMore details");
  assert.equal((await act("check")).state, "ready");
  await act("cleanup");
  // Facebook only reveals the button after clicking the populated editor.
  editor.innerText = "";
  submitVisible = false;
  revealAfterTextClick = true;
  assert.equal((await act("prepare")).textEntered, true);
  assert.equal(submitVisible, true);
  assert.equal((await act("check")).state, "ready");
  assert.equal(editor.innerText, "First comment 🚗\nMore details");
  await act("cleanup");
  // Text can finish rendering after prepare, and focus can mount a new button.
  pasteWorks = false;
  nativeWorks = false;
  revealAfterTextClick = false;
  editor.innerText = "";
  submitVisible = false;
  submitMounted = false;
  assert.equal((await act("prepare")).textEntered, false);
  editor.innerText = "First comment 🚗\nMore details";
  revealAfterTextFocus = true;
  assert.equal((await act("check")).state, "ready", "refocusing late-rendered text must mount and reveal the submit button");
  assert.equal(submitMounted, true);
  assert.equal(submitVisible, true);
  assert.equal(clicks, 1, "activating the editor must not submit the comment");
  assert.equal((await act("submit")).state, "submitted");
  assert.equal((await act("submit")).state, "submitted");
  assert.equal(clicks, 2);
  await act("cleanup");
});

test("comment selectors reject ambiguous forms and dialogs without using translated text", async () => {
  const code = (await transform(helperSource.replace(/^export /gm, ""), { loader: "ts" })).code;
  const visible = { closest: () => null, getClientRects: () => [{}] };
  const submit = { ...visible, getAttribute: () => null, hasAttribute: () => false };
  const buttons = [submit];
  const form = {
    getAttribute: (name) => name === "role" ? "presentation" : null,
    querySelectorAll: () => buttons,
  };
  const editor = {
    ...visible, innerText: "تعليق", getAttribute: () => null, focus() {}, click() {},
    closest: (selector) => selector === "form" ? form : null,
  };
  const reply = { ...editor, closest: (selector) => selector === '[role="article"]' ? {} : selector === "form" ? form : null };
  const editors = [reply, editor];
  let postContent = true;
  const dialog = {
    ...visible, matches: () => false, contains: (element) => element === form,
    querySelector: (selector) => selector === "h2" || (postContent && selector.includes("aria-posinset")) ? {} : null,
    querySelectorAll: () => editors,
  };
  const dialogs = [dialog];
  const path = "/groups/100/permalink/12345/";
  const context = vm.createContext({
    document: { readyState: "complete", body: { matches: () => false, querySelector: () => null }, querySelectorAll: () => dialogs },
    location: { pathname: path }, Date: { now: () => 0 },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (callback) => callback(),
  });
  vm.runInContext(code, context);
  const inspect = () => context.inspectPublishedPostPageInPage(path);
  const check = () => context.interactWithPostCommentFormInPage(path, "تعليق", "check");
  assert.equal(inspect().commentFormFound, true, "a reply editor is excluded without reading its label");
  assert.equal((await check()).state, "ready");
  editors.push({ ...editor });
  assert.equal(inspect().commentFormFound, false);
  assert.equal((await check()).state, "unavailable");
  editors.pop();
  buttons.push({ ...submit });
  assert.equal((await check()).state, "preparing", "multiple buttons in the submit container must not be guessed");
  buttons.pop();
  dialogs.push({ ...dialog });
  assert.equal(inspect().dialogFound, false);
  assert.equal((await check()).state, "unavailable");
  dialogs.pop();
  postContent = false;
  assert.equal(inspect().dialogFound, false, "a generic modal is not a post dialog");
  assert.equal((await check()).state, "unavailable");
  context.inspectPublishedPostPageInPage(path, true);
});

const captureWaitCode = (await transform(
  background.slice(background.indexOf("async function waitForFirstPostResponseCapture("), background.indexOf("async function readFirstPostResponseCapture(")) +
  background.slice(background.indexOf("async function waitForPostingTemplatesInternal("), background.indexOf("function finalizeUploadTemplate(")),
  { loader: "ts" },
)).code;

for (const capture of ["response", "requests"]) {
  for (const stop of [false, true]) {
    test(`${capture} capture waits beyond its old timeout and ${stop ? "cleans up when stopped" : "returns when ready"}`, async () => {
      let elapsed = 0;
      let cleanupCount = 0;
      const context = vm.createContext({
        Date: { now: () => elapsed },
        capturedPostTemplate: undefined,
        capturedUploadTemplate: undefined,
        debugLog() {},
        throwIfPostingStopped() { if (stop && elapsed >= 65000) throw new Error("stopped"); },
        sleepWithStopChecks: async () => {
          elapsed += 1000;
          if (elapsed >= 65000) {
            context.capturedPostTemplate = { formData: {} };
            context.capturedUploadTemplate = { formData: {} };
          }
        },
        readFirstPostResponseCapture: async (tabId, cleanup) => {
          if (cleanup) { cleanupCount++; return undefined; }
          return elapsed >= 65000 ? "confirmed response" : undefined;
        },
        finalizeUploadTemplate: (upload) => upload,
        stopPostingTemplateCapture: () => { cleanupCount++; },
      });
      vm.runInContext(captureWaitCode, context);
      const waiting = capture === "response"
        ? context.waitForFirstPostResponseCapture(7)
        : context.waitForPostingTemplatesInternal(true);
      if (stop) {
        await assert.rejects(waiting, /stopped/);
      } else {
        const result = await waiting;
        if (capture === "response") assert.equal(result, "confirmed response");
        else {
          assert.ok(result.postTemplate);
          assert.ok(result.uploadTemplate);
        }
      }
      assert.ok(elapsed >= 65000);
      assert.equal(cleanupCount, 1);
    });
  }
}
