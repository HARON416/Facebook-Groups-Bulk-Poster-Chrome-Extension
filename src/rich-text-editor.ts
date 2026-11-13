import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  $isListNode,
  REMOVE_LIST_COMMAND,
  registerList,
} from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
  registerRichText,
} from "@lexical/rich-text";
import {
  $getRoot,
  $getSelection,
  $createLineBreakNode,
  $createTextNode,
  $isElementNode,
  $isRangeSelection,
  $createParagraphNode,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  type ElementNode,
  FORMAT_TEXT_COMMAND,
  type RangeSelection,
  $setSelection,
  $setTextFormat,
  type TextFormatType,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";

export type PostContent = {
  body: string;
  html: string;
};

const formatCommands: Partial<Record<string, { format: TextFormatType }>> = {
  bold: { format: "bold" },
  italic: { format: "italic" },
};

export function initializePostEditor(onChange: () => void) {
  const root = document.querySelector<HTMLElement>("#post-body-input");
  const toolbar = document.querySelector<HTMLElement>(".rich-text-toolbar");
  if (!root || !toolbar) {
    throw new Error("The post editor could not be initialized.");
  }

  const editor = createEditor({
    namespace: "postika-post-editor",
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
    theme: {
      text: {
        italic: "post-editor-italic",
      },
    },
    onError(error) {
      throw error;
    },
  });
  editor.setRootElement(root);
  root.dataset.empty = "true";
  registerRichText(editor);
  registerList(editor);

  const undoButton = toolbar.querySelector<HTMLButtonElement>(
    '[data-history="undo"]',
  );
  const redoButton = toolbar.querySelector<HTMLButtonElement>(
    '[data-history="redo"]',
  );
  if (!undoButton || !redoButton) {
    throw new Error(
      "The post editor history controls could not be initialized.",
    );
  }
  const historyState = createEmptyHistoryState();
  registerHistory(editor, historyState, 300);
  editor.registerCommand(
    CAN_UNDO_COMMAND,
    (canUndo) => {
      undoButton.disabled = !canUndo;
      return false;
    },
    COMMAND_PRIORITY_LOW,
  );
  editor.registerCommand(
    CAN_REDO_COMMAND,
    (canRedo) => {
      redoButton.disabled = !canRedo;
      return false;
    },
    COMMAND_PRIORITY_LOW,
  );

  for (const [button, command] of [
    [undoButton, UNDO_COMMAND],
    [redoButton, REDO_COMMAND],
  ] as const) {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      editor.dispatchCommand(command, undefined);
      root.focus();
    });
  }

  editor.registerCommand(
    FORMAT_TEXT_COMMAND,
    (format) => {
      if (format !== "bold" && format !== "italic") return true;
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      $setTextFormat(selection, { [format]: !selection.hasFormat(format) });
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
  let savedRangeSelection: RangeSelection | null = null;
  editor.registerUpdateListener(({ editorState }) => {
    const { body, selection, activeFormats } = editorState.read(
      () => {
        const selection = $getSelection();
        const topLevel = $isRangeSelection(selection)
          ? selection.getNodes()[0]?.getTopLevelElement()
          : undefined;
        return {
          body: getPostTextContent(),
          activeFormats: {
            bold: $isRangeSelection(selection) && selection.hasFormat("bold"),
            italic:
              $isRangeSelection(selection) && selection.hasFormat("italic"),
            h1: $isHeadingNode(topLevel) && topLevel.getTag() === "h1",
            h2: $isHeadingNode(topLevel) && topLevel.getTag() === "h2",
            quote: $isQuoteNode(topLevel),
            "unordered-list":
              $isListNode(topLevel) && topLevel.getListType() === "bullet",
            "ordered-list":
              $isListNode(topLevel) && topLevel.getListType() === "number",
          },
          selection: $isRangeSelection(selection) ? selection.clone() : null,
        };
      },
      { editor },
    );
    if (selection) savedRangeSelection = selection;
    root.dataset.empty = String(!body.trim());
    for (const [format, active] of Object.entries(activeFormats)) {
      toolbar
        .querySelector<HTMLButtonElement>(`button[data-format="${format}"]`)
        ?.setAttribute("aria-pressed", String(active));
    }
    onChange();
  });

  function getToolbarSelection(): RangeSelection | null {
    let selection = $getSelection();
    if (!$isRangeSelection(selection) && savedRangeSelection) {
      $setSelection(savedRangeSelection.clone());
      selection = $getSelection();
    }
    return $isRangeSelection(selection) ? selection : null;
  }

  function insertParagraphAfter(
    block: ElementNode | undefined,
  ): RangeSelection {
    const paragraph = $createParagraphNode();
    if (block?.getParent()) block.insertAfter(paragraph);
    else $getRoot().append(paragraph);
    paragraph.selectStart();
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      throw new Error(
        "The post editor could not position the cursor after the current block.",
      );
    }
    return selection;
  }

  toolbar
    .querySelectorAll<HTMLButtonElement>("button[data-format]")
    .forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const format = button.dataset.format;
        const textFormat = formatCommands[format ?? ""];
        editor.update(() => {
          let selection = getToolbarSelection();
          if (!selection) return;
          const topLevelNode = selection.getNodes()[0]?.getTopLevelElement();
          const topLevel = $isElementNode(topLevelNode)
            ? topLevelNode
            : undefined;

          if (textFormat) {
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, textFormat.format);
            return;
          }

          if (format === "unordered-list" || format === "ordered-list") {
            const listType = format === "unordered-list" ? "bullet" : "number";
            const isActive =
              $isListNode(topLevel) && topLevel.getListType() === listType;
            const insertListCommand =
              format === "unordered-list"
                ? INSERT_UNORDERED_LIST_COMMAND
                : INSERT_ORDERED_LIST_COMMAND;
            if (selection.isCollapsed() && topLevel?.getTextContent()) {
              selection = insertParagraphAfter(topLevel);
              if (isActive) return;
            }
            editor.dispatchCommand(
              isActive ? REMOVE_LIST_COMMAND : insertListCommand,
              undefined,
            );
          } else if (format === "h1" || format === "h2") {
            const isSameHeading =
              $isHeadingNode(topLevel) && topLevel.getTag() === format;
            if (selection.isCollapsed() && topLevel?.getTextContent()) {
              selection = insertParagraphAfter(topLevel);
              if (isSameHeading) return;
            }
            $setBlocksType<ElementNode>(selection, () =>
              isSameHeading
                ? $createParagraphNode()
                : $createHeadingNode(format),
            );
          } else if (format === "quote") {
            const isQuote = $isQuoteNode(topLevel);
            if (selection.isCollapsed() && topLevel?.getTextContent()) {
              selection = insertParagraphAfter(topLevel);
              if (isQuote) return;
            }
            $setBlocksType<ElementNode>(selection, () =>
              isQuote ? $createParagraphNode() : $createQuoteNode(),
            );
          }
        });
        root.focus();
      });
    });

  root.addEventListener(
    "paste",
    (event) => {
      if (!(event instanceof ClipboardEvent) || !event.clipboardData) return;
      if (
        event.clipboardData.getData("text/html") ||
        event.clipboardData.getData("application/x-lexical-editor")
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const text = event.clipboardData.getData("text/plain");
      if (text) {
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const nodes = text
            .replace(/\r\n?/g, "\n")
            .split("\n")
            .flatMap((line, index) => [
              ...(index > 0 ? [$createLineBreakNode()] : []),
              ...(line
                ? [
                    $createTextNode(line)
                      .setFormat(selection.format)
                      .setStyle(selection.style),
                  ]
                : []),
            ]);
          if (nodes.length > 0) selection.insertNodes(nodes);
        });
      }
    },
    true,
  );

  return {
    getContent(): PostContent {
      return editor.read(() => ({
        body: getPostTextContent(),
        html: $generateHtmlFromNodes(editor),
      }));
    },
    setContent(html: string): void {
      const document = new DOMParser().parseFromString(html, "text/html");
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const nodes = $generateNodesFromDOM(editor, document);
        if (nodes.length > 0) {
          root.append(...nodes);
        } else {
          root.append($createParagraphNode());
        }
      });
    },
  };
}

function getPostTextContent(): string {
  return $getRoot()
    .getChildren()
    .map((node) => node.getTextContent())
    .join("\n");
}
