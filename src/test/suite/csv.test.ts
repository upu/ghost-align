import * as assert from "assert";
import {
  CsvWidthCache,
  computeCsvColumnPlan,
  computeCsvDecimalWidths,
  computeCsvLineMetrics,
  computeCsvMaxWidths,
  computeCsvNumericColumns,
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

  test("セミコロン区切りではクォート内のセミコロンを区切りとして扱わない", () => {
    assert.deepStrictEqual(
      findCsvDelimiterPositions('"x;y";zz;w', ";"),
      [5, 8]
    );
  });

  test("startInQuotes=true: 継続行の閉じクォート前のカンマは区切りにせず、閉じクォート後のカンマは区切りにする", () => {
    // 前の物理行で開いたクォートが継続している行。"still quoted" 直前のカンマは
    // クォート内なので区切りではなく、閉じクォート `"` の後のカンマだけが区切り。
    const line = 'world,still quoted",x';
    assert.deepStrictEqual(findCsvDelimiterPositions(line, ",", true), [19]);
  });

  test("startInQuotes=false（既定）: 同じ行をクォート状態を引き継がず単独行として解析すると誤検出する", () => {
    // 継続状態を渡さない旧来の挙動では、まだ閉じていないクォートの内側にある
    // カンマを区切りと誤認し、本来の区切り（閉じクォート後のカンマ）を見逃す。
    const line = 'world,still quoted",x';
    assert.deepStrictEqual(findCsvDelimiterPositions(line, ","), [5]);
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

  test("セミコロン区切り: クォート内セミコロンを区切りにせず各列が揃う", () => {
    const placements = computeCsvPaddings(["a;b;c", '"x;y";zz;w'], ";", 4);
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

  test("異体字セレクタを含むセルは幅0として数えて揃える", () => {
    // "a️" は a(幅1) + 異体字セレクタ(幅0) = 視覚幅1。幅1として誤カウント
    // する旧実装では視覚幅2になり、"ccc"(幅3)との差分（padding）がずれていた。
    const placements = computeCsvPaddings(["a️,b", "ccc,d"], ",", 4);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 2 },
    ]);
  });

  test("列数が不揃いでも例外にならずインデックス基準で揃える", () => {
    const placements = computeCsvPaddings(["a,bb,c", "xxx,y"], ",", 4);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 1, padding: 2 },
    ]);
  });

  test("maxPadding: 0（無制限）だと幅の外れ値セル1つが以降の全列に巨大パディングを強制する", () => {
    const lines = [
      "a,bbbbbbbbbbbbbbb,c",
      "aaaaaaaaaaaaaaaaaaaa,ddddd,c",
    ];
    const placements = computeCsvPaddings(lines, ",", 4, 0);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 1, padding: 19 },
      { lineIndex: 1, character: 26, padding: 10 },
    ]);
  });

  test("maxPadding: 超過する列だけ揃えず、以降の列は各行の実位置基準で揃う", () => {
    const lines = [
      "a,bbbbbbbbbbbbbbb,c",
      "aaaaaaaaaaaaaaaaaaaa,ddddd,c",
    ];
    // 列0 は 1 と 20 の差19 > maxPadding(10) なので揃えない。
    // 列1 は列0の実際の終端(2 と 21)からそれぞれ幅15, 5 を足すと
    // 17 と 26 で差9 <= 10 なので揃う（行0 に 9 パディング）。
    const placements = computeCsvPaddings(lines, ",", 4, 10);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 17, padding: 9 },
    ]);
  });

  test("改行を含むクォートフィールドをまたいでもクォート状態が引き継がれ、継続行内のカンマを区切りと誤認しない（#430）", () => {
    const lines = [
      "id,note,value",
      '1,"hello',
      'world,still quoted",x',
      "2,ok,y",
    ];
    const placements = computeCsvPaddings(lines, ",", 4);
    // 3行目 'world,still quoted",x' は "note" フィールドの継続行。"still quoted"
    // 直前のカンマ（char5）を区切りと誤認していれば列0の最大幅が5相当になり
    // 全行のパディングが崩れる。閉じクォート後のカンマ（char19）だけを区切りとして
    // 扱うと、この行自身は列0の最大幅そのものなのでパディング不要になる。
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 17 },
      { lineIndex: 1, character: 1, padding: 18 },
      { lineIndex: 3, character: 1, padding: 18 },
      { lineIndex: 3, character: 4, padding: 2 },
    ]);
  });
});

