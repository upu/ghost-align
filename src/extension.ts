import * as vscode from "vscode";
import { TS_JS_LANGUAGES, findOperatorTargets } from "./finders";
import {
  DEFAULT_TAB_SIZE,
  LineSource,
  computePaddings,
  computeSliceBounds,
  findAlignmentGroups,
} from "./paddings";
import { computeJsdocParamPaddings, parseJsdocParamLine } from "./jsdoc";
import {
  computeMarkdownTablePaddings,
  computeFenceStateBefore,
  findPipePositions,
} from "./markdown";
import { computeCsvPaddings } from "./csv";

// Decoration type: the base style is empty; per-instance renderOptions inject
// the padding. Created in `activate` and registered for disposal there.
let alignDecorationType: vscode.TextEditorDecorationType;

// Fallbacks used when the user clears a setting to an empty string in the UI.
// Keep these in sync with the defaults in package.json.
// NBSP (U+00A0) instead of ASCII space: VS Code collapses consecutive ASCII
// spaces in decoration `contentText`, so plain " ".repeat(N) renders as a
// single space and breaks alignment. NBSP renders identically in monospace
// fonts but is not collapsed.
export const DEFAULT_GHOST_CHAR = " ";
export const DEFAULT_GHOST_COLOR = "rgba(128, 128, 128, 0.25)";

// globalState key under which the toggle state is persisted across reloads.
const ENABLED_STATE_KEY = "enabled";

let enabled = true;

// Status bar item reflecting the current ON/OFF state; clicking it toggles.
let statusBarItem: vscode.StatusBarItem;

/**
 * Resolve the toggle state from persisted storage. Defaults to enabled so
 * existing users (no stored value) keep the feature on.
 */
export function resolveInitialEnabled(
  state: { get<T>(key: string, defaultValue: T): T }
): boolean {
  return state.get<boolean>(ENABLED_STATE_KEY, true);
}

/** Label shown in the status bar for the given toggle state. */
export function statusBarText(isEnabled: boolean): string {
  return `Ghost Align: ${isEnabled ? "ON" : "OFF"}`;
}

export function activate(context: vscode.ExtensionContext) {
  alignDecorationType = vscode.window.createTextEditorDecorationType({});
  context.subscriptions.push(alignDecorationType);

  enabled = resolveInitialEnabled(context.globalState);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "ghostAlign.toggle";
  statusBarItem.tooltip = "Toggle Ghost Align";
  context.subscriptions.push(statusBarItem);

  // Debounce document-edit updates so rapid typing in large files does not
  // trigger a full re-scan on every keystroke.
  const debouncedUpdate = debounce(updateDecorations, 80);
  context.subscriptions.push({ dispose: () => debouncedUpdate.cancel() });

  // Toggle command
  context.subscriptions.push(
    vscode.commands.registerCommand("ghostAlign.toggle", () => {
      enabled = !enabled;
      void context.globalState.update(ENABLED_STATE_KEY, enabled);
      vscode.window.showInformationMessage(statusBarText(enabled));
      if (enabled) {
        updateDecorations();
      } else {
        clearDecorations();
      }
      updateStatusBar();
    })
  );

  // Update on editor / document / configuration changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => updateDecorations()),
    vscode.window.onDidChangeVisibleTextEditors(() => updateDecorations()),
    // Large files are decorated per visible range, so scrolling must
    // recompute; small files are fully decorated and can ignore scrolling.
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.lineCount >= LARGE_FILE_LINE_THRESHOLD) {
        debouncedUpdate();
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const shown = vscode.window.visibleTextEditors.some(
        (editor) => editor.document === e.document
      );
      if (shown) {
        debouncedUpdate();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ghostAlign")) {
        updateDecorations();
        updateStatusBar();
      }
    })
  );

  updateDecorations();
  updateStatusBar();
}

export function deactivate() {
  clearDecorations();
}

function clearDecorations() {
  for (const editor of vscode.window.visibleTextEditors) {
    editor.setDecorations(alignDecorationType, []);
  }
}

function updateStatusBar() {
  if (!statusBarItem) {
    return;
  }
  const config = vscode.workspace.getConfiguration("ghostAlign");
  if (!config.get<boolean>("showStatusBar", false)) {
    statusBarItem.hide();
    return;
  }
  statusBarItem.text = statusBarText(enabled);
  statusBarItem.show();
}

