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
  const widths = delims.map((d, k) => {
    const cellStart = k === 0 ? 0 : delims[k - 1] + 1;
    return (
      visualColumn(lineText, d, tabSize) -
      visualColumn(lineText, cellStart, tabSize)
    );
  });
  return { delims, widths };
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
 */
export function computeCsvPaddingsFromMax(
  rows: { lineIndex: number; metrics: CsvLineMetrics }[],
  plan: readonly (number | null)[],
  delimiter: string,
  tabSize: number
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
        placements.push({
          lineIndex: row.lineIndex,
          character: row.metrics.delims[k],
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
 */
export function computeCsvPaddings(
  lines: string[],
  delimiter: string,
  tabSize: number,
  maxPadding: number = 0
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
  return computeCsvPaddingsFromMax(rows, plan, delimiter, tabSize);
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

  /** Cached metrics of one line (null if it has no delimiter). */
  metricsAt(line: number): CsvLineMetrics | null {
    return this.metrics[line] ?? null;
  }
}
