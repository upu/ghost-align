// ── Alignment-group / padding computation ─────────────────────────────────
//
// Groups consecutive operator-bearing lines and computes the ghost-padding
// placements that line up their operator columns, plus the visual-column
// measurement (tabs, East Asian wide/fullwidth chars) shared by every
// alignment path, and the visible-range slicing used for large files.

import {
  findOperatorTargets,
  initialLineScanState,
  isWholeLineComment,
  isYamlBlockScalarContent,
  LINE_CONTINUATION_OPERATOR,
  LineScanState,
  nextLineScanState,
} from "./finders";

/** Default tab width used when an editor's tabSize cannot be resolved. */
export const DEFAULT_TAB_SIZE = 4;

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
 * table. A multi-code-point emoji ZWJ sequence (e.g. a family emoji) is still
 * out of scope as a single glyph: each code point is measured on its own, so
 * such a sequence sums to more than 2 even though ZWJ/variation selectors
 * inside it are individually zero-width (see ZERO_WIDTH_RANGES below).
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
  [0x1f1e6, 0x1f1ff], // Regional Indicator Symbols (flag emoji pairs)
  [0x1f300, 0x1faff], // Emoji and pictographs (Misc Symbols .. Ext-A)
  [0x20000, 0x3fffd], // CJK Unified Ideographs Extension B and beyond
];

/**
 * Zero-width code point ranges: combining marks and format characters that
 * VS Code renders with no width of their own, always attaching to the
 * preceding character. Scoped to the main blocks named in issue #396 rather
 * than the full Unicode `Mn`/`Cf` categories, matching WIDE_CHAR_RANGES'
 * explicit-table approach above:
 * - Combining Diacritical Marks (U+0300-U+036F): NFD-decomposed accents
 *   (`e` + U+0301 for "é"), common once text isn't NFC-normalized.
 * - U+200B-U+200D: zero width space / non-joiner / joiner (ZWSP/ZWNJ/ZWJ).
 * - Variation Selectors (U+FE00-U+FE0F): text/emoji presentation selectors.
 * - U+FEFF: zero width no-break space, also used as a BOM.
 * A full Mn-category sweep (other combining blocks, Mongolian variation
 * selectors, etc.) is left as a known limitation until a concrete report
 * asks for it.
 */
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x200b, 0x200d], // ZWSP, ZWNJ, ZWJ
  [0xfe00, 0xfe0f], // Variation Selectors
  [0xfeff, 0xfeff], // Zero Width No-Break Space / BOM
];

/**
 * Skin tone modifiers (Emoji_Modifier, U+1F3FB-U+1F3FF) merge with a
 * preceding Emoji_Modifier_Base emoji into a single glyph (an emoji modifier
 * sequence), so the modifier adds no width of its own there. Standalone, or
 * after a non-base code point, the modifier renders as its own swatch and
 * keeps the wide width of 2 from WIDE_CHAR_RANGES. Unlike East_Asian_Width,
 * `Emoji_Modifier_Base` is available as a regex property escape, so no
 * explicit table is needed here.
 */
const EMOJI_MODIFIER_BASE = /^\p{Emoji_Modifier_Base}$/u;

function isSkinToneModifier(codePoint: number): boolean {
  return codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
}

function isEmojiModifierBase(codePoint: number): boolean {
  return codePoint >= 0 && EMOJI_MODIFIER_BASE.test(String.fromCodePoint(codePoint));
}

/** Rendered column width of a single code point: 0 for zero-width, 2 for wide/fullwidth, else 1. */
function charWidth(codePoint: number): number {
  for (const [lo, hi] of ZERO_WIDTH_RANGES) {
    if (codePoint < lo) break;
    if (codePoint <= hi) return 0;
  }
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
  let prevCodePoint = -1;
  const end = Math.min(charIndex, lineText.length);
  for (let i = 0; i < end; ) {
    if (lineText[i] === "\t") {
      col += tabSize - (col % tabSize);
      i++;
      prevCodePoint = -1;
      continue;
    }
    const codePoint = lineText.codePointAt(i) as number;
    if (!(isSkinToneModifier(codePoint) && isEmojiModifierBase(prevCodePoint))) {
      col += charWidth(codePoint);
    }
    prevCodePoint = codePoint;
    i += codePoint > 0xffff ? 2 : 1;
  }
  return col;
}

/**
 * One ghost-padding placement: insert `padding` ghost characters before
 * `character` on `lineIndex`. The shared return shape of every alignment
 * path (operator groups, Markdown tables, CSV/TSV, JSDoc `@param`), so a
 * caller can combine or transform placements from any path uniformly.
 */