/**
 * Wrap `fn` so that rapid successive calls collapse into a single deferred
 * call, fired `delayMs` after the last invocation. The returned function
 * exposes `cancel()` to drop any pending call (used on deactivate so a timer
 * cannot fire against a disposed decoration type).
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number
): { (...args: A): void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delayMs);
  };
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return wrapped;
}

// ── Config resolution ─────────────────────────────────────────────────────

// Default per-language operator overrides. Keep in sync with package.json
// (verified by a test that deep-compares this against the package.json default).
export const DEFAULT_OPERATORS_BY_LANGUAGE: Record<string, string[]> = {
  json: [":"],
  jsonc: [":"],
  yaml: [":"],
  typescript: [":", "="],
  typescriptreact: [":", "="],
  javascript: [":", "="],
  javascriptreact: [":", "="],
  dotenv: ["="],
  properties: ["="],
  toml: ["="],
  ini: ["="],
  python: ["="],
  shellscript: ["="],
  ruby: ["=", "=>"],
  makefile: ["="],
  css: [":"],
  scss: [":"],
  less: [":"],
  php: ["=", "=>"],
  rust: ["=", "=>"],
  go: ["="],
  lua: ["="],
  c: ["="],
  cpp: ["="],
  csharp: ["="],
  java: ["="],
  swift: ["="],
  kotlin: ["="],
  dart: ["="],
  zig: ["="],
};

/**
 * Resolve the ghost-align rendering settings (character + color).
 * An empty string from the settings UI is treated as "use default" so a
 * cleared field cannot silently break the feature (empty char → no padding,
 * empty color → invisible ghost).
 */
export function resolveGhostSettings(
  config: { get<T>(key: string, defaultValue: T): T }
): { ghostChar: string; ghostColor: string } {
  return {
    ghostChar: config.get<string>("ghostCharacter", DEFAULT_GHOST_CHAR) || DEFAULT_GHOST_CHAR,
    ghostColor: config.get<string>("ghostColor", DEFAULT_GHOST_COLOR) || DEFAULT_GHOST_COLOR,
  };
}

/**
 * Resolve the operator list for a given language. The per-language map takes
 * precedence; if the language is not listed, fall back to the global
 * `operators` setting (default `["="]`).
 */
export function resolveOperatorsForLanguage(
  config: { get<T>(key: string, defaultValue: T): T },
  languageId: string
): string[] {
  const byLang = config.get<Record<string, string[]>>(
    "operatorsByLanguage",
    DEFAULT_OPERATORS_BY_LANGUAGE
  );
  if (byLang && Object.prototype.hasOwnProperty.call(byLang, languageId)) {
    return byLang[languageId];
  }
  return config.get<string[]>("operators", ["="]);
}

/**
 * Whether decoration should be fully disabled for `languageId` via
 * `ghostAlign.disabledLanguages`. Takes priority over `operatorsByLanguage`.
 */
export function isLanguageDisabled(
  config: { get<T>(key: string, defaultValue: T): T },
  languageId: string
): boolean {
  const disabledLanguages = config.get<string[]>("disabledLanguages", []);
  return (
    Array.isArray(disabledLanguages) && disabledLanguages.includes(languageId)
  );
}

/** Language IDs that use the Markdown table alignment path instead of operators. */
const MARKDOWN_LANGUAGES = new Set(["markdown"]);

/** Delimiter used by each CSV-family language ID. */
const CSV_DELIMITERS = new Map<string, string>([
  ["csv", ","],
  ["tsv", "\t"],
]);

