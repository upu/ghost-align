import * as assert from "assert";
import {
  CsvWidthCache,
  computeCsvLineMetrics,
  computeCsvMaxWidths,
  computeCsvPaddings,
  computeCsvPaddingsFromMax,
  findCsvDelimiterPositions,
} from "../../csv";

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

suite("computeCsvLineMetrics", () => {
  test("区切り位置とセルの視覚幅を返す", () => {
    assert.deepStrictEqual(computeCsvLineMetrics("aa,bbb,c", ",", 4), {
      delims: [2, 6],
      widths: [2, 3],
    });
  });

  test("区切りのない行は null を返す", () => {
    assert.strictEqual(computeCsvLineMetrics("plain", ",", 4), null);
  });

  test("全角文字セルは視覚幅で数える", () => {
    assert.deepStrictEqual(computeCsvLineMetrics("あ,b", ",", 4), {
      delims: [1],
      widths: [2],
    });
  });
});

suite("computeCsvMaxWidths", () => {
  test("各列の最大幅を全行から集計し、区切りなし行と短い行を許容する", () => {
    const rows = [
      computeCsvLineMetrics("a,bb,c", ",", 4),
      null,
      computeCsvLineMetrics("xxx,y", ",", 4),
    ];
    assert.deepStrictEqual(computeCsvMaxWidths(rows), [3, 2]);
  });
});

suite("computeCsvPaddingsFromMax", () => {
  test("行自身より広いグローバル最大幅を基準に揃える", () => {
    const metrics = computeCsvLineMetrics("a,b", ",", 4)!;
    assert.deepStrictEqual(
      computeCsvPaddingsFromMax([{ lineIndex: 42, metrics }], [10], ",", 4),
      [{ lineIndex: 42, character: 1, padding: 9 }]
    );
  });

  test("全行の最大幅を渡すと computeCsvPaddings と同じ結果になる（TSV のタブストップ吸着含む）", () => {
    const lines = ["aaaaa\tb\tc", "a\tbbbbbbbbb\tc"];
    const rows = lines.map((text, lineIndex) => ({
      lineIndex,
      metrics: computeCsvLineMetrics(text, "\t", 4)!,
    }));
    assert.deepStrictEqual(
      computeCsvPaddingsFromMax(
        rows,
        computeCsvMaxWidths(rows.map((r) => r.metrics)),
        "\t",
        4
      ),
      computeCsvPaddings(lines, "\t", 4)
    );
  });
});

suite("CsvWidthCache", () => {
  const syncWithSpy = (
    cache: CsvWidthCache,
    lines: string[],
    reads: number[],
    tabSize = 4
  ) =>
    cache.sync(
      lines.length,
      (i) => {
        reads.push(i);
        return lines[i];
      },
      tabSize
    );

  test("初回同期は全行を走査して全行基準の最大幅を返す", () => {
    const lines = ["a,b,c", "ccc,d,e"];
    const cache = new CsvWidthCache(",");
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);
    assert.strictEqual(reads.length, lines.length);
    assert.deepStrictEqual(cache.maxWidths(), [3, 1]);
  });

  test("編集後の同期はダーティ行のテキストだけ読み直す", () => {
    const lines = ["a,b", "cc,d", "e,f"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    lines[1] = "cccccc,d";
    cache.applyEdit(1, 1, 1);
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);
    assert.deepStrictEqual(reads, [1]);
    assert.deepStrictEqual(cache.maxWidths(), [6]);
  });

  test("最大幅だった行を縮める編集で最大幅も縮む", () => {
    const lines = ["aaaaaa,b", "c,d"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.maxWidths(), [6]);
    lines[0] = "a,b";
    cache.applyEdit(0, 1, 1);
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.maxWidths(), [1]);
  });

  test("行の挿入で後続行のキャッシュ位置が正しくずれる", () => {
    const lines = ["a,b", "cc,d", "eee,f"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    lines.splice(1, 1, "x,y", "zzzz,w");
    cache.applyEdit(1, 1, 2);
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);
    assert.deepStrictEqual(reads, [1, 2]);
    assert.deepStrictEqual(cache.maxWidths(), [4]);
    assert.deepStrictEqual(cache.metricsAt(3), { delims: [3], widths: [3] });
  });

  test("行数が食い違ったら全行を再構築する", () => {
    const lines = ["a,b", "cc,d"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    lines.push("eee,f");
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);
    assert.strictEqual(reads.length, 3);
    assert.deepStrictEqual(cache.maxWidths(), [3]);
  });

  test("タブ幅が変わったら全行を再計算する", () => {
    const lines = ["a\tx,b"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, [], 4);
    assert.deepStrictEqual(cache.maxWidths(), [5]);
    syncWithSpy(cache, lines, [], 8);
    assert.deepStrictEqual(cache.maxWidths(), [9]);
  });
});