suite("computeCsvPaddings: alignNumbersRight", () => {
  const lines = ["id,name,price", "1,apple,9", "222,banana,15"];

  test("既定(false)では従来どおり区切り直前に左寄せパディングが入る", () => {
    assert.deepStrictEqual(computeCsvPaddings(lines, ",", 4), [
      { lineIndex: 0, character: 2, padding: 1 },
      { lineIndex: 1, character: 1, padding: 2 },
      { lineIndex: 0, character: 7, padding: 2 },
      { lineIndex: 1, character: 7, padding: 1 },
    ]);
  });

  test("true: 全データセルが数値の列はセル内容側に右寄せパディングが入る（ヘッダーも右寄せされる）", () => {
    const placements = computeCsvPaddings(lines, ",", 4, 0, true);
    assert.deepStrictEqual(placements, [
      // 列0 (id): データ行が "1" "222" で全て数値 → ヘッダーの "id" もセル先頭 (character 0) に右寄せパディング。
      { lineIndex: 0, character: 0, padding: 1 },
      { lineIndex: 1, character: 0, padding: 2 },
      // 列1 (name): データに "apple" "banana" と非数値セルがある → 従来どおり区切り直前に左寄せ。
      { lineIndex: 0, character: 7, padding: 2 },
      { lineIndex: 1, character: 7, padding: 1 },
    ]);
  });

  test("true: データセルに数値以外が1つでも混ざる列は左寄せのまま", () => {
    const mixed = ["id,x", "1,a", "abc,b"];
    const placements = computeCsvPaddings(mixed, ",", 4, 0, true);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 1 },
      { lineIndex: 1, character: 1, padding: 2 },
    ]);
  });

  test("true: ヘッダーしかない（データ行がない）列は数値と判定せず左寄せのまま", () => {
    const headerOnly = ["id,name", "notanumber,x"];
    const placements = computeCsvPaddings(headerOnly, ",", 4, 0, true);
    // 列0 のデータ行は "notanumber" のみで数値でないため、列0 は非数値列。
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 8 },
    ]);
  });

  test("true: 桁数の異なる小数が混在する列は右寄せでなく小数点の位置で揃える（#429）", () => {
    // "1.5"(整数部1桁) と "23.45"(整数部2桁) はヘッダー幅(5)に収まるため列幅は広がらない。
    const decimals = ["id,price,note", "x1,1.5,a", "x2,23.45,a"];
    const placements = computeCsvPaddings(decimals, ",", 4, 0, true);
    assert.deepStrictEqual(placements, [
      // "1.5" は整数部が1桁分 ("23.45" の2桁に対して) 足りないのでセル先頭に1、
      // 小数点を揃えた残りの幅を区切り直前に1、それぞれゴーストパディングが入る。
      { lineIndex: 1, character: 3, padding: 1 },
      { lineIndex: 1, character: 6, padding: 1 },
    ]);
  });

  test("true: 小数点を含まない整数セルが混在する場合は整数部の桁数だけで揃え、列幅がヘッダー幅を超えるなら広げる（#429）", () => {
    // 整数部の最大桁数(3, "100") と小数部の最大幅(3, ".45") の合計6は、
    // 元の列最大幅5("23.45"・ヘッダー"price")より広いので、列全体の幅がその分広がる。
    const mixed = ["id,price,note", "x1,1.5,a", "x2,23.45,a", "x3,100,a"];
    const placements = computeCsvPaddings(mixed, ",", 4, 0, true);
    assert.deepStrictEqual(placements, [
      // ヘッダー "price" は非数値行として従来どおり単一の右寄せパディング（幅6-5=1）。
      { lineIndex: 0, character: 3, padding: 1 },
      // "1.5": 整数部1桁 → 整数部側に2、小数点合わせ後の残り1を区切り側に。
      { lineIndex: 1, character: 3, padding: 2 },
      { lineIndex: 1, character: 6, padding: 1 },
      // "23.45": 整数部2桁 → 整数部側に1のみ（小数部は最大なので残りパディング無し）。
      { lineIndex: 2, character: 3, padding: 1 },
      // "100": 整数部3桁で最大 → 整数部側パディングは無く、小数部相当の3を区切り側に。
      { lineIndex: 3, character: 6, padding: 3 },
    ]);
  });
});

