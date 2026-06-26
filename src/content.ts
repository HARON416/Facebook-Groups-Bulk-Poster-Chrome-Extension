import type {
  CreatePostRequest,
  CreatePostResponse,
  UiPostImage,
} from "./config";

const WRITE_SOMETHING_SPAN_SELECTOR = "span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6";
const POST_DIALOG_SELECTOR =
  "div.x1n2onr6.x1ja2u2z.x1afcbsf.x78zum5.xdt5ytf.x1a2a7pz.x6ikm8r.x10wlt62.x71s49j.x1jx94hy.xw5cjc7.x1dmpuos.x1vsv7so.xau1kf4.x104qc98.x15o3w11.xogydr4.x1vmz7ll.x1yyrj1m.x193iq5w";
const FACEBOOK_POST_LIMIT_PATTERN =
  /we\s+limit\s+how\s+often\s+you\s+can\s+post,\s+comment\s+or\s+do\s+other\s+things\s+in\s+a\s+given\s+amount\s+of\s+time\s+in\s+order\s+to\s+help\s+protect\s+the\s+community\s+from\s+spam\.\s+you\s+can\s+try\s+again\s+later/i;

type ContentRequest = CreatePostRequest;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findWriteSomethingButton(): HTMLElement | null {
  const spans = document.querySelectorAll(WRITE_SOMETHING_SPAN_SELECTOR);
  const writeSomethingSpan = Array.from(spans).find(
    (span) => span.textContent?.trim() === "Write something...",
  );

  if (!(writeSomethingSpan instanceof HTMLElement)) {
    return null;
  }

  return (
    writeSomethingSpan.closest<HTMLElement>(
      'div[role="button"][tabindex="0"], [role="button"], button, a',
    ) ?? writeSomethingSpan
  );
}

async function waitForDialog(): Promise<Element> {
  // Wait 10 seconds like the Go code does after clicking write something
  await sleep(10_000);

  const dialog = document.querySelector(POST_DIALOG_SELECTOR);
  if (dialog) return dialog;

  throw new Error("Post dialog did not appear in time.");
}

