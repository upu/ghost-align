// ── CSV / TSV column alignment ────────────────────────────────────────────

import { Placement, computeColumnPlan, visualColumn } from "./paddings";
import {
  UrlShortenTarget,
  computeUrlShortenReduction,
  findUrlShortenTargets,
} from "./urlShorten";

/**
 * Scan one CSV/TSV line for delimiter positions, following RFC 4180 quoting:
 * a delimiter inside a double-quoted field is content, and `""` is an
 * escaped quote that keeps the quoted state. `startInQuotes` seeds the quote
 * state from a field left open by a previous physical line (a quoted field
 * may contain a literal newline, per RFC 4180); `endInQuotes` reports
 * whether this line ends with a field still open, for the caller to carry
 * into the next line. A `"` right before this line's own end and a `"` at
 * the very start of the next line are never treated as one `""` escape —
 * they aren't adjacent characters once the real newline between them is
 * accounted for, and this line-by-line scan naturally keeps them apart.
 */
function scanCsvLine(
  lineText: string,
  delimiter: string,
  startInQuotes: boolean
): { positions: number[]; endInQuotes: boolean } {
  const positions: number[] = [];
  let inQuotes = startInQuotes;
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
  return { positions, endInQuotes: inQuotes };
}

/**
 * Char indices of the field delimiters in one CSV/TSV line (see
 * scanCsvLine). `startInQuotes` (default false) seeds the quote state
 * carried over from a previous physical line for a multi-line quoted field —
 * callers that track state across a whole document (computeCsvPaddings,
 * CsvWidthCache) pass it; a bare single-line call defaults to unquoted.
 */
export function findCsvDelimiterPositions(
  lineText: string,
  delimiter: string,
  startInQuotes: boolean = false
): number[] {
  return scanCsvLine(lineText, delimiter, startInQuotes).positions;
}

/** Delimiter positions and visual cell widths of one CSV/TSV line. */
export interface CsvLineMetrics {
  /** Char indices of the field delimiters (see findCsvDelimiterPositions). */
  delims: number[];
  /** Visual width of the cell ending at each delimiter, index-for-index. */
  widths: number[];
  /**
   * Char index of the first non-space/tab character in each cell, index-for-
   * index with delims/widths. Falls back to the delimiter position when the
   * cell is empty or all whitespace. Used as the padding insertion point for
   * a right-aligned numeric column (see ghostAlign.csv.alignNumbersRight) so
   * ghost characters land against the cell's content instead of its leading
   * whitespace, mirroring markdown.ts's cellContentStart.
   */
  contentStarts: number[];
  /**
   * Whether each cell's trimmed content matches a simple numeric pattern
   * (see NUMERIC_CELL_RE), index-for-index with delims/widths. Used to judge
   * per-column numeric-ness for ghostAlign.csv.alignNumbersRight.
   */
  numeric: boolean[];
  /**
   * Visual width from the cell's start (like widths) to the end of its
   * integer part — up to the decimal point, or the whole numeric value when
   * it has none — index-for-index with delims/widths. Meaningless where
   * numeric[k] is false (defaults to widths[k] there). Used to decimal-point
   * align a numeric column (see computeCsvDecimalWidths) instead of just
   * right-aligning the whole cell.
   */
  intEndWidths: number[];
}

/**
 * Simple numeric-cell pattern for ghostAlign.csv.alignNumbersRight: an
 * optional leading `-`, digits, and an optional decimal part. Deliberately
 * narrow for the first version — thousands separators (`1,234`, ambiguous
 * with the CSV delimiter itself) and exponent notation (`1e10`) are out of
 * scope until a concrete report asks for them.
 */
const NUMERIC_CELL_RE = /^-?\d+(\.\d+)?$/;

/** Char index of the first non-space/tab char in `[cellStart, delimIndex)`, or `delimIndex` if none. */
function cellContentStart(
  lineText: string,
  cellStart: number,
  delimIndex: number
): number {
  let j = cellStart;
  while (j < delimIndex && (lineText[j] === " " || lineText[j] === "\t")) {
    j++;
  }
  return j;
}

