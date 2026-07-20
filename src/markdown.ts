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

/**
 * A row's real cells: the segments between delimiter pipes, trimmed. The
 * whitespace-only segments a leading/trailing `|` produces are not cells
 * (GFM treats those pipes as the table edge), so `| a | b |`, `a | b` and
 * `| a | b` all yield the same two cells — letting header/delimiter cell
 * counts be compared regardless of pipe style.
 */
function splitTableCells(lineText: string): string[] {
  const segments: string[] = [];
  let start = 0;
  for (const pipe of findPipePositions(lineText)) {
    segments.push(lineText.slice(start, pipe));
    start = pipe + 1;
  }
  segments.push(lineText.slice(start));
  if (segments.length > 1 && segments[0].trim() === "") {
    segments.shift();
  }
  if (segments.length > 1 && segments[segments.length - 1].trim() === "") {
    segments.pop();
  }
  return segments.map((segment) => segment.trim());
}

/** A GFM delimiter cell: one or more hyphens with optional leading/trailing colon. */
const DELIMITER_CELL_RE = /^:?-+:?$/;

/**
 * Whether a line is a GFM table delimiter row, e.g. `|---|:--:|`. Requires at
 * least one unescaped `|` (a bare `---` is a setext heading / thematic break,
 * not a table row) and every real cell to match {@link DELIMITER_CELL_RE} —
 * a whole-line character-class check would also accept rows with hyphen-less
 * cells like `| : | --- |`.
 */
export function isDelimiterRow(lineText: string): boolean {
  if (findPipePositions(lineText).length === 0) {
    return false;
  }
  return splitTableCells(lineText).every((cell) => DELIMITER_CELL_RE.test(cell));
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
 * A line's leading-whitespace width (tabs expand to the next multiple of 4 —
 * CommonMark always measures block-structure indentation with a fixed tab
 * stop of 4, independent of the editor's `tabSize` used elsewhere for visual
 * column math) and the text remaining after it. Shared by fence-line
 * detection (0-3 width = fence-eligible) and indented-code-block detection
 * (4+ width).
 */
function splitLeadingIndent(lineText: string): { width: number; rest: string } {
  let width = 0;
  let i = 0;
  while (i < lineText.length) {
    const ch = lineText[i];
    if (ch === " ") {
      width++;
    } else if (ch === "\t") {
      width += 4 - (width % 4);
    } else {
      break;
    }
    i++;
  }
  return { width, rest: lineText.slice(i) };
}

/**
 * Fence state after processing one more line, given the state as of the line
 * before it. A fence opens on a line indented 0-3 columns whose remaining
 * text starts with 3+ backticks or tildes (an info string may follow), and
 * closes on a later line indented 0-3 columns whose remaining text is 3+ of
 * the same character (at least as many as the opening run) followed by
 * nothing but whitespace — GFM allows a closing fence no trailing content,
 * unlike an opening one. A line indented 4+ columns can neither open nor
 * close a fence (it's an indented code block instead, see
 * computeIndentedCodeLines) but doesn't end one already open — it's just
 * fence content. The single per-line step shared by {@link
 * computeFencedLines} (a full scan that also records which lines are inside
 * the fence) and {@link computeFenceStateBefore} (a state-only pre-scan for
 * a slice's starting fence state) — mirrors nextCssBlockDepth /
 * nextYamlBlockScalarState in finders.ts, which are each shared the same way
 * between a full scan and a state pre-scan.
 *
 * Always returns a freshly constructed object rather than `state` or the
 * shared {@link NO_FENCE} constant by reference, so a caller mutating the
 * returned state can never corrupt NO_FENCE or an earlier call's state.
 */
function nextFenceState(lineText: string, state: FenceState): FenceState {
  const { width, rest } = splitLeadingIndent(lineText);
  if (width > 3) {
    return state.char === null ? { char: null, len: 0 } : state;
  }
  const match = FENCE_RE.exec(rest);
  if (state.char === null) {
    if (match) {
      return { char: match[1][0], len: match[1].length };
    }
    return { char: null, len: 0 };
  }
  if (
    match &&
    match[1][0] === state.char &&
    match[1].length >= state.len &&
    rest.slice(match[1].length).trim() === ""
  ) {
    return { char: null, len: 0 };
  }
  return { char: state.char, len: state.len };
}

