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

// ── Core logic ──────────────────────────────────────────────────────────

// Default per-language operator overrides. Keep in sync with package.json.
const DEFAULT_OPERATORS_BY_LANGUAGE: Record<string, string[]> = {
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

/** State for {@link advanceQuoteState}: the currently open quote char, or `false`. */
type QuoteState = { quote: string | false; escaped: boolean };

export function initialQuoteState(): QuoteState {
  return { quote: false, escaped: false };
}

/**
 * Shared string/escape tracking step used by findColonOutsideString /
 * findCssColon / findAssignmentEquals / findTrailingComment. Advances `state`
 * by one character against `quoteChars` (the quote characters this call site
 * recognizes, e.g. `"` only for JSON vs. `"`+`'` for CSS/JS-like assignments),
 * tracking `\` escapes. Mutates `state` in place and returns whether `ch` was
 * consumed by string/escape tracking — callers should skip their own
 * per-character logic (and `continue`) for that iteration when this is `true`.
 */
export function advanceQuoteState(
  state: QuoteState,
  ch: string,
  quoteChars: ReadonlySet<string>
): boolean {
  if (state.quote) {
    if (state.escaped) {
      state.escaped = false;
    } else if (ch === "\\") {
      state.escaped = true;
    } else if (ch === state.quote) {
      state.quote = false;
    }
    return true;
  }
  if (quoteChars.has(ch)) {
    state.quote = ch;
    return true;
  }
  return false;
}

/**
 * Quote characters recognized by findColonOutsideString. JSON only uses `"`;
 * YAML also allows single-quoted keys/values like `'a:b': 1`. Deliberately
 * does not include the backtick: JSON/YAML have no template-literal syntax,
 * and treating a stray, unpaired backtick in a plain scalar as a string
 * delimiter would risk swallowing the real delimiter `:` that follows it.
 */
const QUOTE_CHARS = new Set<string>(['"', "'"]);

/**
 * Quote characters recognized by findCssColon / findAssignmentEquals /
 * findTrailingComment. Adds the backtick to {@link QUOTE_CHARS} so a
 * single-line-closed JS/TS template literal (`` `...` ``) is treated as a
 * string, excluding its contents from operator detection. A template literal
 * spanning multiple lines is not tracked — same known limitation as
 * multi-line `/* ... *​/` block comments, since these functions scan one
 * line at a time.
 */
const TEMPLATE_QUOTE_CHARS = new Set<string>(['"', "'", "`"]);

/** Language IDs whose `:` finder must skip C-style `//` / `/* ... *​/` comments. */
const C_COMMENT_COLON_LANGUAGES = new Set(["jsonc"]);

/**
 * Indices of all `:` outside any `"..."` / `'...'` string, in order. Walks the
 * line character by character, tracking string state and `\` escapes. Used for
 * JSON/JSONC (double-quote strings only, so `'` never opens a string there)
 * and YAML (which also allows single-quoted keys/values).
 *
 * Comments are skipped per language: YAML's `#` (line start or after
 * whitespace, via LINE_COMMENT_MARKERS_BY_LANGUAGE) and JSONC's `//` /
 * single-line `/* ... *​/`. JSON has no comment syntax, so its behavior is
 * unchanged.
 */
function findColonOutsideString(
  lineText: string,
  languageId?: string
): number[] {
  const results: number[] = [];
  const markers = lineCommentMarkers(languageId);
  const cStyleComments =
    languageId !== undefined && C_COMMENT_COLON_LANGUAGES.has(languageId);
  const state = initialQuoteState();
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (advanceQuoteState(state, ch, QUOTE_CHARS)) {
      continue;
    }
    if (markers && startsLineComment(lineText, i, markers)) {
      break; // comment to the end of the line
    }
    if (cStyleComments) {
      if (ch === "/" && lineText[i + 1] === "/") {
        break; // line comment: nothing after this is a key
      }
      if (ch === "/" && lineText[i + 1] === "*") {
        const close = lineText.indexOf("*/", i + 2);
        if (close === -1) {
          break; // unterminated block comment: rest of the line is a comment
        }
        i = close + 1; // loop's i++ advances past the closing `/`
        continue;
      }
    }
    if (ch === ":") {
      results.push(i);
    }
  }
  return results;
}

/** Language IDs whose `:` is a CSS declaration separator, not a JSON/YAML key. */
const CSS_LANGUAGES = new Set(["css", "scss", "less"]);

/** Language IDs whose `:` is a TS/JS type annotation or object-literal separator. */
const TS_JS_LANGUAGES = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
]);

/**
 * Indices of all type-annotation / property `:` on a TS/JS line, in order.
 * Excludes:
 *   - `:` inside `"..."` / `'...'` / single-line-closed `` `...` `` strings
 *   - `:` inside `//` line comments or single-line `/* ... *​/` block comments
 *   - the ternary-operator `:` (the branch separator matching a preceding
 *     `? ... :` at the same bracket depth)
 *
 * The optional-property marker `?:` (`name?: string`) is not a ternary, so its
 * `:` is returned as a normal type colon; `?.` and `??` are likewise excluded
 * from ternary tracking. Colons inside `(...)`/`[...]`/`{...}` are still valid
 * targets (function parameter annotations count), so bracket depth is tracked
 * only to pair ternary `?`/`:`, not to exclude nested colons.
 *
 * Block comments and template literals spanning multiple lines are not tracked:
 * this function sees one line at a time, matching the other single-line finders.
 */