/**
 * computeCsvLineMetrics plus the quote state to carry into the next physical
 * line (see scanCsvLine). Metrics are still per physical line — a cell
 * that continues a quoted field opened on a previous line measures only its
 * portion on this line, since there is no single-line width to report for a
 * field split across lines — but the delimiter it ends on is classified
 * correctly using the carried-in quote state, and callers that track state
 * across a document (computeCsvPaddings, CsvWidthCache) use `endInQuotes` to
 * classify the next line's delimiters correctly in turn.
 *
 * `shortenUrls` (ghostAlign.shortenUrls, #418), when true, reduces each
 * cell's reported width by the visual space its URLs' shortened display
 * (`[host]`) would save (see computeUrlShortenReduction) — so a column plan
 * built from these widths sizes itself for the shortened form instead of
 * being widened by text that renders hidden.
 */
function computeCsvLineState(
  lineText: string,
  delimiter: string,
  tabSize: number,
  startInQuotes: boolean,
  shortenUrls: boolean = false
): { metrics: CsvLineMetrics | null; endInQuotes: boolean } {
  const { positions: delims, endInQuotes } = scanCsvLine(lineText, delimiter, startInQuotes);
  if (delims.length === 0) {
    return { metrics: null, endInQuotes };
  }
  const widths: number[] = [];
  const contentStarts: number[] = [];
  const numeric: boolean[] = [];
  const intEndWidths: number[] = [];
  delims.forEach((d, k) => {
    const cellStart = k === 0 ? 0 : delims[k - 1] + 1;
    const cellStartCol = visualColumn(lineText, cellStart, tabSize);
    let width = visualColumn(lineText, d, tabSize) - cellStartCol;
    if (shortenUrls) {
      width -= computeUrlShortenReduction(lineText, cellStart, d, tabSize);
    }
    widths.push(width);
    const contentStart = cellContentStart(lineText, cellStart, d);
    contentStarts.push(contentStart);
    const trimmed = lineText.slice(contentStart, d).trimEnd();
    const isNumeric = NUMERIC_CELL_RE.test(trimmed);
    numeric.push(isNumeric);
    if (isNumeric) {
      const dotIndex = trimmed.indexOf(".");
      const intLen = dotIndex === -1 ? trimmed.length : dotIndex;
      intEndWidths.push(
        visualColumn(lineText, contentStart + intLen, tabSize) - cellStartCol
      );
    } else {
      intEndWidths.push(width);
    }
  });
  return { metrics: { delims, widths, contentStarts, numeric, intEndWidths }, endInQuotes };
}

/**
 * Metrics of one line, or null when the line has no delimiter and therefore
 * takes no part in column alignment. Cell widths are measured in visual
 * columns, so tabs and full-width characters count by their rendered width.
 * `startInQuotes` (default false) seeds the quote state carried over from a
 * previous physical line, like findCsvDelimiterPositions.
 */
export function computeCsvLineMetrics(
  lineText: string,
  delimiter: string,
  tabSize: number,
  startInQuotes: boolean = false
): CsvLineMetrics | null {
  return computeCsvLineState(lineText, delimiter, tabSize, startInQuotes).metrics;
}

/**
 * Per-column "every data cell is numeric" flags for
 * ghostAlign.csv.alignNumbersRight: `numericColumns[k]` is true only when
 * every row that has a k-th cell (after the first participating row, treated
 * as the header and excluded from the judgment — see computeCsvPaddings) has
 * a numeric k-th cell, and at least one such row exists. A column no row
 * contributes to is false rather than vacuously true, matching the default
 * left-aligned behavior when there is nothing to judge.
 *
 * The header exclusion only affects this determination, not where padding is
 * applied: a numeric column still right-aligns its header cell too (see
 * computeCsvPaddingsFromMax), matching the spreadsheet convention of a label
 * sitting above right-aligned numbers.
 */
