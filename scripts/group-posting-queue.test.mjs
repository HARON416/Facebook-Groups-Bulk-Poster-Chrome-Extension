import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import { build } from "esbuild";

const source = await readFile(
  new URL("../src/background.ts", import.meta.url),
  "utf8",
);
const bundle = await build({
  stdin: {
    contents:
      source +
      `
      globalThis.queueFixture = {
        run: runGraphqlPostingQueue,
        buildPostVariables,
        createPost: createGraphqlPost,
        uploadImages: uploadImagesForGroup,
        setNetworkOffline: setPostingNetworkOffline,
        start: startUiPostingRequest,
        stop: stopUiPosting,
        configure: overrides => {
          getActiveTabForPosting = overrides.tab;
          getFacebookActorId = overrides.actor;
          ensurePostingTemplates = overrides.templates;
          uploadImagesForGroup = overrides.upload;
          if (overrides.uploadImage) uploadImage = overrides.uploadImage;
          createGraphqlPost = overrides.post;
          if (overrides.replay) createGraphqlPostInPage = overrides.replay;
          if (overrides.fetch) globalThis.fetch = overrides.fetch;
          sleepWithPostingCountdown = async () => {};
          readFirstPostResponseCapture = async () => undefined;
        }
      };`,
    resolveDir: new URL("../src/", import.meta.url).pathname,
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
});

function queueFixture() {
  const statuses = [];
  let listener;
  let alarmListener;
  const scheduledItems = new Map();
  const alarms = new Map();
  const noop = () => {};
  const database = {
    objectStoreNames: { contains: () => true },
    close: noop,
    transaction: () => {
      const transaction = {
        objectStore: () => ({
          put: (value, key) => {
            scheduledItems.set(key, value);
            queueMicrotask(() => transaction.oncomplete?.());
          },
          get: (key) => {
            const request = {};
            queueMicrotask(() => {
              request.result = scheduledItems.get(key);
              request.onsuccess?.();
              queueMicrotask(() => transaction.oncomplete?.());
            });
            return request;
          },
          delete: (key) => scheduledItems.delete(key),
        }),
      };
      return transaction;
    },
  };
  const context = vm.createContext({
    console: { log: noop, warn: noop },
    crypto: webcrypto,
    URL,
    URLSearchParams,
    TextEncoder,
    setTimeout,
    clearTimeout,
    AbortController,
    navigator: { onLine: true },
    chrome: {
      runtime: {
        onConnect: { addListener: noop },
        onInstalled: { addListener: noop },
        onMessage: {
          addListener: (callback) => {
            listener = callback;
          },
        },
        sendMessage: async (status) => statuses.push(status),
      },
      tabs: {
        query: async () => [],
        get: async () => ({
          url: "https://www.facebook.com/groups/test",
          status: "complete",
        }),
        sendMessage: async () => ({}),
        onActivated: { addListener: noop },
        onUpdated: { addListener: noop },
      },
      scripting: {
        executeScript: async ({ func, args = [] }) => [
          { result: await func(...args) },
        ],
      },
      action: { onClicked: { addListener: noop } },
      webRequest: {
        onBeforeRequest: { addListener: noop },
        onBeforeSendHeaders: { addListener: noop },
      },
      alarms: {
        onAlarm: {
          addListener: (callback) => {
            alarmListener = callback;
          },
        },
        create: (name, info) =>
          alarms.set(name, { name, scheduledTime: info.when }),
        get: async (name) => alarms.get(name),
        clear: async (name) => alarms.delete(name),
      },
      storage: {
        local: { get: async () => ({}), remove: async () => {} },
        session: {
          get: async () => ({}),
          remove: async () => {},
          set: async () => {},
        },
      },
    },
    indexedDB: {
      open: () => {
        const request = { result: database };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  return {
    queue: context.queueFixture,
    schedule: {
      start: context.queueFixture.start,
      stop: context.queueFixture.stop,
      saved: () => scheduledItems.get("active"),
      hasAlarm: () => alarms.has("postika-scheduled-posting"),
      fire: () => alarmListener?.({ name: "postika-scheduled-posting" }),
    },
    statuses,
    message: (request, respond) => listener(request, {}, respond),
  };
}

test("group queue captures once, replays original images, and reports pending/published outcomes", async () => {
  const { queue, statuses, message } = queueFixture();
  const images = [
    {
      name: "original.png",
      type: "image/png",
      dataUrl: "data:image/png;base64,b3JpZ2luYWw=",
    },
  ];
  const events = [];
  queue.configure({
    tab: async () => ({ id: 7 }),
    actor: async () => "123456",
    templates: async (_tab, groups, original, body, html, media) => {
      events.push("capture");
      assert.equal(original, "Original post");
      assert.equal(body, original);
      assert.equal(html, "<h1><strong>Original</strong> post</h1>");
      assert.deepEqual(media, images);
      return {
        firstGroupPosted: true,
        firstPostResult: { pendingApproval: true },
        uploadTemplate: {},
        postTemplate: {},
      };
    },
    upload: async (_tab, _template, media) => {
      events.push("upload");
      assert.deepEqual(media, images);
      return ["photo-1"];
    },
    post: async (
      _tab,
      _template,
      text,
      photos,
      _groupId,
      preserveFormatting,
    ) => {
      events.push("replay");
      assert.equal(text, "Original post");
      assert.deepEqual(Array.from(photos), ["photo-1"]);
      assert.equal(preserveFormatting, true);
      return { success: true, postId: "confirmed" };
    },
  });
  await queue.run({
    type: "START_UI_POSTING",
    startedAt: Date.now(),
    groups: [
      { id: "100", name: "First" },
      { id: "200", name: "Second" },
    ],
    posts: [
      {
        id: "post",
        body: "Original post",
        html: "<h1><strong>Original</strong> post</h1>",
        images,
      },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 60,
    maxPosts: 2,
    // Old saved batches must not re-enable retired features.
    groupCommentEnabled: true,
    groupCommentOptions: ["Retired comment"],
  });
  assert.deepEqual(events, ["capture", "upload", "replay"]);
  const results = statuses.filter((s) =>
    ["pending", "posted"].includes(s.status),
  );
  assert.deepEqual(
    results.map((s) => s.status),
    ["pending", "posted"],
  );
  assert.equal(statuses.at(-1).status, "done");
  assert.equal(statuses.at(-1).successCount, 2);
  assert.equal(statuses.at(-1).pendingCount, 1);
  assert.equal(
    statuses.some((s) => /comment|watermark/i.test(s.message)),
    false,
  );
  const restored = await new Promise((resolve) =>
    message({ type: "GET_POSTING_QUEUE_STATUS" }, resolve),
  );
  assert.equal(restored.groups.status, "done");
  assert.equal(restored.groups.successCount, 2);
  let control;
  message({ type: "PAUSE_UI_POSTING" }, (value) => {
    control = value;
  });
  assert.equal(control.ok, false);
  assert.match(control.error, /not running/);
});

test("network loss pauses the queue until connectivity returns", async () => {
  const { queue, statuses } = queueFixture();
  let postCount = 0;
  queue.configure({
    tab: async () => ({ id: 7 }),
    actor: async () => "123456",
    templates: async () => {
      queue.setNetworkOffline(true);
      return {
        firstGroupPosted: true,
        firstPostResult: { success: true },
        uploadTemplate: {},
        postTemplate: {},
      };
    },
    upload: async () => ["photo"],
    post: async () => {
      postCount += 1;
      return { success: true, postId: "confirmed" };
    },
  });

  const run = queue.run({
    type: "START_UI_POSTING",
    startedAt: Date.now(),
    groups: [
      { id: "100", name: "First" },
      { id: "200", name: "Second" },
    ],
    posts: [
      {
        id: "post",
        body: "Post",
        html: "<p>Post</p>",
        images: [
          {
            name: "image.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,eA==",
          },
        ],
      },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 60,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(postCount, 0);
  assert.ok(
    statuses.some(
      (status) =>
        status.status === "paused" &&
        /Internet connection lost/.test(status.message),
    ),
    JSON.stringify(statuses),
  );

  queue.setNetworkOffline(false);
  await run;

  assert.equal(postCount, 1);
  assert.ok(
    statuses.some(
      (status) =>
        status.status === "posting" &&
        /connection restored/i.test(status.message),
    ),
  );
  assert.equal(statuses.at(-1).status, "done");
});

test("network retry reuses the same GraphQL mutation variables", async () => {
  const { queue, statuses } = queueFixture();
  const attempts = [];
  queue.configure({
    tab: async () => ({ id: 7 }),
    actor: async () => "123456",
    templates: async () => ({
      firstGroupPosted: true,
      firstPostResult: { success: true },
      uploadTemplate: {},
      postTemplate: {
        url: "https://web.facebook.com/api/graphql/",
        headers: {},
        formData: {
          variables: JSON.stringify({
            input: {
              message: { text: "Post" },
              audience: { to_id: "100" },
            },
          }),
        },
      },
    }),
    upload: async () => ["photo"],
    post: (...args) => queue.createPost(...args),
    replay: async (_template, variables) => {
      attempts.push(variables);
      if (attempts.length === 1) {
        setTimeout(() => queue.setNetworkOffline(false), 50);
        return {
          status: 0,
          ok: false,
          responseText: "",
          error: "Failed to fetch",
        };
      }
      return {
        status: 200,
        ok: true,
        responseText:
          '{"data":{"story_create":{"post_id":"confirmed","story":{"id":"confirmed"}}}}',
      };
    },
  });

  await queue.run({
    type: "START_UI_POSTING",
    startedAt: Date.now(),
    groups: [
      { id: "100", name: "First" },
      { id: "200", name: "Second" },
    ],
    posts: [
      {
        id: "post",
        body: "Post",
        html: "<p>Post</p>",
        images: [
          {
            name: "image.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,eA==",
          },
        ],
      },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 60,
  });

  assert.equal(attempts.length, 2, JSON.stringify(statuses));
  assert.equal(attempts[0], attempts[1]);
  assert.ok(
    statuses.some(
      (status) =>
        status.status === "paused" &&
        /Internet connection lost/.test(status.message),
    ),
  );
  assert.equal(statuses.at(-1).status, "done");
});

test("first-post recovery replays the captured mutation unchanged", async () => {
  const { queue } = queueFixture();
  const capturedVariables = JSON.stringify({
    input: {
      client_mutation_id: "captured-mutation",
      audience: { to_id: "100" },
    },
  });
  let replayedVariables;
  queue.configure({
    replay: async (_template, variables) => {
      replayedVariables = variables;
      return {
        status: 200,
        ok: true,
        responseText:
          '{"data":{"story_create":{"post_id":"confirmed","story":{"id":"confirmed"}}}}',
      };
    },
  });

  await queue.createPost(
    7,
    {
      url: "https://web.facebook.com/api/graphql/",
      headers: {},
      formData: { variables: "{}" },
    },
    "unused",
    [],
    "100",
    true,
    {
      current: 1,
      total: 1,
      groupId: "100",
      groupName: "First",
      successCount: 0,
      failedCount: 0,
      processedCount: 0,
    },
    capturedVariables,
  );

  assert.equal(replayedVariables, capturedVariables);
});

test("connectivity probes automatically resume an offline queue", async () => {
  const { queue, statuses } = queueFixture();
  let online = false;
  let postCount = 0;
  queue.configure({
    fetch: async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return { type: "basic" };
    },
    tab: async () => ({ id: 7 }),
    actor: async () => "123456",
    templates: async () => ({
      firstGroupPosted: true,
      firstPostResult: { success: true },
      uploadTemplate: {},
      postTemplate: {},
    }),
    upload: async () => ["photo"],
    post: async () => {
      postCount += 1;
      return { success: true, postId: "confirmed" };
    },
  });

  const run = queue.run({
    type: "START_UI_POSTING",
    startedAt: Date.now(),
    groups: [
      { id: "100", name: "First" },
      { id: "200", name: "Second" },
    ],
    posts: [
      {
        id: "post",
        body: "Post",
        html: "<p>Post</p>",
        images: [
          {
            name: "image.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,eA==",
          },
        ],
      },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 60,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(postCount, 0);
  assert.ok(
    statuses.some(
      (status) =>
        status.status === "paused" &&
        /Internet connection lost/.test(status.message),
    ),
  );

  online = true;
  await run;

  assert.equal(postCount, 1);
  assert.ok(
    statuses.some(
      (status) =>
        status.status === "posting" &&
        /connection restored/i.test(status.message),
    ),
  );
  assert.equal(statuses.at(-1).status, "done");
});

test("reconnection preserves a user-requested pause", async () => {
  const { queue, statuses, message } = queueFixture();
  let postCount = 0;
  queue.configure({
    tab: async () => ({ id: 7 }),
    actor: async () => "123456",
    templates: async () => {
      queue.setNetworkOffline(true);
      return {
        firstGroupPosted: true,
        firstPostResult: { success: true },
        uploadTemplate: {},
        postTemplate: {},
      };
    },
    upload: async () => ["photo"],
    post: async () => {
      postCount += 1;
      return { success: true, postId: "confirmed" };
    },
  });

  const run = queue.run({
    type: "START_UI_POSTING",
    startedAt: Date.now(),
    groups: [
      { id: "100", name: "First" },
      { id: "200", name: "Second" },
    ],
    posts: [
      {
        id: "post",
        body: "Post",
        html: "<p>Post</p>",
        images: [
          {
            name: "image.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,eA==",
          },
        ],
      },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 60,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  let pauseResponse;
  message({ type: "PAUSE_UI_POSTING" }, (response) => {
    pauseResponse = response;
  });
  assert.equal(pauseResponse.ok, true);

  queue.setNetworkOffline(false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(postCount, 0);
  assert.ok(
    statuses.some(
      (status) =>
        status.status === "paused" && /remains paused/.test(status.message),
    ),
  );

  message({ type: "RESUME_UI_POSTING" }, () => {});
  await run;
  assert.equal(postCount, 1);
  assert.equal(statuses.at(-1).status, "done");
});

test("image upload retries after connectivity returns", async () => {
  const { queue, statuses } = queueFixture();
  let uploadAttempts = 0;
  queue.configure({
    tab: async () => ({ id: 7 }),
    actor: async () => "123456",
    templates: async () => ({
      firstGroupPosted: true,
      firstPostResult: { success: true },
      uploadTemplate: {},
      postTemplate: {},
    }),
    upload: (...args) => queue.uploadImages(...args),
    uploadImage: async () => {
      uploadAttempts += 1;
      if (uploadAttempts === 1) {
        setTimeout(() => queue.setNetworkOffline(false), 50);
        return { success: false, error: "Failed to fetch" };
      }
      return { success: true, photoId: "photo" };
    },
    post: async () => ({ success: true, postId: "confirmed" }),
  });

  await queue.run({
    type: "START_UI_POSTING",
    startedAt: Date.now(),
    groups: [
      { id: "100", name: "First" },
      { id: "200", name: "Second" },
    ],
    posts: [
      {
        id: "post",
        body: "Post",
        html: "<p>Post</p>",
        images: [
          {
            name: "image.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,eA==",
          },
        ],
      },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 60,
  });

  assert.equal(uploadAttempts, 2);
  assert.ok(
    statuses.some(
      (status) =>
        status.status === "paused" &&
        /Internet connection lost/.test(status.message),
    ),
  );
  assert.equal(statuses.at(-1).status, "done");
});

test("formatted Facebook template metadata is preserved for queued post replay", () => {
  const { queue } = queueFixture();
  const messageRanges = [{ offset: 0, length: 8, style: "BOLD" }];
  const composedText = {
    block_data: ["{}", "{}"],
    block_depths: [0, 0],
    block_types: [1, 0],
    blocks: ["Heading", "Body"],
    entities: ["[]", "[]"],
    entity_map: "{}",
    inline_styles: ['["BOLD"]', "[]"],
  };
  const formData = {
    variables: JSON.stringify({
      input: {
        message: { text: "Formatted post", ranges: messageRanges },
        composed_text: composedText,
        audience: { to_id: "100" },
      },
    }),
  };

  const variables = JSON.parse(
    queue.buildPostVariables(formData, "Formatted post", ["photo-1"], "200"),
  );
  assert.deepEqual(variables.input.message.ranges, messageRanges);
  assert.deepEqual(variables.input.composed_text, composedText);
  assert.equal(variables.input.audience.to_id, "200");
});

test("GraphQL replay keeps inline formatting when only line endings differ", () => {
  const { queue } = queueFixture();
  const text =
    "Samsung Galaxy Note 20\nStarting from\nKsh1,160 / Week\n+ Ksh8,999 deposit\nIncluding 1 week credit\nCall/WhatsApp 0718448461";
  const capturedText = text.replace(/\n/g, "\r\n");
  const messageRanges = [
    {
      offset: text.indexOf("Call/WhatsApp"),
      length: "Call/WhatsApp 0718448461".length,
      style: "BOLD",
    },
  ];
  const composedText = {
    block_data: ["{}"],
    block_depths: [0],
    block_types: [0],
    blocks: [capturedText],
    entities: ["[]"],
    entity_map: "{}",
    inline_styles: [JSON.stringify(messageRanges)],
  };
  const variables = JSON.parse(
    queue.buildPostVariables(
      {
        variables: JSON.stringify({
          input: {
            message: { text: capturedText, ranges: messageRanges },
            composed_text: composedText,
          },
        }),
      },
      text,
      [],
      "100",
    ),
  );

  assert.equal(variables.input.message.text, text);
  assert.deepEqual(variables.input.message.ranges, messageRanges);
  assert.deepEqual(variables.input.composed_text.blocks, [text]);
  assert.deepEqual(
    variables.input.composed_text.inline_styles,
    composedText.inline_styles,
  );
});

test("GraphQL replay preserves Facebook formatting for the UI-seeded post", () => {
  const { queue } = queueFixture();
  const editorText =
    "Samsung Galaxy Note 20\nStarting from\n\nKsh1,160 / Week\n+ Ksh8,999 deposit\nIncluding 1 week credit\n\nCall/WhatsApp 0718448461";
  const formattedLength = editorText.replace(/\n\n/g, "\n").length;
  const capturedMessage = {
    text: "Samsung Galaxy Note 20\nStarting from\nKsh1,160 / Week\n+ Ksh8,999 deposit\nIncluding 1 week credit\nCall/WhatsApp 0718448461",
    ranges: [
      { offset: 0, length: formattedLength, type: "bold" },
      { offset: 0, length: formattedLength, type: "italic" },
    ],
  };
  const capturedComposedText = {
    block_data: ["{}"],
    block_depths: [0],
    block_types: [0],
    blocks: [capturedMessage.text],
    entities: ["[]"],
    entity_map: "{}",
    inline_styles: [
      JSON.stringify([
        { offset: 0, length: formattedLength, style: "BOLD" },
        { offset: 0, length: formattedLength, style: "ITALIC" },
      ]),
    ],
  };
  const variables = JSON.parse(
    queue.buildPostVariables(
      {
        variables: JSON.stringify({
          input: {
            message: capturedMessage,
            composed_text: capturedComposedText,
            audience: { to_id: "100" },
          },
        }),
      },
      editorText,
      ["photo-1"],
      "200",
      true,
    ),
  );

  assert.deepEqual(variables.input.message, capturedMessage);
  assert.deepEqual(variables.input.composed_text, capturedComposedText);
  assert.equal(variables.input.audience.to_id, "200");
  assert.deepEqual(variables.input.attachments, [{ photo: { id: "photo-1" } }]);
});

test("queue reuses captured formatting only for the UI-seeded post", async () => {
  const { queue } = queueFixture();
  const replayed = [];
  const image = [
    {
      name: "post.png",
      type: "image/png",
      dataUrl: "data:image/png;base64,eA==",
    },
  ];
  queue.configure({
    tab: async () => ({ id: 7 }),
    actor: async () => "123456",
    templates: async () => ({
      firstGroupPosted: true,
      firstPostResult: { success: true },
      uploadTemplate: {},
      postTemplate: {},
    }),
    upload: async () => ["photo-1"],
    post: async (
      _tab,
      _template,
      text,
      _photos,
      groupId,
      preserveFormatting,
    ) => {
      replayed.push([text, preserveFormatting]);
      return { success: true, postId: "confirmed" };
    },
  });

  await queue.run({
    type: "START_UI_POSTING",
    startedAt: Date.now(),
    groups: [{ id: "100" }, { id: "200" }, { id: "300" }],
    posts: [
      {
        id: "first",
        body: "First post",
        html: "<p><strong>First post</strong></p>",
        images: image,
      },
      {
        id: "second",
        body: "Second post",
        html: "<p>Second post</p>",
        images: image,
      },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 60,
  });

  assert.deepEqual(replayed, [
    ["Second post", false],
    ["First post", true],
  ]);
});

test("GraphQL posting preserves paragraph breaks and empty lines", () => {
  const { queue } = queueFixture();
  const text = "First line\n\nThird line\r\nFourth line";
  const variables = JSON.parse(
    queue.buildPostVariables(
      {
        variables: JSON.stringify({ input: { message: { text: "Original" } } }),
      },
      text,
      [],
      "100",
    ),
  );

  assert.equal(
    variables.input.message.text,
    "First line\n\nThird line\nFourth line",
  );
  assert.deepEqual(variables.input.composed_text.blocks, [
    "First line\n\nThird line\nFourth line",
  ]);
});

test("selected groups are attempted once even with failures and a legacy repeat count", async () => {
  const { queue, statuses } = queueFixture();
  const attempted = [];
  queue.configure({
    tab: async () => ({ id: 7 }),
    actor: async () => "123456",
    templates: async (_tab, groups) => {
      attempted.push(groups[0].id);
      return {
        firstGroupPosted: true,
        firstPostResult: { pendingApproval: false },
        uploadTemplate: {},
        postTemplate: {},
      };
    },
    upload: async () => ["photo-1"],
    post: async (_tab, _template, _body, _photos, groupId) => {
      attempted.push(groupId);
      return attempted.length === 2
        ? { success: false, error: "Group rejected the post" }
        : { success: true, postId: "confirmed" };
    },
  });
  await queue.run({
    type: "START_UI_POSTING",
    groups: [{ id: "100" }, { id: "200" }, { id: "300" }, { id: "100" }],
    posts: [
      {
        id: "post",
        body: "Unchanged post",
        html: "<p>Unchanged post</p>",
        images: [{ dataUrl: "original" }],
      },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 60,
    maxPosts: 99,
  });
  assert.equal(attempted.length, 3);
  assert.equal(new Set(attempted).size, 3);
  assert.equal(statuses.at(-1).status, "done");
  assert.equal(statuses.at(-1).successCount, 2);
  assert.equal(statuses.at(-1).failedCount, 1);
});

test("posting exceeds the former daily quota across consecutive runs without allowance requests", async () => {
  const { queue, statuses } = queueFixture();
  const attempted = [];
  queue.configure({
    tab: async () => ({ id: 7 }),
    actor: async () => "123456",
    templates: async (_tab, groups) => {
      attempted.push(groups[0].id);
      return {
        firstGroupPosted: true,
        firstPostResult: {},
        uploadTemplate: {},
        postTemplate: {},
      };
    },
    upload: async () => ["photo"],
    post: async (_tab, _template, _body, _photos, groupId) => {
      attempted.push(groupId);
      return { success: true, postId: "confirmed" };
    },
  });

  // No fetch API exists in this fixture: any quota request would fail the run.
  for (let run = 0; run < 2; run++) {
    await queue.run({
      type: "START_UI_POSTING",
      groups: Array.from({ length: 12 }, (_, i) => ({
        id: String(100 + i),
        name: `Group ${i}`,
      })),
      posts: [
        {
          id: "post",
          body: "Post",
          html: "<p>Post</p>",
          images: [{ dataUrl: "original" }],
        },
      ],
      minimumDelaySeconds: 60,
      maximumDelaySeconds: 60,
    });
    assert.equal(statuses.at(-1).status, "done");
    assert.equal(statuses.at(-1).successCount, 12);
  }
  assert.equal(attempted.length, 24);
});

test("scheduled queues persist, arm an alarm, and can be cancelled", async () => {
  const { schedule, statuses } = queueFixture();
  const scheduledAt = Date.now() + 60_000;
  const response = await schedule.start({
    type: "START_UI_POSTING",
    startedAt: Date.now(),
    scheduledAt: new Date(scheduledAt).toISOString(),
    groups: [
      { id: "group", name: "Group", url: "https://facebook.com/groups/group" },
    ],
    posts: [
      { id: "post", body: "Post body", html: "<p>Post body</p>", images: [] },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 300,
  });

  assert.equal(response.ok, true);
  assert.equal(schedule.saved().scheduledAt, scheduledAt);
  assert.equal(schedule.hasAlarm(), true);
  assert.equal(statuses.at(-1).status, "scheduled");

  assert.equal((await schedule.stop()).ok, true);
  assert.equal(schedule.saved(), undefined);
  assert.equal(schedule.hasAlarm(), false);
  assert.equal(statuses.at(-1).status, "stopped");
});

test("scheduled queues reject dates that have already passed", async () => {
  const { schedule } = queueFixture();
  const response = await schedule.start({
    type: "START_UI_POSTING",
    startedAt: Date.now(),
    scheduledAt: new Date(Date.now() - 60_000).toISOString(),
    groups: [
      { id: "group", name: "Group", url: "https://facebook.com/groups/group" },
    ],
    posts: [
      { id: "post", body: "Post body", html: "<p>Post body</p>", images: [] },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 300,
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /future date and time/i);
  assert.equal(schedule.saved(), undefined);
  assert.equal(schedule.hasAlarm(), false);
});

test("the scheduled alarm launches the persisted posting queue", async () => {
  const { queue, schedule, statuses } = queueFixture();
  queue.configure({
    tab: async () => ({ id: 7 }),
    actor: async () => "123456",
    templates: async () => ({
      firstGroupPosted: true,
      firstPostResult: { success: true, postId: "confirmed" },
      uploadTemplate: {},
      postTemplate: {},
    }),
    upload: async () => ["photo"],
    post: async () => ({ success: true, postId: "confirmed" }),
  });
  const response = await schedule.start({
    type: "START_UI_POSTING",
    startedAt: Date.now(),
    scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    groups: [
      { id: "group", name: "Group", url: "https://facebook.com/groups/group" },
    ],
    posts: [
      {
        id: "post",
        body: "Post body",
        html: "<p>Post body</p>",
        images: [
          {
            name: "image.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      },
    ],
    minimumDelaySeconds: 60,
    maximumDelaySeconds: 300,
  });
  assert.equal(response.ok, true);

  schedule.saved().scheduledAt = Date.now() - 1;
  schedule.fire();
  for (
    let attempt = 0;
    attempt < 50 && statuses.at(-1).status !== "done";
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(statuses.at(-1).status, "done");
  assert.equal(schedule.saved(), undefined);
  assert.equal(schedule.hasAlarm(), false);
});
