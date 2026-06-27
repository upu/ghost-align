import * as vscode from "vscode";

// Decoration type: the base style is empty; per-instance renderOptions inject
// the padding. Created in `activate` and registered for disposal there.
let alignDecorationType: vscode.TextEditorDecorationType;

// Fallbacks used when the user clears a setting to an empty string in the UI.
// Keep these in sync with the defaults in package.json.
// NBSP (U+00A0) instead of ASCII space: VS Code collapses consecutive ASCII
// spaces in decoration `contentText`, so plain " ".repeat(N) renders as a
// single space and breaks alignment. NBSP renders identically in monospace
// fonts but is not collapsed.
const DEFAULT_GHOST_CHAR = " ";
const DEFAULT_GHOST_COLOR = "rgba(128, 128, 128, 0.25)";

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
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) {
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

// ── Core logic ──────────────────────────────────────────────────────────

// Default per-language operator overrides. Keep in sync with package.json.
const DEFAULT_OPERATORS_BY_LANGUAGE: Record<string, string[]> = {
  json: [":"],
  jsonc: [":"],
  yaml: [":"],
  dotenv: ["="],
  properties: ["="],
  toml: ["="],
  css: [":"],
  scss: [":"],
  less: [":"],
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
 * Index of the first `:` outside any double-quoted string. Walks the line
 * character by character, tracking string state and `\` escapes (JSON rules).
 */
function findColonOutsideString(lineText: string): number {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === ":") {
      return i;
    }
  }
  return -1;
}

/**
 * Index of the first assignment `=` on a line, excluding:
 *   - any `=` inside `(...)` or `[...]` (e.g. `for (let i = 0; ...)` or
 *     default arguments `function f(a = 1)`)
 *   - any `=` inside `"..."` or `'...'` strings
 *   - any `=` inside `//` line comments or single-line `/* ... *​/` blocks
 *   - the comparison/arrow operators `==`, `!=`, `<=`, `>=`, `=>`
 *
 * Block comments spanning multiple lines are not tracked: this function sees
 * one line at a time, so a `/*` without a matching `*​/` is treated as a
 * comment running to the end of the line.
 */
function findAssignmentEquals(lineText: string): number {
  let inString: false | '"' | "'" = false;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "/" && lineText[i + 1] === "/") {
      // Line comment: nothing after this can be an assignment.
      return -1;
    }
    if (ch === "/" && lineText[i + 1] === "*") {
      const close = lineText.indexOf("*/", i + 2);
      if (close === -1) {
        // Unterminated block comment: treat the rest of the line as comment.
        return -1;
      }
      i = close + 1; // loop's i++ advances past the closing `/`
      continue;
    }
    if (ch === "(" || ch === "[") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]") {
      if (depth > 0) {
        depth--;
      }
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    if (ch === "=") {
      const prev = lineText[i - 1];
      const next = lineText[i + 1];
      if (prev === "=" || prev === "!" || prev === "<" || prev === ">") {
        continue;
      }
      if (next === "=" || next === ">") {
        continue;
      }
      return i;
    }
  }
  return -1;
}

/** Find the column of the first alignment-target operator on a line. */
export function findOperatorColumn(
  lineText: string,
  operators: string[]
): number | null {
  for (const op of operators) {
    if (op === "=") {
      const idx = findAssignmentEquals(lineText);
      if (idx !== -1) {
        return idx;
      }
    } else if (op === ":") {
      const idx = findColonOutsideString(lineText);
      if (idx !== -1) {
        return idx;
      }
    } else {
      const idx = lineText.indexOf(op);
      if (idx !== -1) {
        return idx;
      }
    }
  }
  return null;
}

/** Count leading whitespace characters (spaces or tabs). */
function leadingIndent(lineText: string): number {
  let i = 0;
  while (i < lineText.length && (lineText[i] === " " || lineText[i] === "\t")) {
    i++;
  }
  return i;
}

/**
 * Group consecutive lines that contain an operator.
 * A group is also split when the leading indent width changes — this keeps
 * nested blocks (e.g. JSON objects) from being aligned across indent levels.
 */
export function findAlignmentGroups(
  document: vscode.TextDocument,
  operators: string[]
): { lineIndex: number; operatorColumn: number }[][] {
  const groups: { lineIndex: number; operatorColumn: number }[][] = [];
  let currentGroup: { lineIndex: number; operatorColumn: number }[] = [];
  let currentIndent: number | null = null;

  const flush = () => {
    if (currentGroup.length >= 2) {
      groups.push(currentGroup);
    }
    currentGroup = [];
    currentIndent = null;
  };

  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;
    const col = findOperatorColumn(lineText, operators);

    if (col === null) {
      flush();
      continue;
    }

    const indent = leadingIndent(lineText);
    if (currentIndent !== null && indent !== currentIndent) {
      flush();
    }
    currentGroup.push({ lineIndex: i, operatorColumn: col });
    currentIndent = indent;
  }
  flush();

  return groups;
}

function updateDecorations() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const config = vscode.workspace.getConfiguration("ghostAlign");
  if (!config.get<boolean>("enabled", true) || !enabled) {
    clearDecorations();
    return;
  }

  const { ghostChar, ghostColor } = resolveGhostSettings(config);
  const operators = resolveOperatorsForLanguage(
    config,
    editor.document.languageId
  );
  const groups = findAlignmentGroups(editor.document, operators);
  const decorations: vscode.DecorationOptions[] = [];

  for (const group of groups) {
    const maxCol = Math.max(...group.map((g) => g.operatorColumn));

    for (const entry of group) {
      const padding = maxCol - entry.operatorColumn;
      if (padding <= 0) {
        continue; // already at the max position
      }

      const pos = new vscode.Position(entry.lineIndex, entry.operatorColumn);
      const range = new vscode.Range(pos, pos);

      decorations.push({
        range,
        renderOptions: {
          before: {
            contentText: ghostChar.repeat(padding),
            color: ghostColor,
            backgroundColor: ghostColor,
          },
        },
      });
    }
  }

  editor.setDecorations(alignDecorationType, decorations);
}