export function computeCsvNumericColumns(
  rows: Iterable<CsvLineMetrics | null | undefined>
): boolean[] {
  const dataRows: CsvLineMetrics[] = [];
  let sawHeader = false;
  for (const row of rows) {
    if (!row) {
      continue;
    }
    if (!sawHeader) {
      sawHeader = true;
      continue;
    }
    dataRows.push(row);
  }
  const columnCount = dataRows.reduce((max, r) => Math.max(max, r.widths.length), 0);
  const numericColumns: boolean[] = [];
  for (let k = 0; k < columnCount; k++) {
    let sawData = false;
    let allNumeric = true;
    for (const row of dataRows) {
      if (row.numeric.length > k) {
        sawData = true;
        if (!row.numeric[k]) {
          allNumeric = false;
        }
      }
    }
    numericColumns.push(sawData && allNumeric);
  }
  return numericColumns;
}

/**
 * Per-column decimal-point alignment widths for ghostAlign.csv.alignNumbersRight,
 * restricted to columns `numericColumns` marks numeric (see
 * computeCsvNumericColumns) and, within them, to rows whose own cell is
 * numeric (a header row typically isn't).
 *
 * `maxIntWidths[k]` is the widest integer part (see CsvLineMetrics.intEndWidths)
 * among those rows — the amount of left-padding a narrower row's integer part
 * needs so every row's decimal point lands in the same column.
 *
 * `minTotalWidths[k]` is the narrowest column width that can fit every row's
 * integer part AND fractional part simultaneously aligned — `maxIntWidths[k]`
 * plus the widest fractional part (digits after the dot, including the dot
 * itself) among those rows. This can exceed the column's plain max cell width
 * (see computeCsvMaxWidths) when no single row has both the widest integer
 * part and the widest fractional part, so computeCsvPaddingsFromMax widens
 * the column's plan target to at least this before splitting each row's
 * padding into a left part (aligning the decimal point) and a right part
 * (the remainder, still landing the delimiter at the same target position as
 * before this widening).
 */
export function computeCsvDecimalWidths(
  rows: Iterable<CsvLineMetrics | null | undefined>,
  numericColumns: readonly boolean[]
): { maxIntWidths: number[]; minTotalWidths: number[] } {
  const maxIntWidths: number[] = [];
  for (const row of rows) {
    if (!row) {
      continue;
    }
    for (let k = 0; k < row.numeric.length; k++) {
      if (!numericColumns[k] || !row.numeric[k]) {
        continue;
      }
      if (maxIntWidths[k] === undefined || row.intEndWidths[k] > maxIntWidths[k]) {
        maxIntWidths[k] = row.intEndWidths[k];
      }
    }
  }
  const minTotalWidths: number[] = [];
  for (const row of rows) {
    if (!row) {
      continue;
    }
    for (let k = 0; k < row.numeric.length; k++) {
      if (!numericColumns[k] || !row.numeric[k]) {
        continue;
      }
      const total = maxIntWidths[k] + (row.widths[k] - row.intEndWidths[k]);
      if (minTotalWidths[k] === undefined || total > minTotalWidths[k]) {
        minTotalWidths[k] = total;
      }
    }
  }
  return { maxIntWidths, minTotalWidths };
}

/**
 * Per-column max cell width across rows. Rows without a k-th delimiter don't
 * take part in column k; null/undefined entries (delimiter-less or not yet
 * scanned lines) are skipped entirely.
 */
export function computeCsvMaxWidths(
  rows: Iterable<CsvLineMetrics | null | undefined>
): number[] {
  const max: number[] = [];
  for (const row of rows) {
    if (!row) {
      continue;
    }
    for (let k = 0; k < row.widths.length; k++) {
      if (max[k] === undefined || row.widths[k] > max[k]) {
        max[k] = row.widths[k];
      }
    }
  }
  return max;
}

/**
 * The running-position advance rule for one delimiter: `+1` for a
 * single-char delimiter (comma), or the next tab stop for TSV, since the
 * delimiter tab itself expands from wherever it starts.
 */