export type Placement = {
  lineIndex: number;
  character: number;
  padding: number;
  /**
   * Character to fill the padding with, when the padding should look like
   * surrounding content (e.g. `-` on a Markdown table delimiter row) instead
   * of the configured ghost character / a copy-time space.
   */
  padChar?: string;
};

/** One alignment column of a group entry, in rendered coordinates. */
export type AlignmentColumn = {
  opIndex: number;
  insert: number;
  visualColumn: number;
};

/** A line in an alignment group: `columns` lists every alignment column on it. */
export type AlignmentEntry = {
  lineIndex: number;
  columns: AlignmentColumn[];
};

/**
 * The subset of vscode.TextDocument the alignment scan needs. Structural, so
 * a slice of a large document (visible-range mode) can be scanned by
 * presenting its lines as a smaller document.
 */
export type LineSource = {
  lineCount: number;
  lineAt(line: number): { text: string };
};

/**
 * Group consecutive lines that contain at least one operator.
 * A group is also split when the leading indent width changes — this keeps
 * nested blocks (e.g. JSON objects) from being aligned across indent levels.
 * Exception: a line whose target includes LINE_CONTINUATION_OPERATOR (`\`),
 * or that belongs to a group already containing one, never splits on indent —
 * continuation lines (shell/Makefile/C-preprocessor line-splicing) are
 * routinely indented differently line-to-line specifically because they
 * aren't yet aligned, which is the whole point of this operator. The group
 * still ends the normal way once a line has no continuation target (see the
 * `targets.length === 0` flush below).
 *
 * Each column's `insert` is the character index where padding is inserted
 * (the operator's first character, so compound assignments like `+=` are
 * never split), while `visualColumn` is the rendered column of the alignment
 * point (the `=` itself) used to compute padding and the group's alignment
 * target. Indent comparison and alignment use visual columns so tabs and
 * tab/space mixes line up on screen, not by raw character count.
 *
 * `initialState` seeds the cross-line scan state (plain code / inside a
 * block comment or template literal; CSS/SCSS/LESS rule-block depth; YAML
 * block-scalar indent; TS/JS switch-body brace stack) that line 0 of
 * `document` starts in, so a visible-range slice of a large file can resume
 * whatever a construct opened above it left behind — see {@link
 * LineScanState} in finders.ts.
 * Each line's targets are found relative to that state, which is then
 * advanced across the loop via nextLineScanState, so an operator inside an
 * unclosed block comment/template literal, a multi-line CSS selector
 * continuation, or opaque YAML block-scalar content is never treated as an
 * alignment target. Defaults to {@link initialLineScanState}, the correct
 * assumption for the top of a real file.
 *
 * A whole-line comment (see {@link isWholeLineComment}) is the other
 * exception to the `targets.length === 0` flush: it has no targets of its
 * own but is transparent to the surrounding group, so a comment interleaved
 * between assignments (`x = 1\n// note\ny = 2`) doesn't split them. It never
 * joins the group itself (no entry is pushed for it) and its indent is never
 * compared against `currentIndent`, so an oddly-indented comment can't split
 * a group either. A blank line is not a whole-line comment, so it still
 * flushes as before.
 */
