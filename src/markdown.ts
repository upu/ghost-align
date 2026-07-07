// ── Markdown table alignment ──────────────────────────────────────────────

import { Placement, computeColumnPlan, visualColumn } from "./paddings";

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
 * Fence-tracking state carried into a scan: `char: null` means not inside a fence.
 * Lets a scan over a slice of a large file resume with the fence state left by
 * whatever came before the slice, instead of always assuming line 0 is unfenced.
 */
export interface FenceState {
  char: string | null;
  len: number;
}

const NO_FENCE: FenceState = { char: null, len: 0 };

/**
 * Fence state after processing one more line, given the state as of the line
 * before it. A fence opens on a line whose trimmed text starts with 3+
 * backticks or tildes, and closes on a later line whose trimmed text starts
 * with 3+ of the same character (at least as many as the opening run). The
 * single per-line step shared by {@link computeFencedLines} (a full scan
 * that also records which lines are inside the fence) and
 * {@link computeFenceStateBefore} (a state-only pre-scan for a slice's
 * starting fence state) — mirrors nextCssBlockDepth / nextYamlBlockScalarState
 * in finders.ts, which are each shared the same way between a full scan and
 * a state pre-scan.
 *
 * Always returns a freshly constructed object rather than `state` or the
 * shared {@link NO_FENCE} constant by reference, so a caller mutating the
 * returned state can never corrupt NO_FENCE or an earlier call's state.
 */
function nextFenceState(lineText: string, state: FenceState): FenceState {
  const trimmed = lineText.trim();
  const match = FENCE_RE.exec(trimmed);
  if (state.char === null) {
    if (match) {
      return { char: match[1][0], len: match[1].length };
    }
    return { char: null, len: 0 };
  }
  if (match && match[1][0] === state.char && match[1].length >= state.len) {
    return { char: null, len: 0 };
  }
  return { char: state.char, len: state.len };
}

/**
 * For each line, whether it is inside a fenced code block (```` ``` ```` or `~~~`).
 * A line is fenced if the fence was already open before it, or if it's the line that
 * opens one — so both the opening and closing delimiter lines count as fenced, and an
 * unclosed fence extends to the end of the file. `initialState` seeds the fence state
 * as of line 0, for callers scanning a slice rather than the whole file.
 */
function computeFencedLines(
  lines: string[],
  initialState: FenceState = NO_FENCE
): boolean[] {
  const fenced = new Array<boolean>(lines.length).fill(false);
  let state = initialState;
  for (let i = 0; i < lines.length; i++) {
    const next = nextFenceState(lines[i], state);
    fenced[i] = state.char !== null || next.char !== null;
    state = next;
  }
  return fenced;
}

/**
 * Fence state as of `lineCount` lines scanned via `lineAt`, without computing per-line
 * table/pipe data. Only a trim + regex check per line, so it's cheap enough to run over
 * every line above a large file's visible-range slice — letting the slice's table
 * detection know whether it starts inside a fence opened above it (see findMarkdownTables).
 */
export function computeFenceStateBefore(
  lineCount: number,
  lineAt: (index: number) => string
): FenceState {
  let state = NO_FENCE;
  for (let i = 0; i < lineCount; i++) {
    state = nextFenceState(lineAt(i), state);
  }
  return state;
}

/**
 * Detect GFM table blocks: a header row (containing `|`), a delimiter row, then
 * data rows (non-blank, containing `|`). Returns each block as its line indices.
 * Lines inside fenced code blocks (``` or ~~~) are skipped. `initialState` seeds the
 * fence state as of line 0 (see computeFenceStateBefore).
 */