function findTsColon(lineText: string): number[] {
  const results: number[] = [];
  const state = initialQuoteState();
  const ternaryDepths: number[] = [];
  let depth = 0;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (advanceQuoteState(state, ch, TEMPLATE_QUOTE_CHARS)) {
      continue;
    }
    if (ch === "/" && lineText[i + 1] === "/") {
      break; // line comment: nothing after this is code
    }
    if (ch === "/" && lineText[i + 1] === "*") {
      const close = lineText.indexOf("*/", i + 2);
      if (close === -1) {
        break; // unterminated block comment: rest of the line is a comment
      }
      i = close + 1; // loop's i++ advances past the closing `/`
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth > 0) {
        depth--;
      }
      continue;
    }
    if (ch === "?") {
      const next = lineText[i + 1];
      if (next === ":") {
        // optional-property marker `?:` — the `:` is a type colon
        results.push(i + 1);
        i++; // don't reprocess the `:` on the next iteration
        continue;
      }
      if (next === "." || next === "?") {
        i++; // `?.` optional chaining / `??` nullish coalescing, not a ternary
        continue;
      }
      ternaryDepths.push(depth);
      continue;
    }
    if (ch === ":") {
      if (
        ternaryDepths.length > 0 &&
        ternaryDepths[ternaryDepths.length - 1] === depth
      ) {
        ternaryDepths.pop(); // ternary branch separator, not a type colon
        continue;
      }
      results.push(i);
    }
  }
  return results;
}

/** Language IDs with `//` line comments; CSS itself has no `//` comment syntax. */
const SCSS_LESS_LANGUAGES = new Set(["scss", "less"]);

/** Index of the first `{` outside any string, or -1. */
function indexOfTopLevelBrace(lineText: string): number {
  const state = initialQuoteState();
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (advanceQuoteState(state, ch, TEMPLATE_QUOTE_CHARS)) {
      continue;
    }
    if (ch === "{") {
      return i;
    }
  }
  return -1;
}

/**
 * Indices of all CSS declaration-separator `:` (the `:` in `color: red`),
 * excluding:
 *   - `:` inside `"..."` / `'...'` / single-line-closed `` `...` `` strings
 *   - `:` inside `(...)`, e.g. `url(http://...)`
 *   - pseudo-element `::` and pseudo-class `:` in the selector part
 *     (`a:hover`, `.x::before`)
 *   - anything from a `//` line comment onward, for SCSS/LESS only — CSS has
 *     no `//` comment syntax, so `//` in a CSS value must not be treated as one
 *   - `:` inside a single-line-closed `/* ... *​/` block comment (CSS/SCSS/LESS
 *     all support these). A block comment spanning multiple lines is not
 *     tracked: this function sees one line at a time, so a `/*` without a
 *     matching `*​/` on the same line is treated as running to the end of it.
 *
 * The rule block `{` separates selector from declarations: colons before the
 * first `{` on the line are treated as selectors and skipped. A line with no
 * `{` — the common multi-line declaration such as `  color: red;` — is treated
 * as a declaration, so its first qualifying `:` is returned.
 */
function findCssColon(lineText: string, languageId: string): number[] {
  const results: number[] = [];
  const braceIndex = indexOfTopLevelBrace(lineText);
  const state = initialQuoteState();
  let parenDepth = 0;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (advanceQuoteState(state, ch, TEMPLATE_QUOTE_CHARS)) {
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
    if (ch === "/" && lineText[i + 1] === "*") {
      const close = lineText.indexOf("*/", i + 2);
      if (close === -1) {
        break; // unterminated block comment: rest of the line is a comment
      }
      i = close + 1; // loop's i++ advances past the closing `/`
      continue;
    }
    if (
      SCSS_LESS_LANGUAGES.has(languageId) &&
      ch === "/" &&
      lineText[i + 1] === "/"
    ) {
      break; // SCSS/LESS line comment: nothing after this is a declaration
    }
    if (ch === ":") {
      if (lineText[i + 1] === ":") {
        i++; // pseudo-element `::`
        continue;
      }
      if (braceIndex !== -1 && i < braceIndex) {
        continue; // selector pseudo-class, before the rule block
      }
      results.push(i);
    }
  }
  return results;
}

/**
 * A found alignment target on a line: `insert` is the character index where
 * ghost padding is inserted (the operator's first character, so a compound
 * assignment like `+=` is never split), and `align` is the character index of
 * the column to line up across the group (the `=` itself). For single-character
 * operators the two are identical.
 */
export type OperatorTarget = { insert: number; align: number };

/**
 * Single-character prefixes that combine with `=` into a compound assignment
 * (`+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`, Makefile/Go `:=`,
 * Makefile `?=`). `<` and `>` are handled separately because `<=`/`>=` are
 * comparisons while `<<=`/`>>=` are assignments.
 */
