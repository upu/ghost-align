// ── Per-language operator finders + shared quote-state machine ───────────
//
// Locates the alignment-target occurrences of each supported operator
// (`=`, `:`, `=>`, `//`/`#`, and literal tokens) on a single line, aware of
// each language's string/comment syntax so operators inside them are never
// treated as alignment targets.

/** State for {@link advanceQuoteState}: the currently open quote char, or `false`. */
export type QuoteState = { quote: string | false; escaped: boolean };

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

/**
 * Languages where `'` is not a generic string delimiter: it opens a char
 * literal (`'x'`, `'\n'`) but far more often starts a lifetime (`'a`,
 * `&'static`) that is never closed on the line. Treating `'` as a quote
 * char there would swallow the rest of the line as "inside a string" (see
 * {@link rustCharLiteralEnd}).
 */
const LIFETIME_LANGUAGES = new Set(["rust"]);

/**
 * Language IDs with Python-style triple-quoted strings (`"""..."""` /
 * `'''...'''`) that can span multiple lines. Tracked by DocScanState's
 * `pyTripleDouble`/`pyTripleSingle` states (see resolveDocScanOptions /
 * advanceLineDocState) and by findAssignmentEquals's own single-line
 * handling. Ruby/PHP heredocs share the same root cause — a multi-line
 * string not carried across lines — but need a terminator identifier
 * carried alongside the state, so they get their own `{ kind: "heredoc" }`
 * DocScanState variant instead of reusing this one (see HEREDOC_LANGUAGES).
 */
const TRIPLE_QUOTE_LANGUAGES = new Set(["python"]);

/** {@link TEMPLATE_QUOTE_CHARS} without `'`, for {@link LIFETIME_LANGUAGES}. */
const NON_LIFETIME_QUOTE_CHARS = new Set<string>(['"', "`"]);

/**
 * Quote characters for findAssignmentEquals / findArrow, aware that
 * {@link LIFETIME_LANGUAGES} must not treat `'` as a generic quote char.
 */
function assignmentQuoteChars(languageId: string | undefined): ReadonlySet<string> {
  if (languageId !== undefined && LIFETIME_LANGUAGES.has(languageId)) {
    return NON_LIFETIME_QUOTE_CHARS;
  }
  return TEMPLATE_QUOTE_CHARS;
}

/**
 * If `lineText[i]` (a `'`) opens a Rust char literal — `'x'`, `'\n'`, `'\''`,
 * `'\u{7FFF}'` — returns the index just past its closing `'`. Otherwise (a
 * lifetime like `'a` or `'static`) returns -1 so the caller leaves the `'`
 * alone instead of treating it as an unterminated string open.
 */
function rustCharLiteralEnd(lineText: string, i: number): number {
  let j = i + 1;
  if (lineText[j] === undefined) {
    return -1;
  }
  if (lineText[j] === "\\") {
    j++;
    if (lineText[j] === "u" && lineText[j + 1] === "{") {
      const close = lineText.indexOf("}", j + 2);
      if (close === -1) {
        return -1;
      }
      j = close + 1;
    } else if (lineText[j] !== undefined) {
      j++; // one char after the backslash: n, t, ', \, 0, or a hex digit
    } else {
      return -1;
    }
  } else {
    j++;
  }
  return lineText[j] === "'" ? j + 1 : -1;
}

/**
 * If `lineText[i]` (an `r`) opens a Rust raw string literal — `r"..."`,
 * `r#"..."#`, `r##"..."##`, ... — returns the index just past its closing
 * `"` + matching number of `#`. Otherwise returns -1: `i` is not preceded by
 * an identifier character check failing (e.g. the `r` in `bar"..."` is the
 * tail of a longer identifier, not a raw-string prefix), the `r` isn't
 * followed by `#`*N + `"`, or the raw string doesn't close on this line
 * (multi-line raw strings are out of scope, matching the other finders'
 * single-line-only limitation).
 *
 * The number of `#` in the closing delimiter must exactly match the opening
 * one, so a raw string's content can safely contain a run of fewer `#` after
 * a `"` (e.g. `r##"a="#b"##`'s content has a literal `"#`) without closing
 * the string early — mirroring Rust's own delimiter-matching grammar.
 */
function rustRawStringEnd(lineText: string, i: number): number {
  const prev = lineText[i - 1];
  if (prev !== undefined && /[A-Za-z0-9_]/.test(prev)) {
    return -1; // `r` is the tail of a longer identifier, not a prefix
  }
  let j = i + 1;
  let hashes = 0;
  while (lineText[j] === "#") {
    hashes++;
    j++;
  }
  if (lineText[j] !== '"') {
    return -1;
  }
  const closeDelimiter = '"' + "#".repeat(hashes);
  const close = lineText.indexOf(closeDelimiter, j + 1);
  return close === -1 ? -1 : close + closeDelimiter.length;
}

/**
 * Result of {@link advanceCommentState} at one character position:
 *   - `false` — `ch` does not start a comment here
 *   - `"break"` — a comment runs from here to the end of the line; the caller
 *     should stop scanning
 *   - a number — `ch` opened a single-line-closed block comment; the caller
 *     should set its loop index to this value (the loop's own `i++` then
 *     advances past the closing `/`) and `continue`
 */
export type CommentAdvance = false | "break" | number;

/**
 * Shared comment-skipping step used by findColonOutsideString / findTsColon /
 * findCssColon / findAssignmentEquals / findArrow. Recognizes, in order:
 *   - a marker-based line comment (`opts.markers`, e.g. YAML's `#`), via
 *     {@link startsLineComment} — line start or after whitespace
 *   - C-style comments (`opts.cStyle`): `//` running to the end of the line
 *     (unless `opts.cStyleLineComment` is `false`, e.g. plain CSS which has no
 *     `//` syntax) and `/* ... *​/`, closed on the same line or else treated as
 *     running to the end of it
 *
 * Callers gate the whole check on whether a comment style even applies to the
 * current language, so this makes no language decisions itself beyond the
 * options passed in.
 */