export function findMarkdownTables(
  lines: string[],
  initialState: FenceState = NO_FENCE
): number[][] {
  const tables: number[][] = [];
  const fenced = computeFencedLines(lines, initialState);
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
 * Where to insert padding in a delimiter-row cell so the ruled line stays
 * continuous: before a trailing `:` (keeps `---:` / `:---:` markers at the
 * cell edge), otherwise right after the last `-`. Falls back to the pipe
 * position for cells with neither (e.g. empty cells).
 */
function delimiterCellInsertPos(
  text: string,
  segStart: number,
  pipe: number
): number {
  let j = pipe - 1;
  while (j >= segStart && (text[j] === " " || text[j] === "\t")) {
    j--;
  }
  if (j >= segStart && text[j] === ":") {
    return j;
  }
  if (j >= segStart && text[j] === "-") {
    return j + 1;
  }
  return pipe;
}

/**
 * One table row's own text plus its delimiter positions and per-column cell
 * widths (in rendered columns). Carrying `text` alongside the metrics lets
 * {@link placementsForTableRows} work row-by-row without a caller having to
 * hand it a full `lines` array indexed by absolute line number.
 */
interface TableRowMetrics {
  lineIndex: number;
  text: string;
  pipes: number[];
  segWidths: number[];
}

/** Compute {@link TableRowMetrics} for each line index in `block`. */
function computeTableRowMetrics(
  lines: string[],
  block: number[],
  tabSize: number
): TableRowMetrics[] {
  return block.map((lineIndex) => {
    const text = lines[lineIndex];
    const pipes = findPipePositions(text);
    const segWidths: number[] = [];
    let prevVisual = 0;
    for (const pipe of pipes) {
      const pipeVisual = visualColumn(text, pipe, tabSize);
      segWidths.push(pipeVisual - prevVisual);
      prevVisual = pipeVisual + 1; // skip the pipe character (width 1)
    }
    return { lineIndex, text, pipes, segWidths };
  });
}

/**
 * Per-column alignment plan for one table's rows — see computeColumnPlan.
 * `maxPadding` <= 0 means unlimited, so every column always aligns to its
 * widest cell (matching the pre-#178 behavior); otherwise a column whose
 * required spread exceeds `maxPadding` is left unaligned (`null`) rather
 * than forcing huge ghost padding onto every other row because of one
 * outlier cell. The `|` delimiter is always a single character, so the
 * running position simply advances by 1 past each column.
 */
function computeTableColumnPlan(
  rows: readonly Pick<TableRowMetrics, "segWidths">[],
  maxPadding: number
): (number | null)[] {
  return computeColumnPlan(
    rows.map((r) => r.segWidths),
    maxPadding,
    (after) => after + 1
  );
}

/**
 * Placements that align `rows` against a per-column plan (see
 * computeTableColumnPlan). Walks each row's own columns in order, tracking
 * its own running position: a `null` plan entry (column left unaligned)
 * adds no padding and the row's position continues from its own actual
 * width instead of a shared target, so a skipped column doesn't stop later
 * columns from aligning — it just makes them align relative to each row's
 * real position rather than one inherited from the skipped column.
 *
 * Row-unit API: each row carries its own `text` (see {@link
 * TableRowMetrics}), so a caller with rows scattered across a document
 * (e.g. {@link MarkdownTableWidthCache.placementsForRange}) doesn't need to
 * build a full `lines` array indexed by absolute line number just to satisfy
 * this function.
 */
function placementsForTableRows(
  rows: readonly TableRowMetrics[],
  plan: readonly (number | null)[]
): Placement[] {
  const placements: Placement[] = [];
  for (const row of rows) {
    const text = row.text;
    const isDelimiter = isDelimiterRow(text);
    let pos = 0;
    row.pipes.forEach((pipe, k) => {
      const raw = pos + row.segWidths[k];
      const target = plan[k];
      if (target === null || target === undefined) {
        pos = raw + 1;
        return;
      }
      const padding = target - raw;
      if (padding > 0) {
        if (isDelimiter && k > 0) {
          const segStart = row.pipes[k - 1] + 1;
          placements.push({
            lineIndex: row.lineIndex,
            character: delimiterCellInsertPos(text, segStart, pipe),
            padding,
            padChar: "-",
          });
        } else {
          placements.push({ lineIndex: row.lineIndex, character: pipe, padding });
        }
      }
      pos = target + 1;
    });
  }
  return placements;
}

/**
 * Ghost-padding placements that align the `|` delimiters of every Markdown table
 * in `lines`. Each cell is padded to its column's widest cell by inserting ghost
 * characters before the trailing `|`, so all delimiters line up. Returns the same
 * placement shape as computePaddings. `initialState` seeds the fence state as of
 * line 0 (see computeFenceStateBefore), for large-file visible-range slices.
 *
 * Delimiter rows (`|---|:--:|`) are the exception: their cells are padded with
 * `-` (padChar) at the end of the dash run — before a trailing `:` — so the
 * ruled line keeps looking continuous and alignment markers stay at the cell
 * edge. The segment left of the table's first `|` is ordinary padding even on
 * a delimiter row, since the ruled line doesn't extend past the table edge.
 *
 * Column widths are computed only from `lines`, so a caller that passes a
 * visible-range slice of a large file gets alignment based on that slice
 * alone — for a table entirely within the slice this is exactly the whole
 * table, but a table larger than the slice (plus {@link
 * computeSliceBounds}'s group-boundary expansion) is only aligned against
 * its in-slice rows. {@link MarkdownTableWidthCache} solves this for large
 * files by computing widths from the whole document once instead.
 *
 * `maxPadding` caps how many ghost characters a single column may insert on
 * any one line (see computeTableColumnPlan); 0 (the default) means
 * unlimited, aligning every column regardless of outlier cells.
 */
export function computeMarkdownTablePaddings(
  lines: string[],
  tabSize: number,
  initialState: FenceState = NO_FENCE,
  maxPadding: number = 0
): Placement[] {
  const placements: Placement[] = [];
  for (const block of findMarkdownTables(lines, initialState)) {
    const rows = computeTableRowMetrics(lines, block, tabSize);
    const plan = computeTableColumnPlan(rows, maxPadding);
    placements.push(...placementsForTableRows(rows, plan));
  }
  return placements;
}

/**
 * Whole-document cache of Markdown table row metrics and per-table column
 * widths, so alignment in a large file is based on every row of a table
 * instead of just the currently visible slice — mirroring CsvWidthCache in
 * csv.ts, which solves the same scroll-stability problem for CSV/TSV.
 *
 * Unlike a CSV row (whose delimiter positions depend only on that one line),
 * a Markdown table row's very membership depends on cross-line context: fence
 * state and header/delimiter-row pairing. So this cache cannot cheaply
 * re-scan just the lines an edit touched the way CsvWidthCache does — any
 * edit (see {@link markDirty}) invalidates the whole cache, rebuilt in full
 * on the next {@link sync}. Full-document table detection is a single linear
 * pass (the same order of cost as the fence-state prescan every large-file
 * Markdown decoration already pays), so this only adds cost on edits, not on
 * scrolling — which is what makes scrolling scroll-stable.
 */
export class MarkdownTableWidthCache {
  private tables: number[][] = [];
  private rowMetrics = new Map<number, TableRowMetrics>();
  private tableIndexByLine = new Map<number, number>();
  private planByTable: (number | null)[][] = [];
  private lineCount = -1;
  private tabSize = 0;
  private maxPadding = 0;
  private dirty = true;

  /** Mark the cache stale so the next {@link sync} rebuilds it from scratch. */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Bring the cache in line with the document. Rebuilds fully when dirty, or
   * when `tabSize`/`maxPadding` changed (both affect the per-table plan, and
   * `maxPadding` can change from a settings edit with no document edit at
   * all, so it can't rely on {@link markDirty}).
   */
  sync(
    lineCount: number,
    lineAt: (line: number) => string,
    tabSize: number,
    maxPadding: number = 0
  ): void {
    if (
      !this.dirty &&
      lineCount === this.lineCount &&
      tabSize === this.tabSize &&
      maxPadding === this.maxPadding
    ) {
      return;
    }
    this.lineCount = lineCount;
    this.tabSize = tabSize;
    this.maxPadding = maxPadding;
    this.dirty = false;
    this.rowMetrics.clear();
    this.tableIndexByLine.clear();
    this.planByTable = [];

    const lines: string[] = [];
    for (let i = 0; i < lineCount; i++) {
      lines.push(lineAt(i));
    }
    this.tables = findMarkdownTables(lines);
    this.tables.forEach((block, tableIndex) => {
      const rows = computeTableRowMetrics(lines, block, tabSize);
      for (const row of rows) {
        this.rowMetrics.set(row.lineIndex, row);
        this.tableIndexByLine.set(row.lineIndex, tableIndex);
      }
      this.planByTable.push(computeTableColumnPlan(rows, maxPadding));
    });
  }

  /** Placements for the table rows in `[sliceStart, sliceEnd]`. Call sync() first. */
  placementsForRange(sliceStart: number, sliceEnd: number): Placement[] {
    const placements: Placement[] = [];
    for (let lineIndex = sliceStart; lineIndex <= sliceEnd; lineIndex++) {
      const row = this.rowMetrics.get(lineIndex);
      const tableIndex = this.tableIndexByLine.get(lineIndex);
      if (!row || tableIndex === undefined) {
        continue;
      }
      placements.push(
        ...placementsForTableRows([row], this.planByTable[tableIndex])
      );
    }
    return placements;
  }
}