async function waitForElement<T extends Element>(
  root: Element | Document,
  selector: string,
  timeoutMs = 5_000,
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const el = root.querySelector<T>(selector);
    if (el) return el;
    await sleep(250);
  }

  throw new Error(`Element "${selector}" did not appear in time.`);
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

  let fileInput = dialog.querySelector<HTMLInputElement>(`input[type="file"]`);

  if (fileInput) {
    console.log("[Facebook Groups Bulk Poster] Dialog has file input", {
      accept: fileInput.accept,
      outerHTML: fileInput.outerHTML.slice(0, 300),
    });
  } else {
    fileInput = document.querySelector<HTMLInputElement>(`input[type="file"]`);

    if (fileInput) {
      console.log(
        "[Facebook Groups Bulk Poster] Page has file input (fallback)",
        {
          accept: fileInput.accept,
          outerHTML: fileInput.outerHTML.slice(0, 300),
          parentOuterHTML: fileInput.parentElement?.outerHTML?.slice(0, 300),
          grandparentOuterHTML:
            fileInput.parentElement?.parentElement?.outerHTML?.slice(0, 300),
          isInDialog: dialog.contains(fileInput),
          isVisible: fileInput.offsetParent !== null,
          isHidden:
            fileInput.style.display === "none" ||
            fileInput.style.visibility === "hidden",
        },
      );
    } else {
      console.warn(
        "[Facebook Groups Bulk Poster] Dialog does not have file input",
      );

      const photoVideoButton = dialog.querySelector<HTMLElement>(
        `div[aria-label="Photo/video"]`,
      );

      if (!photoVideoButton) {
        console.error(
          "[Facebook Groups Bulk Poster] Dialog does not have photo/video element",
        );
        throw new Error("Dialog does not have a photo/video element.");
      }

      console.log("[Facebook Groups Bulk Poster] Clicking Photo/video button");
      photoVideoButton.click();

      fileInput = await waitForElement<HTMLInputElement>(
        dialog,
        `input[type="file"]`,
      );

      console.log(
        "[Facebook Groups Bulk Poster] File input appeared after clicking Photo/video",
        {
          accept: fileInput.accept,
          outerHTML: fileInput.outerHTML.slice(0, 300),
        },
      );
    }
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

async function insertDescription(dialog: Element, text: string): Promise<void> {
  let textbox = dialog.querySelector<HTMLElement>(
    `div[role="textbox"][contenteditable="true"]`,
  );

  if (textbox) {
    console.log(
      "[Facebook Groups Bulk Poster] Dialog has textbox for description",
    );
  } else {
    console.warn(
      "[Facebook Groups Bulk Poster] Dialog does not have textbox, trying alternative selector",
    );
    textbox = document.querySelector<HTMLElement>(
      `div[aria-placeholder="Create a public post…"]`,
    );
  }

  if (!textbox) {
    console.error(
      "[Facebook Groups Bulk Poster] Could not find textbox for description",
    );
    throw new Error("Could not find textbox for description.");
  }

  console.log("[Facebook Groups Bulk Poster] Focusing textbox");
  textbox.focus();
  textbox.click();

  await sleep(500);

  console.log(
    "[Facebook Groups Bulk Poster] Pasting description via ClipboardEvent",
  );
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  dt.setData("text/html", formatTextAsHtmlWithLineBreaks(text));

  textbox.dispatchEvent(
    new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }),
  );

  await sleep(300);

  if (!textbox.textContent?.includes(text.slice(0, 10))) {
    console.warn(
      "[Facebook Groups Bulk Poster] Paste did not work, trying execCommand",
    );
    document.execCommand("insertText", false, text);
    await sleep(300);
  }

  console.log("[Facebook Groups Bulk Poster] Description inserted", {
    textboxContent: textbox.textContent?.slice(0, 100),
  });
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
  let postButton = dialog.querySelector<HTMLElement>(`div[aria-label="Post"]`);

  if (postButton) {
    console.log("[Facebook Groups Bulk Poster] Dialog has Post button");
  } else {
    console.warn(
      "[Facebook Groups Bulk Poster] Dialog does not have Post button, trying page level selector",
    );
    postButton = document.querySelector<HTMLElement>(`div[aria-label="Post"]`);
  }

  if (!postButton) {
    throw new Error("Could not find Post button.");
  }

  postButton.click();
  console.log("[Facebook Groups Bulk Poster] Post button clicked");

  // Wait for dialog to disappear (post submitted) — up to 120 * 2s = 4 minutes
  for (let i = 0; i < 120; i += 1) {
    await sleep(2_000);

    const dialogStillVisible =
      document.contains(dialog) &&
      (dialog as HTMLElement).offsetParent !== null;

    if (dialogStillVisible) {
      const dialogText = dialog.textContent ?? "";

      if (FACEBOOK_POST_LIMIT_PATTERN.test(dialogText)) {
        console.warn(
          "[Facebook Groups Bulk Poster] Hit posting limit. Please wait and try again later.",
        );
        throw new Error("Hit posting limit. Please wait and try again later.");
      }

      if (
        dialogText.includes(
          "You have been temporarily blocked from performing this action.",
        )
      ) {
        console.warn(
          "[Facebook Groups Bulk Poster] Temporarily blocked from performing this action.",
        );
        throw new Error("Temporarily blocked from performing this action.");
      }

      console.log("[Facebook Groups Bulk Poster] Posting...");
      continue;
    }

    console.log("[Facebook Groups Bulk Poster] Ad posted successfully");
    return;
  }

  throw new Error("Post did not complete in time.");
}

chrome.runtime.onMessage.addListener(
  (
    request: ContentRequest,
    _sender,
    sendResponse: (response: CreatePostResponse) => void,
  ) => {
    if (request.type !== "CREATE_POST") {
      return false;
    }

    const spans = document.querySelectorAll(WRITE_SOMETHING_SPAN_SELECTOR);
    const button = findWriteSomethingButton();

    button?.scrollIntoView({ block: "center", inline: "center" });
    button?.focus();
    button?.click();

    console.log("[Facebook Groups Bulk Poster] Write something click", {
      clicked: Boolean(button),
      spanCount: spans.length,
    });

    if (!button) {
      sendResponse({
        ok: false,
        composerFound: false,
        composerClicked: false,
        spanCount: spans.length,
        error: "Write something button not found.",
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
          await sleep(1_000);
        }

        if (request.body) {
          await insertDescription(dialog, request.body);
          await sleep(500);
        }

        await clickPostButton(dialog);

        sendResponse({
          ok: true,
          composerFound: true,
          composerClicked: true,
          spanCount: spans.length,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          composerFound: true,
          composerClicked: true,
          spanCount: spans.length,
          error:
            error instanceof Error ? error.message : "Dialog did not appear.",
        });
      });

    return true;
  },
);
