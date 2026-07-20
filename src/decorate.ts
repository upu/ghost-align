import * as vscode from "vscode";
import {
  LineScanState,
  LineScanCheckpointCache,
  findOperatorTargets,
} from "./finders";
import {
  DEFAULT_TAB_SIZE,
  LineSource,
  LongOperatorGroupCache,
  Placement,
  computePaddings,
  computeSliceBounds,
  findAlignmentGroups,
} from "./paddings";
import { computeJsdocParamPaddings, parseJsdocParamLine } from "./jsdoc";
import {
  FenceState,
  MarkdownTableWidthCache,
  computeMarkdownTablePaddings,
  findPipePositions,
} from "./markdown";
import {
  CsvLineMetrics,
  CsvWidthCache,
  computeCsvPaddings,
  computeCsvPaddingsFromMax,
} from "./csv";
import { TextRange, buildAlignedText } from "./copyAligned";
import { isLanguageDisabled, resolveAlignmentPath, resolveMaxPadding } from "./config";

/**
 * Compute the ghost-padding placements for `lines`, dispatching to whichever
 * alignment path `languageId` uses (Markdown table / CSV-TSV / operators +
 * JSDoc). `source` backs the operator path's group scan and must present the
 * same lines as `lines` (index-for-index); `markdownFenceState` is only
 * consulted on the Markdown path, and `initialState` only on the operator
 * path — both for when `lines` is a slice that starts mid-file (see
 * decorateEditor's large-file mode), seeding the state a fence / block
 * comment / template literal / CSS rule block / YAML block scalar opened
 * above the slice left behind.
 */
export function computeDocumentPlacements(
  lines: string[],
  source: LineSource,
  languageId: string,
  config: vscode.WorkspaceConfiguration,
  tabSize: number,
  markdownFenceState?: FenceState,
  initialState?: LineScanState
): Placement[] {
  const path = resolveAlignmentPath(languageId, config);
  const maxPadding = resolveMaxPadding(config);

  if (path.kind === "none") {
    return [];
  }
  if (path.kind === "markdown") {
    return computeMarkdownTablePaddings(lines, tabSize, markdownFenceState, maxPadding);
  }
  if (path.kind === "csv") {
    return computeCsvPaddings(
      lines,
      path.delimiter,
      tabSize,
      maxPadding,
      path.alignNumbersRight
    );
  }

  const groups = findAlignmentGroups(
    source,
    path.operators,
    languageId,
    tabSize,
    initialState
  );
  let placements = computePaddings(groups, maxPadding);
  if (path.alignJsdoc) {
    placements = placements.concat(
      computeJsdocParamPaddings(lines, tabSize, maxPadding)
    );
  }
  return placements;
}

