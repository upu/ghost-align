import * as assert from "assert";
import { findCsvDelimiterPositions, computeCsvPaddings } from "../../csv";

suite("findCsvDelimiterPositions", () => {
  test("クォート内のカンマは区切りとして扱わない", () => {
    assert.deepStrictEqual(findCsvDelimiterPositions('"x,y",zz,w', ","), [5, 8]);
  });

  test('二重引用符エスケープ `""` を挟んでもクォート状態を維持する', () => {
    assert.deepStrictEqual(findCsvDelimiterPositions('"a""b,c",d', ","), [8]);
  });

  test("タブ区切り（TSV）ではタブの位置を返す", () => {
    assert.deepStrictEqual(findCsvDelimiterPositions("a\tb\tc", "\t"), [1, 3]);
  });
});

suite("computeCsvPaddings", () => {
  test("csv: クォート内カンマを区切りにせず各列の区切りが揃う", () => {
    const placements = computeCsvPaddings(["a,b,c", '"x,y",zz,w'], ",", 4);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 1, padding: 4 },
      { lineIndex: 0, character: 3, padding: 1 },
    ]);
  });

  test("tsv: タブ区切りで列が揃い、次列の開始はタブストップに吸着する", () => {
    const placements = computeCsvPaddings(
      ["aaaaa\tb\tc", "a\tbbbbbbbbb\tc"],
      "\t",
      4
    );
    // 列0 の区切りは視覚列 5 に揃い、次列の開始はタブストップの 8。
    // 列1 の区切りは 8+9=17 に揃うので行0 に 8 パディング。
    assert.deepStrictEqual(placements, [
      { lineIndex: 1, character: 1, padding: 4 },
      { lineIndex: 0, character: 7, padding: 8 },
    ]);
  });

  test("区切りを含まない行は整列に参加せず他の行は揃う", () => {
    const placements = computeCsvPaddings(["a,b", "plain", "ccc,d"], ",", 4);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 1, padding: 2 },
    ]);
  });

  test("全角文字セルは視覚幅で数えて揃える", () => {
    const placements = computeCsvPaddings(["あ,b", "ccc,d"], ",", 4);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 1, padding: 1 },
    ]);
  });

  test("列数が不揃いでも例外にならずインデックス基準で揃える", () => {
    const placements = computeCsvPaddings(["a,bb,c", "xxx,y"], ",", 4);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 1, padding: 2 },
    ]);
  });
});