function delimiterAdvance(
  delimiter: string,
  tabSize: number
): (afterPosition: number) => number {
  return (after) =>
    delimiter === "\t" ? (Math.floor(after / tabSize) + 1) * tabSize : after + 1;
}

/**
 * Per-column alignment plan for a CSV/TSV document: for each column, either
 * the common visual position every row's delimiter should be padded to, or
 * `null` when the column is left unaligned because that would need more
 * than `maxPadding` ghost characters on some row (see computeColumnPlan;
 * `maxPadding` <= 0 means unlimited, so every column always aligns —
 * matching the pre-#178 behavior). `rowWidths` should cover every row that
 * takes part in alignment (the whole document, not just a visible slice),
 * so the plan is scroll-stable for large files — see CsvWidthCache.
 */
export function computeCsvColumnPlan(
  rowWidths: readonly (readonly number[])[],
  delimiter: string,
  tabSize: number,
  maxPadding: number = 0
): (number | null)[] {
  return computeColumnPlan(rowWidths, maxPadding, delimiterAdvance(delimiter, tabSize));
}

/**
 * Placements that align `rows` against a per-column plan (see
 * computeCsvColumnPlan). `plan` may come from the whole document rather than
 * just `rows`, so a visible-range slice of a large file aligns identically
 * no matter where it is scrolled.
 *
 * Alignment proceeds column by column, tracking each row's own running
 * position rather than a single shared one: when a column's plan entry is a
 * number, every row's k-th delimiter is padded to that position and its
 * running position continues from there; when it is `null` (skipped, see
 * computeColumnPlan), no padding is added and the row's running position
 * continues from its own actual (unpadded) width instead — so a column
 * skipped because of one outlier doesn't stop later columns from aligning,
 * it just makes them align relative to each row's real position rather than
 * a position inherited from the skipped column.
 *
 * `numericColumns[k]` (see computeCsvNumericColumns), when true, right-aligns
 * a column instead of left-aligning it, for ghostAlign.csv.alignNumbersRight.
 * Defaults to an empty array, so every column left-aligns (pre-#399 behavior)
 * unless a caller opts in. For a row whose own cell is numeric, the padding
 * is further split at the decimal point (see computeCsvDecimalWidths) using
 * `maxIntWidths`/`minTotalWidths`: a left part at the cell's content start
 * that aligns the decimal point with other rows, and a right part at the
 * delimiter for whatever padding remains — a header row (typically not
 * numeric even in a numeric column) keeps the pre-#429 single-part
 * right-align instead. `maxIntWidths`/`minTotalWidths` default to empty, so
 * omitting them (or leaving numericColumns empty) reduces to that behavior.
 */
export function computeCsvPaddingsFromMax(
  rows: { lineIndex: number; metrics: CsvLineMetrics }[],
  plan: readonly (number | null)[],
  delimiter: string,
  tabSize: number,
  numericColumns: readonly boolean[] = [],
  maxIntWidths: readonly number[] = [],
  minTotalWidths: readonly number[] = []
): Placement[] {
  const advance = delimiterAdvance(delimiter, tabSize);
  const pos = new Array<number>(rows.length).fill(0);
  const placements: Placement[] = [];
  for (let k = 0; k < plan.length; k++) {
    const planTarget = plan[k];
    // plan[k] is an absolute running position (pos[i] carried in from earlier
    // columns plus this column's own width), while minTotalWidths[k] is only
    // this column's own decimal-aligned width — so widening must compare
    // against pos[i] + minTotalWidths[k], not minTotalWidths[k] alone.
    let target = planTarget;
    if (planTarget !== null && numericColumns[k] && minTotalWidths[k] !== undefined) {
      rows.forEach((row, i) => {
        if (row.metrics.delims.length <= k) {
          return;
        }
        const decimalTarget = pos[i] + minTotalWidths[k];
        if (decimalTarget > target!) {
          target = decimalTarget;
        }
      });
    }
    rows.forEach((row, i) => {
      if (row.metrics.delims.length <= k) {
        return;
      }
      const raw = pos[i] + row.metrics.widths[k];
      if (target === null || target === undefined) {
        pos[i] = advance(raw);
        return;
      }
      const padding = target - raw;
      if (padding > 0) {
        if (numericColumns[k] && row.metrics.numeric[k]) {
          const leftPad = Math.max(0, (maxIntWidths[k] ?? 0) - row.metrics.intEndWidths[k]);
          const rightPad = padding - leftPad;
          if (leftPad > 0) {
            placements.push({
              lineIndex: row.lineIndex,
              character: row.metrics.contentStarts[k],
              padding: leftPad,
            });
          }
          if (rightPad > 0) {
            placements.push({
              lineIndex: row.lineIndex,
              character: row.metrics.delims[k],
              padding: rightPad,
            });
          }
        } else {
          const character = numericColumns[k]
            ? row.metrics.contentStarts[k]
            : row.metrics.delims[k];
          placements.push({
            lineIndex: row.lineIndex,
            character,
            padding,
          });
        }
      }
      pos[i] = advance(target);
    });
  }
  return placements;
}

