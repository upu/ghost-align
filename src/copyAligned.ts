// ── Copy with Alignment ────────────────────────────────────────────────────
//
// Turns ghost padding into real ASCII spaces so the aligned look survives a
// copy-paste outside the editor (chat, review comments, docs). Pure text
// transform: given the same Placement values used for decoration, inserts
// spaces at those positions instead of rendering them as ghost text, then
// trims the result to the requested range.

import { Placement } from "./paddings";

/** A character range spanning one or more lines, e.g. an editor selection. */
export type TextRange = {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
};

/**
 * Insert `paddings` into `lineText` as real characters, at each `character`
 * column — ASCII spaces, or the placement's `padChar` when set (e.g. `-` on
 * a Markdown table delimiter row, which must stay `-` to remain a valid GFM
 * delimiter cell). Padding is inserted before the existing character at that
 * column (mirroring the decoration's `before` render option), so no original
 * character is consumed.
 */
export function applyPaddingsToLine(
  lineText: string,
  paddings: { character: number; padding: number; padChar?: string }[]
): string {
  const sorted = [...paddings].sort((a, b) => a.character - b.character);
  let result = "";
  let cursor = 0;
  for (const { character, padding, padChar } of sorted) {
    result += lineText.slice(cursor, character);
    result += (padChar ?? " ").repeat(padding);
    cursor = character;
  }
  result += lineText.slice(cursor);
  return result;
}

/** One line's ghost padding, in that line's own character coordinates. */
interface LinePadding {
  character: number;
  padding: number;
  padChar?: string;
}

/** Placements grouped by line index, each line keeping its original order. */
function groupPlacementsByLine(
  placements: Placement[]
): Map<number, LinePadding[]> {
  const byLine = new Map<number, LinePadding[]>();
  for (const { lineIndex, character, padding, padChar } of placements) {
    const list = byLine.get(lineIndex);
    if (list) {
      list.push({ character, padding, padChar });
    } else {
      byLine.set(lineIndex, [{ character, padding, padChar }]);
    }
  }
  return byLine;
}

/**
 * The kept slice of line `i` as `[from, to)` character offsets: the whole line
 * unless `range` starts or ends partway through it.
 */
function lineSliceBounds(
  lineText: string,
  i: number,
  range: TextRange | null
): [number, number] {
  const from = range && i === range.startLine ? range.startChar : 0;
  const to = range && i === range.endLine ? range.endChar : lineText.length;
  return [from, to];
}

/**
 * Build the aligned text for `range` (or the whole document when `range` is
 * null) by applying `placements` as real spaces to `lines`. Lines/characters
 * outside `range` are trimmed away; a placement whose column falls outside
 * the kept slice of its line is dropped along with that trimmed-away text.
 */
export function buildAlignedText(
  lines: string[],
  placements: Placement[],
  range: TextRange | null,
  eol: string = "\n"
): string {
  const byLine = groupPlacementsByLine(placements);
  const startLine = range ? range.startLine : 0;
  const endLine = range ? range.endLine : lines.length - 1;

  const outLines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    const lineText = lines[i];
    const [from, to] = lineSliceBounds(lineText, i, range);
    const paddings = (byLine.get(i) ?? [])
      .filter((p) => p.character >= from && p.character <= to)
      .map((p) => ({
        character: p.character - from,
        padding: p.padding,
        padChar: p.padChar,
      }));
    outLines.push(applyPaddingsToLine(lineText.slice(from, to), paddings));
  }
  return outLines.join(eol);
}
