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
  computeMarkdownTableUrlTargets,
  findPipePositions,
} from "./markdown";
import {
  CsvLineMetrics,
  CsvWidthCache,
  computeCsvPaddings,
  computeCsvPaddingsFromMax,
  computeCsvUrlTargets,
  urlTargetsForCsvLine,
} from "./csv";
import { UrlShortenTarget } from "./urlShorten";
import { TextRange, buildAlignedText } from "./copyAligned";
import {
  AlignmentPath,
  isLanguageDisabled,
  resolveAlignmentPath,
  resolveMaxPadding,
  resolveShortenUrls,
} from "./config";

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
 *
 * `shortenUrls` (ghostAlign.shortenUrls, #418, default true) sizes the
 * Markdown/CSV column plan for each cell's shortened URL width instead of
 * its raw width — see computeMarkdownTablePaddings/computeCsvPaddings.
 * buildCopyAlignedText never passes it (stays false), so Copy with
 * Alignment's real-space padding always matches the full text it copies —
 * the setting only controls the live *decoration*, not the copy.
 */
export function computeDocumentPlacements(
  lines: string[],
  source: LineSource,
  languageId: string,
  config: vscode.WorkspaceConfiguration,
  tabSize: number,
  markdownFenceState?: FenceState,
  initialState?: LineScanState,
  shortenUrls: boolean = false
): Placement[] {
  const path = resolveAlignmentPath(languageId, config);
  const maxPadding = resolveMaxPadding(config);

  if (path.kind === "none") {
    return [];
  }
  if (path.kind === "markdown") {
    return computeMarkdownTablePaddings(
      lines,
      tabSize,
      markdownFenceState,
      maxPadding,
      shortenUrls
    );
  }
  if (path.kind === "csv") {
    return computeCsvPaddings(
      lines,
      path.delimiter,
      tabSize,
      maxPadding,
      path.alignNumbersRight,
      shortenUrls
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
  clearUrlShortenDecorationsIfNeeded(editor);
}

/** Clear ghost-align decorations from every visible editor. */
export function clearDecorations() {
  for (const editor of vscode.window.visibleTextEditors) {
    clearEditorDecorations(editor);
  }
}

// Two decoration types for ghostAlign.shortenUrls (#418), alongside
// alignDecorationType above. `urlHideDecorationType`'s ranges cover a URL's
// scheme/userinfo prefix and path/query/fragment suffix (see UrlShortenTarget
// in urlShorten.ts); `urlHostDecorationType`'s ranges cover the host[:port]
// kept as real, visible document text, carrying the `[`/`]` markers and the
// hover tooltip. Both created (and their disposal registered) alongside
// alignDecorationType in extension.ts's activate().
let urlHideDecorationType: vscode.TextEditorDecorationType;
let urlHostDecorationType: vscode.TextEditorDecorationType;

/**
 * Create (or replace) the two decoration types ghostAlign.shortenUrls draws
 * with. `urlHideDecorationType`'s `textDecoration` is a CSS-injection hack:
 * VS Code passes the string straight into the decorated span's inline
 * `text-decoration` style, so terminating it with `;` and appending further
 * declarations collapses the hidden text to near-zero width. This is
 * unsupported by the extension API (documented as an accepted risk in #418)
 * but is a long-standing pattern in inline-fold-style extensions, and
 * degrades safely: if VS Code ever stops honoring it, the hidden text simply
 * reappears at full size instead of rendering incorrectly.
 */
export function createUrlShortenDecorationTypes(): {
  hide: vscode.TextEditorDecorationType;
  host: vscode.TextEditorDecorationType;
} {
  urlHideDecorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: "none; font-size: 0.01px;",
  });
  urlHostDecorationType = vscode.window.createTextEditorDecorationType({});
  return { hide: urlHideDecorationType, host: urlHostDecorationType };
}

// Editors currently showing shortened-URL decorations, so decorateEditor can
// tell whether it needs to actively clear urlHide/urlHostDecorationType (a
// real setDecorations([]) call) or can skip touching them entirely — the
// common case, since ghostAlign.shortenUrls defaults off. Skipping when
// there was never anything to clear keeps a plain decorateEditor() call from
// growing extra no-op renders for every editor that never used the feature.
const urlShortenAppliedEditors = new WeakSet<vscode.TextEditor>();

/** Clear urlHide/urlHostDecorationType for `editor` if a previous pass set them. */
function clearUrlShortenDecorationsIfNeeded(editor: vscode.TextEditor) {
  if (urlShortenAppliedEditors.has(editor)) {
    editor.setDecorations(urlHideDecorationType, []);
    editor.setDecorations(urlHostDecorationType, []);
    urlShortenAppliedEditors.delete(editor);
  }
}

/**
 * A vscode.DocumentLinkProvider so Ctrl+click on a shortened URL's visible
 * host span always opens exactly that URL, regardless of what surrounds it
 * in the raw text. VS Code's own generic link detector (used when no
 * provider covers a position) treats an ASCII `,` as trimmable only at the
 * very end of a candidate, not as a mid-token boundary — so on a CSV/TSV
 * line with no surrounding whitespace (the normal case), it would otherwise
 * swallow the rest of the line after the URL's delimiter into the same
 * "link" (e.g. `https://example.com,note` opens with `,note` attached).
 * Markdown table cells don't have this problem (`|` *is* one of the
 * generic detector's terminator characters), but the provider covers both
 * paths uniformly since it's driven by the same UrlShortenTarget data
 * `decorateEditor` already computes for the visible `[host]` decoration.
 */
/**
 * The testable core of {@link createUrlShortenLinkProvider}: computes the
 * document links for `document` given an explicit `config`, so tests can
 * inject a mock config the way every other decorate.ts entry point does,
 * instead of going through vscode.workspace.getConfiguration.
 */
export function computeUrlShortenLinks(
  document: Pick<vscode.TextDocument, "languageId" | "lineCount" | "lineAt">,
  config: vscode.WorkspaceConfiguration
): vscode.DocumentLink[] {
  const languageId = document.languageId;
  if (isLanguageDisabled(config, languageId) || !resolveShortenUrls(config)) {
    return [];
  }
  const path = resolveAlignmentPath(languageId, config);
  if (path.kind !== "csv" && path.kind !== "markdown") {
    return [];
  }
  const lines: string[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    lines.push(document.lineAt(i).text);
  }
  const targets =
    path.kind === "csv"
      ? computeCsvUrlTargets(lines, path.delimiter, DEFAULT_TAB_SIZE)
      : computeMarkdownTableUrlTargets(lines, DEFAULT_TAB_SIZE);
  const links: vscode.DocumentLink[] = [];
  for (const target of targets) {
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(target.url, true);
    } catch {
      continue;
    }
    links.push(
      new vscode.DocumentLink(
        new vscode.Range(target.lineIndex, target.hostStart, target.lineIndex, target.hostEnd),
        uri
      )
    );
  }
  return links;
}