/**
 * Ghost-padding placements that align the delimiters of a CSV/TSV document
 * so each column's delimiter lines up at the widest cell, unless `maxPadding`
 * excludes a column from alignment (see computeCsvColumnPlan and
 * computeCsvPaddingsFromMax for the column-by-column mechanics).
 *
 * `alignNumbersRight` (ghostAlign.csv.alignNumbersRight, default false)
 * right-aligns a column instead of left-aligning it when every data cell in
 * it is numeric (see computeCsvNumericColumns) — the first row that
 * participates in alignment (`rows[0]`, typically the header line) is
 * excluded from that judgment but still gets the resulting right-alignment
 * applied to it, like a header label sitting above right-aligned numbers.
 *
 * `shortenUrls` (ghostAlign.shortenUrls, default false) sizes the column
 * plan for each cell's shortened width instead of its raw width (see
 * computeCsvLineState) — the ghost-padding placements this returns don't
 * themselves shorten any URL text; that's a separate decoration pass (see
 * computeCsvUrlTargets) driven by the same setting.
 */
export function computeCsvPaddings(
  lines: string[],
  delimiter: string,
  tabSize: number,
  maxPadding: number = 0,
  alignNumbersRight: boolean = false,
  shortenUrls: boolean = false
): Placement[] {
  const rows: { lineIndex: number; metrics: CsvLineMetrics }[] = [];
  let inQuotes = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const { metrics, endInQuotes } = computeCsvLineState(
      lines[lineIndex],
      delimiter,
      tabSize,
      inQuotes,
      shortenUrls
    );
    if (metrics) {
      rows.push({ lineIndex, metrics });
    }
    inQuotes = endInQuotes;
  }
  const plan = computeCsvColumnPlan(
    rows.map((r) => r.metrics.widths),
    delimiter,
    tabSize,
    maxPadding
  );
  const numericColumns = alignNumbersRight
    ? computeCsvNumericColumns(rows.map((r) => r.metrics))
    : [];
  const { maxIntWidths, minTotalWidths } = alignNumbersRight
    ? computeCsvDecimalWidths(rows.map((r) => r.metrics), numericColumns)
    : { maxIntWidths: [], minTotalWidths: [] };
  return computeCsvPaddingsFromMax(
    rows,
    plan,
    delimiter,
    tabSize,
    numericColumns,
    maxIntWidths,
    minTotalWidths
  );
}

/**
 * Per-line metrics cache for a large CSV/TSV document. Holds every line's
 * delimiter metrics so the per-column max width — and thus the alignment —
 * is computed over the whole file instead of a visible-range slice, making
 * it scroll-stable. An edit only re-scans the lines it touched: applyEdit
 * splices the changed lines in as dirty, and the next sync() re-reads just
 * those. The max aggregation runs over the cached numbers (no text scan)
 * and is memoized until the next edit.
 */