/** Resolve the effective tab width of an editor, falling back to the default. */
function resolveTabSize(editor: vscode.TextEditor): number {
  const t = editor.options.tabSize;
  if (typeof t === "number" && t > 0) {
    return t;
  }
  const parsed = typeof t === "string" ? parseInt(t, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TAB_SIZE;
}

// ── Visible-range mode for large files ────────────────────────────────────

/** Files with at least this many lines are decorated per visible range. */
export const LARGE_FILE_LINE_THRESHOLD = 10000;

// Per-document CSV/TSV width caches for large files, so the column max is
// global (scroll-stable alignment) while an edit re-scans only the changed
// lines. WeakMap keying by document identity frees an entry when its
// document goes away.
const csvWidthCaches = new WeakMap<vscode.TextDocument, CsvWidthCache>();

/**
 * Keep a document's CSV width cache in step with an edit by marking the
 * changed lines dirty (re-scanned on the next decoration pass). No-op for
 * documents that have no cache yet — one is built on first decoration.
 */
export function notifyCsvDocumentChange(
  document: vscode.TextDocument,
  changes: readonly { range: vscode.Range; text: string }[]
) {
  const cache = csvWidthCaches.get(document);
  if (!cache) {
    return;
  }
  for (const change of changes) {
    cache.applyEdit(
      change.range.start.line,
      change.range.end.line - change.range.start.line + 1,
      change.text.split("\n").length
    );
  }
}

// Per-document Markdown table width caches for large files, mirroring
// csvWidthCaches above — see MarkdownTableWidthCache for how it decides
// whether an edit can be left alone or forces a full rebuild.
const markdownTableWidthCaches = new WeakMap<
  vscode.TextDocument,
  MarkdownTableWidthCache
>();

/**
 * Keep a document's Markdown table width cache in step with an edit — see
 * MarkdownTableWidthCache.applyEdit for how it decides whether the edit can
 * only have touched ordinary prose (cache stays valid) or must invalidate
 * the cache for a full rebuild on the next decoration pass. No-op for
 * documents that have no cache yet — one is built on first decoration.
 */
export function notifyMarkdownDocumentChange(
  document: vscode.TextDocument,
  changes: readonly { range: vscode.Range; text: string }[]
) {
  const cache = markdownTableWidthCaches.get(document);
  if (!cache) {
    return;
  }
  for (const change of changes) {
    cache.applyEdit(
      change.range.start.line,
      change.range.end.line - change.range.start.line + 1,
      change.text.split("\n").length,
      change.text
    );
  }
}

// Per-document LineScanState checkpoint caches for the operator path on
// large files, mirroring csvWidthCaches/markdownTableWidthCaches above —
// see LineScanCheckpointCache (finders.ts) for why a checkpoint cache (not a
// whole-document aggregate like the other two) is the right shape here.
const lineScanCheckpointCaches = new WeakMap<
  vscode.TextDocument,
  LineScanCheckpointCache
>();

/** Get (or lazily create) a document's LineScanState checkpoint cache. */
function getLineScanCheckpointCache(
  document: vscode.TextDocument
): LineScanCheckpointCache {
  let cache = lineScanCheckpointCaches.get(document);
  if (!cache) {
    cache = new LineScanCheckpointCache();
    lineScanCheckpointCaches.set(document, cache);
  }
  return cache;
}

/**
 * Keep a document's operator-path LineScanState checkpoint cache in step
 * with an edit by discarding every checkpoint the edit may have invalidated
 * (see LineScanCheckpointCache.invalidateFrom). No-op for documents that
 * have no cache yet — one is built on first decoration.
 */
export function notifyLineScanDocumentChange(
  document: vscode.TextDocument,
  changes: readonly { range: vscode.Range; text: string }[]
) {
  const cache = lineScanCheckpointCaches.get(document);
  if (!cache) {
    return;
  }
  for (const change of changes) {
    cache.invalidateFrom(change.range.start.line);
  }
}

// Per-document LongOperatorGroupCache for the operator path on large files —
// see LongOperatorGroupCache (paddings.ts) for why an over-long group's
// resolved extent is cached separately from the ordinary slice-bounded scan.
const longOperatorGroupCaches = new WeakMap<
  vscode.TextDocument,
  LongOperatorGroupCache
>();

/** Get (or lazily create) a document's LongOperatorGroupCache. */
function getLongOperatorGroupCache(
  document: vscode.TextDocument
): LongOperatorGroupCache {
  let cache = longOperatorGroupCaches.get(document);
  if (!cache) {
    cache = new LongOperatorGroupCache();
    longOperatorGroupCaches.set(document, cache);
  }
  return cache;
}

/**
 * Keep a document's LongOperatorGroupCache in step with an edit. Discards
 * every cached over-long-group range wholesale rather than checking whether
 * the edit's range actually overlapped one — see LongOperatorGroupCache's
 * class doc for why (rare, small cache; recompute cost is one-time either
 * way). No-op for documents that have no cache yet.
 */
export function notifyLongOperatorGroupDocumentChange(
  document: vscode.TextDocument,
  changes: readonly { range: vscode.Range; text: string }[]
) {
  const cache = longOperatorGroupCaches.get(document);
  if (!cache || changes.length === 0) {
    return;
  }
  cache.invalidate();
}

// Decoration type: the base style is empty; per-instance renderOptions inject
// the padding. Created by `createAlignDecorationType` in `activate` and
// registered for disposal there.
let alignDecorationType: vscode.TextEditorDecorationType;

/** Create (or replace) the shared decoration type `decorateEditor` draws with. */
export function createAlignDecorationType(): vscode.TextEditorDecorationType {
  alignDecorationType = vscode.window.createTextEditorDecorationType({});
  return alignDecorationType;
}

/** Clear ghost-align decorations from a single editor. */
export function clearEditorDecorations(editor: vscode.TextEditor) {
  editor.setDecorations(alignDecorationType, []);
}

/** Clear ghost-align decorations from every visible editor. */
export function clearDecorations() {
  for (const editor of vscode.window.visibleTextEditors) {
    clearEditorDecorations(editor);
  }
}

/** Apply ghost-align decorations to a single editor. */
export function decorateEditor(
  editor: vscode.TextEditor,
  config: vscode.WorkspaceConfiguration,
  ghostChar: string,
  ghostColor: string
) {
  const document = editor.document;
  const languageId = document.languageId;

  if (isLanguageDisabled(config, languageId)) {
    editor.setDecorations(alignDecorationType, []);
    return;
  }

  const tabSize = resolveTabSize(editor);
  const lineCount = document.lineCount;

  const path = resolveAlignmentPath(languageId, config);
  if (path.kind === "none") {
    editor.setDecorations(alignDecorationType, []);
    return;
  }
  const maxPadding = resolveMaxPadding(config);

  // Large files are computed per visible range instead of whole-file, and
  // re-decorated on scroll. The slice is expanded to group boundaries so a
  // group straddling the visible edge still aligns against all its members.
  // CSV/TSV has no group boundary (the whole file is one table); it instead
  // aligns against per-column max widths cached over the whole document, so
  // scrolling cannot change the alignment position. Markdown likewise never
  // slices below: its large-file path goes through MarkdownTableWidthCache,
  // which computes widths over the whole document up front.
  let sliceStart = 0;
  let sliceEnd = lineCount - 1;
  // Hoisted so the operator path's over-long-group correction below (#434)
  // can reuse the exact same boundary predicate that bounded this slice.
  let isGroupLine: ((line: number) => boolean) | undefined;
  const useVisibleRange =
    lineCount >= LARGE_FILE_LINE_THRESHOLD && editor.visibleRanges.length > 0;
  if (useVisibleRange) {
    const visibleStart = Math.min(
      ...editor.visibleRanges.map((r) => r.start.line)
    );
    const visibleEnd = Math.max(...editor.visibleRanges.map((r) => r.end.line));
    if (path.kind === "markdown") {
      isGroupLine = (i) => findPipePositions(document.lineAt(i).text).length > 0;
    } else if (path.kind === "csv") {
      isGroupLine = () => false;
    } else {
      const { operators, alignJsdoc } = path;
      isGroupLine = (i) => {
        const text = document.lineAt(i).text;
        return (
          findOperatorTargets(text, operators, languageId).length > 0 ||
          (alignJsdoc && parseJsdocParamLine(text) !== null)
        );
      };
    }
    [sliceStart, sliceEnd] = computeSliceBounds(
      lineCount,
      visibleStart,
      visibleEnd,
      isGroupLine
    );
  }

  let placements: Placement[];
  if (path.kind === "markdown" && useVisibleRange) {
    // Whole-document table widths come from the cache — rebuilt in full only
    // on an edit (see notifyMarkdownDocumentChange) — so scrolling alone
    // reads the cached widths and never shifts alignment.
    let cache = markdownTableWidthCaches.get(document);
    if (!cache) {
      cache = new MarkdownTableWidthCache();
      markdownTableWidthCaches.set(document, cache);
    }
    cache.sync(lineCount, (i) => document.lineAt(i).text, tabSize, maxPadding);
    placements = cache.placementsForRange(sliceStart, sliceEnd);
  } else if (path.kind === "csv" && useVisibleRange) {
    // Whole-file column widths come from the cache — built once, then only
    // the lines an edit touched are re-scanned (see notifyCsvDocumentChange)
    // — so only the decoration generation is limited to the slice.
    let cache = csvWidthCaches.get(document);
    if (!cache || cache.delimiter !== path.delimiter) {
      cache = new CsvWidthCache(path.delimiter);
      csvWidthCaches.set(document, cache);
    }
    cache.sync(lineCount, (i) => document.lineAt(i).text, tabSize);
    const rows: { lineIndex: number; metrics: CsvLineMetrics }[] = [];
    for (let i = sliceStart; i <= sliceEnd; i++) {
      const metrics = cache.metricsAt(i);
      if (metrics) {
        rows.push({ lineIndex: i, metrics });
      }
    }
    placements = computeCsvPaddingsFromMax(
      rows,
      cache.columnPlan(maxPadding),
      path.delimiter,
      tabSize,
      path.alignNumbersRight ? cache.numericColumns() : [],
      path.alignNumbersRight ? cache.maxIntWidths() : [],
      path.alignNumbersRight ? cache.minTotalWidths() : []
    );
  } else {
    const sliceLines = (): string[] => {
      const lines: string[] = [];
      for (let i = sliceStart; i <= sliceEnd; i++) {
        lines.push(document.lineAt(i).text);
      }
      return lines;
    };

    // Large files: an operator group longer than computeSliceBounds' normal
    // expansion limit would otherwise align only against its in-slice rows
    // (#434) — wrong, and dependent on scroll position, since the group's
    // true rightmost member can sit outside the slice entirely. Resolve the
    // group's real extent with an *unbounded* computeSliceBounds walk (cheap
    // unless the group truly is that long — an ordinary group fails its
    // first extra isGroupLine check and stops immediately) and cache the
    // corrected whole-group placements, so a scroll that stays inside the
    // same over-long group reuses them instead of re-walking it.
    let longGroupPlacements: Placement[] | undefined;
    if (useVisibleRange && path.kind === "operators" && isGroupLine) {
      const cache = getLongOperatorGroupCache(document);
      cache.sync(
        `${languageId}|${tabSize}|${maxPadding}|${path.alignJsdoc}|${path.operators.join(",")}`
      );
      longGroupPlacements = cache.findFor(sliceStart, sliceEnd);
      if (!longGroupPlacements) {
        const [trueStart, trueEnd] = computeSliceBounds(
          lineCount,
          sliceStart,
          sliceEnd,
          isGroupLine,
          0,
          lineCount
        );
        if (trueStart < sliceStart || trueEnd > sliceEnd) {
          const extInitialState: LineScanState | undefined =
            trueStart > 0
              ? getLineScanCheckpointCache(document).stateBefore(
                  trueStart,
                  (i) => document.lineAt(i).text,
                  languageId
                )
              : undefined;
          const extSource: LineSource = {
            lineCount: trueEnd - trueStart + 1,
            lineAt: (i: number) => document.lineAt(trueStart + i),
          };
          const extGroups = findAlignmentGroups(
            extSource,
            path.operators,
            languageId,
            tabSize,
            extInitialState
          );
          longGroupPlacements = computePaddings(extGroups, maxPadding).map((p) => ({
            ...p,
            lineIndex: p.lineIndex + trueStart,
          }));
          cache.set(trueStart, trueEnd, longGroupPlacements);
        }
      }
    }

    if (longGroupPlacements) {
      // JSDoc @param blocks are bounded by a comment block's own size, never
      // by GROUP_EXPANSION_LIMIT, so they're recomputed from the ordinary
      // slice like the non-corrected path below rather than folded into the
      // extended operator-group scan above.
      const jsdocPlacements =
        path.kind === "operators" && path.alignJsdoc
          ? computeJsdocParamPaddings(sliceLines(), tabSize, maxPadding).map((p) => ({
              ...p,
              lineIndex: p.lineIndex + sliceStart,
            }))
          : [];
      placements = longGroupPlacements
        .filter((p) => p.lineIndex >= sliceStart && p.lineIndex <= sliceEnd)
        .concat(jsdocPlacements);
    } else {
      // A block comment/template literal, CSS rule block, or YAML block scalar
      // opened above sliceStart would otherwise look unopened at the top of the
      // slice; seed the scan with whatever state it left behind.
      const initialState: LineScanState | undefined =
        path.kind === "operators" && sliceStart > 0
          ? getLineScanCheckpointCache(document).stateBefore(
              sliceStart,
              (i) => document.lineAt(i).text,
              languageId
            )
          : undefined;
      const source: LineSource =
        sliceStart === 0 && sliceEnd === lineCount - 1
          ? document
          : {
              lineCount: sliceEnd - sliceStart + 1,
              lineAt: (i: number) => document.lineAt(sliceStart + i),
            };
      placements = computeDocumentPlacements(
        sliceLines(),
        source,
        languageId,
        config,
        tabSize,
        // Markdown never reaches this branch with sliceStart > 0 (the
        // path.kind === "markdown" && useVisibleRange case is handled above
        // via MarkdownTableWidthCache instead), so there's no fence state to
        // seed here.
        undefined,
        initialState
      );
      if (sliceStart > 0) {
        placements = placements.map((p) => ({
          ...p,
          lineIndex: p.lineIndex + sliceStart,
        }));
      }
    }
  }

  const decorations: vscode.DecorationOptions[] = placements.map(
    (p) => {
      const pos = new vscode.Position(p.lineIndex, p.character);
      return {
        range: new vscode.Range(pos, pos),
        renderOptions: {
          // padChar padding (e.g. `-` on a Markdown delimiter row) must be
          // legible, so it keeps the theme's text color and only carries the
          // ghost background; default padding hides its glyphs by drawing
          // them in the background color.
          before: p.padChar
            ? {
                contentText: p.padChar.repeat(p.padding),
                backgroundColor: ghostColor,
              }
            : {
                contentText: ghostChar.repeat(p.padding),
                color: ghostColor,
                backgroundColor: ghostColor,
              },
        },
      };
    }
  );

  editor.setDecorations(alignDecorationType, decorations);
}

/**
 * Build the "Copy with Alignment" clipboard text: the current selection (or
 * the whole document, when there is no selection) with its ghost padding
 * turned into real ASCII spaces — regardless of `ghostAlign.ghostCharacter`,
 * for compatibility with the paste target. Always computed over the whole
 * document (no visible-range slicing), since this runs once per invocation
 * rather than on every keystroke. The document itself is never modified.
 *
 * `enabled` mirrors the extension's global toggle (`ghostAlign.toggle`): when
 * false there is no ghost padding shown in the editor, so copying must match
 * that and fall back to the raw text, same as a disabled language (#397).
 */
export function buildCopyAlignedText(
  editor: vscode.TextEditor,
  config: vscode.WorkspaceConfiguration,
  enabled = true
): string {
  const document = editor.document;
  const languageId = document.languageId;
  const lines: string[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    lines.push(document.lineAt(i).text);
  }

  const placements = !enabled || isLanguageDisabled(config, languageId)
    ? []
    : computeDocumentPlacements(
        lines,
        document,
        languageId,
        config,
        resolveTabSize(editor)
      );

  const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

  const selections = editor.selections;
  if (selections.length <= 1) {
    const selection = selections[0] ?? editor.selection;
    const range = selection.isEmpty ? null : toTextRange(selection);
    return buildAlignedText(lines, placements, range, eol);
  }

  // マルチカーソル: VS Code標準コピーに揃え、ドキュメント順にソートした各選択範囲を
  // 整列済みテキスト化してEOLで連結する。placements は全文で1回だけ計算済みのものを使い回す。
  // 選択なし（空selection）のカーソルは、VS Code標準コピーと同様にそのカーソル行全体を対象にする
  // （単一選択・選択なし時の「全文コピー」とは異なる、複数カーソル固有の挙動）。
  return [...selections]
    .sort((a, b) => a.start.line - b.start.line || a.start.character - b.start.character)
    .map((selection) =>
      buildAlignedText(
        lines,
        placements,
        selection.isEmpty ? toWholeLineRange(selection, lines) : toTextRange(selection),
        eol
      )
    )
    .join(eol);
}

function toTextRange(selection: vscode.Selection): TextRange {
  return {
    startLine: selection.start.line,
    startChar: selection.start.character,
    endLine: selection.end.line,
    endChar: selection.end.character,
  };
}

function toWholeLineRange(selection: vscode.Selection, lines: string[]): TextRange {
  const line = selection.start.line;
  return {
    startLine: line,
    startChar: 0,
    endLine: line,
    endChar: lines[line].length,
  };
}