/**
 * A vscode.DocumentLinkProvider so Ctrl+click on a shortened URL's visible
 * host span always opens exactly that URL, regardless of what surrounds it
 * in the raw text. VS Code's own generic link detector (used when no
 * provider covers a position) treats an ASCII `,` as trimmable only at the
 * very end of a candidate, not as a mid-token boundary — so on a CSV/TSV
 * line with no surrounding whitespace (the normal case), it would otherwise
 * swallow the rest of the line after the URL's delimiter into the same
 * "link" (e.g. `https://example.com,note` opens with `,note` attached).
 * Markdown table cells don't have this problem (`|` *is* one of the
 * generic detector's terminator characters), but the provider covers both
 * paths uniformly since it's driven by the same UrlShortenTarget data
 * `decorateEditor` already computes for the visible `[host]` decoration.
 */
export function createUrlShortenLinkProvider(): vscode.DocumentLinkProvider {
  return {
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
      return computeUrlShortenLinks(
        document,
        vscode.workspace.getConfiguration("ghostAlign", document)
      );
    },
  };
}

/**
 * Whether the cursor or a selection in `selections` overlaps `target`'s full
 * URL span — such a target renders in full instead of shortened (#418's
 * expand-on-cursor-entry behavior), matching the Inline Fold convention of
 * revealing hidden text the moment the user's attention (cursor/selection)
 * touches it.
 */
function isUrlTargetExpanded(
  target: UrlShortenTarget,
  selections: readonly vscode.Selection[]
): boolean {
  return selections.some((sel) => {
    if (target.lineIndex < sel.start.line || target.lineIndex > sel.end.line) {
      return false;
    }
    const rangeStart = target.lineIndex === sel.start.line ? sel.start.character : 0;
    const rangeEnd =
      target.lineIndex === sel.end.line ? sel.end.character : Number.MAX_SAFE_INTEGER;
    return rangeStart <= target.end && rangeEnd >= target.start;
  });
}

