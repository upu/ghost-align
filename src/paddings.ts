// ── Alignment-group / padding computation ─────────────────────────────────
//
// Groups consecutive operator-bearing lines and computes the ghost-padding
// placements that line up their operator columns, plus the visual-column
// measurement (tabs, East Asian wide/fullwidth chars) shared by every
// alignment path, and the visible-range slicing used for large files.

import {
  CSS_LANGUAGES,
  DocScanState,
  findOperatorTargets,
  isYamlBlockScalarContent,
  nextCssBlockDepth,
  nextDocScanState,
  nextYamlBlockScalarState,
  YamlBlockScalarState,
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
 *
 * Each column's `insert` is the character index where padding is inserted
 * (the operator's first character, so compound assignments like `+=` are
 * never split), while `visualColumn` is the rendered column of the alignment
 * point (the `=` itself) used to compute padding and the group's alignment
 * target. Indent comparison and alignment use visual columns so tabs and
 * tab/space mixes line up on screen, not by raw character count.
 *
 * `initialDocState` seeds the state (plain code / inside a block comment /
 * inside a template literal) that line 0 of `document` starts in, so a
 * visible-range slice of a large file can resume whatever a multi-line block
 * comment or template literal opened above it left behind — see
 * computeLineStateBefore in finders.ts. Each line's targets are found
 * relative to that state, which is then advanced across the loop via
 * nextDocScanState, so an operator inside an unclosed block comment or
 * template literal is never treated as an alignment target.
 *
 * `initialCssBlockDepth` is the CSS/SCSS/LESS analog for the `:` operator
 * (see computeCssBlockDepthBefore in finders.ts): whether line 0 starts
 * already inside a rule's declaration block, so a multi-line selector
 * continuation (`.foo:hover,`) is not mistaken for a declaration. Defaults to
 * 0 (not inside a block), the correct assumption for the top of a real file —
 * unlike findOperatorTargets's own default, which favors single-line callers
 * with no document context.
 *
 * `initialYamlBlockScalarState` is the YAML analog for a block scalar
 * (`key: |` / `key: >`; see computeYamlBlockScalarStateBefore in finders.ts):
 * whether line 0 starts already inside one opened above it, so its opaque
 * content (arbitrary text, not YAML) is never scanned for `:` targets.
 * Defaults to `null` (not inside a block scalar).
 */
export function findAlignmentGroups(
  document: LineSource,
  operators: string[],
  languageId?: string,
  tabSize: number = DEFAULT_TAB_SIZE,
  initialDocState: DocScanState = "code",
  initialCssBlockDepth: number = 0,
  initialYamlBlockScalarState: YamlBlockScalarState = null
): AlignmentEntry[][] {
  const groups: AlignmentEntry[][] = [];
  let currentGroup: AlignmentEntry[] = [];
  let currentIndent: number | null = null;
  let docState: DocScanState = initialDocState;
  const isCssLang = languageId !== undefined && CSS_LANGUAGES.has(languageId);
  let cssBlockDepth = initialCssBlockDepth;
  const isYamlLang = languageId === "yaml";
  let yamlBlockScalarState: YamlBlockScalarState = initialYamlBlockScalarState;

  const flush = () => {
    if (currentGroup.length >= 2) {
      groups.push(currentGroup);
    }
    currentGroup = [];
    currentIndent = null;
  };

  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;

    if (isYamlLang && isYamlBlockScalarContent(lineText, yamlBlockScalarState)) {
      yamlBlockScalarState = nextYamlBlockScalarState(lineText, yamlBlockScalarState);
      flush();
      continue;
    }

    const targets = findOperatorTargets(
      lineText,
      operators,
      languageId,
      docState,
      cssBlockDepth > 0
    );
    docState = nextDocScanState(lineText, docState, languageId);
    if (isCssLang) {
      cssBlockDepth = nextCssBlockDepth(lineText, cssBlockDepth, languageId as string);
    }
    if (isYamlLang) {
      yamlBlockScalarState = nextYamlBlockScalarState(lineText, yamlBlockScalarState);
    }

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
      columns,
    });
    currentIndent = indent;
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
      columns: entry.columns,
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
  const pos = new Array(rowWidths.length).fill(0);
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