export function advanceCommentState(
  lineText: string,
  i: number,
  ch: string,
  opts: {
    markers?: readonly string[];
    cStyle?: boolean;
    cStyleLineComment?: boolean;
  }
): CommentAdvance {
  if (opts.markers && startsLineComment(lineText, i, opts.markers)) {
    return "break";
  }
  if (opts.cStyle) {
    if (
      (opts.cStyleLineComment ?? true) &&
      ch === "/" &&
      lineText[i + 1] === "/"
    ) {
      return "break";
    }
    if (ch === "/" && lineText[i + 1] === "*") {
      const close = lineText.indexOf("*/", i + 2);
      return close === -1 ? "break" : close + 1;
    }
  }
  return false;
}

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
    const comment = advanceCommentState(lineText, i, ch, {
      markers,
      cStyle: cStyleComments,
    });
    if (comment === "break") {
      break; // comment to the end of the line
    }
    if (comment !== false) {
      i = comment; // loop's i++ advances past the closing `/`
      continue;
    }
    if (ch === ":") {
      results.push(i);
    }
  }
  return results;
}

/** Language IDs whose `:` is a CSS declaration separator, not a JSON/YAML key. */
export const CSS_LANGUAGES = new Set(["css", "scss", "less"]);

/** Language IDs whose `:` is a TS/JS type annotation or object-literal separator. */
export const TS_JS_LANGUAGES = new Set([
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
    const comment = advanceCommentState(lineText, i, ch, { cStyle: true });
    if (comment === "break") {
      break; // comment to the end of the line
    }
    if (comment !== false) {
      i = comment; // loop's i++ advances past the closing `/`
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
 * `{` of its own falls back to `insideBlock` (see {@link nextCssBlockDepth}):
 * the common multi-line declaration such as `  color: red;` is inside a block
 * left open by a previous line, so its first qualifying `:` is returned; a
 * multi-line selector continuation such as `.foo:hover,` is not (no block has
 * opened yet), so its `:` is excluded like any other selector pseudo-class.
 */
function findCssColon(
  lineText: string,
  languageId: string,
  insideBlock: boolean = true
): number[] {
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
    const comment = advanceCommentState(lineText, i, ch, {
      cStyle: true,
      cStyleLineComment: SCSS_LESS_LANGUAGES.has(languageId),
    });
    if (comment === "break") {
      break; // comment to the end of the line
    }
    if (comment !== false) {
      i = comment; // loop's i++ advances past the closing `/`
      continue;
    }
    if (ch === ":") {
      if (lineText[i + 1] === ":") {
        i++; // pseudo-element `::`
        continue;
      }
      if (braceIndex !== -1) {
        if (i < braceIndex) {
          continue; // selector pseudo-class, before the rule block
        }
      } else if (!insideBlock) {
        continue; // no `{` on this line and no block open yet: selector continuation
      }
      results.push(i);
    }
  }
  return results;
}

/**
 * Net change in CSS/SCSS/LESS `{`/`}` block depth across `lineText`, outside
 * strings and comments — the cross-line half of {@link findCssColon}'s
 * `insideBlock` parameter, since a single line cannot tell a multi-line
 * selector continuation from a multi-line declaration without knowing
 * whether a block was already open when the line started. Nested at-rules
 * (`@media { .a { ... } }`) are approximated with a single depth counter, so
 * a selector continuation nested inside an at-rule is a known limitation.
 */
function cssBlockDepthDelta(lineText: string, languageId: string): number {
  let delta = 0;
  const state = initialQuoteState();
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (advanceQuoteState(state, ch, TEMPLATE_QUOTE_CHARS)) {
      continue;
    }
    const comment = advanceCommentState(lineText, i, ch, {
      cStyle: true,
      cStyleLineComment: SCSS_LESS_LANGUAGES.has(languageId),
    });
    if (comment === "break") {
      break; // comment to the end of the line
    }
    if (comment !== false) {
      i = comment; // loop's i++ advances past the closing `/`
      continue;
    }
    if (ch === "{") {
      delta++;
    } else if (ch === "}") {
      delta--;
    }
  }
  return delta;
}

/**
 * CSS block depth after `lineText`, given the depth it started at (see
 * {@link cssBlockDepthDelta}). Clamped to 0 so a stray unmatched `}` cannot
 * push depth negative and desync `insideBlock` for the rest of the document.
 */
export function nextCssBlockDepth(
  lineText: string,
  depth: number,
  languageId: string
): number {
  return Math.max(0, depth + cssBlockDepthDelta(lineText, languageId));
}

/**
 * CSS block depth as of `lineCount` lines scanned via `lineAt`, without
 * computing per-line targets. Seeds a visible-range slice's starting depth
 * with whatever rule blocks opened above it left behind — mirrors
 * {@link computeLineStateBefore} / computeFenceStateBefore in markdown.ts,
 * which solve the same "a slice doesn't start at line 0" problem.
 */
export function computeCssBlockDepthBefore(
  lineCount: number,
  lineAt: (index: number) => string,
  languageId: string
): number {
  let depth = 0;
  for (let i = 0; i < lineCount; i++) {
    depth = nextCssBlockDepth(lineAt(i), depth, languageId);
  }
  return depth;
}

// ── YAML block-scalar continuation tracking ───────────────────────────────
//
// A YAML block scalar (`key: |` / `key: >`, optionally chomped `|-`/`|+`/
// `>-`/`>+`) is closed by indentation decreasing back to (or below) the key's
// own level, not by a delimiter character — unlike the CSS block-depth or
// Markdown fence tracking above/in markdown.ts. Its content is arbitrary text
// (a shell script in a GitHub Actions `run: |`, for instance), so any `:` in
// it must never be treated as a YAML mapping colon.

/** Leading whitespace character count — the raw indent YAML's own grammar compares, not a tab-aware visual column (paddings.ts's concern for on-screen alignment, not for this indent-based termination rule). */
function yamlLeadingWhitespace(lineText: string): number {
  let i = 0;
  while (i < lineText.length && (lineText[i] === " " || lineText[i] === "\t")) {
    i++;
  }
  return i;
}

/**
 * Trailing chunk after a YAML mapping colon that opens a block scalar: `|`/`>`
 * optionally followed by a chomping indicator (`-` strip / `+` keep), then
 * nothing but whitespace or a trailing `#` comment to the end of the line.
 */
const YAML_BLOCK_SCALAR_TAIL = /^\s*[|>][+-]?\s*(#.*)?$/;

/**
 * Leading-whitespace indent of `lineText` if it opens a YAML block scalar, or
 * null if it doesn't. Reuses findColonOutsideString so a `#` inside a comment
 * (`  # key: |`) or a `:` inside a quoted value (`key: ">"`) is never mistaken
 * for the mapping colon that introduces a scalar — findColonOutsideString
 * already excludes both from its results.
 */
function yamlBlockScalarHeaderIndent(lineText: string): number | null {
  const colons = findColonOutsideString(lineText, "yaml");
  if (colons.length === 0) {
    return null;
  }
  const rest = lineText.slice(colons[colons.length - 1] + 1);
  return YAML_BLOCK_SCALAR_TAIL.test(rest)
    ? yamlLeadingWhitespace(lineText)
    : null;
}

/**
 * YAML block-scalar continuation state: `null` when the current line starts
 * as plain YAML, otherwise the leading-whitespace indent of the `key: |` /
 * `key: >` line that opened the scalar. Every following line indented deeper
 * than that (or blank) is opaque block-scalar content, until indentation
 * returns to that level or shallower, or EOF — mirrors CSS block depth
 * (nextCssBlockDepth) and Markdown fence state (computeFenceStateBefore in
 * markdown.ts) for the same "state doesn't reset every line" problem, but
 * keyed on indentation instead of a delimiter, since that's how a block
 * scalar actually ends.
 */
export type YamlBlockScalarState = number | null;

/**
 * Whether `lineText` is itself opaque block-scalar content, given the state
 * as of the line *before* it. Blank/whitespace-only lines stay inside the
 * scalar unconditionally — a blank line never decides termination. Any other
 * line is content only while indented deeper than `state`; a line whose
 * indentation has dropped back to or below it is not content — it's either
 * the scalar's terminator or an unrelated YAML line, and either way is
 * scanned normally rather than treated as opaque.
 */
export function isYamlBlockScalarContent(
  lineText: string,
  state: YamlBlockScalarState
): boolean {
  if (state === null) {
    return false;
  }
  const indent = yamlLeadingWhitespace(lineText);
  return indent === lineText.length || indent > state;
}

/**
 * The {@link YamlBlockScalarState} that follows `lineText`, given the state
 * it started in. A line already inside a scalar (per
 * {@link isYamlBlockScalarContent}) leaves the state unchanged; otherwise
 * checks whether `lineText` itself opens a new block scalar — including the
 * case where the same line both ends a previous scalar (indentation back to
 * the key's level) and immediately opens another one.
 */
export function nextYamlBlockScalarState(
  lineText: string,
  state: YamlBlockScalarState
): YamlBlockScalarState {
  if (isYamlBlockScalarContent(lineText, state)) {
    return state;
  }
  return yamlBlockScalarHeaderIndent(lineText);
}

/**
 * {@link YamlBlockScalarState} as of `lineCount` lines scanned via `lineAt`,
 * without computing per-line alignment targets. Seeds a visible-range slice's
 * starting state with whatever block scalar opened above it left behind —
 * mirrors {@link computeCssBlockDepthBefore} / computeFenceStateBefore in
 * markdown.ts, which solve the same "a slice doesn't start at line 0" problem.
 */
export function computeYamlBlockScalarStateBefore(
  lineCount: number,
  lineAt: (index: number) => string
): YamlBlockScalarState {
  let state: YamlBlockScalarState = null;
  for (let i = 0; i < lineCount; i++) {
    state = nextYamlBlockScalarState(lineAt(i), state);
  }
  return state;
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

/** Language IDs whose numeric literals use `'` as a C++14 digit separator (`1'000'000`), not a quote. */
const DIGIT_SEPARATOR_LANGUAGES = new Set(["c", "cpp"]);

/** Whether `ch` is a hex/decimal digit, i.e. a valid neighbor of a C++14 digit-separator `'`. */
function isDigitSeparatorNeighbor(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9a-fA-F]/.test(ch);
}

/**
 * Result of {@link advanceCodeScan} at one character position:
 *   - `{ kind: "code" }` — `ch` is itself a normal code character; the caller
 *     should run its own token-matching logic for this iteration
 *   - `{ kind: "skip", nextIndex }` — `ch` was consumed by a string/escape,
 *     comment, or language-specific literal; the caller should set its loop
 *     index to `nextIndex - 1` (the loop's own `i++` then lands on
 *     `nextIndex`) and `continue`
 *   - `{ kind: "stop" }` — scanning should end here (a comment running to the
 *     end of the line, or an unterminated Python triple-quote): the caller
 *     should `break` out of its loop
 */
type CodeScanStep =
  | { kind: "code" }
  | { kind: "skip"; nextIndex: number }
  | { kind: "stop" };

/**
 * Per-language skip rules {@link advanceCodeScan} applies. One flag/option
 * per rule so each call site opts into exactly the set it needs, preserving
 * the differences between findAssignmentEquals / findArrow /
 * findLineContinuationMarker instead of silently unifying them (see #243):
 * e.g. only findAssignmentEquals skips Python triple-quotes, and
 * findArrow is the only one of the three with no digit-separator handling —
 * both match each function's behavior from before this refactor.
 */
interface CodeScanOptions {
  quoteChars: ReadonlySet<string>;
  markers?: readonly string[];
  cStyle: boolean;
  cStyleLineComment?: boolean;
  lifetimeLang?: boolean;
  digitSeparators?: boolean;
  pyTripleQuote?: boolean;
}

/**
 * Shared per-character skip step for findAssignmentEquals / findArrow /
 * findLineContinuationMarker (see #243). These three finders each need to
 * tell real code apart from the same set of things — a Rust char literal
 * (`'x'`) or raw string (`r#"..."#`), a C++14 digit separator (`1'000`), a
 * Python triple-quote (`"""`/`'''`), a quoted string, or a comment — before
 * deciding whether `ch` is a candidate for the operator they're each looking
 * for. This consolidates that shared skip logic into one step function so a
 * language-specific exception is added in one place instead of three.
 * Mutates `quoteState` in place, same as {@link advanceQuoteState}.
 */
function advanceCodeScan(
  lineText: string,
  i: number,
  ch: string,
  quoteState: QuoteState,
  opts: CodeScanOptions
): CodeScanStep {
  if (opts.lifetimeLang && quoteState.quote === false && ch === "'") {
    const end = rustCharLiteralEnd(lineText, i);
    if (end !== -1) {
      return { kind: "skip", nextIndex: end };
    }
    // Otherwise a lifetime (`'a`, `'static`): leave the `'` alone below.
  }
  if (opts.lifetimeLang && quoteState.quote === false && ch === "r") {
    const end = rustRawStringEnd(lineText, i);
    if (end !== -1) {
      return { kind: "skip", nextIndex: end };
    }
  }
  if (
    ch === "'" &&
    !quoteState.quote &&
    opts.digitSeparators &&
    isDigitSeparatorNeighbor(lineText[i - 1]) &&
    isDigitSeparatorNeighbor(lineText[i + 1])
  ) {
    return { kind: "skip", nextIndex: i + 1 }; // C++14 digit separator (1'000'000), not a quote
  }
  if (
    opts.pyTripleQuote &&
    !quoteState.quote &&
    (ch === '"' || ch === "'") &&
    lineText[i + 1] === ch &&
    lineText[i + 2] === ch
  ) {
    // Python triple-quote (""" or '''): recognized as one token so an odd
    // number of embedded same-char quotes in its content can't desync the
    // naive single-char toggle below into treating embedded code as real.
    const close = scanClosingTripleQuote(lineText, i + 3, ch);
    if (close === -1) {
      return { kind: "stop" }; // unterminated on this line: nothing after it is code
    }
    return { kind: "skip", nextIndex: close + 1 };
  }
  if (advanceQuoteState(quoteState, ch, opts.quoteChars)) {
    return { kind: "skip", nextIndex: i + 1 };
  }
  const comment = advanceCommentState(lineText, i, ch, {
    markers: opts.markers,
    cStyle: opts.cStyle,
    cStyleLineComment: opts.cStyleLineComment,
  });
  if (comment === "break") {
    return { kind: "stop" }; // comment to the end of the line
  }
  if (comment !== false) {
    return { kind: "skip", nextIndex: comment + 1 };
  }
  return { kind: "code" };
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
 * For C/C++ (DIGIT_SEPARATOR_LANGUAGES), a `'` flanked by hex/decimal digits
 * on both sides (`1'000`, `0x1'000`) is a digit separator, not a quote: it is
 * skipped rather than opening a string, so it cannot swallow the rest of the
 * line. A char literal like `'a'` / `'\0'` / `'='` still opens a real quote
 * because at least one side of its `'` is not a digit.
 *
 * Block comments and template literals spanning multiple lines are not
 * tracked: this function sees one line at a time, so a `/*` without a
 * comment running to the end of the line.
 */
export function findAssignmentEquals(
  lineText: string,
  languageId?: string
): OperatorTarget[] {
  const results: OperatorTarget[] = [];
  const markers = lineCommentMarkers(languageId);
  const cStyle =
    markers === undefined ||
    (languageId !== undefined && C_STYLE_COMMENT_ALSO.has(languageId));
  const opts: CodeScanOptions = {
    quoteChars: assignmentQuoteChars(languageId),
    markers,
    cStyle,
    lifetimeLang: languageId !== undefined && LIFETIME_LANGUAGES.has(languageId),
    digitSeparators:
      languageId !== undefined && DIGIT_SEPARATOR_LANGUAGES.has(languageId),
    pyTripleQuote:
      languageId !== undefined && TRIPLE_QUOTE_LANGUAGES.has(languageId),
  };
  const quoteState = initialQuoteState();
  let depth = 0;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    const step = advanceCodeScan(lineText, i, ch, quoteState, opts);
    if (step.kind === "stop") {
      break; // comment to the end of the line, or an unterminated triple-quote
    }
    if (step.kind === "skip") {
      i = step.nextIndex - 1; // loop's i++ advances to nextIndex
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
 *
 * For {@link LIFETIME_LANGUAGES} (Rust), `'` is not treated as a generic
 * quote char — see {@link assignmentQuoteChars} / {@link rustCharLiteralEnd} —
 * so a lifetime like `&'a str` before a match arm's `=>` does not swallow it.
 */
function findArrow(lineText: string, languageId?: string): number[] {
  const results: number[] = [];
  const opts: CodeScanOptions = {
    quoteChars: assignmentQuoteChars(languageId),
    cStyle: true,
    lifetimeLang: languageId !== undefined && LIFETIME_LANGUAGES.has(languageId),
  };
  const quoteState = initialQuoteState();
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    const step = advanceCodeScan(lineText, i, ch, quoteState, opts);
    if (step.kind === "stop") {
      break; // comment to the end of the line
    }
    if (step.kind === "skip") {
      i = step.nextIndex - 1; // loop's i++ advances to nextIndex
      continue;
    }
    if (ch === "=" && lineText[i + 1] === ">" && lineText[i - 1] !== "<") {
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

/**
 * The literal operator token for the line-continuation marker (a trailing
 * `\`, as used by shell/Makefile/C-preprocessor line-splicing). Exported so
 * callers outside findOccurrences (e.g. findAlignmentGroups's indent-based
 * group-splitting) can recognize this operator without duplicating the
 * string literal.
 */
export const LINE_CONTINUATION_OPERATOR = "\\";

/**
 * Index of a trailing line-continuation marker `\` — the last non-whitespace
 * character on the line — or -1. Distinguishes a real continuation marker
 * from a `\` that merely appears at the end of a string/escape sequence on
 * the same line: the trailing `\` counts only if it is reached while
 * scanning outside any open quote (an unterminated string swallows it as an
 * escape char, not a continuation) and before any comment that runs to the
 * end of the line (a commented-out line's trailing `\` has no continuation
 * meaning either). Mirrors the quote/comment/digit-separator handling
 * findAssignmentEquals already does per language, so e.g. C/C++'s `#define`
 * continuations are unaffected by a `'` digit separator (`1'000`) and are
 * not mistaken for a comment (C/C++ are not in LINE_COMMENT_MARKERS_BY_LANGUAGE,
 * so `#` there is left to cStyle handling, i.e. not a comment marker at all).
 * A `\` that is not the line's last non-whitespace character never reaches
 * this far — it's excluded up front, so mid-line escapes (`echo \ foo`) are
 * never candidates.
 */
function findLineContinuationMarker(
  lineText: string,
  languageId?: string
): number {
  let end = lineText.length;
  while (end > 0 && (lineText[end - 1] === " " || lineText[end - 1] === "\t")) {
    end--;
  }
  if (end === 0 || lineText[end - 1] !== "\\") {
    return -1;
  }
  const idx = end - 1;
  const markers = lineCommentMarkers(languageId);
  const cStyle =
    markers === undefined ||
    (languageId !== undefined && C_STYLE_COMMENT_ALSO.has(languageId));
  const opts: CodeScanOptions = {
    quoteChars: assignmentQuoteChars(languageId),
    markers,
    cStyle,
    digitSeparators:
      languageId !== undefined && DIGIT_SEPARATOR_LANGUAGES.has(languageId),
  };
  const quoteState = initialQuoteState();
  for (let i = 0; i < idx; i++) {
    const ch = lineText[i];
    const step = advanceCodeScan(lineText, i, ch, quoteState, opts);
    if (step.kind === "stop") {
      return -1; // trailing `\` is inside a comment, not a real continuation
    }
    if (step.kind === "skip") {
      i = step.nextIndex - 1; // loop's i++ advances to nextIndex
      continue;
    }
  }
  return quoteState.quote ? -1 : idx; // -1: trailing `\` inside an unterminated string
}

/** All occurrences of a single operator token on a line, in order. */
function findOccurrences(
  lineText: string,
  op: string,
  languageId?: string,
  cssInsideBlock: boolean = true
): OperatorTarget[] {
  if (op === "=") {
    return findAssignmentEquals(lineText, languageId);
  }
  if (op === ":") {
    let indices: number[];
    if (languageId && CSS_LANGUAGES.has(languageId)) {
      indices = findCssColon(lineText, languageId, cssInsideBlock);
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
    return findArrow(lineText, languageId).map((i) => ({ insert: i, align: i }));
  }
  if (op === LINE_CONTINUATION_OPERATOR) {
    const idx = findLineContinuationMarker(lineText, languageId);
    return idx === -1 ? [] : [{ insert: idx, align: idx }];
  }
  return findLiteralOccurrences(lineText, op, languageId);
}

/**
 * All occurrences of a literal operator token — a `ghostAlign.operators`
 * entry that isn't one of the built-in tokens (`=`, `:`, `=>`, `//`, `#`,
 * `\`) — on a line, outside strings and comments. Shares the same
 * string/comment/Rust-char-literal/raw-string/digit-separator skipping as
 * findAssignmentEquals via {@link advanceCodeScan}, so a custom token like
 * `->` or `::` is excluded from string and comment content exactly the same
 * way the built-in tokens already are, instead of a plain `indexOf` that
 * matched anywhere on the line regardless of context.
 */
function findLiteralOccurrences(
  lineText: string,
  op: string,
  languageId?: string
): OperatorTarget[] {
  const results: OperatorTarget[] = [];
  const markers = lineCommentMarkers(languageId);
  const cStyle =
    markers === undefined ||
    (languageId !== undefined && C_STYLE_COMMENT_ALSO.has(languageId));
  const opts: CodeScanOptions = {
    quoteChars: assignmentQuoteChars(languageId),
    markers,
    cStyle,
    lifetimeLang: languageId !== undefined && LIFETIME_LANGUAGES.has(languageId),
    digitSeparators:
      languageId !== undefined && DIGIT_SEPARATOR_LANGUAGES.has(languageId),
    pyTripleQuote:
      languageId !== undefined && TRIPLE_QUOTE_LANGUAGES.has(languageId),
  };
  const quoteState = initialQuoteState();
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    const step = advanceCodeScan(lineText, i, ch, quoteState, opts);
    if (step.kind === "stop") {
      break; // comment to the end of the line, or an unterminated triple-quote
    }
    if (step.kind === "skip") {
      i = step.nextIndex - 1; // loop's i++ advances to nextIndex
      continue;
    }
    if (lineText.startsWith(op, i)) {
      results.push({ insert: i, align: i });
      i += op.length - 1; // loop's i++ advances past the matched token
    }
  }
  return results;
}

// ── Multi-line block-comment / template-literal / triple-quote tracking ───
//
// Every finder above sees one line at a time, so a `/* ... */` block comment,
// a `` `...` `` template literal, or a Python `"""`/`'''` triple-quoted
// string spanning multiple lines cannot be recognized as such from within a
// single line: each finder just treats an unclosed comment-open, backtick, or
// triple-quote as running to the end of that one line, with nothing carried
// over to the next. The functions below compute, for a document (or a slice
// of one), the state each line *starts* in — plain code, inside a block
// comment, inside a template literal, or inside a Python triple-quoted string
// — so callers can seed findOperatorTargets with it instead of always
// assuming line 0 starts as plain code.

/**
 * State a line can start a scan in, once block comments/template
 * literals/Python triple-quoted strings/Ruby-PHP heredocs may span lines.
 * `pyTripleDouble` / `pyTripleSingle` track which of `"""` / `'''` is open,
 * since only the same kind of triple-quote closes it (Python does not let
 * one close the other). The heredoc variant carries its own `terminator`
 * instead of being one of a fixed enum: unlike the other constructs, what
 * closes a heredoc body depends on which identifier its opener declared
 * (`<<~SQL` is closed by a line that is just `SQL`, not by any other
 * heredoc's terminator).
 */
export type DocScanState =
  | "code"
  | "blockComment"
  | "template"
  | "pyTripleDouble"
  | "pyTripleSingle"
  | { kind: "heredoc"; terminator: string };

/** Language IDs with heredoc/nowdoc constructs whose body spans multiple lines (see #239). */
const HEREDOC_LANGUAGES = new Set(["ruby", "php"]);

/**
 * Ruby heredoc opener: `<<SQL`, `<<-SQL` (indented terminator allowed),
 * `<<~SQL` (indented terminator allowed, content indentation squiggly-
 * stripped — irrelevant here since only the terminator matters for this
 * plugin), and the quoted forms `<<~"SQL"` / `<<~'SQL'` (quoting applies to
 * all three modifiers alike). Capture groups 1/2/3 are the identifier from
 * whichever quoting form matched.
 */
const RUBY_HEREDOC_OPENER = /<<[~-]?(?:"([A-Za-z_]\w*)"|'([A-Za-z_]\w*)'|([A-Za-z_]\w*))/;

/**
 * Character that would make a preceding `<<` Ruby's left-shift operator (it
 * has a left operand, e.g. `x << 2`, `arr << item`) rather than a heredoc
 * opener. A heredoc opener is preceded by nothing but whitespace, `=`, `(`,
 * `,`, or similar — never a value.
 */
function precedesShiftOperand(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_)\]"'`]/.test(ch);
}

/** PHP heredoc (`<<<EOT`, `<<<"EOT"`) / nowdoc (`<<<'EOT'`) opener. Capture groups 1/2/3 are the identifier from whichever quoting form matched. */
const PHP_HEREDOC_OPENER = /<<<\s*(?:'([A-Za-z_]\w*)'|"([A-Za-z_]\w*)"|([A-Za-z_]\w*))/;

/**
 * If `lineText` opens a Ruby heredoc or PHP heredoc/nowdoc, the terminator
 * identifier that closes it; otherwise null. Skips string/comment content
 * the same way the single-line finders do, so a `<<` inside a string or a
 * `#`/`//` comment is never mistaken for an opener. Only the first opener on
 * the line is recognized — multiple heredocs opened on one line
 * (`f(<<~A, <<~B)`) are a known limitation (see #239).
 */
function findHeredocOpener(
  lineText: string,
  languageId: "ruby" | "php"
): string | null {
  const markers = lineCommentMarkers(languageId);
  const cStyle = C_STYLE_COMMENT_ALSO.has(languageId);
  const quoteState = initialQuoteState();
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (advanceQuoteState(quoteState, ch, TEMPLATE_QUOTE_CHARS)) {
      continue;
    }
    const comment = advanceCommentState(lineText, i, ch, { markers, cStyle });
    if (comment === "break") {
      break;
    }
    if (comment !== false) {
      i = comment;
      continue;
    }
    if (
      languageId === "php" &&
      ch === "<" &&
      lineText[i + 1] === "<" &&
      lineText[i + 2] === "<"
    ) {
      const m = PHP_HEREDOC_OPENER.exec(lineText.slice(i));
      if (m) {
        return m[1] ?? m[2] ?? m[3];
      }
    }
    if (
      languageId === "ruby" &&
      ch === "<" &&
      lineText[i + 1] === "<" &&
      !precedesShiftOperand(lineText[i - 1])
    ) {
      const m = RUBY_HEREDOC_OPENER.exec(lineText.slice(i));
      if (m) {
        return m[1] ?? m[2] ?? m[3];
      }
    }
  }
  return null;
}

/**
 * Whether `lineText` is the line that closes a heredoc opened with
 * `terminator`. Leading/trailing whitespace and trailing punctuation (`;`,
 * `,`, `)`, ...) are tolerated — Ruby's `<<-`/`<<~` and PHP's flexible
 * heredoc/nowdoc syntax (PHP 7.3+) both allow an indented terminator, and
 * PHP conventionally follows it with a statement terminator (`EOT;`). Being
 * lenient about the stricter plain `<<EOS` form (which technically requires
 * column 0) is an acceptable approximation for a visual-alignment tool. Only
 * rejects a line where the terminator is a prefix of a longer identifier
 * (`EOTX` does not close a `EOT` heredoc).
 */
function isHeredocTerminatorLine(lineText: string, terminator: string): boolean {
  const trimmed = lineText.trim();
  if (!trimmed.startsWith(terminator)) {
    return false;
  }
  const after = trimmed[terminator.length];
  return after === undefined || !/\w/.test(after);
}

/**
 * Which multi-line constructs apply to `languageId`, mirroring the same rules
 * the single-line finders already use: `cStyle` follows the C-style
 * comment-support decision in findAssignmentEquals (marker-only languages,
 * e.g. Python/YAML, don't get it; PHP gets both; plain JSON has no comment
 * syntax at all, unlike JSONC). `template` is TS/JS-only — the languages
 * with real template-literal syntax. `pyTripleQuote` is
 * {@link TRIPLE_QUOTE_LANGUAGES} (Python); `markers` is only resolved for
 * those languages, so advanceLineDocState can tell a `#` line comment from a
 * `"""` that starts a docstring instead of one appearing inside a comment.
 * `heredocLanguage` is {@link HEREDOC_LANGUAGES} (Ruby/PHP); unlike
 * `markers`, {@link findHeredocOpener} resolves its own comment markers
 * internally, so it stays independent of the other constructs' options here.
 */
function resolveDocScanOptions(
  languageId: string | undefined
): {
  cStyle: boolean;
  template: boolean;
  pyTripleQuote: boolean;
  markers?: readonly string[];
  heredocLanguage?: "ruby" | "php";
} {
  const isMarkerOnly =
    languageId !== undefined &&
    Object.prototype.hasOwnProperty.call(
      LINE_COMMENT_MARKERS_BY_LANGUAGE,
      languageId
    ) &&
    !C_STYLE_COMMENT_ALSO.has(languageId);
  const cStyle = languageId !== "json" && !isMarkerOnly;
  const template = languageId !== undefined && TS_JS_LANGUAGES.has(languageId);
  const pyTripleQuote =
    languageId !== undefined && TRIPLE_QUOTE_LANGUAGES.has(languageId);
  const heredocLanguage =
    languageId !== undefined && HEREDOC_LANGUAGES.has(languageId)
      ? (languageId as "ruby" | "php")
      : undefined;
  return {
    cStyle,
    template,
    pyTripleQuote,
    markers: pyTripleQuote ? lineCommentMarkers(languageId) : undefined,
    heredocLanguage,
  };
}

/** Index of `quoteChar`'s matching close in `lineText` from `from` (respecting `\` escapes), or -1. */
function scanClosingQuote(
  lineText: string,
  from: number,
  quoteChar: string
): number {
  const state: QuoteState = { quote: quoteChar, escaped: false };
  for (let i = from; i < lineText.length; i++) {
    advanceQuoteState(state, lineText[i], TEMPLATE_QUOTE_CHARS);
    if (!state.quote) {
      return i;
    }
  }
  return -1;
}

/**
 * Index of the last character of a Python triple-quote's (`"""`/`'''`)
 * matching close in `lineText` from `from` (respecting `\` escapes on the
 * individual quote char), or -1. Used both by findAssignmentEquals (same-line
 * open+close) and by advanceLineDocState/skipToCodeStart (cross-line carry).
 */
function scanClosingTripleQuote(
  lineText: string,
  from: number,
  quoteChar: string
): number {
  let escaped = false;
  for (let i = from; i < lineText.length; i++) {
    const ch = lineText[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === quoteChar && lineText[i + 1] === quoteChar && lineText[i + 2] === quoteChar) {
      return i + 2;
    }
  }
  return -1;
}

/**
 * The plain-code end state for a line, checking whether it opens a heredoc
 * (Ruby/PHP only, via `heredocLanguage`) before settling on `"code"`. Shared
 * by every "rest of the line carries nothing over" exit point in
 * {@link advanceLineDocState} — a line comment starting mid-line, a
 * single-line-closed `//`, or simply reaching the end of the line — since a
 * heredoc opener can precede any of those (`sql = <<~SQL # comment`, `sql =
 * <<~SQL`, ...) and {@link findHeredocOpener} already does its own
 * comment/string-aware scan of the full line regardless of where in it the
 * caller stopped.
 */
function codeEndState(
  lineText: string,
  heredocLanguage: "ruby" | "php" | undefined
): DocScanState {
  if (heredocLanguage) {
    const terminator = findHeredocOpener(lineText, heredocLanguage);
    if (terminator !== null) {
      return { kind: "heredoc", terminator };
    }
  }
  return "code";
}

/**
 * The {@link DocScanState} that follows `lineText`, given the state it
 * started in. Mirrors the comment/quote handling the finders already do per
 * line, but carries an unterminated block comment, template literal, Python
 * triple-quoted string, or Ruby/PHP heredoc into the next line instead of
 * resetting at the line boundary.
 *
 * Does not model `${...}` interpolation inside a template literal (real code,
 * including its own strings/comments, can appear there) — a `` ` `` found
 * while scanning one is treated as closing it, the same simplification the
 * single-line finders already make for template literals.
 */
function advanceLineDocState(
  lineText: string,
  state: DocScanState,
  opts: {
    cStyle: boolean;
    template: boolean;
    pyTripleQuote: boolean;
    markers?: readonly string[];
    heredocLanguage?: "ruby" | "php";
  }
): DocScanState {
  let i = 0;
  if (typeof state === "object") {
    if (!isHeredocTerminatorLine(lineText, state.terminator)) {
      return state; // still inside the heredoc body
    }
    // terminator line: fall through and scan it (i = 0) like any other line
  } else if (state === "blockComment") {
    const close = lineText.indexOf("*/");
    if (close === -1) {
      return "blockComment";
    }
    i = close + 2;
  } else if (state === "template") {
    const close = scanClosingQuote(lineText, 0, "`");
    if (close === -1) {
      return "template";
    }
    i = close + 1;
  } else if (state === "pyTripleDouble" || state === "pyTripleSingle") {
    const quoteChar = state === "pyTripleDouble" ? '"' : "'";
    const close = scanClosingTripleQuote(lineText, 0, quoteChar);
    if (close === -1) {
      return state;
    }
    i = close + 1;
  }
  const quote = initialQuoteState();
  const quoteChars = opts.template ? new Set<string>(['"', "'"]) : TEMPLATE_QUOTE_CHARS;
  for (; i < lineText.length; i++) {
    const ch = lineText[i];
    if (
      opts.markers &&
      !quote.quote &&
      startsLineComment(lineText, i, opts.markers)
    ) {
      return codeEndState(lineText, opts.heredocLanguage); // rest of the line is a line comment; nothing carries over
    }
    if (
      opts.pyTripleQuote &&
      !quote.quote &&
      (ch === '"' || ch === "'") &&
      lineText[i + 1] === ch &&
      lineText[i + 2] === ch
    ) {
      const close = scanClosingTripleQuote(lineText, i + 3, ch);
      if (close === -1) {
        return ch === '"' ? "pyTripleDouble" : "pyTripleSingle";
      }
      i = close;
      continue;
    }
    if (advanceQuoteState(quote, ch, quoteChars)) {
      continue;
    }
    if (opts.template && ch === "`") {
      const close = scanClosingQuote(lineText, i + 1, "`");
      if (close === -1) {
        return "template";
      }
      i = close;
      continue;
    }
    if (opts.cStyle) {
      if (ch === "/" && lineText[i + 1] === "/") {
        return codeEndState(lineText, opts.heredocLanguage); // rest of the line is a line comment; nothing carries over
      }
      if (ch === "/" && lineText[i + 1] === "*") {
        const close = lineText.indexOf("*/", i + 2);
        if (close === -1) {
          return "blockComment";
        }
        i = close + 1;
        continue;
      }
    }
  }
  return codeEndState(lineText, opts.heredocLanguage);
}

/**
 * Advances {@link DocScanState} across `lineText` for `languageId`, applying
 * that language's cStyle/template/pyTripleQuote/heredoc rules. Exported so
 * callers with their own line loop (e.g. findAlignmentGroups) can track
 * document state one line at a time without needing
 * {@link resolveDocScanOptions} / {@link advanceLineDocState}.
 */
export function nextDocScanState(
  lineText: string,
  state: DocScanState,
  languageId?: string
): DocScanState {
  const opts = resolveDocScanOptions(languageId);
  if (!opts.cStyle && !opts.template && !opts.pyTripleQuote && !opts.heredocLanguage) {
    return "code"; // language has none of these constructs; state never leaves "code"
  }
  return advanceLineDocState(lineText, state, opts);
}

/**
 * The {@link DocScanState} as of `lineCount` lines scanned via `lineAt`,
 * without computing per-line operator targets. Used to seed the
 * visible-range slice's starting state with whatever a block comment or
 * template literal opened above it left behind — mirrors
 * computeFenceStateBefore in markdown.ts, which solves the same "a slice
 * doesn't start at line 0" problem for fenced code blocks.
 */
export function computeLineStateBefore(
  lineCount: number,
  lineAt: (index: number) => string,
  languageId?: string
): DocScanState {
  let state: DocScanState = "code";
  for (let i = 0; i < lineCount; i++) {
    state = nextDocScanState(lineAt(i), state, languageId);
  }
  return state;
}

// ── Unified cross-line scan state ─────────────────────────────────────────
//
// DocScanState, CSS block depth, and YamlBlockScalarState are each their own
// per-language rule for what "still open from the previous line" means, but
// callers that just need to carry state from one line to the next (findAlignmentGroups,
// computeDocumentPlacements, decorateEditor) don't care about that per-language
// distinction — they only need one bundle to hold, advance, and pre-scan.
// LineScanState is that bundle: adding a 4th cross-line construct (e.g. #225's
// Ruby/PHP heredoc) means adding one field here plus one branch in
// nextLineScanState, without touching any of those callers' signatures.

/** Bundles every per-language cross-line scan state a single document position can be in. */
export type LineScanState = {
  doc: DocScanState;
  cssBlockDepth: number;
  yamlBlockScalar: YamlBlockScalarState;
};

/** The {@link LineScanState} for the top of a document (or a slice with nothing above it). */
export function initialLineScanState(): LineScanState {
  return { doc: "code", cssBlockDepth: 0, yamlBlockScalar: null };
}

/**
 * The {@link LineScanState} that follows `lineText`, given the state it
 * started in. Each field advances via its own existing per-language rule
 * (nextDocScanState / nextCssBlockDepth / nextYamlBlockScalarState), gated the
 * same way findAlignmentGroups already gated them before this consolidation:
 * CSS block depth only moves for {@link CSS_LANGUAGES}, YAML block-scalar
 * state only for `"yaml"` — otherwise a language whose own syntax uses `{}`
 * or indentation differently would desync the other languages' trackers.
 */
export function nextLineScanState(
  lineText: string,
  state: LineScanState,
  languageId?: string
): LineScanState {
  return {
    doc: nextDocScanState(lineText, state.doc, languageId),
    cssBlockDepth:
      languageId !== undefined && CSS_LANGUAGES.has(languageId)
        ? nextCssBlockDepth(lineText, state.cssBlockDepth, languageId)
        : state.cssBlockDepth,
    yamlBlockScalar:
      languageId === "yaml"
        ? nextYamlBlockScalarState(lineText, state.yamlBlockScalar)
        : state.yamlBlockScalar,
  };
}

/**
 * The {@link LineScanState} as of `lineCount` lines scanned via `lineAt`,
 * without computing per-line alignment targets. Seeds a visible-range
 * slice's starting state with whatever a block comment, template literal,
 * CSS rule block, or YAML block scalar opened above it left behind — the
 * single pre-scan that replaces the three separate ones
 * (computeLineStateBefore / computeCssBlockDepthBefore /
 * computeYamlBlockScalarStateBefore) a caller used to run individually.
 */
export function computeLineScanStateBefore(
  lineCount: number,
  lineAt: (index: number) => string,
  languageId?: string
): LineScanState {
  let state = initialLineScanState();
  for (let i = 0; i < lineCount; i++) {
    state = nextLineScanState(lineAt(i), state, languageId);
  }
  return state;
}

/**
 * Char index in `lineText` where normal scanning resumes given `state`, or
 * null if the whole line is still inside a block comment/template
 * literal/Python triple-quoted string/Ruby-PHP heredoc that doesn't close
 * on it.
 */
function skipToCodeStart(lineText: string, state: DocScanState): number | null {
  if (state === "code") {
    return 0;
  }
  if (typeof state === "object") {
    return isHeredocTerminatorLine(lineText, state.terminator) ? 0 : null;
  }
  if (state === "blockComment") {
    const close = lineText.indexOf("*/");
    return close === -1 ? null : close + 2;
  }
  if (state === "template") {
    const close = scanClosingQuote(lineText, 0, "`");
    return close === -1 ? null : close + 1;
  }
  const quoteChar = state === "pyTripleDouble" ? '"' : "'";
  const close = scanClosingTripleQuote(lineText, 0, quoteChar);
  return close === -1 ? null : close + 1;
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
 *
 * `cssInsideBlock` (see {@link nextCssBlockDepth}) only affects the `:`
 * operator on CSS/SCSS/LESS lines with no `{` of their own: it tells
 * {@link findCssColon} whether the line continues a declaration block or a
 * multi-line selector. Defaults to `true` (declaration context), matching
 * this function's previous behavior for callers that scan a single line
 * without surrounding document context.
 */
export function findOperatorTargets(
  lineText: string,
  operators: string[],
  languageId?: string,
  initialState: DocScanState = "code",
  cssInsideBlock: boolean = true
): ColumnTarget[] {
  let text = lineText;
  let offset = 0;
  if (initialState !== "code") {
    const resolved = skipToCodeStart(lineText, initialState);
    if (resolved === null) {
      return []; // whole line still inside a block comment/template literal
    }
    offset = resolved;
    text = lineText.slice(offset);
  }
  const columns: ColumnTarget[] = [];
  let minIndex = 0;
  for (let opIndex = 0; opIndex < operators.length; opIndex++) {
    const occurrences = findOccurrences(text, operators[opIndex], languageId, cssInsideBlock);
    const match = occurrences.find((t) => t.insert >= minIndex);
    if (!match) {
      continue;
    }
    columns.push({
      opIndex,
      insert: match.insert + offset,
      align: match.align + offset,
    });
    minIndex = match.align + 1;
  }
  return columns;
}