/**
 * Apply ghostAlign.shortenUrls decorations to `editor`: for every target not
 * currently expanded (see isUrlTargetExpanded), hide its scheme/userinfo
 * prefix and path/query/fragment suffix (urlHideDecorationType) and frame
 * its host[:port] with `[`/`]` markers plus a hover tooltip of the full URL
 * (urlHostDecorationType) — an expanded target gets neither, rendering as
 * plain, unmodified text.
 */
function applyUrlShortenDecorations(
  editor: vscode.TextEditor,
  targets: readonly UrlShortenTarget[]
) {
  const selections = editor.selections;
  const hideRanges: vscode.Range[] = [];
  const hostDecorations: vscode.DecorationOptions[] = [];
  for (const target of targets) {
    if (isUrlTargetExpanded(target, selections)) {
      continue;
    }
    if (target.start < target.hostStart) {
      hideRanges.push(
        new vscode.Range(target.lineIndex, target.start, target.lineIndex, target.hostStart)
      );
    }
    if (target.hostEnd < target.end) {
      hideRanges.push(
        new vscode.Range(target.lineIndex, target.hostEnd, target.lineIndex, target.end)
      );
    }
    hostDecorations.push({
      range: new vscode.Range(
        target.lineIndex,
        target.hostStart,
        target.lineIndex,
        target.hostEnd
      ),
      renderOptions: {
        before: { contentText: "[" },
        after: { contentText: "]" },
      },
      hoverMessage: target.url,
    });
  }
  editor.setDecorations(urlHideDecorationType, hideRanges);
  editor.setDecorations(urlHostDecorationType, hostDecorations);
  urlShortenAppliedEditors.add(editor);
}

type ActiveAlignmentPath = Exclude<AlignmentPath, { kind: "none" }>;

interface DecorationSlice {
  start: number;
  end: number;
  useVisibleRange: boolean;
  isGroupLine?: (line: number) => boolean;
}

interface EditorDecorationContext {
  document: vscode.TextDocument;
  languageId: string;
  config: vscode.WorkspaceConfiguration;
  path: ActiveAlignmentPath;
  tabSize: number;
  maxPadding: number;
  shortenUrls: boolean;
  slice: DecorationSlice;
}

interface PlacementResult {
  placements: Placement[];
  urlTargets?: UrlShortenTarget[];
}

function clearEditorAlignment(editor: vscode.TextEditor): void {
  editor.setDecorations(alignDecorationType, []);
  clearUrlShortenDecorationsIfNeeded(editor);
}

function createGroupLinePredicate(
  document: vscode.TextDocument,
  path: ActiveAlignmentPath,
  languageId: string
): (line: number) => boolean {
  if (path.kind === "markdown") {
    return (line) => findPipePositions(document.lineAt(line).text).length > 0;
  }
  if (path.kind === "csv") {
    return () => false;
  }
  return (line) => {
    const text = document.lineAt(line).text;
    return (
      findOperatorTargets(text, path.operators, languageId).length > 0 ||
      (path.alignJsdoc && parseJsdocParamLine(text) !== null)
    );
  };
}

function resolveDecorationSlice(
  editor: vscode.TextEditor,
  path: ActiveAlignmentPath,
  languageId: string
): DecorationSlice {
  const lineCount = editor.document.lineCount;
  // 大きなファイルだけ可視範囲へ絞り、境界上のグループは全行を含むように広げる。
  const useVisibleRange =
    lineCount >= LARGE_FILE_LINE_THRESHOLD && editor.visibleRanges.length > 0;
  if (!useVisibleRange) {
    return { start: 0, end: lineCount - 1, useVisibleRange };
  }
  const visibleStart = Math.min(...editor.visibleRanges.map((range) => range.start.line));
  const visibleEnd = Math.max(...editor.visibleRanges.map((range) => range.end.line));
  const isGroupLine = createGroupLinePredicate(editor.document, path, languageId);
  const [start, end] = computeSliceBounds(
    lineCount,
    visibleStart,
    visibleEnd,
    isGroupLine
  );
  return { start, end, useVisibleRange, isGroupLine };
}

function computeVisibleMarkdownPlacements(
  context: EditorDecorationContext
): PlacementResult {
  const { document, tabSize, maxPadding, shortenUrls, slice } = context;
  let cache = markdownTableWidthCaches.get(document);
  if (!cache) {
    cache = new MarkdownTableWidthCache();
    markdownTableWidthCaches.set(document, cache);
  }
  // スクロールだけで列幅が揺れないよう、幅は文書全体のキャッシュから得る。
  cache.sync(
    document.lineCount,
    (line) => document.lineAt(line).text,
    tabSize,
    maxPadding,
    shortenUrls
  );
  return {
    placements: cache.placementsForRange(slice.start, slice.end),
    urlTargets: shortenUrls
      ? cache.urlTargetsForRange(slice.start, slice.end)
      : undefined,
  };
}

