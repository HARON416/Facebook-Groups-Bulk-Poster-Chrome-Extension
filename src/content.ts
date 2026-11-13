import {
  findGroupComposerButton,
  findGroupComposerDialog,
  findGroupComposerEditor,
  findGroupComposerMediaInput,
  findGroupComposerPostButton,
} from "./group-composer";
import type {
  CreatePostRequest,
  CreatePostResponse,
  UiPostImage,
} from "./config";

type ContentRequest =
  | CreatePostRequest
  | {
      type: "PAUSE_CREATE_POST" | "RESUME_CREATE_POST" | "STOP_CREATE_POST";
    };
type ContentResponse = CreatePostResponse | { ok: boolean };

const CONTENT_SCRIPT_MARKER = "__facebookGroupsBulkPosterContentScriptLoaded";
const contentScriptGlobal = globalThis as typeof globalThis &
  Record<string, unknown>;
const isFirstContentScriptLoad =
  contentScriptGlobal[CONTENT_SCRIPT_MARKER] !== true;
contentScriptGlobal[CONTENT_SCRIPT_MARKER] = true;
let contentPostingPaused = false;
let contentPostingStopped = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfContentPostingStopped(): void {
  if (contentPostingStopped) {
    throw new Error("Posting stopped by user.");
  }
}

async function waitWhileContentPostingPaused(): Promise<void> {
  while (contentPostingPaused && !contentPostingStopped) {
    await sleep(100);
  }
  throwIfContentPostingStopped();
}

async function sleepWithPostingControls(ms: number): Promise<void> {
  let remaining = ms;
  while (remaining > 0) {
    await waitWhileContentPostingPaused();
    const step = Math.min(100, remaining);
    await sleep(step);
    remaining -= step;
  }
  throwIfContentPostingStopped();
}

async function waitForDialog(): Promise<Element> {
  while (true) {
    await waitWhileContentPostingPaused();
    const dialog = findGroupComposerDialog();
    if (dialog) return dialog;
    await sleepWithPostingControls(250);
  }
}

async function uiPostImageToFile(image: UiPostImage): Promise<File> {
  const res = await fetch(image.dataUrl);
  const blob = await res.blob();
  return new File([blob], image.name, { type: image.type });
}

async function insertImages(dialog: Element, files: File[]): Promise<void> {
  const dt = new DataTransfer();
  for (const file of files) {
    dt.items.add(file);
  }

  let fileInput = findGroupComposerMediaInput(dialog);
  while (!fileInput) {
    await sleepWithPostingControls(250);
    if (!dialog.isConnected)
      throw new Error("The post composer closed before images could be added.");
    fileInput = findGroupComposerMediaInput(dialog);
  }

  const dropTarget = fileInput.closest("div") ?? fileInput;

  dropTarget.dispatchEvent(
    new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    }),
  );
  dropTarget.dispatchEvent(
    new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    }),
  );
  dropTarget.dispatchEvent(
    new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    }),
  );

  console.log("[Facebook Groups Bulk Poster] Images inserted", {
    count: files.length,
  });
}

async function insertDescription(
  dialog: Element,
  text: string,
  html: string,
): Promise<void> {
  const textbox = findGroupComposerEditor(dialog);

  if (!textbox) {
    console.error(
      "[Facebook Groups Bulk Poster] Could not find textbox for description",
    );
    throw new Error("Could not find textbox for description.");
  }

  console.log("[Facebook Groups Bulk Poster] Focusing textbox");
  textbox.focus();
  textbox.click();

  await sleepWithPostingControls(500);

  console.log(
    "[Facebook Groups Bulk Poster] Pasting description via ClipboardEvent",
  );
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  dt.setData(
    "text/html",
    sanitizePostHtml(html || formatTextAsHtmlWithLineBreaks(text)),
  );

  textbox.dispatchEvent(
    new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }),
  );

  await sleepWithPostingControls(300);

  if (!textbox.textContent?.includes(text.slice(0, 10))) {
    console.log(
      "[Facebook Groups Bulk Poster] Paste did not work, trying execCommand",
    );
    document.execCommand("insertText", false, text);
    await sleepWithPostingControls(300);
  }

  console.log("[Facebook Groups Bulk Poster] Description inserted", {
    textboxContent: textbox.textContent?.slice(0, 100),
  });
}

function sanitizePostHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const allowedTags = new Set([
    "B",
    "BLOCKQUOTE",
    "BR",
    "EM",
    "H1",
    "H2",
    "I",
    "LI",
    "OL",
    "P",
    "STRONG",
    "UL",
  ]);
  const output = document.createElement("div");
  const copyNode = (source: Node, target: Node) => {
    if (source.nodeType === Node.TEXT_NODE) {
      const lines = (source.textContent ?? "").split(/\r\n?|\n/);
      lines.forEach((line, index) => {
        if (line) target.appendChild(document.createTextNode(line));
        if (index < lines.length - 1) {
          target.appendChild(document.createElement("br"));
        }
      });
      return;
    }
    if (!(source instanceof HTMLElement)) return;
    const tag = source.tagName;
    const destination = allowedTags.has(tag)
      ? document.createElement(tag === "EM" ? "i" : tag.toLowerCase())
      : target;
    if (destination !== target) target.appendChild(destination);
    source.childNodes.forEach((child) => copyNode(child, destination));
  };
  parsed.body.childNodes.forEach((node) => copyNode(node, output));
  return output.innerHTML;
}

function formatTextAsHtmlWithLineBreaks(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function clickPostButton(dialog: Element): Promise<void> {
  let postButton: HTMLElement | null = null;
  while (true) {
    await waitWhileContentPostingPaused();
    if (!dialog.isConnected)
      throw new Error(
        "The post composer closed before the post could be submitted.",
      );
    postButton = findGroupComposerPostButton(dialog);
    if (
      postButton &&
      postButton.getAttribute("aria-disabled") !== "true" &&
      !postButton.hasAttribute("disabled")
    )
      break;
    await sleepWithPostingControls(250);
  }

  postButton.click();
  console.log("[Facebook Groups Bulk Poster] Post button clicked");
}

if (isFirstContentScriptLoad)
  chrome.runtime.onMessage.addListener(
    (
      request: ContentRequest,
      _sender,
      sendResponse: (response: ContentResponse) => void,
    ) => {
      if (request.type === "PAUSE_CREATE_POST") {
        contentPostingPaused = true;
        sendResponse({ ok: true });
        return false;
      }

      if (request.type === "RESUME_CREATE_POST") {
        contentPostingPaused = false;
        sendResponse({ ok: true });
        return false;
      }

      if (request.type === "STOP_CREATE_POST") {
        contentPostingStopped = true;
        contentPostingPaused = false;
        sendResponse({ ok: true });
        return false;
      }

      if (request.type !== "CREATE_POST") {
        return false;
      }

      contentPostingPaused = false;
      contentPostingStopped = false;

      const spanCount = document.querySelectorAll(
        "span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6",
      ).length;
      const button = findGroupComposerButton();

      button?.scrollIntoView({ block: "center", inline: "center" });
      button?.focus();
      button?.click();

      console.log("[Facebook Groups Bulk Poster] Group composer click", {
        clicked: Boolean(button),
        spanCount,
      });

      if (!button) {
        sendResponse({
          ok: false,
          composerFound: false,
          composerClicked: false,
          spanCount,
          error: "Group composer button not found.",
        });
        return true;
      }

      waitForDialog()
        .then(async (dialog) => {
          console.log("[Facebook Groups Bulk Poster] Dialog appeared", {
            dialog,
          });

          if (request.images?.length) {
            const files = await Promise.all(
              request.images.map(uiPostImageToFile),
            );
            await insertImages(dialog, files);
            await sleepWithPostingControls(1_000);
          }

          if (request.body) {
            await insertDescription(dialog, request.body, request.html);
            await sleepWithPostingControls(500);
          }

          await clickPostButton(dialog);

          sendResponse({
            ok: true,
            composerFound: true,
            composerClicked: true,
            spanCount,
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            composerFound: true,
            composerClicked: true,
            spanCount,
            error:
              error instanceof Error ? error.message : "Dialog did not appear.",
          });
        });

      return true;
    },
  );
