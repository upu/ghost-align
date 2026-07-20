import * as assert from "assert";
import {
  findPipePositions,
  isDelimiterRow,
  findMarkdownTables,
  computeMarkdownTablePaddings,
  computeFenceStateBefore,
  MarkdownTableWidthCache,
} from "../../markdown";

suite("findPipePositions", () => {
  test("区切りの `|` 位置を返す", () => {
    assert.deepStrictEqual(findPipePositions("| a | b |"), [0, 4, 8]);
  });

  test("エスケープされた `\\|` は区切りにしない", () => {
    // "| a \| b | c |" の \| は対象外
    assert.deepStrictEqual(findPipePositions("| a \\| b | c |"), [0, 9, 13]);
  });

  test("エスケープされたバックスラッシュ後の `|` は区切りになる", () => {
    // "\\|" は「エスケープされた \」+「生の |」
    assert.deepStrictEqual(findPipePositions("a\\\\| b"), [3]);
  });

  test("`|` がない行は空配列", () => {
    assert.deepStrictEqual(findPipePositions("no pipes here"), []);
  });

  test("インラインコードスパン内の `|` は区切りにしない", () => {
    assert.deepStrictEqual(findPipePositions("| `a|b` | c |"), [0, 8, 12]);
  });

  test("2連バックティックのコードスパン内の `|` も区切りにしない", () => {
    assert.deepStrictEqual(findPipePositions("| ``a|b`` | c |"), [0, 10, 14]);
  });

  test("閉じバックティックがない行はスパン扱いせず `|` を区切りにする", () => {
    assert.deepStrictEqual(findPipePositions("| `a | b |"), [0, 5, 9]);
  });

  test("コードスパン内の `\\|` はエスケープでなくスパンにより除外される", () => {
    assert.deepStrictEqual(findPipePositions("| `\\|` | b |"), [0, 7, 11]);
  });
});

suite("isDelimiterRow", () => {
  test("`|---|---|` は区切り行", () => {
    assert.strictEqual(isDelimiterRow("|---|---|"), true);
  });

  test("アラインメント指定 `:` を含む区切り行も真", () => {
    assert.strictEqual(isDelimiterRow("| :--- | ---: | :--: |"), true);
  });

  test("文字を含む行は区切り行でない", () => {
    assert.strictEqual(isDelimiterRow("| a | b |"), false);
  });

  test("`|` を含まない `---` は区切り行でない", () => {
    assert.strictEqual(isDelimiterRow("---"), false);
  });

  test("先頭・末尾パイプを省略した区切り行も真", () => {
    assert.strictEqual(isDelimiterRow("--- | :---:"), true);
  });

  test("コロンだけのセルを含む行は区切り行でない", () => {
    assert.strictEqual(isDelimiterRow("| : | --- |"), false);
  });

  test("空セルを含む行は区切り行でない", () => {
    assert.strictEqual(isDelimiterRow("| --- | | --- |"), false);
  });

  test("コロンが片側2個以上のセルを含む行は区切り行でない", () => {
    assert.strictEqual(isDelimiterRow("| ::--- | --- |"), false);
  });
});