/** Resolve the effective tab width of an editor, falling back to the default. */
function resolveTabSize(editor: vscode.TextEditor): number {
  const t = editor.options.tabSize;
  if (typeof t === "number" && t > 0) {
    return t;
  }
  const parsed = typeof t === "string" ? parseInt(t, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TAB_SIZE;
}

// ── Visible-range mode for large files ────────────────────────────────────

/** Files with at least this many lines are decorated per visible range. */
const LARGE_FILE_LINE_THRESHOLD = 10000;

/** Apply ghost-align decorations to a single editor. */
export function decorateEditor(
  editor: vscode.TextEditor,
  config: vscode.WorkspaceConfiguration,
  ghostChar: string,
  ghostColor: string
) {
  const document = editor.document;
  const languageId = document.languageId;

  if (isLanguageDisabled(config, languageId)) {
    editor.setDecorations(alignDecorationType, []);
    return;
  }

  const tabSize = resolveTabSize(editor);
  const lineCount = document.lineCount;

  const csvDelimiter = CSV_DELIMITERS.get(languageId);
  const isMarkdown = MARKDOWN_LANGUAGES.has(languageId);
  const isOperatorPath = !isMarkdown && csvDelimiter === undefined;
  const operators = isOperatorPath
    ? resolveOperatorsForLanguage(config, languageId)
    : [];
  const alignJsdoc =
    isOperatorPath &&
    TS_JS_LANGUAGES.has(languageId) &&
    config.get<boolean>("alignJsdocParams", true);

  // Large files are computed per visible range instead of whole-file, and
  // re-decorated on scroll. The slice is expanded to group boundaries so a
  // group straddling the visible edge still aligns against all its members.
  // Known limit of the slice view: a CSV/TSV table aligns to the widest cell
  // within the slice (the whole file is one table, so no boundary to expand
  // to). Markdown fence state opened above the slice is tracked separately
  // below via computeFenceStateBefore.
  let sliceStart = 0;
  let sliceEnd = lineCount - 1;
  if (lineCount >= LARGE_FILE_LINE_THRESHOLD && editor.visibleRanges.length > 0) {
    const visibleStart = Math.min(
      ...editor.visibleRanges.map((r) => r.start.line)
    );
    const visibleEnd = Math.max(...editor.visibleRanges.map((r) => r.end.line));
    let isGroupLine: (line: number) => boolean;
    if (isMarkdown) {
      isGroupLine = (i) => findPipePositions(document.lineAt(i).text).length > 0;
    } else if (csvDelimiter !== undefined) {
      isGroupLine = () => false;
    } else {
      isGroupLine = (i) => {
        const text = document.lineAt(i).text;
        return (
          findOperatorTargets(text, operators, languageId).length > 0 ||
          (alignJsdoc && parseJsdocParamLine(text) !== null)
        );
      };
    }
    [sliceStart, sliceEnd] = computeSliceBounds(
      lineCount,
      visibleStart,
      visibleEnd,
      isGroupLine
    );
  }

  const sliceLines = (): string[] => {
    const lines: string[] = [];
    for (let i = sliceStart; i <= sliceEnd; i++) {
      lines.push(document.lineAt(i).text);
    }
    return lines;
  };

  let placements: { lineIndex: number; character: number; padding: number }[];
  if (isMarkdown) {
    // computeFencedLines(lines) only tracks fence open/close within `lines`, so a
    // fence opened above sliceStart would otherwise look unfenced at the top of the
    // slice. The pre-scan is a cheap trim + regex per line (no pipe/table parsing),
    // so it's fine to run over every line above the slice even for a huge file.
    const fenceState =
      sliceStart > 0
        ? computeFenceStateBefore(sliceStart, (i) => document.lineAt(i).text)
        : undefined;
    placements = computeMarkdownTablePaddings(sliceLines(), tabSize, fenceState);
  } else if (csvDelimiter !== undefined) {
    placements = computeCsvPaddings(sliceLines(), csvDelimiter, tabSize);
  } else {
    const rawMaxPadding = config.get<number>("maxPadding", 0);
    const maxPadding =
      typeof rawMaxPadding === "number" &&
      Number.isFinite(rawMaxPadding) &&
      rawMaxPadding > 0
        ? Math.floor(rawMaxPadding)
        : 0;
    const source: LineSource =
      sliceStart === 0 && sliceEnd === lineCount - 1
        ? document
        : {
            lineCount: sliceEnd - sliceStart + 1,
            lineAt: (i: number) => document.lineAt(sliceStart + i),
          };
    const groups = findAlignmentGroups(source, operators, languageId, tabSize);
    placements = computePaddings(groups, maxPadding);
    if (alignJsdoc) {
      placements = placements.concat(
        computeJsdocParamPaddings(sliceLines(), tabSize, maxPadding)
      );
    }
  }
  if (sliceStart > 0) {
    placements = placements.map((p) => ({
      ...p,
      lineIndex: p.lineIndex + sliceStart,
    }));
  }

  const decorations: vscode.DecorationOptions[] = placements.map(
    (p) => {
      const pos = new vscode.Position(p.lineIndex, p.character);
      return {
        range: new vscode.Range(pos, pos),
        renderOptions: {
          before: {
            contentText: ghostChar.repeat(p.padding),
            color: ghostColor,
            backgroundColor: ghostColor,
          },
        },
      };
    }
  );

  editor.setDecorations(alignDecorationType, decorations);
}

// Allowlist of URI schemes that receive alignment decorations. Editors like
// the output panel (`output`), debug console, or search editor also appear in
// visibleTextEditors; an allowlist keeps unknown non-file schemes out, which
// an exclusion list would not.
const ALIGNABLE_SCHEMES = new Set([
  "file",
  "untitled",
  "vscode-remote",
  "vscode-vfs",
]);

/** Whether documents with this URI scheme should be aligned. */
export function isAlignableScheme(scheme: string): boolean {
  return ALIGNABLE_SCHEMES.has(scheme);
}

function updateDecorations() {
  if (!enabled) {
    clearDecorations();
    return;
  }
  const config = vscode.workspace.getConfiguration("ghostAlign");

  const { ghostChar, ghostColor } = resolveGhostSettings(config);
  for (const editor of vscode.window.visibleTextEditors) {
    if (!isAlignableScheme(editor.document.uri.scheme)) {
      editor.setDecorations(alignDecorationType, []);
      continue;
    }
    decorateEditor(editor, config, ghostChar, ghostColor);
  }
}
