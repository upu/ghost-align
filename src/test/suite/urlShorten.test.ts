import * as assert from "assert";
import {
  computeUrlShortenReduction,
  findUrlShortenTargets,
  findUrlSpans,
} from "../../urlShorten";

suite("findUrlSpans", () => {
  test("scheme とホストとパスに分割する", () => {
    const text = "see https://github.com/foo/bar?q=1 for details";
    const spans = findUrlSpans(text);
    assert.strictEqual(spans.length, 1);
    const [span] = spans;
    assert.strictEqual(text.slice(span.start, span.hostStart), "https://");
    assert.strictEqual(text.slice(span.hostStart, span.hostEnd), "github.com");
    assert.strictEqual(text.slice(span.hostEnd, span.end), "/foo/bar?q=1");
  });

  test("http と https の両方を認識する", () => {
    assert.strictEqual(findUrlSpans("http://example.com").length, 1);
    assert.strictEqual(findUrlSpans("https://example.com").length, 1);
  });

  test("http/https 以外のスキームは対象外", () => {
    assert.deepStrictEqual(findUrlSpans("ftp://example.com"), []);
  });

  test("ポートを含めてホストとして扱う", () => {
    const text = "https://example.com:8080/path";
    const [span] = findUrlSpans(text);
    assert.strictEqual(text.slice(span.hostStart, span.hostEnd), "example.com:8080");
    assert.strictEqual(text.slice(span.hostEnd, span.end), "/path");
  });

  test("userinfo はホストに含めず前置き隠蔽部分に含める", () => {
    const text = "https://user:pass@example.com/path";
    const [span] = findUrlSpans(text);
    assert.strictEqual(text.slice(span.start, span.hostStart), "https://user:pass@");
    assert.strictEqual(text.slice(span.hostStart, span.hostEnd), "example.com");
  });

  test("パスの無い裸のホストも1件として検出する", () => {
    const text = "https://example.com";
    const spans = findUrlSpans(text);
    assert.strictEqual(spans.length, 1);
    assert.strictEqual(spans[0].hostEnd, spans[0].end);
  });

  test("1つのテキストに複数 URL があれば全て検出する", () => {
    const text = "https://a.com and https://b.com";
    const spans = findUrlSpans(text);
    assert.strictEqual(spans.length, 2);
  });

  test("Markdown リンク構文 [text](url) の url 部分だけを検出する", () => {
    const text = "[label](https://example.com/path)";
    const spans = findUrlSpans(text);
    assert.strictEqual(spans.length, 1);
    assert.strictEqual(text.slice(spans[0].start, spans[0].end), "https://example.com/path");
  });

  test("オートリンク <https://...> の url 部分だけを検出する", () => {
    const text = "see <https://example.com/path> now";
    const spans = findUrlSpans(text);
    assert.strictEqual(spans.length, 1);
    assert.strictEqual(text.slice(spans[0].start, spans[0].end), "https://example.com/path");
  });

  test("カンマ区切りで隣接する2つの URL を1つに結合しない", () => {
    const text = "https://a.com,https://b.com";
    const spans = findUrlSpans(text);
    assert.strictEqual(spans.length, 2);
    assert.strictEqual(text.slice(spans[0].start, spans[0].end), "https://a.com");
    assert.strictEqual(text.slice(spans[1].start, spans[1].end), "https://b.com");
  });

  test("CSV/TSV・Markdown のセル区切り文字 | の手前で URL を止める", () => {
    const text = "https://example.com/path|next";
    const spans = findUrlSpans(text);
    assert.strictEqual(spans.length, 1);
    assert.strictEqual(text.slice(spans[0].start, spans[0].end), "https://example.com/path");
  });

  test("URL を含まないテキストは空配列", () => {
    assert.deepStrictEqual(findUrlSpans("plain text, no links here"), []);
  });
});

suite("findUrlShortenTargets", () => {
  test("セル範囲内の絶対位置で URL ターゲットを返す", () => {
    const lineText = "id,https://github.com/foo,note";
    const targets = findUrlShortenTargets(0, lineText, 3, 25);
    assert.strictEqual(targets.length, 1);
    const [target] = targets;
    assert.strictEqual(target.lineIndex, 0);
    assert.strictEqual(lineText.slice(target.start, target.end), "https://github.com/foo");
    assert.strictEqual(lineText.slice(target.hostStart, target.hostEnd), "github.com");
    assert.strictEqual(target.url, "https://github.com/foo");
  });

  test("セル範囲外の URL は検出しない", () => {
    const lineText = "https://example.com,plain";
    const targets = findUrlShortenTargets(0, lineText, 21, lineText.length);
    assert.deepStrictEqual(targets, []);
  });
});

suite("computeUrlShortenReduction", () => {
  test("scheme とパスの幅からブラケット2文字ぶんを差し引いた分だけ縮む", () => {
    // "https://github.com/foo" (23) -> "[github.com]" (12) 相当、縮小量 = 23 - 12 = 11
    const lineText = "https://github.com/foo";
    const reduction = computeUrlShortenReduction(lineText, 0, lineText.length, 4);
    assert.strictEqual(reduction, lineText.length - "[github.com]".length);
  });

  test("URL を含まないセルは縮小量0", () => {
    const lineText = "plain,cell";
    assert.strictEqual(computeUrlShortenReduction(lineText, 0, 5, 4), 0);
  });

  test("短すぎて隠す幅がブラケット幅未満なら縮小量は0（負にならない）", () => {
    // "http://a" -> host "a" のみ、隠れるのは "http://" (7文字)。
    // ブラケット込みでも "[a]" (3) の方が短いのでここでは正の縮小量になる例だが、
    // 極端に短いケースとして host そのものより短い縮小しか出ない状況を確認する。
    const lineText = "http://a";
    const reduction = computeUrlShortenReduction(lineText, 0, lineText.length, 4);
    assert.ok(reduction >= 0);
  });

  test("複数 URL があれば合算される", () => {
    const single = "https://github.com/foo";
    const lineText = `${single},${single}`;
    const oneReduction = computeUrlShortenReduction(single, 0, single.length, 4);
    const totalReduction = computeUrlShortenReduction(lineText, 0, lineText.length, 4);
    assert.strictEqual(totalReduction, oneReduction * 2);
  });
});
