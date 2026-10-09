type PostResult = {
  success: boolean;
  pendingApproval?: boolean;
  postUrl?: string;
};

export type CommentSetupPageInspection = {
  loaded: boolean;
  stable: boolean;
  dialogFound: boolean;
  commentFormFound: boolean;
  commentEditorFound: boolean;
  submitButtonFound: boolean;
  reason?: string;
};

export function inspectPostPermalinkLoadInPage(expectedPath: string): { loaded: boolean; documentId: number } {
  return {
    loaded: location.pathname.replace(/\/+$/, "") === expectedPath.replace(/\/+$/, "") &&
      document.readyState === "complete" && Boolean(document.body),
    documentId: performance.timeOrigin,
  };
}

// Runs in the Facebook tab; keep dependencies inside this function so Chrome
// can serialize it for executeScript.
export function inspectPublishedPostPageInPage(
  expectedPath: string,
  cleanup = false,
): CommentSetupPageInspection {
  const key = "__postikaCommentSetupDomObserver";
  type Observation = {
    path: string;
    target: HTMLElement;
    startedAt: number;
    lastChangedAt: number;
    observer: MutationObserver;
  };
  const scope = globalThis as typeof globalThis & { [key]?: Observation };
  const empty: CommentSetupPageInspection = {
    loaded: false, stable: false, dialogFound: false,
    commentFormFound: false,
    commentEditorFound: false, submitButtonFound: false,
  };
  if (cleanup) {
    scope[key]?.observer.disconnect();
    delete scope[key];
    return empty;
  }
  if (location.pathname.replace(/\/+$/, "") !== expectedPath.replace(/\/+$/, "") ||
      document.readyState !== "complete" || !document.body) {
    scope[key]?.observer.disconnect();
    delete scope[key];
    return empty;
  }
  const visible = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return !element.closest('[hidden], [aria-hidden="true"]') &&
      style.display !== "none" && style.visibility !== "hidden" &&
      element.getClientRects().length > 0;
  };
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
  const postDialogs = dialogs.filter((candidate) => visible(candidate) &&
    candidate.querySelector("h2") &&
    candidate.querySelector('[aria-posinset], [role="article"], [data-virtualized]'));
  const dialog = postDialogs.length === 1 ? postDialogs[0] : undefined;
  const target = dialog ?? document.body;
  let observation = scope[key];
  if (!observation || observation.path !== expectedPath || observation.target !== target) {
    observation?.observer.disconnect();
    const now = Date.now();
    observation = {
      path: expectedPath, target, startedAt: now, lastChangedAt: now,
      observer: new MutationObserver(() => {
        if (scope[key]) scope[key]!.lastChangedAt = Date.now();
      }),
    };
    scope[key] = observation;
    observation.observer.observe(target, {
      childList: true, subtree: true, characterData: true, attributes: true,
      // Ignore animated styles and classes; track content and accessibility
      // changes that affect whether the post and comment controls are ready.
      attributeFilter: ["aria-busy", "aria-hidden", "role", "contenteditable", "aria-label", "aria-disabled"],
    });
  }
  const now = Date.now();
  const busy = target.matches('[aria-busy="true"]') || Boolean(target.querySelector('[aria-busy="true"]'));
  const stable = !busy && now - observation.startedAt >= 3000 && now - observation.lastChangedAt >= 1500;
  const editors = Array.from(dialog?.querySelectorAll<HTMLElement>(
    '[role="textbox"][contenteditable="true"][data-lexical-editor="true"]',
  ) ?? []).filter((element) => visible(element) && !element.closest('[role="article"]'));
  const eligibleEditors = editors.filter((editor) => {
    const form = editor.closest("form");
    return form?.getAttribute("role") === "presentation" && dialog?.contains(form) &&
      editor.getAttribute("aria-disabled") !== "true";
  });
  let commentFormFound = false;
  let submitButtonFound = false;
  let reason = !dialog ? "Could not find the opened post." : "No comment box is available on this post.";
  for (const editor of editors) {
    const form = editor.closest<HTMLFormElement>("form");
    if (!form || form.getAttribute("role") !== "presentation" || !dialog?.contains(form)) {
      reason = "A comment box appeared, but Facebook has not made it ready for posting.";
      continue;
    }
    const buttons = form.querySelectorAll<HTMLElement>(
      '#focused-state-composer-submit [role="button"], #focused-state-composer-submit button',
    );
    const submit = buttons.length === 1 ? buttons[0] : undefined;
    submitButtonFound = Boolean(submit && visible(submit));
    if (editor.getAttribute("aria-disabled") === "true") {
      reason = "Facebook has disabled comments on this post.";
      continue;
    }
    // Facebook may use a layoutless form wrapper (e.g. display: contents).
    // A visible editor establishes form availability. Facebook may reveal or
    // mount the submit control only after focusing and typing in the editor.
    if (eligibleEditors.length !== 1) {
      reason = "More than one comment box is available. Postika could not identify the main comment form.";
      continue;
    }
    commentFormFound = true;
    break;
  }
  return {
    loaded: true, stable, dialogFound: Boolean(dialog),
    commentFormFound, commentEditorFound: editors.length > 0, submitButtonFound,
    reason: commentFormFound ? undefined : reason,
  };
}

export type CommentFormActionResult = {
  state: "unavailable" | "preparing" | "ready" | "submitted" | "failed";
  error?: string;
  textEntered?: boolean;
  editorEmpty?: boolean;
};

