// ── CSV / TSV column alignment ────────────────────────────────────────────

import { Placement, computeColumnPlan, visualColumn } from "./paddings";

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
 * Metrics of one line, or null when the line has no delimiter and therefore
 * takes no part in column alignment. Cell widths are measured in visual
 * columns, so tabs and full-width characters count by their rendered width.
 */
export function computeCsvLineMetrics(
  lineText: string,
  delimiter: string,
  tabSize: number
): CsvLineMetrics | null {
  const delims = findCsvDelimiterPositions(lineText, delimiter);
  if (delims.length === 0) {
    return null;
  }
  const widths: number[] = [];
  const contentStarts: number[] = [];
  const numeric: boolean[] = [];
  delims.forEach((d, k) => {
    const cellStart = k === 0 ? 0 : delims[k - 1] + 1;
    widths.push(
      visualColumn(lineText, d, tabSize) - visualColumn(lineText, cellStart, tabSize)
    );
    const contentStart = cellContentStart(lineText, cellStart, d);
    contentStarts.push(contentStart);
    numeric.push(NUMERIC_CELL_RE.test(lineText.slice(contentStart, d).trimEnd()));
  });
  return { delims, widths, contentStarts, numeric };
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
 * `numericColumns[k]` (see computeCsvNumericColumns), when true, inserts a
 * column's padding at the cell's content start instead of at the delimiter —
 * right-aligning it — for ghostAlign.csv.alignNumbersRight. Defaults to an
 * empty array, so every column left-aligns (pre-#399 behavior) unless a
 * caller opts in.
 */
export function computeCsvPaddingsFromMax(
  rows: { lineIndex: number; metrics: CsvLineMetrics }[],
  plan: readonly (number | null)[],
  delimiter: string,
  tabSize: number,
  numericColumns: readonly boolean[] = []
): Placement[] {
  const advance = delimiterAdvance(delimiter, tabSize);
  const pos = new Array<number>(rows.length).fill(0);
  const placements: Placement[] = [];
  for (let k = 0; k < plan.length; k++) {
    const target = plan[k];
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
        const character = numericColumns[k]
          ? row.metrics.contentStarts[k]
          : row.metrics.delims[k];
        placements.push({
          lineIndex: row.lineIndex,
          character,
          padding,
        });
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
 */
export function computeCsvPaddings(
  lines: string[],
  delimiter: string,
  tabSize: number,
  maxPadding: number = 0,
  alignNumbersRight: boolean = false
): Placement[] {
  const rows: { lineIndex: number; metrics: CsvLineMetrics }[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const metrics = computeCsvLineMetrics(lines[lineIndex], delimiter, tabSize);
    if (metrics) {
      rows.push({ lineIndex, metrics });
    }
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
  return computeCsvPaddingsFromMax(rows, plan, delimiter, tabSize, numericColumns);
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
  private max: number[] | null = null;
  private plan: (number | null)[] | null = null;
  private planMaxPadding = 0;
  private numericCols: boolean[] | null = null;
  private tabSize = 0;

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
    this.max = null;
    this.plan = null;
    this.numericCols = null;
  }

  /**
   * Bring the cache in line with the document: re-scan dirty lines only, or
   * rebuild everything when the line count disagrees (an edit was missed)
   * or the tab size changed.
   */
  sync(lineCount: number, lineAt: (line: number) => string, tabSize: number) {
    if (this.metrics.length !== lineCount || this.tabSize !== tabSize) {
      this.tabSize = tabSize;
      this.metrics = new Array<CsvLineMetrics | null | undefined>(
        lineCount
      ).fill(undefined);
      this.max = null;
      this.plan = null;
      this.numericCols = null;
    }
    for (let i = 0; i < this.metrics.length; i++) {
      if (this.metrics[i] === undefined) {
        this.metrics[i] = computeCsvLineMetrics(
          lineAt(i),
          this.delimiter,
          this.tabSize
        );
      }
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

  /** Cached metrics of one line (null if it has no delimiter). */
  metricsAt(line: number): CsvLineMetrics | null {
    return this.metrics[line] ?? null;
  }
}