function visibleCsvRows(
  cache: CsvWidthCache,
  start: number,
  end: number
): { lineIndex: number; metrics: CsvLineMetrics }[] {
  const rows: { lineIndex: number; metrics: CsvLineMetrics }[] = [];
  for (let line = start; line <= end; line++) {
    const metrics = cache.metricsAt(line);
    if (metrics) {
      rows.push({ lineIndex: line, metrics });
    }
  }
  return rows;
}

function computeVisibleCsvPlacements(
  context: EditorDecorationContext & {
    path: Extract<ActiveAlignmentPath, { kind: "csv" }>;
  }
): PlacementResult {
  const { document, path, tabSize, maxPadding, shortenUrls, slice } = context;
  let cache = csvWidthCaches.get(document);
  if (!cache || cache.delimiter !== path.delimiter) {
    cache = new CsvWidthCache(path.delimiter);
    csvWidthCaches.set(document, cache);
  }
  // 幅は全文で同期し、装飾生成だけを可視範囲の行へ限定する。
  cache.sync(
    document.lineCount,
    (line) => document.lineAt(line).text,
    tabSize,
    shortenUrls
  );
  const rows = visibleCsvRows(cache, slice.start, slice.end);
  return {
    placements: computeCsvPaddingsFromMax(
      rows,
      cache.columnPlan(maxPadding),
      path.delimiter,
      tabSize,
      path.alignNumbersRight ? cache.numericColumns() : [],
      path.alignNumbersRight ? cache.maxIntWidths() : [],
      path.alignNumbersRight ? cache.minTotalWidths() : []
    ),
    urlTargets: shortenUrls
      ? rows.flatMap((row) =>
          urlTargetsForCsvLine(
            row.lineIndex,
            document.lineAt(row.lineIndex).text,
            row.metrics
          )
        )
      : undefined,
  };
}

function documentSliceLines(
  document: vscode.TextDocument,
  start: number,
  end: number
): string[] {
  const lines: string[] = [];
  for (let line = start; line <= end; line++) {
    lines.push(document.lineAt(line).text);
  }
  return lines;
}

function computeLongOperatorGroupPlacements(
  context: EditorDecorationContext
): Placement[] | undefined {
  const { document, languageId, path, tabSize, maxPadding, slice } = context;
  if (!slice.useVisibleRange || path.kind !== "operators" || !slice.isGroupLine) {
    return undefined;
  }
  // 通常の境界拡張上限を超えるグループは、スクロール位置に依存しない全体配置を再利用する。
  const cache = getLongOperatorGroupCache(document);
  cache.sync(
    `${languageId}|${tabSize}|${maxPadding}|${path.alignJsdoc}|${path.operators.join(",")}`
  );
  const cached = cache.findFor(slice.start, slice.end);
  if (cached) {
    return cached;
  }
  const [trueStart, trueEnd] = computeSliceBounds(
    document.lineCount,
    slice.start,
    slice.end,
    slice.isGroupLine,
    0,
    document.lineCount
  );
  if (trueStart >= slice.start && trueEnd <= slice.end) {
    return undefined;
  }
  const initialState =
    trueStart > 0
      ? getLineScanCheckpointCache(document).stateBefore(
          trueStart,
          (line) => document.lineAt(line).text,
          languageId
        )
      : undefined;
  const source: LineSource = {
    lineCount: trueEnd - trueStart + 1,
    lineAt: (line) => document.lineAt(trueStart + line),
  };
  const groups = findAlignmentGroups(
    source,
    path.operators,
    languageId,
    tabSize,
    initialState
  );
  const placements = computePaddings(groups, maxPadding).map((placement) => ({
    ...placement,
    lineIndex: placement.lineIndex + trueStart,
  }));
  cache.set(trueStart, trueEnd, placements);
  return placements;
}

function computeLongGroupSlice(
  context: EditorDecorationContext,
  longGroupPlacements: Placement[]
): PlacementResult {
  const { document, path, tabSize, maxPadding, slice } = context;
  const jsdocPlacements =
    path.kind === "operators" && path.alignJsdoc
      ? computeJsdocParamPaddings(
          documentSliceLines(document, slice.start, slice.end),
          tabSize,
          maxPadding
        ).map((placement) => ({
          ...placement,
          lineIndex: placement.lineIndex + slice.start,
        }))
      : [];
  return {
    placements: longGroupPlacements
      .filter(
        (placement) =>
          placement.lineIndex >= slice.start && placement.lineIndex <= slice.end
      )
      .concat(jsdocPlacements),
  };
}

