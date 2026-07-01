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

/** Language IDs whose `:` is a CSS declaration separator, not a JSON/YAML key. */
const CSS_LANGUAGES = new Set(["css", "scss", "less"]);

/** Index of the first `{` outside any string, or -1. */
function indexOfTopLevelBrace(lineText: string): number {
  let inString: false | '"' | "'" = false;
  let escaped = false;
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
    } else if (ch === "{") {
      return i;
    }
  }
  return -1;
}

/**
 * Index of the CSS declaration-separator `:` (the `:` in `color: red`),
 * excluding:
 *   - `:` inside `"..."` / `'...'` strings
 *   - `:` inside `(...)`, e.g. `url(http://...)`
 *   - pseudo-element `::` and pseudo-class `:` in the selector part
 *     (`a:hover`, `.x::before`)
 *
 * The rule block `{` separates selector from declarations: colons before the
 * first `{` on the line are treated as selectors and skipped. A line with no
 * `{` — the common multi-line declaration such as `  color: red;` — is treated
 * as a declaration, so its first qualifying `:` is returned.
 */
function findCssColon(lineText: string): number {
  const braceIndex = indexOfTopLevelBrace(lineText);
  let inString: false | '"' | "'" = false;
  let escaped = false;
  let parenDepth = 0;
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
    if (ch === "(") {
      parenDepth++;
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) {
        parenDepth--;
      }
      continue;
    }
    if (parenDepth !== 0) {
      continue;
    }
    if (ch === ":") {
      if (lineText[i + 1] === ":") {
        i++; // pseudo-element `::`
        continue;
      }
      if (braceIndex !== -1 && i < braceIndex) {
        continue; // selector pseudo-class, before the rule block
      }
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

/**
 * Index of a *trailing* line-comment marker (`//` or `#`) on a line, or -1.
 * Excludes:
 *   - markers inside `"..."` / `'...'` strings
 *   - whole-line comments (the marker is the first non-whitespace token)
 *   - `//` that is part of a URL scheme such as `http://` (preceded by `:`)
 *   - for `#`, a marker not preceded by whitespace (so `value#x` is not a comment)
 *   - `//` inside a single-line `/* ... *​/` block (only for the `//` marker)
 */
function findTrailingComment(lineText: string, marker: "//" | "#"): number {
  let inString: false | '"' | "'" = false;
  let escaped = false;
  let seenCode = false;
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
      seenCode = true;
      continue;
    }
    if (marker === "//" && ch === "/" && lineText[i + 1] === "*") {
      const close = lineText.indexOf("*/", i + 2);
      if (close === -1) {
        return -1;
      }
      i = close + 1;
      seenCode = true;
      continue;
    }
    if (marker === "//" && ch === "/" && lineText[i + 1] === "/") {
      if (!seenCode) {
        return -1;
      }
      if (lineText[i - 1] === ":") {
        i++; // URL scheme like http:// — skip both slashes and keep scanning
        continue;
      }
      return i;
    }
    if (marker === "#" && ch === "#") {
      if (!seenCode) {
        return -1;
      }
      const prev = lineText[i - 1];
      if (prev === " " || prev === "\t") {
        return i;
      }
      continue;
    }
    if (ch !== " " && ch !== "\t") {
      seenCode = true;
    }
  }
  return -1;
}

