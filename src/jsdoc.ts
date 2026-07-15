// ── JSDoc @param alignment ─────────────────────────────────────────────────

import {
  AlignmentColumn,
  AlignmentEntry,
  Placement,
  computePaddings,
  visualColumn,
} from "./paddings";

/**
 * Matches a JSDoc body line `* @param ...` / `* @property ...` /
 * `* @arg ...` / `* @argument ...` (leading whitespace + `*`). `@property`
 * (`@typedef` members) and the `@param` aliases `@arg` / `@argument` share
 * the same `{type} name description` shape, so they are parsed identically.
 */
const JSDOC_PARAM_RE = /^\s*\*\s*@(?:param|property|arg|argument)(?:\s+|$)/;

/** Index of the first non-whitespace character at or after `from`. */
function skipSpaces(lineText: string, from: number): number {
  let i = from;
  while (i < lineText.length && (lineText[i] === " " || lineText[i] === "\t")) {
    i++;
  }
  return i;
}

/**
 * Parse a JSDoc `@param` line into the character indices of its
 * parameter-name and description tokens (`descStart` is -1 when the line has
 * no description). Returns null for lines that are not alignable `@param`
 * lines (not a JSDoc `@param`, no name, or an unbalanced `{type}`). The
 * `{type}` part is optional and may contain nested braces; an
 * optional-parameter name `[count=1]` is one token up to its `]`.
 */
export function parseJsdocParamLine(
  lineText: string
): { nameStart: number; descStart: number } | null {
  const match = JSDOC_PARAM_RE.exec(lineText);
  if (!match) {
    return null;
  }
  let i = skipSpaces(lineText, match[0].length);
  if (lineText[i] === "{") {
    let depth = 0;
    let j = i;
    for (; j < lineText.length; j++) {
      if (lineText[j] === "{") {
        depth++;
      } else if (lineText[j] === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    if (depth !== 0) {
      return null; // unbalanced type braces
    }
    i = skipSpaces(lineText, j);
  }
  if (i >= lineText.length) {
    return null; // no parameter name
  }
  const nameStart = i;
  let nameEnd: number;
  if (lineText[i] === "[") {
    // Depth-counted like the {type} scan above: a default value such as
    // `[indices=[]]` or `[items=["a","b"]]` nests its own `[`/`]`, so the
    // first `]` found by a plain indexOf would close the wrong bracket.
    let depth = 0;
    let j = i;
    for (; j < lineText.length; j++) {
      if (lineText[j] === "[") {
        depth++;
      } else if (lineText[j] === "]") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    if (depth !== 0) {
      return null; // unbalanced name brackets
    }
    nameEnd = j;
  } else {
    let j = i;
    while (
      j < lineText.length &&
      lineText[j] !== " " &&
      lineText[j] !== "\t"
    ) {
      j++;
    }
    nameEnd = j;
  }
  const descStart = skipSpaces(lineText, nameEnd);
  return { nameStart, descStart: descStart < lineText.length ? descStart : -1 };
}

/**
 * Ghost-padding placements aligning consecutive JSDoc `@param`-shaped lines
 * (`@param`, `@property`, `@arg`, `@argument`): the parameter-name column,
 * then the description column. Reuses the sequential multi-column logic of
 * computePaddings (name padding shifts the description). Any line that is
 * not an alignable line splits the run, so `@returns` etc. are never pulled
 * into the group. A run of `@param` lines immediately followed by a run of
 * `@property` (or `@arg`/`@argument`) lines is treated as one group rather
 * than split by tag type — the tags share the same shape, so aligning the
 * name/description columns across the boundary reads as one coherent list
 * instead of two arbitrarily-different ones.
 */
export function computeJsdocParamPaddings(
  lines: string[],
  tabSize: number,
  maxPadding: number = 0
): Placement[] {
  const groups: AlignmentEntry[][] = [];
  let current: AlignmentEntry[] = [];
  const flush = () => {
    if (current.length >= 2) {
      groups.push(current);
    }
    current = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseJsdocParamLine(lines[i]);
    if (!parsed) {
      flush();
      continue;
    }
    const columns: AlignmentColumn[] = [
      {
        opIndex: 0,
        insert: parsed.nameStart,
        visualColumn: visualColumn(lines[i], parsed.nameStart, tabSize),
      },
    ];
    if (parsed.descStart !== -1) {
      columns.push({
        opIndex: 1,
        insert: parsed.descStart,
        visualColumn: visualColumn(lines[i], parsed.descStart, tabSize),
      });
    }
    current.push({
      lineIndex: i,
      columns,
    });
  }
  flush();
  return computePaddings(groups, maxPadding);
}