export class CsvWidthCache {
  // undefined = dirty slot awaiting re-scan; null = line has no delimiter.
  private metrics: (CsvLineMetrics | null | undefined)[] = [];
  // Quote state each line started/ended with, index-for-index with metrics.
  // Only meaningful where metrics[i] !== undefined (kept in sync with it).
  private startInQuotes: boolean[] = [];
  private endInQuotes: boolean[] = [];
  private max: number[] | null = null;
  private plan: (number | null)[] | null = null;
  private planMaxPadding = 0;
  private numericCols: boolean[] | null = null;
  private decimalWidthsCache: { maxIntWidths: number[]; minTotalWidths: number[] } | null = null;
  private tabSize = 0;
  private shortenUrls = false;

  constructor(public readonly delimiter: string) {}

  /**
   * Record a document edit: `deletedLineCount` lines at `startLine` are
   * replaced by `insertedLineCount` fresh (dirty) lines.
   */
  applyEdit(
    startLine: number,
    deletedLineCount: number,
    insertedLineCount: number
  ) {
    const filler = new Array<CsvLineMetrics | null | undefined>(
      insertedLineCount
    ).fill(undefined);
    this.metrics = this.metrics
      .slice(0, startLine)
      .concat(filler, this.metrics.slice(startLine + deletedLineCount));
    const boolFiller = new Array<boolean>(insertedLineCount).fill(false);
    this.startInQuotes = this.startInQuotes
      .slice(0, startLine)
      .concat(boolFiller, this.startInQuotes.slice(startLine + deletedLineCount));
    this.endInQuotes = this.endInQuotes
      .slice(0, startLine)
      .concat(boolFiller, this.endInQuotes.slice(startLine + deletedLineCount));
    this.max = null;
    this.plan = null;
    this.numericCols = null;
    this.decimalWidthsCache = null;
  }

  /**
   * Bring the cache in line with the document: re-scan dirty lines only, or
   * rebuild everything when the line count disagrees (an edit was missed)
   * or the tab size changed.
   *
   * A quoted field can carry its open state across a physical line (see
   * scanCsvLine in findCsvDelimiterPositions), so a dirty line's rescan can
   * change the quote state it hands off to the line after it even when that
   * next line wasn't itself touched by the edit. This walks top to bottom
   * tracking the running quote state and re-scans any line whose incoming
   * state (`carry`) no longer matches what it was last scanned with, in
   * addition to lines applyEdit marked dirty — cascading forward until a
   * line's incoming state matches its cached one again, which also means
   * its cached outgoing state is still valid and the cascade can stop.
   *
   * `shortenUrls` (ghostAlign.shortenUrls) is treated like `tabSize`: a
   * change forces a full rebuild, since it's a per-document setting rather
   * than something tracked line-by-line, and can flip with no document edit
   * at all (a settings change).
   */
  sync(
    lineCount: number,
    lineAt: (line: number) => string,
    tabSize: number,
    shortenUrls: boolean = false
  ) {
    if (
      this.metrics.length !== lineCount ||
      this.tabSize !== tabSize ||
      this.shortenUrls !== shortenUrls
    ) {
      this.tabSize = tabSize;
      this.shortenUrls = shortenUrls;
      this.metrics = new Array<CsvLineMetrics | null | undefined>(
        lineCount
      ).fill(undefined);
      this.startInQuotes = new Array<boolean>(lineCount).fill(false);
      this.endInQuotes = new Array<boolean>(lineCount).fill(false);
      this.max = null;
      this.plan = null;
      this.numericCols = null;
      this.decimalWidthsCache = null;
    }
    let carry = false;
    for (let i = 0; i < this.metrics.length; i++) {
      if (this.metrics[i] !== undefined && this.startInQuotes[i] === carry) {
        carry = this.endInQuotes[i];
        continue;
      }
      const { metrics, endInQuotes } = computeCsvLineState(
        lineAt(i),
        this.delimiter,
        this.tabSize,
        carry,
        this.shortenUrls
      );
      this.metrics[i] = metrics;
      this.startInQuotes[i] = carry;
      this.endInQuotes[i] = endInQuotes;
      carry = endInQuotes;
    }
  }