/** Find the column of the first alignment-target operator on a line. */
export function findOperatorColumn(
  lineText: string,
  operators: string[],
  languageId?: string
): number | null {
  for (const op of operators) {
    if (op === "=") {
      const idx = findAssignmentEquals(lineText);
      if (idx !== -1) {
        return idx;
      }
    } else if (op === ":") {
      const idx =
        languageId && CSS_LANGUAGES.has(languageId)
          ? findCssColon(lineText)
          : findColonOutsideString(lineText);
      if (idx !== -1) {
        return idx;
      }
    } else if (op === "//" || op === "#") {
      const idx = findTrailingComment(lineText, op);
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

/** Default tab width used when an editor's tabSize cannot be resolved. */
const DEFAULT_TAB_SIZE = 4;

/** Count leading whitespace characters (spaces or tabs). */
function leadingIndent(lineText: string): number {
  let i = 0;
  while (i < lineText.length && (lineText[i] === " " || lineText[i] === "\t")) {
    i++;
  }
  return i;
}

/**
 * Visual column of the character at `charIndex` (the rendered width of the
 * prefix before it), expanding tabs to the next multiple of `tabSize`. Used so
 * alignment and group splitting compare on-screen positions rather than raw
 * character counts, which differ once tabs are involved.
 */
export function visualColumn(
  lineText: string,
  charIndex: number,
  tabSize: number
): number {
  let col = 0;
  const end = Math.min(charIndex, lineText.length);
  for (let i = 0; i < end; i++) {
    if (lineText[i] === "\t") {
      col += tabSize - (col % tabSize);
    } else {
      col += 1;
    }
  }
  return col;
}

/**
 * Group consecutive lines that contain an operator.
 * A group is also split when the leading indent width changes — this keeps
 * nested blocks (e.g. JSON objects) from being aligned across indent levels.
 *
 * `operatorColumn` is the character index (used to position the decoration),
 * while `visualColumn` is the rendered column (used to compute padding and the
 * group's alignment target). Indent comparison and alignment use visual columns
 * so tabs and tab/space mixes line up on screen, not by raw character count.
 */
export function findAlignmentGroups(
  document: vscode.TextDocument,
  operators: string[],
  languageId?: string,
  tabSize: number = DEFAULT_TAB_SIZE
): { lineIndex: number; operatorColumn: number; visualColumn: number }[][] {
  type Entry = { lineIndex: number; operatorColumn: number; visualColumn: number };
  const groups: Entry[][] = [];
  let currentGroup: Entry[] = [];
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
    const col = findOperatorColumn(lineText, operators, languageId);

    if (col === null) {
      flush();
      continue;
    }

    const indent = visualColumn(lineText, leadingIndent(lineText), tabSize);
    if (currentIndent !== null && indent !== currentIndent) {
      flush();
    }
    currentGroup.push({
      lineIndex: i,
      operatorColumn: col,
      visualColumn: visualColumn(lineText, col, tabSize),
    });
    currentIndent = indent;
  }
  flush();

  return groups;
}

/** Resolve the effective tab width of an editor, falling back to the default. */
function resolveTabSize(editor: vscode.TextEditor): number {
  const t = editor.options.tabSize;
  if (typeof t === "number" && t > 0) {
    return t;
  }
  const parsed = typeof t === "string" ? parseInt(t, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TAB_SIZE;
}

/**
 * Compute the ghost-padding placements for alignment groups. Pure: for each
 * line that is not already at its group's max visual column, returns the line
 * and character to decorate (the operator's character index) and how many ghost
 * characters to insert before it.
 */
export function computePaddings(
  groups: { lineIndex: number; operatorColumn: number; visualColumn: number }[][]
): { lineIndex: number; character: number; padding: number }[] {
  const placements: { lineIndex: number; character: number; padding: number }[] = [];
  for (const group of groups) {
    const maxCol = Math.max(...group.map((g) => g.visualColumn));
    for (const entry of group) {
      const padding = maxCol - entry.visualColumn;
      if (padding <= 0) {
        continue; // already at the max position
      }
      placements.push({
        lineIndex: entry.lineIndex,
        character: entry.operatorColumn,
        padding,
      });
    }
  }
  return placements;
}

/** Language IDs that use the Markdown table alignment path instead of operators. */
const MARKDOWN_LANGUAGES = new Set(["markdown"]);

/**
 * Char indices of the unescaped `|` table delimiters in a line. A `|` preceded
 * by an odd number of backslashes is escaped (`\|`) and not a delimiter.
 */
export function findPipePositions(lineText: string): number[] {
  const positions: number[] = [];
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] !== "|") {
      continue;
    }
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && lineText[j] === "\\"; j--) {
      backslashes++;
    }
    if (backslashes % 2 === 0) {
      positions.push(i);
    }
  }
  return positions;
}