suite("computeCsvNumericColumns", () => {
  const metricsOf = (lines: string[]) =>
    lines.map((l) => computeCsvLineMetrics(l, ",", 4));

  test("先頭行(ヘッダー)は判定から除外し、以降のデータ行が全て数値なら true", () => {
    const rows = metricsOf(["id,name,price", "1,apple,9", "222,banana,15"]);
    assert.deepStrictEqual(computeCsvNumericColumns(rows), [true, false]);
  });

  test("データ行に非数値セルが1つでもあれば false", () => {
    const rows = metricsOf(["id,x", "1,a", "abc,b"]);
    assert.deepStrictEqual(computeCsvNumericColumns(rows), [false]);
  });

  test("データ行が無い（ヘッダーのみ）列は判定対象なし（空配列）", () => {
    const rows = metricsOf(["id,name"]);
    assert.deepStrictEqual(computeCsvNumericColumns(rows), []);
  });

  test("区切りのない行(null)は読み飛ばしてヘッダー判定・数値判定する", () => {
    const rows = [
      computeCsvLineMetrics("id,val,x", ",", 4),
      null,
      computeCsvLineMetrics("1,2,y", ",", 4),
      computeCsvLineMetrics("3,4,z", ",", 4),
    ];
    assert.deepStrictEqual(computeCsvNumericColumns(rows), [true, true]);
  });
});

suite("computeCsvDecimalWidths", () => {
  const metricsOf = (lines: string[]) =>
    lines.map((l) => computeCsvLineMetrics(l, ",", 4));

  test("整数部の最大幅と、整数部+小数部の最大幅の組み合わせを列ごとに返す", () => {
    // 列0(price): "1.5"(整数部1,小数部".5"幅2) "23.45"(整数部2,小数部".45"幅3) "100"(整数部3,小数部なし)。
    // maxIntWidths=3("100")。minTotalWidths=3+3=6(整数部最大と小数部最大は別の行から)。
    const rows = metricsOf(["price,note", "1.5,a", "23.45,a", "100,a"]);
    assert.deepStrictEqual(
      computeCsvDecimalWidths(rows, computeCsvNumericColumns(rows)),
      { maxIntWidths: [3], minTotalWidths: [6] }
    );
  });

  test("numericColumns が false の列は集計しない（空のまま）", () => {
    const rows = metricsOf(["id,x", "1,a", "abc,b"]);
    assert.deepStrictEqual(computeCsvDecimalWidths(rows, computeCsvNumericColumns(rows)), {
      maxIntWidths: [],
      minTotalWidths: [],
    });
  });

  test("ヘッダー行など numeric=false の行は個別に除外する", () => {
    // ヘッダー "price" は numericColumns の判定から除外されるだけで numeric=false のまま残り、
    // maxIntWidths/minTotalWidths の集計でも(数値でないので)無視される。
    const rows = metricsOf(["price,note", "1.5,a", "23.45,a"]);
    assert.deepStrictEqual(
      computeCsvDecimalWidths(rows, computeCsvNumericColumns(rows)),
      { maxIntWidths: [2], minTotalWidths: [5] }
    );
  });
});

