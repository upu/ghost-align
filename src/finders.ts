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
 * string not carried across lines — but are deferred to a follow-up (#225).
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
  const digitSeparators =
    languageId !== undefined && DIGIT_SEPARATOR_LANGUAGES.has(languageId);
  const cStyle =
    markers === undefined ||
    (languageId !== undefined && C_STYLE_COMMENT_ALSO.has(languageId));
  const isLifetimeLang =
    languageId !== undefined && LIFETIME_LANGUAGES.has(languageId);
  const pyTripleQuote =
    languageId !== undefined && TRIPLE_QUOTE_LANGUAGES.has(languageId);
  const quoteChars = assignmentQuoteChars(languageId);
  const state = initialQuoteState();
  let depth = 0;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (isLifetimeLang && state.quote === false && ch === "'") {
      const end = rustCharLiteralEnd(lineText, i);
      if (end !== -1) {
        i = end - 1; // loop's i++ advances past the closing `'`
        continue;
      }
      // Otherwise a lifetime (`'a`, `'static`): leave the `'` alone below.
    }
    if (
      ch === "'" &&
      !state.quote &&
      digitSeparators &&
      isDigitSeparatorNeighbor(lineText[i - 1]) &&
      isDigitSeparatorNeighbor(lineText[i + 1])
    ) {
      continue; // C++14 digit separator (1'000'000), not a quote
    }
    if (
      pyTripleQuote &&
      !state.quote &&
      (ch === '"' || ch === "'") &&
      lineText[i + 1] === ch &&
      lineText[i + 2] === ch
    ) {
      // Python triple-quote (""" or '''): recognized as one token so an
      // odd number of embedded same-char quotes in its content (e.g.
      // `x = """a "quote example = 1"""`) can't desync the naive
      // single-char toggle below into treating the embedded `=` as real.
      const close = scanClosingTripleQuote(lineText, i + 3, ch);
      if (close === -1) {
        break; // unterminated on this line: nothing after it is code
      }
      i = close; // loop's i++ advances past the closing quote char
      continue;
    }
    if (advanceQuoteState(state, ch, quoteChars)) {
      continue;
    }
    const comment = advanceCommentState(lineText, i, ch, { markers, cStyle });
    if (comment === "break") {
      // Comment to the end of the line: no assignment can follow.
      break;
    }
    if (comment !== false) {
      i = comment; // loop's i++ advances past the closing `/`
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
  const isLifetimeLang =
    languageId !== undefined && LIFETIME_LANGUAGES.has(languageId);
  const quoteChars = assignmentQuoteChars(languageId);
  const state = initialQuoteState();
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (isLifetimeLang && state.quote === false && ch === "'") {
      const end = rustCharLiteralEnd(lineText, i);
      if (end !== -1) {
        i = end - 1; // loop's i++ advances past the closing `'`
        continue;
      }
      // Otherwise a lifetime (`'a`, `'static`): leave the `'` alone below.
    }
    if (advanceQuoteState(state, ch, quoteChars)) {
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
 * literals/Python triple-quoted strings may span lines. `pyTripleDouble` /
 * `pyTripleSingle` track which of `"""` / `'''` is open, since only the same
 * kind of triple-quote closes it (Python does not let one close the other).
 */
export type DocScanState =
  | "code"
  | "blockComment"
  | "template"
  | "pyTripleDouble"
  | "pyTripleSingle";

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
 */
function resolveDocScanOptions(
  languageId: string | undefined
): {
  cStyle: boolean;
  template: boolean;
  pyTripleQuote: boolean;
  markers?: readonly string[];
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
  return {
    cStyle,
    template,
    pyTripleQuote,
    markers: pyTripleQuote ? lineCommentMarkers(languageId) : undefined,
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
 * The {@link DocScanState} that follows `lineText`, given the state it
 * started in. Mirrors the comment/quote handling the finders already do per
 * line, but carries an unterminated block comment, template literal, or
 * Python triple-quoted string into the next line instead of resetting at the
 * line boundary.
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
  }
): DocScanState {
  let i = 0;
  if (state === "blockComment") {
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
      return "code"; // rest of the line is a line comment; nothing carries over
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
        return "code"; // rest of the line is a line comment; nothing carries over
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
  return "code";
}

/**
 * Advances {@link DocScanState} across `lineText` for `languageId`, applying
 * that language's cStyle/template/pyTripleQuote rules. Exported so callers
 * with their own line loop (e.g. findAlignmentGroups) can track document
 * state one line at a time without needing {@link resolveDocScanOptions} /
 * {@link advanceLineDocState}.
 */
export function nextDocScanState(
  lineText: string,
  state: DocScanState,
  languageId?: string
): DocScanState {
  const opts = resolveDocScanOptions(languageId);
  if (!opts.cStyle && !opts.template && !opts.pyTripleQuote) {
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

/**
 * Char index in `lineText` where normal scanning resumes given `state`, or
 * null if the whole line is still inside a block comment/template
 * literal/Python triple-quoted string that doesn't close on it.
 */
function skipToCodeStart(lineText: string, state: DocScanState): number | null {
  if (state === "code") {
    return 0;
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
