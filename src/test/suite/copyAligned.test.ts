import * as assert from "assert";
import { applyPaddingsToLine, buildAlignedText } from "../../copyAligned";
import { computeMarkdownTablePaddings } from "../../markdown";

suite("applyPaddingsToLine", () => {
  test("padChar 指定のパディングはその文字で実体化される", () => {
    const result = applyPaddingsToLine("| ---: |", [
      { character: 5, padding: 2, padChar: "-" },
    ]);
    assert.strictEqual(result, "| -----: |");
  });

  test("character 位置の前に padding 分のスペースを実体化する（元の文字は消費しない）", () => {
    const result = applyPaddingsToLine("a = 1", [{ character: 2, padding: 1 }]);
    assert.strictEqual(result, "a  = 1");
  });

  test("複数の padding は character の昇順で適用され、位置は元の文字列基準のまま", () => {
    // わざと降順で渡し、内部でソートされることを確認する
    const result = applyPaddingsToLine("abcdefghij", [
      { character: 6, padding: 1 },
      { character: 3, padding: 2 },
    ]);
    assert.strictEqual(result, "abc  def ghij");
  });

  test("padding が空なら元の文字列のまま", () => {
    assert.strictEqual(applyPaddingsToLine("a = 1", []), "a = 1");
  });
});

suite("buildAlignedText", () => {
  test("range が null なら全行を対象にし、指定した eol で結合する", () => {
    const lines = ["a = 1", "bb = 2"];
    const text = buildAlignedText(
      lines,
      [{ lineIndex: 0, character: 2, padding: 1 }],
      null,
      "\n"
    );
    assert.strictEqual(text, "a  = 1\nbb = 2");
  });

  test("選択範囲より前のパディングは対象外になる（選択範囲外にトリムされる）", () => {
    const lines = ["a = 1"];
    const text = buildAlignedText(
      lines,
      [{ lineIndex: 0, character: 2, padding: 1 }],
      { startLine: 0, startChar: 3, endLine: 0, endChar: 5 }
    );
    assert.strictEqual(text, " 1");
  });

  test("選択範囲の開始位置に一致するパディングは含まれ、相対位置に補正される", () => {
    const lines = ["a = 1"];
    const text = buildAlignedText(
      lines,
      [{ lineIndex: 0, character: 2, padding: 1 }],
      { startLine: 0, startChar: 2, endLine: 0, endChar: 5 }
    );
    assert.strictEqual(text, " = 1");
  });

  test("複数行の選択範囲は先頭行を startChar から、末尾行を endChar までにトリムし、中間行は全体を使う", () => {
    const lines = ["abcde", "fghij", "klmno"];
    const text = buildAlignedText(
      lines,
      [],
      { startLine: 0, startChar: 2, endLine: 2, endChar: 3 }
    );
    assert.strictEqual(text, "cde\nfghij\nklm");
  });

  test("Markdown 区切り行の `-` パディングはコピーでも `-` で実体化され GFM として妥当なまま", () => {
    const lines = ["| a | b |", "| ---: | --- |", "| cccccc | d |"];
    const text = buildAlignedText(
      lines,
      computeMarkdownTablePaddings(lines, 4),
      null,
      "\n"
    );
    assert.strictEqual(text.split("\n")[1], "| -----: | --- |");
  });
});
