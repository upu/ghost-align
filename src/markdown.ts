// ── Markdown table alignment ──────────────────────────────────────────────

import { visualColumn } from "./paddings";

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
 * For each line, whether it is inside a fenced code block (```` ``` ```` or `~~~`).
 * A fence opens on a line whose trimmed text starts with 3+ backticks or tildes, and
 * closes on the next line whose trimmed text starts with 3+ of the same character. An
 * unclosed fence extends to the end of the file.
 */
function computeFencedLines(lines: string[]): boolean[] {
  const fenced = new Array<boolean>(lines.length).fill(false);
  let fenceChar: string | null = null;
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const match = FENCE_RE.exec(trimmed);
    if (fenceChar === null) {
      if (match) {
        fenceChar = match[1][0];
        fenceLen = match[1].length;
        fenced[i] = true;
      }
    } else {
      fenced[i] = true;
      if (match && match[1][0] === fenceChar && match[1].length >= fenceLen) {
        fenceChar = null;
      }
    }
  }
  return fenced;
}

/**
 * Detect GFM table blocks: a header row (containing `|`), a delimiter row, then
 * data rows (non-blank, containing `|`). Returns each block as its line indices.
 * Lines inside fenced code blocks (``` or ~~~) are skipped.
 */
export function findMarkdownTables(lines: string[]): number[][] {
  const tables: number[][] = [];
  const fenced = computeFencedLines(lines);
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
 * Ghost-padding placements that align the `|` delimiters of every Markdown table
 * in `lines`. Each cell is padded to its column's widest cell by inserting ghost
 * characters before the trailing `|`, so all delimiters line up. Returns the same
 * placement shape as computePaddings.
 */
export function computeMarkdownTablePaddings(
  lines: string[],
  tabSize: number
): { lineIndex: number; character: number; padding: number }[] {
  const placements: { lineIndex: number; character: number; padding: number }[] = [];

  for (const block of findMarkdownTables(lines)) {
    const rows = block.map((lineIndex) => {
      const text = lines[lineIndex];
      const pipes = findPipePositions(text);
      const segWidths: number[] = [];
      let prevVisual = 0;
      for (const pipe of pipes) {
        const pipeVisual = visualColumn(text, pipe, tabSize);
        segWidths.push(pipeVisual - prevVisual);
        prevVisual = pipeVisual + 1; // skip the pipe character (width 1)
      }
      return { lineIndex, pipes, segWidths };
    });

    const maxSeg: number[] = [];
    for (const row of rows) {
      row.segWidths.forEach((w, k) => {
        maxSeg[k] = Math.max(maxSeg[k] ?? 0, w);
      });
    }

    for (const row of rows) {
      row.pipes.forEach((pipe, k) => {
        const padding = maxSeg[k] - row.segWidths[k];
        if (padding > 0) {
          placements.push({ lineIndex: row.lineIndex, character: pipe, padding });
        }
      });
    }
  }

  return placements;
}