const COMPOUND_PREFIX_CHARS = new Set([
  "+", "-", "*", "/", "%", "&", "|", "^", "?", ":",
]);

/**
 * Prefixes that may double up before `=`: `**=`, `||=`, `&&=`, `??=`, and
 * Python's floor-division `//=` (reachable only for languages where `//` is
 * not a comment — see LINE_COMMENT_MARKERS_BY_LANGUAGE).
 */
const DOUBLED_PREFIX_CHARS = new Set(["*", "|", "&", "?", "/"]);

/**
 * Line-comment markers for languages whose comments are not the C-style
 * `//` / `/* ... *​/` that findAssignmentEquals handles by default. For these
 * languages the C-style handling is disabled (`//` is floor division in
 * Python, and not a comment in the others), and a marker starts a comment
 * only at the line start or after whitespace (so shell's `$#` is not one).
 */
const LINE_COMMENT_MARKERS_BY_LANGUAGE: Record<string, readonly string[]> = {
  python: ["#"],
  shellscript: ["#"],
  ruby: ["#"],
  makefile: ["#"],
  toml: ["#"],
  dotenv: ["#"],
  properties: ["#"],
  ini: ["#", ";"],
  yaml: ["#"],
  lua: ["--"],
  php: ["#"],
};

/**
 * Marker languages that additionally keep the C-style `//` / `/* ... *​/`
 * comment handling (PHP supports both `#` and `//`). For other marker
 * languages C-style is disabled — `//` is floor division in Python and
 * has no comment meaning in the rest.
 */
const C_STYLE_COMMENT_ALSO = new Set(["php"]);

/** Whether a line comment starts at `index` with one of `markers` (line start or after whitespace). */
function startsLineComment(
  lineText: string,
  index: number,
  markers: readonly string[]
): boolean {
  const prev = lineText[index - 1];
  if (prev !== undefined && prev !== " " && prev !== "\t") {
    return false;
  }
  return markers.some((m) => lineText.startsWith(m, index));
}

/** Resolve the line-comment markers for a language, or undefined for C-style. */
function lineCommentMarkers(
  languageId: string | undefined
): readonly string[] | undefined {
  if (
    languageId &&
    Object.prototype.hasOwnProperty.call(
      LINE_COMMENT_MARKERS_BY_LANGUAGE,
      languageId
    )
  ) {
    return LINE_COMMENT_MARKERS_BY_LANGUAGE[languageId];
  }
  return undefined;
}

/**
 * All assignment `=` targets on a line, in order. Excludes:
 *   - any `=` inside `(...)` or `[...]` (e.g. `for (let i = 0; ...)` or
 *     default arguments `function f(a = 1)`)
 *   - any `=` inside `"..."`, `'...'`, or single-line-closed `` `...` `` strings
 *   - any `=` inside `//` line comments or single-line `/* ... *​/` blocks
 *   - the comparison/arrow operators `==`, `!=`, `<=`, `>=`, `=>`
 *
 * Compound assignments (`+=`, `:=`, `**=`, `<<=`, ...) are targets: `align`
 * is the `=` and `insert` is the operator's first character, so padding never
 * splits the operator.
 *
 * Comment handling depends on the language: languages listed in
 * LINE_COMMENT_MARKERS_BY_LANGUAGE use their own markers (`#`, `;`) and the
 * C-style handling is disabled for them; all others use `//` and `/* ... *​/`.
 *
 * Block comments and template literals spanning multiple lines are not
 * tracked: this function sees one line at a time, so a `/*` without a
 * comment running to the end of the line.
 */
function findAssignmentEquals(
  lineText: string,
  languageId?: string
): OperatorTarget[] {
  const results: OperatorTarget[] = [];
  const markers = lineCommentMarkers(languageId);
  const cStyle =
    markers === undefined ||
    (languageId !== undefined && C_STYLE_COMMENT_ALSO.has(languageId));
  const state = initialQuoteState();
  let depth = 0;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (advanceQuoteState(state, ch, TEMPLATE_QUOTE_CHARS)) {
      continue;
    }
    if (markers && startsLineComment(lineText, i, markers)) {
      // Comment to the end of the line: no assignment can follow.
      break;
    }
    if (cStyle) {
      if (ch === "/" && lineText[i + 1] === "/") {
        // Line comment: nothing after this can be an assignment.
        break;
      }
      if (ch === "/" && lineText[i + 1] === "*") {
        const close = lineText.indexOf("*/", i + 2);
        if (close === -1) {
          // Unterminated block comment: treat the rest of the line as comment.
          break;
        }
        i = close + 1; // loop's i++ advances past the closing `/`
        continue;
      }
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
      if (next === "=" || next === ">" || next === "~") {
        continue; // ==, =>, and Ruby's regex match =~
      }
      if (prev === "=" || prev === "!" || prev === "~") {
        continue; // ==, !=, and Lua's not-equal ~=
      }
      if (prev === "<" || prev === ">") {
        if (lineText[i - 2] !== prev) {
          continue; // comparison <= / >=
        }
        // shift assignment <<= / >>= (and >>>=)
        const insert = prev === ">" && lineText[i - 3] === ">" ? i - 3 : i - 2;
        results.push({ insert, align: i });
        continue;
      }
      if (prev === ".") {
        if (lineText[i - 2] === ".") {
          continue; // Rust's closed-range operator ..=, not an assignment
        }
        // PHP's string-concatenation compound assignment .=
        results.push({ insert: i - 1, align: i });
        continue;
      }
      if (prev !== undefined && COMPOUND_PREFIX_CHARS.has(prev)) {
        const insert =
          DOUBLED_PREFIX_CHARS.has(prev) && lineText[i - 2] === prev
            ? i - 2
            : i - 1;
        results.push({ insert, align: i });
        continue;
      }
      results.push({ insert: i, align: i });
    }
  }
  return results;
}