/** Whether a line is a GFM table delimiter row, e.g. `|---|:--:|`. */
export function isDelimiterRow(lineText: string): boolean {
  const t = lineText.trim();
  if (!t.includes("|") || !t.includes("-")) {
    return false;
  }
  return /^[|\-:\s]+$/.test(t);
}

/**
 * Detect GFM table blocks: a header row (containing `|`), a delimiter row, then
 * data rows (non-blank, containing `|`). Returns each block as its line indices.
 */
export function findMarkdownTables(lines: string[]): number[][] {
  const tables: number[][] = [];
  let i = 0;
  while (i < lines.length) {
    const isHeader = findPipePositions(lines[i]).length > 0;
    if (isHeader && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const block = [i, i + 1];
      let j = i + 2;
      while (
        j < lines.length &&
        lines[j].trim().length > 0 &&
        findPipePositions(lines[j]).length > 0
      ) {
        block.push(j);
        j++;
      }
      tables.push(block);
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

/**
 * Ghost-padding placements that align the `|` delimiters of every Markdown table
 * in `lines`. Each cell is padded to its column's widest cell by inserting ghost
 * characters before the trailing `|`, so all delimiters line up. Returns the same
 * placement shape as computePaddings.
 */
export function computeMarkdownTablePaddings(
  lines: string[],
  tabSize: number
): { lineIndex: number; character: number; padding: number }[] {
  const placements: { lineIndex: number; character: number; padding: number }[] = [];

  for (const block of findMarkdownTables(lines)) {
    const rows = block.map((lineIndex) => {
      const text = lines[lineIndex];
      const pipes = findPipePositions(text);
      const segWidths: number[] = [];
      let prevVisual = 0;
      for (const pipe of pipes) {
        const pipeVisual = visualColumn(text, pipe, tabSize);
        segWidths.push(pipeVisual - prevVisual);
        prevVisual = pipeVisual + 1; // skip the pipe character (width 1)
      }
      return { lineIndex, pipes, segWidths };
    });

    const maxSeg: number[] = [];
    for (const row of rows) {
      row.segWidths.forEach((w, k) => {
        maxSeg[k] = Math.max(maxSeg[k] ?? 0, w);
      });
    }

    for (const row of rows) {
      row.pipes.forEach((pipe, k) => {
        const padding = maxSeg[k] - row.segWidths[k];
        if (padding > 0) {
          placements.push({ lineIndex: row.lineIndex, character: pipe, padding });
        }
      });
    }
  }

  return placements;
}

/** Apply ghost-align decorations to a single editor. */
function decorateEditor(
  editor: vscode.TextEditor,
  config: vscode.WorkspaceConfiguration,
  ghostChar: string,
  ghostColor: string
) {
  const languageId = editor.document.languageId;
  const tabSize = resolveTabSize(editor);

  let placements: { lineIndex: number; character: number; padding: number }[];
  if (MARKDOWN_LANGUAGES.has(languageId)) {
    const lines: string[] = [];
    for (let i = 0; i < editor.document.lineCount; i++) {
      lines.push(editor.document.lineAt(i).text);
    }
    placements = computeMarkdownTablePaddings(lines, tabSize);
  } else {
    const operators = resolveOperatorsForLanguage(config, languageId);
    const groups = findAlignmentGroups(
      editor.document,
      operators,
      languageId,
      tabSize
    );
    placements = computePaddings(groups);
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

function updateDecorations() {
  const config = vscode.workspace.getConfiguration("ghostAlign");
  if (!config.get<boolean>("enabled", true) || !enabled) {
    clearDecorations();
    return;
  }

  const { ghostChar, ghostColor } = resolveGhostSettings(config);
  for (const editor of vscode.window.visibleTextEditors) {
    decorateEditor(editor, config, ghostChar, ghostColor);
  }
}