suite("findMarkdownTables", () => {
  test("ヘッダ+区切り+データのブロックを検出する", () => {
    const tables = findMarkdownTables([
      "text",
      "| h |",
      "|---|",
      "| d |",
      "",
      "pipe | but no | table",
    ]);
    assert.deepStrictEqual(tables, [[1, 2, 3]]);
  });

  test("区切り行がなければテーブルにしない", () => {
    const tables = findMarkdownTables(["| a | b |", "| c | d |"]);
    assert.deepStrictEqual(tables, []);
  });

  test("区切り行のセル数がヘッダーより少なければテーブルにしない", () => {
    const tables = findMarkdownTables(["| a | b |", "| --- |", "| x |"]);
    assert.deepStrictEqual(tables, []);
  });

  test("区切り行のセル数がヘッダーより多ければテーブルにしない", () => {
    const tables = findMarkdownTables(["| a |", "| --- | --- |"]);
    assert.deepStrictEqual(tables, []);
  });

  test("ハイフンを持たないセルを含む区切り行はテーブルにしない", () => {
    const tables = findMarkdownTables(["| a | b |", "| : | --- |"]);
    assert.deepStrictEqual(tables, []);
  });

  test("先頭・末尾パイプを省略した有効なテーブルは検出する", () => {
    const tables = findMarkdownTables(["a | b", "--- | ---", "x | y"]);
    assert.deepStrictEqual(tables, [[0, 1, 2]]);
  });

  test("データ行のセル数はヘッダーと一致しなくてもテーブルに含める", () => {
    const tables = findMarkdownTables(["| a | b |", "| --- | --- |", "| x |"]);
    assert.deepStrictEqual(tables, [[0, 1, 2]]);
  });

  test("フェンスドコードブロック内のテーブル風行は対象外", () => {
    const tables = findMarkdownTables([
      "```",
      "| not | a | real table |",
      "|-----|---|------------|",
      "```",
    ]);
    assert.deepStrictEqual(tables, []);
  });

  test("`~~~` フェンス内のテーブル風行も対象外", () => {
    const tables = findMarkdownTables([
      "~~~",
      "| not | a | real table |",
      "|-----|---|------------|",
      "~~~",
    ]);
    assert.deepStrictEqual(tables, []);
  });

  test("言語指定付き・インデントされたフェンスも対象外にする", () => {
    const tables = findMarkdownTables([
      "  ```ts",
      "| not | a | real table |",
      "|-----|---|------------|",
      "  ```",
    ]);
    assert.deepStrictEqual(tables, []);
  });

  test("閉じないフェンスは末尾までフェンス内として扱う", () => {
    const tables = findMarkdownTables([
      "```",
      "| not | a | real table |",
      "|-----|---|------------|",
    ]);
    assert.deepStrictEqual(tables, []);
  });

  test("バッククォートのフェンスはチルダでは閉じない", () => {
    const tables = findMarkdownTables([
      "```",
      "~~~",
      "| not | a | real table |",
      "|-----|---|------------|",
      "```",
    ]);
    assert.deepStrictEqual(tables, []);
  });

  test("フェンス外の通常テーブルは引き続き整列対象になる", () => {
    const tables = findMarkdownTables([
      "```",
      "| not | a | real table |",
      "|-----|---|------------|",
      "```",
      "",
      "| h |",
      "|---|",
      "| d |",
    ]);
    assert.deepStrictEqual(tables, [[5, 6, 7]]);
  });

  test("初期フェンス状態が開いていれば、閉じフェンスが来るまでテーブル検出しない", () => {
    const tables = findMarkdownTables(
      ["| not | a | real table |", "|-----|---|------------|", "```", "", "| h |", "|---|", "| d |"],
      { char: "`", len: 3 }
    );
    assert.deepStrictEqual(tables, [[4, 5, 6]]);
  });

  test("初期フェンス状態が閉じていれば通常どおりテーブル検出する", () => {
    const tables = findMarkdownTables(
      ["| h |", "|---|", "| d |"],
      { char: null, len: 0 }
    );
    assert.deepStrictEqual(tables, [[0, 1, 2]]);
  });

  test("終了フェンスの後ろに空白以外の文字がある行はフェンスを閉じない", () => {
    // ```not-a-closer はGFM上の終了フェンスの条件（後続は空白のみ）を満たさない
    const tables = findMarkdownTables([
      "```",
      "```not-a-closer",
      "| not | a | real table |",
      "|-----|---|------------|",
      "```",
    ]);
    assert.deepStrictEqual(tables, []);
  });

  test("終了フェンスは末尾の空白を許容する", () => {
    const tables = findMarkdownTables([
      "```",
      "in fence",
      "```  ",
      "| h |",
      "|---|",
      "| d |",
    ]);
    assert.deepStrictEqual(tables, [[3, 4, 5]]);
  });

  test("4スペース以上字下げされたフェンス風の行は通常のフェンスとして扱わない", () => {
    // 4スペース字下げは indented code block であり、GFM のフェンス構文の対象外
    const tables = findMarkdownTables([
      "    ```",
      "| not | a | real table |",
      "|-----|---|------------|",
      "    ```",
    ]);
    assert.deepStrictEqual(tables, [[1, 2]]);
  });

  test("4スペース字下げのコードブロック内の table-like text は対象外", () => {
    const tables = findMarkdownTables([
      "prose",
      "",
      "    | not | a | real table |",
      "    |-----|---|------------|",
      "",
      "| h |",
      "|---|",
      "| d |",
    ]);
    assert.deepStrictEqual(tables, [[5, 6, 7]]);
  });

  test("段落を直接続ける4スペース字下げ行は indented code block にならず、テーブルとして検出する", () => {
    // 直前が空行/ドキュメント先頭でない字下げ行は lazy continuation で、
    // indented code block を開始できない（CommonMark の「段落を中断できない」規則）
    const tables = findMarkdownTables([
      "prose",
      "    | h |",
      "    |---|",
      "    | d |",
    ]);
    assert.deepStrictEqual(tables, [[1, 2, 3]]);
  });

  test("ドキュメント先頭からの4スペース字下げは indented code block として扱う", () => {
    const tables = findMarkdownTables([
      "    | not | a | real table |",
      "    |-----|---|------------|",
    ]);
    assert.deepStrictEqual(tables, []);
  });

  test("indented code block は空行を挟んで続いても対象外のまま", () => {
    const tables = findMarkdownTables([
      "",
      "    | not | a | real table |",
      "",
      "    |-----|---|------------|",
      "",
      "| h |",
      "|---|",
      "| d |",
    ]);
    assert.deepStrictEqual(tables, [[5, 6, 7]]);
  });
});

