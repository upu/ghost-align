import * as assert from "assert";
import {
  findPipePositions,
  isDelimiterRow,
  findMarkdownTables,
  computeMarkdownTablePaddings,
  computeFenceStateBefore,
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

  test("右寄せ `---:` は trailing `:` の直前に `-` を挿入して `:` が端に残る", () => {
    const placements = computeMarkdownTablePaddings(
      ["| a | b |", "| ---: | --- |", "| cccccc | d |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 5 },
      { lineIndex: 0, character: 8, padding: 2 },
      { lineIndex: 1, character: 5, padding: 2, padChar: "-" },
      { lineIndex: 2, character: 13, padding: 2 },
    ]);
  });

  test("中央寄せ `:---:` も trailing `:` の直前に `-` を挿入する", () => {
    const placements = computeMarkdownTablePaddings(
      ["| a | b |", "| :---: | --- |", "| cccccc | d |"],
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 5 },
      { lineIndex: 0, character: 8, padding: 2 },
      { lineIndex: 1, character: 6, padding: 1, padChar: "-" },
      { lineIndex: 2, character: 13, padding: 2 },
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
});