  /** Per-column max widths over all cached lines. Call sync() first. */
  maxWidths(): number[] {
    if (!this.max) {
      this.max = computeCsvMaxWidths(this.metrics);
    }
    return this.max;
  }

  /**
   * Per-column alignment plan over all cached lines — see
   * computeCsvColumnPlan — memoized like maxWidths() but also recomputed
   * when `maxPadding` differs from the last call, since the plan (unlike
   * maxWidths) depends on it. Call sync() first.
   */
  columnPlan(maxPadding: number): (number | null)[] {
    if (!this.plan || this.planMaxPadding !== maxPadding) {
      const widths = this.metrics
        .filter((m): m is CsvLineMetrics => !!m)
        .map((m) => m.widths);
      this.plan = computeCsvColumnPlan(widths, this.delimiter, this.tabSize, maxPadding);
      this.planMaxPadding = maxPadding;
    }
    return this.plan;
  }

  /**
   * Per-column numeric flags over all cached lines — see
   * computeCsvNumericColumns, including its header-row exclusion — memoized
   * like maxWidths()/columnPlan(). Call sync() first.
   */
  numericColumns(): boolean[] {
    if (!this.numericCols) {
      this.numericCols = computeCsvNumericColumns(this.metrics);
    }
    return this.numericCols;
  }

  /**
   * Per-column decimal-alignment widths over all cached lines — see
   * computeCsvDecimalWidths, which this also depends on numericColumns() for
   * — memoized like numericColumns(). Call sync() first.
   */
  private decimalWidths(): { maxIntWidths: number[]; minTotalWidths: number[] } {
    if (!this.decimalWidthsCache) {
      this.decimalWidthsCache = computeCsvDecimalWidths(this.metrics, this.numericColumns());
    }
    return this.decimalWidthsCache;
  }

  /** Per-column widest integer part among numeric rows — see computeCsvDecimalWidths. */
  maxIntWidths(): number[] {
    return this.decimalWidths().maxIntWidths;
  }

  /** Per-column narrowest width fitting every numeric row's decimal-aligned form — see computeCsvDecimalWidths. */
  minTotalWidths(): number[] {
    return this.decimalWidths().minTotalWidths;
  }

  /** Cached metrics of one line (null if it has no delimiter). */
  metricsAt(line: number): CsvLineMetrics | null {
    return this.metrics[line] ?? null;
  }
}

/**
 * {@link UrlShortenTarget}s for every cell of one CSV/TSV row (ghostAlign.shortenUrls,
 * #418) — every delimiter-bounded cell plus the trailing cell after the last
 * delimiter (which `metrics.delims`/`widths` don't cover, since there's no
 * column-width plan for a cell nothing follows, but it can still contain a
 * URL worth shortening).
 */
export function urlTargetsForCsvLine(
  lineIndex: number,
  lineText: string,
  metrics: CsvLineMetrics
): UrlShortenTarget[] {
  const targets: UrlShortenTarget[] = [];
  let cellStart = 0;
  for (const d of metrics.delims) {
    targets.push(...findUrlShortenTargets(lineIndex, lineText, cellStart, d));
    cellStart = d + 1;
  }
  targets.push(...findUrlShortenTargets(lineIndex, lineText, cellStart, lineText.length));
  return targets;
}

/**
 * {@link UrlShortenTarget}s for every cell of every row in a CSV/TSV
 * document — the small-file counterpart of {@link urlTargetsForCsvLine},
 * which large files instead call per cached row via CsvWidthCache.metricsAt.
 */
export function computeCsvUrlTargets(
  lines: string[],
  delimiter: string,
  tabSize: number
): UrlShortenTarget[] {
  const targets: UrlShortenTarget[] = [];
  let inQuotes = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const { metrics, endInQuotes } = computeCsvLineState(
      lines[lineIndex],
      delimiter,
      tabSize,
      inQuotes
    );
    if (metrics) {
      targets.push(...urlTargetsForCsvLine(lineIndex, lines[lineIndex], metrics));
    }
    inQuotes = endInQuotes;
  }
  return targets;
}