// Runs in the Facebook tab. Only the comment form inside the post dialog is
// eligible; never fall back to another textbox or a page-wide submit button.
export async function interactWithPostCommentFormInPage(
  expectedPath: string,
  comment: string,
  action: "prepare" | "check" | "submit" | "cleanup",
): Promise<CommentFormActionResult> {
  const key = "__postikaFirstCommentUiSubmission";
  const scope = globalThis as typeof globalThis & {
    [key]?: { path: string; comment: string; clicked: boolean };
  };
  if (action === "cleanup") {
    delete scope[key];
    return { state: "unavailable" };
  }
  const path = expectedPath.replace(/\/+$/, "");
  if (location.pathname.replace(/\/+$/, "") !== path || document.readyState !== "complete") {
    return { state: "unavailable" };
  }
  if (!comment.trim()) return { state: "failed", error: "Your first comment is blank. Add some text before posting." };
  if (scope[key]?.path === path && scope[key]?.clicked) return { state: "submitted" };
  const visible = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return !element.closest('[hidden], [aria-hidden="true"]') &&
      style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
  // Keep these structural checks aligned with the page inspection above;
  // each function must remain self-contained for Chrome executeScript.
  const postDialogs = dialogs.filter((dialog) => visible(dialog) &&
    dialog.querySelector("h2") &&
    dialog.querySelector('[aria-posinset], [role="article"], [data-virtualized]'));
  if (postDialogs.length !== 1) return { state: "unavailable" };
  const dialog = postDialogs[0];
  const editors = Array.from(dialog.querySelectorAll<HTMLElement>(
    '[role="textbox"][contenteditable="true"][data-lexical-editor="true"]',
  )).filter((candidate) => {
    if (!visible(candidate) || candidate.getAttribute("aria-disabled") === "true" ||
        candidate.closest('[role="article"]')) return false;
    const form = candidate.closest("form");
    return form?.getAttribute("role") === "presentation" && dialog.contains(form);
  });
  const editor = editors.length === 1 ? editors[0] : undefined;
  const form = editor?.closest("form");
  const findSubmit = () => {
    const buttons = form?.querySelectorAll<HTMLElement>(
      '#focused-state-composer-submit [role="button"], #focused-state-composer-submit button',
    );
    return buttons?.length === 1 ? buttons[0] : undefined;
  };
  if (!editor) return { state: "unavailable" };
  const normalized = (text: string) => text.replace(/\r\n/g, "\n").trim();
  const editorText = normalized(editor.innerText || editor.textContent || "");
  const expectedText = normalized(comment);
  if (action === "prepare") {
    if (editorText && editorText !== expectedText) {
      return { state: "failed", error: "The comment box already contains another draft. It was left unchanged." };
    }
    scope[key] = { path, comment, clicked: false };
    if (!editorText) {
      editor.focus();
      editor.click();
      // Focus/click activates Facebook's Lexical composer. Establish a caret
      // inside this editor before pasting or using native text insertion.
      const selection = document.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      const data = new DataTransfer();
      data.setData("text/plain", comment);
      data.setData("text/html", comment.replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>"));
      editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      // execCommand's return value alone does not establish that text was
      // entered. Fall back only if the actual editor is still empty.
      if (!normalized(editor.innerText || editor.textContent || "")) {
        editor.focus();
        document.execCommand("insertText", false, comment);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    const actualText = normalized(editor.innerText || editor.textContent || "");
    if (actualText === expectedText) {
      // Facebook can keep Post comment hidden until the populated composer
      // receives another click/focus after text insertion.
      editor.click();
      editor.focus();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const verifiedText = normalized(editor.innerText || editor.textContent || "");
    return { state: "preparing", textEntered: verifiedText === expectedText, editorEmpty: !verifiedText };
  }
  if (editorText !== expectedText) return { state: "preparing", textEntered: false, editorEmpty: !editorText };
  let submit = findSubmit();
  if (document.activeElement !== editor || !submit || !visible(submit)) {
    // Text may finish rendering after prepare returns, or Facebook may replace
    // the editor and lose focus. Activate the populated editor during readiness
    // checks too, then find the newly mounted submit control.
    editor.click();
    editor.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
    submit = findSubmit();
    const activatedText = normalized(editor.innerText || editor.textContent || "");
    if (activatedText !== expectedText) {
      return { state: "preparing", textEntered: false, editorEmpty: !activatedText };
    }
  }
  if (!submit || !visible(submit) || submit.getAttribute("aria-disabled") === "true" || submit.hasAttribute("disabled")) {
    return { state: "preparing", textEntered: true, editorEmpty: false };
  }
  if (action === "check") return { state: "ready", textEntered: true };
  // Mark before clicking so repeated inspections cannot submit it twice.
  scope[key] = { path, comment, clicked: true };
  submit.click();
  return { state: "submitted" };
}

export function groupPostPermalink(
  result: PostResult | undefined,
  groupId: string,
): string | undefined {
  if (!result?.success || !result.postUrl) return undefined;
  try {
    const url = new URL(result.postUrl);
    const match = url.pathname.match(/^\/groups\/([^/]+)\/(?:permalink|posts)\/\d+\/?$/);
    if (url.protocol !== "https:" || url.username || url.password ||
        !(url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com")) ||
        !match || match[1] !== groupId) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