suite("computeFenceStateBefore", () => {
  test("フェンスが開いたまま閉じていなければ開いた状態を返す", () => {
    const lines = ["text", "```", "in fence"];
    assert.deepStrictEqual(
      computeFenceStateBefore(lines.length, (i) => lines[i]),
      { char: "`", len: 3 }
    );
  });

  test("フェンスが閉じていれば非フェンス状態を返す", () => {
    const lines = ["```", "in fence", "```", "text"];
    assert.deepStrictEqual(
      computeFenceStateBefore(lines.length, (i) => lines[i]),
      { char: null, len: 0 }
    );
  });

  test("フェンスが一度もなければ非フェンス状態を返す", () => {
    const lines = ["a", "b"];
    assert.deepStrictEqual(
      computeFenceStateBefore(lines.length, (i) => lines[i]),
      { char: null, len: 0 }
    );
  });

  test("`~~~` フェンスが開いたままなら `~` の開いた状態を返す", () => {
    const lines = ["~~~~", "in fence"];
    assert.deepStrictEqual(
      computeFenceStateBefore(lines.length, (i) => lines[i]),
      { char: "~", len: 4 }
    );
  });
});

suite("computeMarkdownTablePaddings", () => {
  test("各列の最大幅に合わせて `|` 直前にパディングする", () => {
    const placements = computeMarkdownTablePaddings(
      ["| a | bb |", "| --- | --- |", "| ccc | d |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 2 },
      { lineIndex: 0, character: 9, padding: 1 },
      { lineIndex: 2, character: 10, padding: 2 },
    ]);
  });

  test("テーブルがなければ空を返す（他言語に影響しない）", () => {
    const placements = computeMarkdownTablePaddings(
      ["const x = 1;", "a | b without delimiter"],
      4
    );
    assert.deepStrictEqual(placements, []);
  });

  test("ヘッダーと区切り行のセル数が一致しない無効な表形式テキストにはパディングしない", () => {
    const placements = computeMarkdownTablePaddings(
      ["| a | b |", "| --- |", "| x |"],
      4
    );
    assert.deepStrictEqual(placements, []);
  });

  test("エスケープ `\\|` はセル内文字として扱う", () => {
    // 各行のパイプ数が一致し、\| は区切りに数えない
    const placements = computeMarkdownTablePaddings(
      ["| a \\| b | c |", "| --- | --- |", "| x | y |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 13, padding: 2 },
      { lineIndex: 1, character: 5, padding: 3, padChar: "-" },
      { lineIndex: 2, character: 4, padding: 5 },
      { lineIndex: 2, character: 8, padding: 2 },
    ]);
  });

  test("セル数が揃わない(ragged)行でも例外にならずインデックス基準でパディングする", () => {
    const placements = computeMarkdownTablePaddings(
      ["| a | bb | ccc |", "| --- | --- | --- |", "| x | y |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 2 },
      { lineIndex: 0, character: 9, padding: 1 },
      { lineIndex: 2, character: 4, padding: 2 },
      { lineIndex: 2, character: 8, padding: 2 },
    ]);
  });

  test("全角文字セルを含む表でも視覚幅で列を揃える", () => {
    // "あ"(幅2) と "cc"(幅2) は同じ視覚幅。文字数基準では "cc"=2, "あ"=1 と
    // 誤って数え、列幅がずれていた。
    const placements = computeMarkdownTablePaddings(
      ["| あ | b |", "| --- | --- |", "| cc | d |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 1 },
      { lineIndex: 0, character: 8, padding: 2 },
      { lineIndex: 2, character: 5, padding: 1 },
      { lineIndex: 2, character: 9, padding: 2 },
    ]);
  });

  test("ZWJを含むセルも視覚幅で列を揃える", () => {
    // "a‍b"（a + ZWJ U+200D + b）は視覚幅2で "cc" と同じ。ZWJ を幅1として
    // 誤って数える旧実装では視覚幅3になり、"あ/cc" と同じ形の表なのに
    // ヘッダー行がすでに揃っている（パディング不要）と誤判定していた。
    const placements = computeMarkdownTablePaddings(
      ["| a‍b | b |", "| --- | --- |", "| cc | d |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 6, padding: 1 },
      { lineIndex: 0, character: 10, padding: 2 },
      { lineIndex: 2, character: 5, padding: 1 },
      { lineIndex: 2, character: 9, padding: 2 },
    ]);
  });

  test("コードスパン内の `|` を区切りと誤認せず列がずれない", () => {
    const placements = computeMarkdownTablePaddings(
      ["| `a|b` | c |", "| --- | --- |", "| x | yy |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 12, padding: 2 },
      { lineIndex: 1, character: 5, padding: 2, padChar: "-" },
      { lineIndex: 2, character: 4, padding: 4 },
      { lineIndex: 2, character: 9, padding: 1 },
    ]);
  });

  test("区切り行のパディングは padChar `-` 付きで、最後の `-` の直後に挿入される", () => {
    const placements = computeMarkdownTablePaddings(
      ["| a | b |", "| --- | --- |", "| cccccc | d |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 5 },
      { lineIndex: 0, character: 8, padding: 2 },
      { lineIndex: 1, character: 5, padding: 3, padChar: "-" },
      { lineIndex: 2, character: 13, padding: 2 },
    ]);
  });

  test("右寄せ `---:` は区切り行で trailing `:` の直前に `-` を挿入しつつ、他行はセル内容の先頭にパディングして右寄せを再現する", () => {
    const placements = computeMarkdownTablePaddings(
      ["| a | b |", "| ---: | --- |", "| cccccc | d |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 5 },
      { lineIndex: 0, character: 8, padding: 2 },
      { lineIndex: 1, character: 5, padding: 2, padChar: "-" },
      { lineIndex: 2, character: 13, padding: 2 },
    ]);
  });

  test("中央寄せ `:---:` は区切り行で trailing `:` の直前に `-` を挿入しつつ、他行はセル内容の前後にパディングを分配して中央寄せを再現する（奇数個は末尾側に多く配分）", () => {
    const placements = computeMarkdownTablePaddings(
      ["| a | b |", "| :---: | --- |", "| cccccc | d |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 2 },
      { lineIndex: 0, character: 4, padding: 3 },
      { lineIndex: 0, character: 8, padding: 2 },
      { lineIndex: 1, character: 6, padding: 1, padChar: "-" },
      { lineIndex: 2, character: 13, padding: 2 },
    ]);
  });

  test("左寄せ・中央寄せ・右寄せが混在するテーブルは各列が宣言どおりに揃う", () => {
    // 列1: 左寄せ(既定) 列2: 中央寄せ 列3: 右寄せ。データ行(aaaaa/bbbbb/ccccc)が
    // 各列で最も幅が広く、そのままどの列の目標幅にもなるためパディング不要。
    const placements = computeMarkdownTablePaddings(
      [
        "| a | b | c |",
        "| --- | :---: | ---: |",
        "| aaaaa | bbbbb | ccccc |",
      ],
      4
    );
    assert.deepStrictEqual(placements, [
      // 列1(左寄せ): 従来どおり `|` 直前にパディング
      { lineIndex: 0, character: 4, padding: 4 },
      // 列2(中央寄せ): セル内容の前後に分配（4は2/2）
      { lineIndex: 0, character: 6, padding: 2 },
      { lineIndex: 0, character: 8, padding: 2 },
      // 列3(右寄せ): セル内容の先頭にまとめてパディング
      { lineIndex: 0, character: 10, padding: 4 },
      { lineIndex: 1, character: 5, padding: 2, padChar: "-" },
      { lineIndex: 1, character: 19, padding: 1, padChar: "-" },
    ]);
  });

  test("区切り行でも表の左端より前のセグメントは従来どおり padChar なしでパディングする", () => {
    const placements = computeMarkdownTablePaddings(
      ["  | a |", "| --- |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 6, padding: 2 },
      { lineIndex: 1, character: 0, padding: 2 },
    ]);
  });

  test("初期フェンス状態が開いていれば、渡したスライスだけを見てもテーブル風行を整列しない", () => {
    const placements = computeMarkdownTablePaddings(
      ["| not | a | table |", "|-----|---|-------|"],
      4,
      { char: "`", len: 3 }
    );
    assert.deepStrictEqual(placements, []);
  });

  test("maxPadding: 0（無制限）だと幅の外れ値セル1つが以降の列にも巨大パディングを強制する", () => {
    const lines = [
      "|a|cccccccccccccccccccc|",
      "|-|--------------------|",
      "|xxxxxxxxxxxxxxxxxxxx||",
    ];
    const placements = computeMarkdownTablePaddings(lines, 4, undefined, 0);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 19 },
      { lineIndex: 1, character: 2, padding: 19, padChar: "-" },
      { lineIndex: 2, character: 22, padding: 20 },
    ]);
  });

  test("maxPadding: 超過する列だけ揃えず、以降の列は各行の実位置基準で揃う", () => {
    const lines = [
      "|a|cccccccccccccccccccc|",
      "|-|--------------------|",
      "|xxxxxxxxxxxxxxxxxxxx||",
    ];
    // 列1(index1) は幅 1,1,20 で差19 > maxPadding(10) なので揃えない。
    // 列2(index2) は各行の実際の終端(2,2,21いずれも+20/+20/+1)から
    // 続けて計算すると3行とも23で自然に揃うが、行2だけ幅0なので1パディング必要。
    const placements = computeMarkdownTablePaddings(lines, 4, undefined, 10);
    assert.deepStrictEqual(placements, [
      { lineIndex: 2, character: 22, padding: 1 },
    ]);
  });
});

