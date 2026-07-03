// ── CSV / TSV column alignment ────────────────────────────────────────────

import { visualColumn } from "./paddings";

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