suite("computeCsvLineMetrics", () => {
  test("区切り位置とセルの視覚幅を返す", () => {
    assert.deepStrictEqual(computeCsvLineMetrics("aa,bbb,c", ",", 4), {
      delims: [2, 6],
      widths: [2, 3],
      contentStarts: [0, 3],
      numeric: [false, false],
      intEndWidths: [2, 3],
    });
  });

  test("区切りのない行は null を返す", () => {
    assert.strictEqual(computeCsvLineMetrics("plain", ",", 4), null);
  });

  test("全角文字セルは視覚幅で数える", () => {
    assert.deepStrictEqual(computeCsvLineMetrics("あ,b", ",", 4), {
      delims: [1],
      widths: [2],
      contentStarts: [0],
      numeric: [false],
      intEndWidths: [2],
    });
  });

  test("数値セルは numeric=true、先頭の空白を除いた位置を contentStarts に返す", () => {
    assert.deepStrictEqual(computeCsvLineMetrics("12, -3.5,c", ",", 4), {
      delims: [2, 8],
      widths: [2, 5],
      contentStarts: [0, 4],
      numeric: [true, true],
      // "12" は小数点なしで全体が整数部（幅2）。" -3.5" は先頭空白1 + 符号・整数部2桁で幅3。
      intEndWidths: [2, 3],
    });
  });

  test("英数混在・符号のみ・小数点2つなど数値パターンに合致しないセルは numeric=false", () => {
    assert.deepStrictEqual(computeCsvLineMetrics("1a,-,1.2.3,x", ",", 4), {
      delims: [2, 4, 10],
      widths: [2, 1, 5],
      contentStarts: [0, 3, 5],
      numeric: [false, false, false],
      intEndWidths: [2, 1, 5],
    });
  });

  test("小数点を含む数値セルは intEndWidths が小数点直前までの幅を返す", () => {
    assert.deepStrictEqual(computeCsvLineMetrics("1.5,23.45,100", ",", 4), {
      delims: [3, 9],
      widths: [3, 5],
      contentStarts: [0, 4],
      numeric: [true, true],
      intEndWidths: [1, 2],
    });
  });

  test("startInQuotes=true: 前行から継続する `\"\"` エスケープ込みのクォートフィールドを正しく閉じ、閉じクォート後のカンマを区切りとして返す", () => {
    // 前行 'a,"He said ""hi' はクォートを開いたまま終わる（1行目のテストで確認済み）。
    // この行はその継続で、`\"\"` エスケープの後の `\"` で閉じ、その後のカンマだけが区切り。
    const line = 'there""",b';
    assert.deepStrictEqual(computeCsvLineMetrics(line, ",", 4, true), {
      delims: [8],
      widths: [8],
      contentStarts: [0],
      numeric: [false],
      intEndWidths: [8],
    });
  });

  test("startInQuotes 省略（既定false）だと同じ行のクォート継続を認識できず区切りを1つも検出しない", () => {
    // 継続状態を渡さないと、行頭の `"` を新規のクォート開始と誤認し、直後の `\"\"` を
    // エスケープとして飲み込んでしまい、本来の区切り（カンマ）まで見失う。
    const line = 'there""",b';
    assert.strictEqual(computeCsvLineMetrics(line, ",", 4), null);
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

  test("全行から求めた計画を渡すと computeCsvPaddings と同じ結果になる（TSV のタブストップ吸着含む）", () => {
    const lines = ["aaaaa\tb\tc", "a\tbbbbbbbbb\tc"];
    const rows = lines.map((text, lineIndex) => ({
      lineIndex,
      metrics: computeCsvLineMetrics(text, "\t", 4)!,
    }));
    assert.deepStrictEqual(
      computeCsvPaddingsFromMax(
        rows,
        computeCsvColumnPlan(rows.map((r) => r.metrics.widths), "\t", 4),
        "\t",
        4
      ),
      computeCsvPaddings(lines, "\t", 4)
    );
  });
});

suite("computeCsvColumnPlan", () => {
  test("maxPadding 以内なら全列の最大幅に揃える計画を返す", () => {
    const rows = [
      computeCsvLineMetrics("a,bb,x", ",", 4)!,
      computeCsvLineMetrics("xxx,y,z", ",", 4)!,
    ];
    assert.deepStrictEqual(
      computeCsvColumnPlan(rows.map((r) => r.widths), ",", 4, 10),
      [3, 6]
    );
  });

  test("超過する列は null にし、以降の列は各行の実位置基準で計画する", () => {
    const rows = [
      computeCsvLineMetrics("a,bbbbbbbbbbbbbbb,c", ",", 4)!,
      computeCsvLineMetrics("aaaaaaaaaaaaaaaaaaaa,ddddd,c", ",", 4)!,
    ];
    assert.deepStrictEqual(
      computeCsvColumnPlan(rows.map((r) => r.widths), ",", 4, 10),
      [null, 26]
    );
  });

  test("maxPadding 0 は無制限（従来挙動）", () => {
    const rows = [
      computeCsvLineMetrics("a,b", ",", 4)!,
      computeCsvLineMetrics("xxxxxxxxxx,y", ",", 4)!,
    ];
    assert.deepStrictEqual(
      computeCsvColumnPlan(rows.map((r) => r.widths), ",", 4, 0),
      [10]
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
    assert.deepStrictEqual(cache.metricsAt(3), {
      delims: [3],
      widths: [3],
      contentStarts: [0],
      numeric: [false],
      intEndWidths: [3],
    });
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

  test("columnPlan: maxPadding 以内なら全列の最大位置に揃える計画を返す", () => {
    const lines = ["a,b,c", "ccc,d,e"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.columnPlan(10), [3, 5]);
  });

  test("columnPlan: 全行(可視範囲外含む)基準で外れ値列を判定する", () => {
    const lines = ["a,bbbbbbbbbbbbbbb,c", "aaaaaaaaaaaaaaaaaaaa,ddddd,c"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.columnPlan(10), [null, 26]);
  });

  test("columnPlan: maxPadding を変えると再計算する", () => {
    const lines = ["a,bbbbbbbbbbbbbbb,c", "aaaaaaaaaaaaaaaaaaaa,ddddd,c"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.columnPlan(10), [null, 26]);
    assert.deepStrictEqual(cache.columnPlan(0), [20, 36]);
  });

  test("numericColumns: 先頭行をヘッダーとして除外し、可視範囲外の行も含めた全行で判定する", () => {
    const lines = ["id,name,price", "1,apple,9", "222,banana,15"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.numericColumns(), [true, false]);
  });

  test("numericColumns: 編集でデータ行が非数値になったら次の sync 後に false へ更新される", () => {
    const lines = ["id,name", "1,x", "2,y"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.numericColumns(), [true]);
    lines[1] = "abc,x";
    cache.applyEdit(1, 1, 1);
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.numericColumns(), [false]);
  });

  test("maxIntWidths/minTotalWidths: 可視範囲外の行も含めた全行から小数点位置揃えの幅を求める（#429）", () => {
    const lines = ["price,note", "1.5,a", "23.45,a", "100,a"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.maxIntWidths(), [3]);
    assert.deepStrictEqual(cache.minTotalWidths(), [6]);
  });

  test("maxIntWidths/minTotalWidths: 編集でデータ行の桁数が変わったら次の sync 後に更新される", () => {
    const lines = ["price,note", "1.5,a", "23.45,a"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.maxIntWidths(), [2]);
    assert.deepStrictEqual(cache.minTotalWidths(), [5]);
    lines[1] = "100.5,a";
    cache.applyEdit(1, 1, 1);
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.maxIntWidths(), [3]);
    assert.deepStrictEqual(cache.minTotalWidths(), [6]);
  });

  test("複数行クォートフィールドの開始行を編集してクォート状態が変わると、ダーティでない後続行までカスケードして再走査する（#430）", () => {
    const lines = ['a,"b', 'c",d', "e,f"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    // 初回: 1行目末尾でクォートが開いたまま終わり、2行目でその継続が閉じてから
    // カンマが区切りになる（"c\",d" の delims=[2]）。列0の最大幅は2。
    assert.deepStrictEqual(cache.maxWidths(), [2]);

    // 1行目の `"` を消し、クォートを一切開かない行に変える。
    lines[0] = "a,b";
    cache.applyEdit(0, 1, 1);
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);
    // 1行目だけがダーティだが、1行目の終端クォート状態が true→false に変わったため、
    // 2行目・3行目もそれを踏まえて再走査しないと誤った結果のまま残ってしまう。
    assert.deepStrictEqual(reads, [0, 1, 2]);
    // 2行目は継続クォートが無くなったことで `"` が新規開始と解釈され、以降クォート内
    // 扱いになってカンマが区切りでなくなる（delims=[] → null）。3行目もクォートが
    // 閉じないまま終わるので同様に区切りが無くなる。
    assert.deepStrictEqual(cache.metricsAt(0), {
      delims: [1],
      widths: [1],
      contentStarts: [0],
      numeric: [false],
      intEndWidths: [1],
    });
    assert.strictEqual(cache.metricsAt(1), null);
    assert.strictEqual(cache.metricsAt(2), null);
    assert.deepStrictEqual(cache.maxWidths(), [1]);
  });

  test("クォート状態が変わらない編集では、ダーティ行だけ読み直しカスケードしない", () => {
    const lines = ['a,"b', 'c",d', "e,f"];
    const cache = new CsvWidthCache(",");
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.maxWidths(), [2]);

    // クォートは開いたままで幅だけ変わる編集。終端のクォート状態(true)は変わらない。
    lines[0] = 'aa,"bb';
    cache.applyEdit(0, 1, 1);
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);
    assert.deepStrictEqual(reads, [0]);
    assert.deepStrictEqual(cache.maxWidths(), [2]);
  });
});