/**
 * Indices of all arrows `=>` on a line, in order, excluding:
 *   - `=>` inside `"..."`, `'...'`, or single-line-closed `` `...` `` strings
 *   - `=>` inside `//` line comments or single-line `/* ... *​/` blocks
 *
 * Unlike findAssignmentEquals, bracket depth is not tracked: an arrow inside
 * `(...)` (e.g. `arr.map((x) => x)`) is still a real arrow function and a valid
 * alignment target. Block comments and template literals spanning multiple
 * lines are not tracked — this function sees one line at a time, matching the
 * other single-line finders.
 */
function findArrow(lineText: string): number[] {
  const results: number[] = [];
  const state = initialQuoteState();
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (advanceQuoteState(state, ch, TEMPLATE_QUOTE_CHARS)) {
      continue;
    }
    if (ch === "/" && lineText[i + 1] === "/") {
      break; // line comment: nothing after this is code
    }
    if (ch === "/" && lineText[i + 1] === "*") {
      const close = lineText.indexOf("*/", i + 2);
      if (close === -1) {
        break; // unterminated block comment: rest of the line is a comment
      }
      i = close + 1; // loop's i++ advances past the closing `/`
      continue;
    }
    if (ch === "=" && lineText[i + 1] === ">") {
      results.push(i);
      i++; // skip the `>` so it is not reprocessed
    }
  }
  return results;
}

/**
 * Index of a *trailing* line-comment marker (`//` or `#`) on a line, or -1.
 * Excludes:
 *   - markers inside `"..."` / `'...'` / single-line-closed `` `...` `` strings
 *   - whole-line comments (the marker is the first non-whitespace token)
 *   - `//` that is part of a URL scheme such as `http://` (preceded by `:`)
 *   - for `#`, a marker not preceded by whitespace (so `value#x` is not a comment)
 *   - `//` inside a single-line `/* ... *​/` block (only for the `//` marker)
 */