/**
 * For each line, whether it's part of a 4+-column-indented code block (GFM
 * indented code, distinct from a fenced one) and thus excluded from table
 * detection alongside fenced lines. An indented block can only start where a
 * paragraph can't lazily continue into it — right after a blank line, at the
 * start of the document, or right after a fence — matching CommonMark's "does
 * not interrupt a paragraph" rule; once started, blank lines inside it don't
 * end it as long as further indented content follows. Fenced lines are
 * excluded from consideration entirely (already handled as fenced) and reset
 * the "can start" state for what follows, same as a blank line would.
 */
function computeIndentedCodeLines(lines: string[], fenced: boolean[]): boolean[] {
  const indented = new Array<boolean>(lines.length).fill(false);
  let canStart = true;
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) {
      canStart = true;
      inBlock = false;
      continue;
    }
    if (lines[i].trim().length === 0) {
      canStart = true;
      continue;
    }
    const lineIsIndented: boolean =
      splitLeadingIndent(lines[i]).width >= 4 && (inBlock || canStart);
    indented[i] = lineIsIndented;
    inBlock = lineIsIndented;
    canStart = false;
  }
  return indented;
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
 * Detect GFM table blocks: a header row (containing `|`), a delimiter row with
 * the same cell count as the header (GFM rejects the pair otherwise; data rows
 * may differ), then data rows (non-blank, containing `|`). Returns each block
 * as its line indices.
 * Lines inside fenced code blocks (``` or ~~~) or 4+-column-indented code
 * blocks (see computeIndentedCodeLines) are skipped. `initialState` seeds the
 * fence state as of line 0 (see computeFenceStateBefore).
 *
 * `fencedOut`, if given, is filled with the per-line fenced flags computed
 * internally — lets a caller that also needs fence info (e.g.
 * {@link MarkdownTableWidthCache}, to track which lines an edit touching a
 * fence must invalidate) get it without a second full-document scan.
 */
export function findMarkdownTables(
  lines: string[],
  initialState: FenceState = NO_FENCE,
  fencedOut?: boolean[]
): number[][] {
  const tables: number[][] = [];
  const fenced = computeFencedLines(lines, initialState);
  if (fencedOut) {
    fencedOut.length = 0;
    fencedOut.push(...fenced);
  }
  const indented = computeIndentedCodeLines(lines, fenced);
  const isSkipped = (index: number) => fenced[index] || indented[index];
  let i = 0;
  while (i < lines.length) {
    if (isSkipped(i)) {
      i++;
      continue;
    }
    const isHeader = findPipePositions(lines[i]).length > 0;
    if (
      isHeader &&
      i + 1 < lines.length &&
      !isSkipped(i + 1) &&
      isDelimiterRow(lines[i + 1]) &&
      splitTableCells(lines[i]).length === splitTableCells(lines[i + 1]).length
    ) {
      const block = [i, i + 1];
      let j = i + 2;
      while (
        j < lines.length &&
        !isSkipped(j) &&
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

/** A column's declared GFM alignment, parsed from its delimiter-row marker. */
type ColumnAlign = "left" | "center" | "right";

/**
 * Per-column alignment declared by a delimiter row's markers (`:---`,
 * `---:`, `:---:`; plain `---` is left), indexed the same way as {@link
 * TableRowMetrics.segWidths} — `alignments[k]` is the segment ending at
 * `pipes[k]` (so index 0 is the prefix before the table's leading `|`,
 * always "left" since it's never real cell content).
 */
function parseDelimiterAlignments(text: string, pipes: number[]): ColumnAlign[] {
  let segStart = 0;
  return pipes.map((pipe) => {
    const cell = text.slice(segStart, pipe).trim();
    segStart = pipe + 1;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":") && cell.length > 0;
    if (left && right && cell.length > 1) {
      return "center";
    }
    return right ? "right" : "left";
  });
}

/**
 * Char index where right/center-aligned padding pushes a cell's content
 * from: the first non-space/tab character in `[segStart, segEnd)`, so the
 * cell's existing leading whitespace stays put and ghost padding lands right
 * against the content, pushing it toward the `|`. Falls back to `segEnd`
 * (same position `placementsForTableRows` uses for left alignment) when the
 * cell is empty or all whitespace.
 */
function cellContentStart(text: string, segStart: number, segEnd: number): number {
  let j = segStart;
  while (j < segEnd && (text[j] === " " || text[j] === "\t")) {
    j++;
  }
  return j;
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
 * `alignments[k]` (from {@link parseDelimiterAlignments}) controls where a
 * header/data row's padding for column `k` lands: "left" (default, also
 * used when `alignments` is shorter than the row, e.g. a ragged row) keeps
 * the pre-#398 behavior of padding right before the `|`; "right" moves all
 * of it to {@link cellContentStart}, before the cell's content; "center"
 * splits it across both — floor at the content side, ceil at the `|` side,
 * so an odd remainder leans the content left of exact center (mirrors
 * Python's `str.center`). The delimiter row itself is unaffected by
 * `alignments` — its `-`-padding placement is chosen by {@link
 * delimiterCellInsertPos} regardless of which alignment it declares, so the
 * ruled line keeps looking continuous.
 *
 * Row-unit API: each row carries its own `text` (see {@link
 * TableRowMetrics}), so a caller with rows scattered across a document
 * (e.g. {@link MarkdownTableWidthCache.placementsForRange}) doesn't need to
 * build a full `lines` array indexed by absolute line number just to satisfy
 * this function.
 */
function placementsForTableRows(
  rows: readonly TableRowMetrics[],
  plan: readonly (number | null)[],
  alignments: readonly ColumnAlign[] = []
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
        } else if (!isDelimiter && alignments[k] === "right") {
          const segStart = k === 0 ? 0 : row.pipes[k - 1] + 1;
          placements.push({
            lineIndex: row.lineIndex,
            character: cellContentStart(text, segStart, pipe),
            padding,
          });
        } else if (!isDelimiter && alignments[k] === "center") {
          const segStart = k === 0 ? 0 : row.pipes[k - 1] + 1;
          const leftPad = Math.floor(padding / 2);
          const rightPad = padding - leftPad;
          if (leftPad > 0) {
            placements.push({
              lineIndex: row.lineIndex,
              character: cellContentStart(text, segStart, pipe),
              padding: leftPad,
            });
          }
          if (rightPad > 0) {
            placements.push({ lineIndex: row.lineIndex, character: pipe, padding: rightPad });
          }
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
    const delimiterRow = rows[1];
    const alignments = parseDelimiterAlignments(delimiterRow.text, delimiterRow.pipes);
    placements.push(...placementsForTableRows(rows, plan, alignments));
  }
  return placements;
}

/**
 * Contiguous `[start, end]` (inclusive) runs of `true` in `flags`, e.g.
 * `[F,T,T,F,T]` -> `[[1,2],[4,4]]`. Used to turn the per-line fenced-flag
 * array from {@link findMarkdownTables} into the small span list {@link
 * MarkdownTableWidthCache} keeps around to cheaply test whether a later
 * edit's line range could have touched a fence.
 */
function spansFromFlags(flags: readonly boolean[]): [number, number][] {
  const spans: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) {
      if (start === -1) {
        start = i;
      }
    } else if (start !== -1) {
      spans.push([start, i - 1]);
      start = -1;
    }
  }
  if (start !== -1) {
    spans.push([start, flags.length - 1]);
  }
  return spans;
}

/** Whether `[start, end]` (inclusive) overlaps any span in `spans`. */
function rangeIntersectsSpans(
  spans: readonly [number, number][],
  start: number,
  end: number
): boolean {
  return spans.some(([spanStart, spanEnd]) => start <= spanEnd && end >= spanStart);
}

/**
 * A run of 3+ backticks or tildes — the minimum that could open/close a
 * fence (see FENCE_RE) — anywhere in a string, not anchored to line start
 * since the caller only has the replacement text, not full lines.
 */
const POSSIBLE_FENCE_MARKER_RE = /`{3,}|~{3,}/;

/**
 * Whether replacement text could plausibly start or end a table (contains
 * `|`, which is all {@link findMarkdownTables} requires of a header line) or
 * a fence (contains a 3+ backtick/tilde run). Used by {@link
 * MarkdownTableWidthCache.applyEdit} to decide if an edit outside any known
 * table/fence span could still matter. Single/double backticks or tildes
 * (common in prose: inline code, `~/home`, `~100`) don't match, so they
 * don't force a rebuild on their own.
 */
function mayAffectTablesOrFences(text: string): boolean {
  return text.includes("|") || POSSIBLE_FENCE_MARKER_RE.test(text);
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
 * re-scan just the lines an edit touched the way CsvWidthCache does. Instead,
 * {@link applyEdit} keeps the table and fenced-line spans from the last full
 * build around and only marks the cache stale when an edit could plausibly
 * change them — its old line range overlaps a known table/fence span, its
 * replacement text could open/close one (see {@link mayAffectTablesOrFences}),
 * or it changes the document's line count. An edit to ordinary prose well
 * outside any table or fence leaves every span untouched, so the cache (and
 * its rowMetrics/planByTable) stays valid and {@link sync} can skip rebuilding
 * it — this is what keeps typing in a large Markdown file's prose from paying
 * for a full-document table re-detection on every debounce tick.
 */
export class MarkdownTableWidthCache {
  private tables: number[][] = [];
  private rowMetrics = new Map<number, TableRowMetrics>();
  private tableIndexByLine = new Map<number, number>();
  private planByTable: (number | null)[][] = [];
  private alignmentsByTable: ColumnAlign[][] = [];
  private tableSpans: [number, number][] = [];
  private fencedSpans: [number, number][] = [];
  private lineCount = -1;
  private tabSize = 0;
  private maxPadding = 0;
  private dirty = true;

  /** Mark the cache stale so the next {@link sync} rebuilds it from scratch. */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Record a document edit, replacing `deletedLineCount` lines starting at
   * `startLine` with `insertedLineCount` lines of `insertedText`. Marks the
   * cache stale only if the edit could plausibly have changed table/fence
   * membership anywhere (see class doc) — otherwise leaves it as-is so the
   * next {@link sync} can skip its full rebuild. Once stale, later edits in
   * the same batch are no-ops (already stale, nothing more to decide).
   */
  applyEdit(
    startLine: number,
    deletedLineCount: number,
    insertedLineCount: number,
    insertedText: string
  ): void {
    if (this.dirty) {
      return;
    }
    const endLine = startLine + deletedLineCount - 1;
    if (
      deletedLineCount !== insertedLineCount ||
      mayAffectTablesOrFences(insertedText) ||
      rangeIntersectsSpans(this.tableSpans, startLine, endLine) ||
      rangeIntersectsSpans(this.fencedSpans, startLine, endLine)
    ) {
      this.dirty = true;
    }
  }

  /**
   * Bring the cache in line with the document. Rebuilds fully when dirty, or
   * when `tabSize`/`maxPadding` changed (both affect the per-table plan, and
   * `maxPadding` can change from a settings edit with no document edit at
   * all, so it can't rely on {@link markDirty}/{@link applyEdit}).
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
    this.alignmentsByTable = [];

    const lines: string[] = [];
    for (let i = 0; i < lineCount; i++) {
      lines.push(lineAt(i));
    }
    const fenced: boolean[] = [];
    this.tables = findMarkdownTables(lines, NO_FENCE, fenced);
    this.tableSpans = this.tables.map(
      (block): [number, number] => [block[0], block[block.length - 1]]
    );
    this.fencedSpans = spansFromFlags(fenced);
    this.tables.forEach((block, tableIndex) => {
      const rows = computeTableRowMetrics(lines, block, tabSize);
      for (const row of rows) {
        this.rowMetrics.set(row.lineIndex, row);
        this.tableIndexByLine.set(row.lineIndex, tableIndex);
      }
      this.planByTable.push(computeTableColumnPlan(rows, maxPadding));
      const delimiterRow = rows[1];
      this.alignmentsByTable.push(
        parseDelimiterAlignments(delimiterRow.text, delimiterRow.pipes)
      );
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
        ...placementsForTableRows(
          [row],
          this.planByTable[tableIndex],
          this.alignmentsByTable[tableIndex]
        )
      );
    }
    return placements;
  }
}
