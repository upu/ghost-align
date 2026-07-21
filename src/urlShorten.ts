// ── URL shortening for table cells (ghostAlign.shortenUrls) ──────────────
//
// Detects http(s) URLs within CSV/TSV and Markdown table cell text and
// reports, for each one, the spans a caller should hide (the scheme/userinfo
// prefix and the path/query/fragment suffix) versus keep visible (the
// host[:port]) — so the host renders as real, unmodified document text
// framed by `[` `]` markers while the rest disappears via decoration
// (see decorate.ts). Nothing here touches the document buffer, so Ctrl+F,
// Ctrl+click, and copy all keep working against the real, full text.

import { visualColumn } from "./paddings";

/** One http(s) URL match within a string: see module doc for the three spans. */
export interface UrlSpan {
  /** Start of the whole URL (the scheme). */
  start: number;
  /** End of the whole URL (end of path/query/fragment, or of the host when there is none). */
  end: number;
  /** Start of the host[:port] span kept visible. */
  hostStart: number;
  /** End of the host[:port] span kept visible. */
  hostEnd: number;
}

/**
 * http(s) URL matcher, deliberately narrow for the first version (mirrors
 * NUMERIC_CELL_RE in csv.ts): only "http://"/"https://" schemes, a required
 * non-empty host, and character classes that stop at whitespace, `,` (the
 * CSV/TSV delimiter — cell text is normally already bounded by it, but a
 * quoted CSV field can carry a literal comma, and two URLs typed back-to-back
 * with no space in between would otherwise merge into one match), `|` (the
 * Markdown pipe / a plausible CSV/TSV cell boundary marker), and the
 * punctuation that commonly wraps a URL in Markdown (`()`, `<>`, quotes) —
 * so `[text](https://example.com/path)` and `<https://example.com>` shorten
 * just the URL inside without consuming the surrounding syntax. Userinfo
 * (`user@host`) is captured so it can be hidden alongside the scheme rather
 * than mistaken for path content.
 */
const URL_RE =
  /(https?:\/\/)([^\s|,<>()"']*@)?([^\s|,<>()"'/:]+)(:\d+)?([^\s|,<>()"']*)/g;

/** Every http(s) URL match in `text`, in left-to-right order. */
export function findUrlSpans(text: string): UrlSpan[] {
  const spans: UrlSpan[] = [];
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text))) {
    const [whole, scheme, userinfo, host, port] = m;
    const start = m.index;
    const hostStart = start + scheme.length + (userinfo?.length ?? 0);
    const hostEnd = hostStart + host.length + (port?.length ?? 0);
    spans.push({ start, end: start + whole.length, hostStart, hostEnd });
  }
  return spans;
}

/** Visual columns the `[` and `]` markers occupy once a URL is shortened. */
const BRACKET_WIDTH = 2;

/**
 * Visual-width reduction from shortening every URL found in
 * `[cellStart, cellEnd)` of `lineText` — the sum, per URL, of its hidden
 * prefix+suffix width minus the 2 columns the `[` `]` markers add back
 * (floored at 0, for a URL short enough that the markers would net-widen
 * it). Used so CSV/Markdown column width computation reflects the shortened
 * form (see computeCsvLineState / computeTableRowMetrics), keeping the
 * column plan stable instead of widening it for text that renders hidden.
 */
export function computeUrlShortenReduction(
  lineText: string,
  cellStart: number,
  cellEnd: number,
  tabSize: number
): number {
  const cellText = lineText.slice(cellStart, cellEnd);
  let reduction = 0;
  for (const span of findUrlSpans(cellText)) {
    const hiddenWidth =
      visualColumn(lineText, cellStart + span.hostStart, tabSize) -
      visualColumn(lineText, cellStart + span.start, tabSize) +
      visualColumn(lineText, cellStart + span.end, tabSize) -
      visualColumn(lineText, cellStart + span.hostEnd, tabSize);
    reduction += Math.max(0, hiddenWidth - BRACKET_WIDTH);
  }
  return reduction;
}

/** One URL's shortening targets, positioned absolutely within a document line. */
export interface UrlShortenTarget {
  lineIndex: number;
  start: number;
  end: number;
  hostStart: number;
  hostEnd: number;
  /** The full URL text, for a hover tooltip. */
  url: string;
}

/** {@link UrlShortenTarget}s for every URL found in `[cellStart, cellEnd)` of one document line. */
export function findUrlShortenTargets(
  lineIndex: number,
  lineText: string,
  cellStart: number,
  cellEnd: number
): UrlShortenTarget[] {
  const cellText = lineText.slice(cellStart, cellEnd);
  return findUrlSpans(cellText).map((span) => ({
    lineIndex,
    start: cellStart + span.start,
    end: cellStart + span.end,
    hostStart: cellStart + span.hostStart,
    hostEnd: cellStart + span.hostEnd,
    url: cellText.slice(span.start, span.end),
  }));
}