function findTrailingComment(lineText: string, marker: "//" | "#"): number {
  const state = initialQuoteState();
  let seenCode = false;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (advanceQuoteState(state, ch, TEMPLATE_QUOTE_CHARS)) {
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

/** All occurrences of a single operator token on a line, in order. */
function findOccurrences(
  lineText: string,
  op: string,
  languageId?: string
): OperatorTarget[] {
  if (op === "=") {
    return findAssignmentEquals(lineText, languageId);
  }
  if (op === ":") {
    let indices: number[];
    if (languageId && CSS_LANGUAGES.has(languageId)) {
      indices = findCssColon(lineText, languageId);
    } else if (languageId && TS_JS_LANGUAGES.has(languageId)) {
      indices = findTsColon(lineText);
    } else {
      indices = findColonOutsideString(lineText, languageId);
    }
    return indices.map((i) => ({ insert: i, align: i }));
  }
  if (op === "//" || op === "#") {
    const idx = findTrailingComment(lineText, op);
    return idx === -1 ? [] : [{ insert: idx, align: idx }];
  }
  if (op === "=>") {
    return findArrow(lineText).map((i) => ({ insert: i, align: i }));
  }
  const results: OperatorTarget[] = [];
  let from = 0;
  for (;;) {
    const idx = lineText.indexOf(op, from);
    if (idx === -1) {
      break;
    }
    results.push({ insert: idx, align: idx });
    from = idx + op.length;
  }
  return results;
}

/**
 * A per-line alignment column: which operator in the configured list it
 * belongs to (`opIndex`), plus the insert/align pair of that occurrence.
 */
export type ColumnTarget = OperatorTarget & { opIndex: number };

/**
 * All alignment columns on a line, in operator-list order. The k-th operator
 * claims its first occurrence *after* the previously claimed column, so the
 * configured list order is both the priority and the left-to-right column
 * order. An operator with no such occurrence is skipped (the line simply has
 * no column for it); listing the same operator twice claims its first and
 * second occurrences.
 */
export function findOperatorTargets(
  lineText: string,
  operators: string[],
  languageId?: string
): ColumnTarget[] {
  const columns: ColumnTarget[] = [];
  let minIndex = 0;
  for (let opIndex = 0; opIndex < operators.length; opIndex++) {
    const occurrences = findOccurrences(lineText, operators[opIndex], languageId);
    const match = occurrences.find((t) => t.insert >= minIndex);
    if (!match) {
      continue;
    }
    columns.push({ opIndex, insert: match.insert, align: match.align });
    minIndex = match.align + 1;
  }
  return columns;
}

/**
 * First alignment-target operator on a line, as the pair of insertion index
 * (where padding goes) and alignment index (the column that lines up across
 * the group). The two differ only for compound assignments such as `+=` —
 * see {@link OperatorTarget}.
 */
export function findOperatorTarget(
  lineText: string,
  operators: string[],
  languageId?: string
): OperatorTarget | null {
  const columns = findOperatorTargets(lineText, operators, languageId);
  return columns.length > 0
    ? { insert: columns[0].insert, align: columns[0].align }
    : null;
}

/** Column of the first alignment-target operator on a line (its `align` index). */
export function findOperatorColumn(
  lineText: string,
  operators: string[],
  languageId?: string
): number | null {
  const target = findOperatorTarget(lineText, operators, languageId);
  return target ? target.align : null;
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
 * East Asian Width Wide/Fullwidth code point ranges, plus emoji. VS Code
 * renders these at double width, so alignment must count them as 2 columns.
 * JS regex has no `\p{East_Asian_Width=...}`, so we test against an explicit
 * table. Variation selectors and ZWJ emoji sequences are out of scope: each
 * code point is measured on its own.
 */
const WIDE_CHAR_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals .. Kangxi .. CJK Symbols (partial)
  [0x3041, 0x33ff], // Hiragana, Katakana, CJK symbols/punctuation, etc.
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical Forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms, Small Form Variants
  [0xff00, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1faff], // Emoji and pictographs (Misc Symbols .. Ext-A)
  [0x20000, 0x3fffd], // CJK Unified Ideographs Extension B and beyond
];

/** Rendered column width of a single code point: 2 for wide/fullwidth, else 1. */
function charWidth(codePoint: number): number {
  for (const [lo, hi] of WIDE_CHAR_RANGES) {
    if (codePoint < lo) break;
    if (codePoint <= hi) return 2;
  }
  return 1;
}

/**
 * Visual column of the character at `charIndex` (the rendered width of the
 * prefix before it), expanding tabs to the next multiple of `tabSize` and
 * counting East Asian Wide/Fullwidth characters and emoji as 2. The scan is
 * per code point (`charIndex` stays a UTF-16 code-unit index), so surrogate
 * pairs count once by their real width instead of twice. Used so alignment
 * and group splitting compare on-screen positions rather than raw character
 * counts, which differ once tabs or full-width characters are involved.
 */
export function visualColumn(
  lineText: string,
  charIndex: number,
  tabSize: number
): number {
  let col = 0;
  const end = Math.min(charIndex, lineText.length);
  for (let i = 0; i < end; ) {
    if (lineText[i] === "\t") {
      col += tabSize - (col % tabSize);
      i++;
      continue;
    }
    const codePoint = lineText.codePointAt(i) as number;
    col += charWidth(codePoint);
    i += codePoint > 0xffff ? 2 : 1;
  }
  return col;
}

/** One alignment column of a group entry, in rendered coordinates. */
export type AlignmentColumn = {
  opIndex: number;
  insert: number;
  visualColumn: number;
};

/**
 * A line in an alignment group. `operatorColumn` / `visualColumn` describe
 * the first column (kept for backward compatibility with single-operator
 * callers); `columns` lists every column on the line. Entries built by hand
 * without `columns` are treated as having that single column.
 */
export type AlignmentEntry = {
  lineIndex: number;
  operatorColumn: number;
  visualColumn: number;
  columns?: AlignmentColumn[];
};

/**
 * The subset of vscode.TextDocument the alignment scan needs. Structural, so
 * a slice of a large document (visible-range mode) can be scanned by
 * presenting its lines as a smaller document.
 */
type LineSource = {
  lineCount: number;
  lineAt(line: number): { text: string };
};

/**
 * Group consecutive lines that contain at least one operator.
 * A group is also split when the leading indent width changes — this keeps
 * nested blocks (e.g. JSON objects) from being aligned across indent levels.
 *
 * Each column's `insert` is the character index where padding is inserted
 * (the operator's first character, so compound assignments like `+=` are
 * never split), while `visualColumn` is the rendered column of the alignment
 * point (the `=` itself) used to compute padding and the group's alignment
 * target. Indent comparison and alignment use visual columns so tabs and
 * tab/space mixes line up on screen, not by raw character count.
 */
export function findAlignmentGroups(
  document: LineSource,
  operators: string[],
  languageId?: string,
  tabSize: number = DEFAULT_TAB_SIZE
): AlignmentEntry[][] {
  const groups: AlignmentEntry[][] = [];
  let currentGroup: AlignmentEntry[] = [];
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
    const targets = findOperatorTargets(lineText, operators, languageId);

    if (targets.length === 0) {
      flush();
      continue;
    }

    const indent = visualColumn(lineText, leadingIndent(lineText), tabSize);
    if (currentIndent !== null && indent !== currentIndent) {
      flush();
    }
    const columns = targets.map((t) => ({
      opIndex: t.opIndex,
      insert: t.insert,
      visualColumn: visualColumn(lineText, t.align, tabSize),
    }));
    currentGroup.push({
      lineIndex: i,
      operatorColumn: columns[0].insert,
      visualColumn: columns[0].visualColumn,
      columns,
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
 * line and column that is not already at the group's max visual column,
 * returns the line and character to decorate (the column's insert index) and
 * how many ghost characters to insert before it.
 *
 * Columns are aligned in operator-list order (`opIndex` ascending). Padding
 * applied to an earlier column shifts everything after it on that line, so
 * later columns compare shifted visual positions. A tab between two columns
 * would absorb part of that shift (tab stops), which is not modeled — a known
 * limitation matching the finders' single-line scope.
 *
 * When `maxPadding` is positive, any column whose alignment would require
 * more than `maxPadding` ghost characters on some line is trimmed: the
 * rightmost (outlier) lines are excluded from that column and the max is
 * recomputed, repeating until the remaining lines fit. Excluded lines keep
 * their position for that column but still participate in other columns.
 */
export function computePaddings(
  groups: AlignmentEntry[][],
  maxPadding: number = 0
): { lineIndex: number; character: number; padding: number }[] {
  const placements: { lineIndex: number; character: number; padding: number }[] = [];
  for (const group of groups) {
    const rows = group.map((entry) => ({
      lineIndex: entry.lineIndex,
      columns:
        entry.columns ??
        [
          {
            opIndex: 0,
            insert: entry.operatorColumn,
            visualColumn: entry.visualColumn,
          },
        ],
      shift: 0,
    }));
    const opIndices = [
      ...new Set(rows.flatMap((r) => r.columns.map((c) => c.opIndex))),
    ].sort((a, b) => a - b);
    for (const opIndex of opIndices) {
      let active = rows
        .map((row) => {
          const column = row.columns.find((c) => c.opIndex === opIndex);
          return column ? { row, column } : undefined;
        })
        .filter((x): x is NonNullable<typeof x> => x !== undefined);
      if (maxPadding > 0) {
        for (;;) {
          const positions = active.map(
            ({ row, column }) => column.visualColumn + row.shift
          );
          const max = Math.max(...positions);
          if (max - Math.min(...positions) <= maxPadding) {
            break;
          }
          active = active.filter(
            ({ row, column }) => column.visualColumn + row.shift !== max
          );
        }
      }
      const maxCol = Math.max(
        ...active.map(({ row, column }) => column.visualColumn + row.shift)
      );
      for (const { row, column } of active) {
        const padding = maxCol - (column.visualColumn + row.shift);
        if (padding <= 0) {
          continue; // already at the max position
        }
        placements.push({
          lineIndex: row.lineIndex,
          character: column.insert,
          padding,
        });
        row.shift += padding;
      }
    }
  }
  return placements;
}

// ── JSDoc @param alignment ──────────────────────────────────────────────

/** Matches a JSDoc body line `* @param ...` (leading whitespace + `*`). */
const JSDOC_PARAM_RE = /^\s*\*\s*@param(?:\s+|$)/;

/** Index of the first non-whitespace character at or after `from`. */
function skipSpaces(lineText: string, from: number): number {
  let i = from;
  while (i < lineText.length && (lineText[i] === " " || lineText[i] === "\t")) {
    i++;
  }
  return i;
}

/**
 * Parse a JSDoc `@param` line into the character indices of its
 * parameter-name and description tokens (`descStart` is -1 when the line has
 * no description). Returns null for lines that are not alignable `@param`
 * lines (not a JSDoc `@param`, no name, or an unbalanced `{type}`). The
 * `{type}` part is optional and may contain nested braces; an
 * optional-parameter name `[count=1]` is one token up to its `]`.
 */
function parseJsdocParamLine(
  lineText: string
): { nameStart: number; descStart: number } | null {
  const match = JSDOC_PARAM_RE.exec(lineText);
  if (!match) {
    return null;
  }
  let i = skipSpaces(lineText, match[0].length);
  if (lineText[i] === "{") {
    let depth = 0;
    let j = i;
    for (; j < lineText.length; j++) {
      if (lineText[j] === "{") {
        depth++;
      } else if (lineText[j] === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    if (depth !== 0) {
      return null; // unbalanced type braces
    }
    i = skipSpaces(lineText, j);
  }
  if (i >= lineText.length) {
    return null; // no parameter name
  }
  const nameStart = i;
  let nameEnd: number;
  if (lineText[i] === "[") {
    const close = lineText.indexOf("]", i + 1);
    if (close === -1) {
      return null;
    }
    nameEnd = close + 1;
  } else {
    let j = i;
    while (
      j < lineText.length &&
      lineText[j] !== " " &&
      lineText[j] !== "\t"
    ) {
      j++;
    }
    nameEnd = j;
  }
  const descStart = skipSpaces(lineText, nameEnd);
  return { nameStart, descStart: descStart < lineText.length ? descStart : -1 };
}

/**
 * Ghost-padding placements aligning consecutive JSDoc `@param` lines: the
 * parameter-name column, then the description column. Reuses the sequential
 * multi-column logic of computePaddings (name padding shifts the
 * description). Any line that is not an alignable `@param` line splits the
 * run, so `@returns` etc. are never pulled into the group.
 */
export function computeJsdocParamPaddings(
  lines: string[],
  tabSize: number,
  maxPadding: number = 0
): { lineIndex: number; character: number; padding: number }[] {
  const groups: AlignmentEntry[][] = [];
  let current: AlignmentEntry[] = [];
  const flush = () => {
    if (current.length >= 2) {
      groups.push(current);
    }
    current = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseJsdocParamLine(lines[i]);
    if (!parsed) {
      flush();
      continue;
    }
    const columns: AlignmentColumn[] = [
      {
        opIndex: 0,
        insert: parsed.nameStart,
        visualColumn: visualColumn(lines[i], parsed.nameStart, tabSize),
      },
    ];
    if (parsed.descStart !== -1) {
      columns.push({
        opIndex: 1,
        insert: parsed.descStart,
        visualColumn: visualColumn(lines[i], parsed.descStart, tabSize),
      });
    }
    current.push({
      lineIndex: i,
      operatorColumn: columns[0].insert,
      visualColumn: columns[0].visualColumn,
      columns,
    });
  }
  flush();
  return computePaddings(groups, maxPadding);
}

/** Language IDs that use the Markdown table alignment path instead of operators. */
const MARKDOWN_LANGUAGES = new Set(["markdown"]);

/**
 * Char ranges `[start, end)` inside inline code spans (CommonMark: opened by
 * a run of N backticks, closed by the next run of exactly N backticks).
 * Spans don't cross lines, so an unmatched opening run is literal text, not
 * a span.
 */
function findCodeSpanRanges(lineText: string): [number, number][] {
  const ranges: [number, number][] = [];
  let i = 0;
  while (i < lineText.length) {
    if (lineText[i] !== "`") {
      i++;
      continue;
    }
    let runEnd = i;
    while (lineText[runEnd] === "`") {
      runEnd++;
    }
    const runLength = runEnd - i;
    let searchPos = runEnd;
    let closeStart = -1;
    while (searchPos < lineText.length) {
      if (lineText[searchPos] !== "`") {
        searchPos++;
        continue;
      }
      let closeEnd = searchPos;
      while (lineText[closeEnd] === "`") {
        closeEnd++;
      }
      if (closeEnd - searchPos === runLength) {
        closeStart = searchPos;
        break;
      }
      searchPos = closeEnd;
    }
    if (closeStart === -1) {
      i = runEnd;
      continue;
    }
    ranges.push([runEnd, closeStart]);
    i = closeStart + runLength;
  }
  return ranges;
}

/**
 * Char indices of the table-delimiter `|` in a line. A `|` inside an inline
 * code span is content, never a delimiter (backslash escapes aren't
 * processed inside code spans either). Outside a code span, a `|` preceded
 * by an odd number of backslashes is escaped (`\|`) and not a delimiter.
 */
export function findPipePositions(lineText: string): number[] {
  const codeSpans = findCodeSpanRanges(lineText);
  const isInCodeSpan = (index: number) =>
    codeSpans.some(([start, end]) => index >= start && index < end);

  const positions: number[] = [];
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] !== "|" || isInCodeSpan(i)) {
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

/** Matches a fenced code block's opening/closing delimiter line (``` or ~~~, 3+ chars). */
const FENCE_RE = /^(`{3,}|~{3,})/;

/**
 * For each line, whether it is inside a fenced code block (```` ``` ```` or `~~~`).
 * A fence opens on a line whose trimmed text starts with 3+ backticks or tildes, and
 * closes on the next line whose trimmed text starts with 3+ of the same character. An
 * unclosed fence extends to the end of the file.
 */
function computeFencedLines(lines: string[]): boolean[] {
  const fenced = new Array<boolean>(lines.length).fill(false);
  let fenceChar: string | null = null;
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const match = FENCE_RE.exec(trimmed);
    if (fenceChar === null) {
      if (match) {
        fenceChar = match[1][0];
        fenceLen = match[1].length;
        fenced[i] = true;
      }
    } else {
      fenced[i] = true;
      if (match && match[1][0] === fenceChar && match[1].length >= fenceLen) {
        fenceChar = null;
      }
    }
  }
  return fenced;
}

/**
 * Detect GFM table blocks: a header row (containing `|`), a delimiter row, then
 * data rows (non-blank, containing `|`). Returns each block as its line indices.
 * Lines inside fenced code blocks (``` or ~~~) are skipped.
 */
export function findMarkdownTables(lines: string[]): number[][] {
  const tables: number[][] = [];
  const fenced = computeFencedLines(lines);
  let i = 0;
  while (i < lines.length) {
    if (fenced[i]) {
      i++;
      continue;
    }
    const isHeader = findPipePositions(lines[i]).length > 0;
    if (
      isHeader &&
      i + 1 < lines.length &&
      !fenced[i + 1] &&
      isDelimiterRow(lines[i + 1])
    ) {
      const block = [i, i + 1];
      let j = i + 2;
      while (
        j < lines.length &&
        !fenced[j] &&
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

// ── CSV / TSV column alignment ──────────────────────────────────────────

/** Delimiter used by each CSV-family language ID. */
const CSV_DELIMITERS = new Map<string, string>([
  ["csv", ","],
  ["tsv", "\t"],
]);

/**
 * Char indices of the field delimiters in one CSV/TSV line. Follows RFC 4180
 * quoting: a delimiter inside a double-quoted field is content, and `""` is
 * an escaped quote that keeps the quoted state. Quoted fields spanning
 * multiple lines are not tracked (single-line scope, like the other finders).
 */
export function findCsvDelimiterPositions(
  lineText: string,
  delimiter: string
): number[] {
  const positions: number[] = [];
  let inQuotes = false;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (ch === '"') {
      if (inQuotes && lineText[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      positions.push(i);
    }
  }
  return positions;
}

/**
 * Ghost-padding placements that align the delimiters of a CSV/TSV document
 * so each column's delimiter lines up at the widest cell. Alignment proceeds
 * column by column: every row's k-th delimiter is padded to the same visual
 * position, and the next column starts right after it — for TSV that start
 * snaps to the next tab stop, because the delimiter tab itself expands from
 * the aligned position. Cell widths are measured in visual columns, so tabs
 * and full-width characters count by their rendered width. Rows are matched
 * by delimiter index; rows without a k-th delimiter simply don't take part
 * in that column.
 */
export function computeCsvPaddings(
  lines: string[],
  delimiter: string,
  tabSize: number
): { lineIndex: number; character: number; padding: number }[] {
  const placements: { lineIndex: number; character: number; padding: number }[] = [];
  const rows: { lineIndex: number; delims: number[]; widths: number[] }[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const text = lines[lineIndex];
    const delims = findCsvDelimiterPositions(text, delimiter);
    if (delims.length === 0) {
      continue;
    }
    const widths = delims.map((d, k) => {
      const cellStart = k === 0 ? 0 : delims[k - 1] + 1;
      return visualColumn(text, d, tabSize) - visualColumn(text, cellStart, tabSize);
    });
    rows.push({ lineIndex, delims, widths });
  }

  let start = 0;
  for (let k = 0; ; k++) {
    const active = rows.filter((r) => r.delims.length > k);
    if (active.length === 0) {
      break;
    }
    const maxDelim = Math.max(...active.map((r) => start + r.widths[k]));
    for (const r of active) {
      const padding = maxDelim - (start + r.widths[k]);
      if (padding > 0) {
        placements.push({
          lineIndex: r.lineIndex,
          character: r.delims[k],
          padding,
        });
      }
    }
    start =
      delimiter === "\t"
        ? (Math.floor(maxDelim / tabSize) + 1) * tabSize
        : maxDelim + 1;
  }

  return placements;
}

// ── Visible-range mode for large files ──────────────────────────────────

/** Files with at least this many lines are decorated per visible range. */
const LARGE_FILE_LINE_THRESHOLD = 10000;

/** Extra lines scanned above/below the visible range before boundary expansion. */
const VISIBLE_RANGE_BUFFER = 100;

/** Hard cap on how far a group-boundary expansion may walk past the buffer. */
const GROUP_EXPANSION_LIMIT = 1000;

/**
 * Line range `[start, end]` to compute for a large file: the visible range
 * plus `buffer` lines, then extended in both directions while `isGroupLine`
 * says an alignment group continues, so a group straddling the visible
 * boundary is still aligned against all of its members. The expansion walks
 * at most `limit` lines each way, so a file where every line is a group line
 * cannot degrade back into a full scan.
 */
export function computeSliceBounds(
  lineCount: number,
  visibleStart: number,
  visibleEnd: number,
  isGroupLine: (line: number) => boolean,
  buffer: number = VISIBLE_RANGE_BUFFER,
  limit: number = GROUP_EXPANSION_LIMIT
): [number, number] {
  let start = Math.max(0, visibleStart - buffer);
  let end = Math.min(lineCount - 1, visibleEnd + buffer);
  const minStart = start;
  const maxEnd = end;
  while (start > 0 && minStart - start < limit && isGroupLine(start - 1)) {
    start--;
  }
  while (end < lineCount - 1 && end - maxEnd < limit && isGroupLine(end + 1)) {
    end++;
  }
  return [start, end];
}

/** Apply ghost-align decorations to a single editor. */
function decorateEditor(
  editor: vscode.TextEditor,
  config: vscode.WorkspaceConfiguration,
  ghostChar: string,
  ghostColor: string
) {
  const document = editor.document;
  const languageId = document.languageId;
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
  // Known limits of the slice view: a CSV/TSV table aligns to the widest
  // cell within the slice (the whole file is one table, so no boundary to
  // expand to), and Markdown fence state opened above the slice is not seen.
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
    placements = computeMarkdownTablePaddings(sliceLines(), tabSize);
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