function computeStandardSlice(
  context: EditorDecorationContext,
  lines: string[]
): PlacementResult {
  const { document, languageId, config, path, tabSize, shortenUrls, slice } = context;
  // slice より前で開いたコメントや文字列の状態を引き継ぎ、途中開始による誤検出を防ぐ。
  const initialState: LineScanState | undefined =
    path.kind === "operators" && slice.start > 0
      ? getLineScanCheckpointCache(document).stateBefore(
          slice.start,
          (line) => document.lineAt(line).text,
          languageId
        )
      : undefined;
  const source: LineSource =
    slice.start === 0 && slice.end === document.lineCount - 1
      ? document
      : {
          lineCount: slice.end - slice.start + 1,
          lineAt: (line) => document.lineAt(slice.start + line),
        };
  let placements = computeDocumentPlacements(
    lines,
    source,
    languageId,
    config,
    tabSize,
    undefined,
    initialState,
    shortenUrls
  );
  let urlTargets =
    shortenUrls && path.kind === "csv"
      ? computeCsvUrlTargets(lines, path.delimiter, tabSize)
      : shortenUrls && path.kind === "markdown"
        ? computeMarkdownTableUrlTargets(lines, tabSize)
        : undefined;
  if (slice.start > 0) {
    placements = placements.map((placement) => ({
      ...placement,
      lineIndex: placement.lineIndex + slice.start,
    }));
    urlTargets = urlTargets?.map((target) => ({
      ...target,
      lineIndex: target.lineIndex + slice.start,
    }));
  }
  return { placements, urlTargets };
}

function computeEditorPlacements(context: EditorDecorationContext): PlacementResult {
  if (context.path.kind === "markdown" && context.slice.useVisibleRange) {
    return computeVisibleMarkdownPlacements(context);
  }
  if (context.path.kind === "csv" && context.slice.useVisibleRange) {
    return computeVisibleCsvPlacements({ ...context, path: context.path });
  }
  const longGroupPlacements = computeLongOperatorGroupPlacements(context);
  if (longGroupPlacements) {
    return computeLongGroupSlice(context, longGroupPlacements);
  }
  return computeStandardSlice(
    context,
    documentSliceLines(context.document, context.slice.start, context.slice.end)
  );
}

function createAlignmentDecorations(
  placements: readonly Placement[],
  ghostChar: string,
  ghostColor: string
): vscode.DecorationOptions[] {
  return placements.map((placement) => {
    const position = new vscode.Position(
      placement.lineIndex,
      placement.character
    );
    // Markdown の区切り線は文字を見せ、通常の ghost padding は背景色へ溶け込ませる。
    const before = placement.padChar
      ? {
          contentText: placement.padChar.repeat(placement.padding),
          backgroundColor: ghostColor,
        }
      : {
          contentText: ghostChar.repeat(placement.padding),
          color: ghostColor,
          backgroundColor: ghostColor,
        };
    return {
      range: new vscode.Range(position, position),
      renderOptions: { before },
    };
  });
}

/** Apply ghost-align decorations to a single editor. */
export function decorateEditor(
  editor: vscode.TextEditor,
  config: vscode.WorkspaceConfiguration,
  ghostChar: string,
  ghostColor: string
) {
  const { document } = editor;
  const languageId = document.languageId;
  if (isLanguageDisabled(config, languageId)) {
    clearEditorAlignment(editor);
    return;
  }
  const path = resolveAlignmentPath(languageId, config);
  if (path.kind === "none") {
    clearEditorAlignment(editor);
    return;
  }
  const context: EditorDecorationContext = {
    document,
    languageId,
    config,
    path,
    tabSize: resolveTabSize(editor),
    maxPadding: resolveMaxPadding(config),
    shortenUrls: resolveShortenUrls(config),
    slice: resolveDecorationSlice(editor, path, languageId),
  };
  const { placements, urlTargets } = computeEditorPlacements(context);
  if (urlTargets) {
    applyUrlShortenDecorations(editor, urlTargets);
  } else {
    clearUrlShortenDecorationsIfNeeded(editor);
  }
  editor.setDecorations(
    alignDecorationType,
    createAlignmentDecorations(placements, ghostChar, ghostColor)
  );
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