suite("MarkdownTableWidthCache", () => {
  const syncWithSpy = (
    cache: MarkdownTableWidthCache,
    lines: string[],
    reads: number[],
    tabSize = 4,
    maxPadding = 0
  ) =>
    cache.sync(
      lines.length,
      (i) => {
        reads.push(i);
        return lines[i];
      },
      tabSize,
      maxPadding
    );

  test("右寄せ宣言は placementsForRange 経由でもセル内容の先頭にパディングする", () => {
    const lines = ["| a | b |", "| ---: | --- |", "| cccccc | d |"];
    const cache = new MarkdownTableWidthCache();
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.placementsForRange(0, 2), [
      { lineIndex: 0, character: 2, padding: 5 },
      { lineIndex: 0, character: 8, padding: 2 },
      { lineIndex: 1, character: 5, padding: 2, padChar: "-" },
      { lineIndex: 2, character: 13, padding: 2 },
    ]);
  });

  test("maxPadding 未指定は無制限で従来どおり全列を最大幅に揃える", () => {
    const lines = ["| a | bb |", "| --- | --- |", "| ccc | d |"];
    const cache = new MarkdownTableWidthCache();
    syncWithSpy(cache, lines, []);
    assert.deepStrictEqual(cache.placementsForRange(0, 2), [
      { lineIndex: 0, character: 4, padding: 2 },
      { lineIndex: 0, character: 9, padding: 1 },
      { lineIndex: 2, character: 10, padding: 2 },
    ]);
  });

  test("maxPadding: 全行(可視範囲外含む)基準で外れ値列を判定し、可視範囲だけ取り出しても結果は変わらない", () => {
    const lines = [
      "|a|cccccccccccccccccccc|",
      "|-|--------------------|",
      "|xxxxxxxxxxxxxxxxxxxx||",
    ];
    const cache = new MarkdownTableWidthCache();
    syncWithSpy(cache, lines, [], 4, 10);
    assert.deepStrictEqual(cache.placementsForRange(0, 2), [
      { lineIndex: 2, character: 22, padding: 1 },
    ]);
    // 可視範囲を最終行だけに絞っても、外れ値判定は全行基準のまま変わらない。
    assert.deepStrictEqual(cache.placementsForRange(2, 2), [
      { lineIndex: 2, character: 22, padding: 1 },
    ]);
  });

  test("maxPadding を変えると（編集がなくても）計画を再計算する", () => {
    const lines = [
      "|a|cccccccccccccccccccc|",
      "|-|--------------------|",
      "|xxxxxxxxxxxxxxxxxxxx||",
    ];
    const cache = new MarkdownTableWidthCache();
    syncWithSpy(cache, lines, [], 4, 10);
    assert.deepStrictEqual(cache.placementsForRange(0, 2), [
      { lineIndex: 2, character: 22, padding: 1 },
    ]);
    syncWithSpy(cache, lines, [], 4, 0);
    assert.deepStrictEqual(cache.placementsForRange(0, 2), [
      { lineIndex: 0, character: 2, padding: 19 },
      { lineIndex: 1, character: 2, padding: 19, padChar: "-" },
      { lineIndex: 2, character: 22, padding: 20 },
    ]);
  });

  // 行番号: 0-1 散文, 2 ヘッダー, 3 区切り行, 4 データ行, 5 散文,
  // 6 フェンス開始, 7 フェンス内, 8 フェンス終了, 9 散文
  const linesWithTableAndFence = () => [
    "prose line 0",
    "prose line 1",
    "| a | b |",
    "| --- | --- |",
    "| c | d |",
    "prose line 5",
    "```",
    "code line",
    "```",
    "prose line 9",
  ];

  test("テーブル・フェンスと交差しない散文編集は全再構築を避ける", () => {
    const lines = linesWithTableAndFence();
    const cache = new MarkdownTableWidthCache();
    syncWithSpy(cache, lines, []);
    const before = cache.placementsForRange(0, lines.length - 1);

    lines[0] = "prose line 0 rewritten";
    cache.applyEdit(0, 1, 1, lines[0]);
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);

    assert.deepStrictEqual(reads, []); // 再構築されていない
    assert.deepStrictEqual(cache.placementsForRange(0, lines.length - 1), before);
  });

  test("テーブル行の編集は全再構築する", () => {
    const lines = linesWithTableAndFence();
    const cache = new MarkdownTableWidthCache();
    syncWithSpy(cache, lines, []);

    lines[4] = "| ccccccc | d |"; // データ行のセル幅を拡張
    cache.applyEdit(4, 1, 1, lines[4]);
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);

    assert.deepStrictEqual(reads, lines.map((_, i) => i));
    assert.deepStrictEqual(cache.placementsForRange(0, lines.length - 1), [
      { lineIndex: 2, character: 4, padding: 6 },
      { lineIndex: 2, character: 8, padding: 2 },
      { lineIndex: 3, character: 5, padding: 4, padChar: "-" },
      { lineIndex: 4, character: 14, padding: 2 },
    ]);
  });

  test("フェンス内部の編集も全再構築する（フェンス範囲との交差を保守的に扱う）", () => {
    const lines = linesWithTableAndFence();
    const cache = new MarkdownTableWidthCache();
    syncWithSpy(cache, lines, []);

    lines[7] = "different code line"; // フェンス開始/終了行そのものではない
    cache.applyEdit(7, 1, 1, lines[7]);
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);

    assert.deepStrictEqual(reads, lines.map((_, i) => i));
  });

  test("行数が変わる編集は全再構築する", () => {
    const lines = linesWithTableAndFence();
    const cache = new MarkdownTableWidthCache();
    syncWithSpy(cache, lines, []);

    lines.splice(9, 0, "inserted prose line"); // 散文の中に1行挿入
    cache.applyEdit(9, 1, 2, "inserted prose line\nprose line 9");
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);

    assert.deepStrictEqual(reads, lines.map((_, i) => i));
  });

  test("既存のテーブル・フェンスと交差しなくても `|` を含む新規テキストは全再構築する（新規テーブル化の可能性）", () => {
    const lines = linesWithTableAndFence();
    const cache = new MarkdownTableWidthCache();
    syncWithSpy(cache, lines, []);

    lines[1] = "| newly | piped |"; // 元は散文だった行にパイプを追加
    cache.applyEdit(1, 1, 1, lines[1]);
    const reads: number[] = [];
    syncWithSpy(cache, lines, reads);

    assert.deepStrictEqual(reads, lines.map((_, i) => i));
  });
});