export function findAlignmentGroups(
  document: LineSource,
  operators: string[],
  languageId?: string,
  tabSize: number = DEFAULT_TAB_SIZE,
  initialState: LineScanState = initialLineScanState()
): AlignmentEntry[][] {
  const groups: AlignmentEntry[][] = [];
  let currentGroup: AlignmentEntry[] = [];
  let currentIndent: number | null = null;
  let currentGroupHasContinuation = false;
  let state = initialState;
  const isYamlLang = languageId === "yaml";

  const flush = () => {
    if (currentGroup.length >= 2) {
      groups.push(currentGroup);
    }
    currentGroup = [];
    currentIndent = null;
    currentGroupHasContinuation = false;
  };

  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;

    if (isYamlLang && isYamlBlockScalarContent(lineText, state.yamlBlockScalar)) {
      state = nextLineScanState(lineText, state, languageId);
      flush();
      continue;
    }

    const incomingDocState = state.doc;
    const targets = findOperatorTargets(
      lineText,
      operators,
      languageId,
      state.doc,
      state.cssBlockDepth > 0,
      state.tsBraces[state.tsBraces.length - 1]
    );
    state = nextLineScanState(lineText, state, languageId);

    if (targets.length === 0) {
      if (isWholeLineComment(lineText, languageId, incomingDocState)) {
        continue; // whole-line comment: transparent to the surrounding group
      }
      flush();
      continue;
    }

    const hasContinuation = targets.some(
      (t) => operators[t.opIndex] === LINE_CONTINUATION_OPERATOR
    );
    const indent = visualColumn(lineText, leadingIndent(lineText), tabSize);
    if (
      currentIndent !== null &&
      indent !== currentIndent &&
      !hasContinuation &&
      !currentGroupHasContinuation
    ) {
      flush();
    }
    const columns = targets.map((t) => ({
      opIndex: t.opIndex,
      insert: t.insert,
      visualColumn: visualColumn(lineText, t.align, tabSize),
    }));
    currentGroup.push({
      lineIndex: i,
      columns,
    });
    currentIndent = indent;
    if (hasContinuation) {
      currentGroupHasContinuation = true;
    }
  }
  flush();

  return groups;
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
): Placement[] {
  const placements: Placement[] = [];
  for (const group of groups) {
    const rows = group.map((entry) => ({
      lineIndex: entry.lineIndex,
      columnsByOpIndex: new Map(entry.columns.map((c) => [c.opIndex, c])),
      shift: 0,
    }));
    const opIndices = [
      ...new Set(rows.flatMap((r) => [...r.columnsByOpIndex.keys()])),
    ].sort((a, b) => a - b);
    for (const opIndex of opIndices) {
      let active = rows
        .map((row) => {
          const column = row.columnsByOpIndex.get(opIndex);
          return column ? { row, column } : undefined;
        })
        .filter((x): x is NonNullable<typeof x> => x !== undefined);
      if (maxPadding > 0) {
        // Equivalent to repeatedly dropping the current max until the spread
        // fits (#178's original behavior): a row at the min position is
        // never itself dropped, since removal only happens while max > min,
        // so the min is invariant across iterations. That makes the fixed
        // point exactly "keep every row within maxPadding of the min" —
        // computable in one pass instead of O(N) removal rounds (#415).
        const positions = active.map(
          ({ row, column }) => column.visualColumn + row.shift
        );
        const min = Math.min(...positions);
        active = active.filter(
          ({ row, column }) => column.visualColumn + row.shift - min <= maxPadding
        );
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

/**
 * Per-column alignment plan for tabular data (Markdown tables, CSV/TSV):
 * for each column index, either the common position every participating
 * row's column should be padded to, or `null` when that column is left
 * unaligned because doing so would need more than `maxPadding` ghost
 * characters on some row.
 *
 * Unlike the operator path (see computePaddings), excluding a single
 * outlier *row* from a tabular column would leave that row's later columns
 * unaligned with everything before them, breaking the table shape (see
 * issue #178's 設計メモ). So the unit excluded here is a whole *column*
 * instead: `rowWidths[i]` is row `i`'s per-column content widths (its own
 * length may be shorter than others', e.g. a ragged CSV row), and `advance`
 * computes the running position just past a column's content plus its
 * delimiter (`+1` for a single-char delimiter, tab-stop snapping for TSV).
 *
 * Each row tracks its own running position rather than a single shared one,
 * because once a column is skipped, rows no longer share a common position
 * entering the next column (each kept its own natural width for the skipped
 * column) — exactly the "以降の列は各行の実位置基準で継続" behavior the
 * issue describes. When no column has been skipped yet, every row's running
 * position is identical after each aligned column (the padding cancels out
 * exactly), so this matches simple whole-column-max alignment until the
 * first skip.
 */
export function computeColumnPlan(
  rowWidths: readonly (readonly number[])[],
  maxPadding: number,
  advance: (afterPosition: number) => number
): (number | null)[] {
  const columnCount = rowWidths.reduce((max, w) => Math.max(max, w.length), 0);
  const pos = new Array<number>(rowWidths.length).fill(0);
  const plan: (number | null)[] = [];
  for (let k = 0; k < columnCount; k++) {
    const activeIdx: number[] = [];
    const raw: number[] = [];
    rowWidths.forEach((widths, i) => {
      if (widths.length > k) {
        activeIdx.push(i);
        raw.push(pos[i] + widths[k]);
      }
    });
    if (activeIdx.length === 0) {
      plan.push(null);
      continue;
    }
    const max = Math.max(...raw);
    const min = Math.min(...raw);
    const skip = maxPadding > 0 && max - min > maxPadding;
    activeIdx.forEach((i, idx) => {
      pos[i] = advance(skip ? raw[idx] : max);
    });
    plan.push(skip ? null : max);
  }
  return plan;
}

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
