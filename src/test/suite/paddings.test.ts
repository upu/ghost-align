import * as assert from "assert";
import {
  findAlignmentGroups,
  visualColumn,
  computePaddings,
  computeColumnPlan,
  computeSliceBounds,
} from "../../paddings";
import { findOperatorTargets, initialLineScanState } from "../../finders";
import { mockDocument } from "./testHelpers";

suite("findAlignmentGroups", () => {
  test("連続する代入行をグループ化する", () => {
    const doc = mockDocument([
      "const x = 1;",
      "const longName = 2;",
      "const a = 3;",
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 3);
  });

  test("1行だけの場合はグループ化しない", () => {
    const doc = mockDocument([
      "const x = 1;",
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 0);
  });

  test("`=>` を指定すると連続するアロー関数行が揃う", () => {
    const doc = mockDocument([
      "const f = (e) => handleClick(e);",
      "const onChange = (e) => handleChange(e);",
    ]);
    const groups = findAlignmentGroups(doc, ["=>"]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
    const paddings = computePaddings(groups);
    const aligned = groups[0].map((g) => {
      const p = paddings.find((q) => q.lineIndex === g.lineIndex);
      return g.columns[0].visualColumn + (p ? p.padding : 0);
    });
    assert.strictEqual(aligned[0], aligned[1]);
  });

  test("空行で区切られると別グループになる", () => {
    const doc = mockDocument([
      "const x = 1;",
      "const y = 2;",
      "",
      "const a = 3;",
      "const b = 4;",
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[1].length, 2);
  });

  test("= がない行が間に入ると別グループになる", () => {
    const doc = mockDocument([
      "const x = 1;",
      "const y = 2;",
      "console.log(x);",
      "const a = 3;",
      "const b = 4;",
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 2);
  });

  test("columns[0].insert が正しい値を持つ", () => {
    const doc = mockDocument([
      "const x = 1;",       // = at 8
      "const longName = 2;", // = at 15
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups[0][0].columns[0].insert, 8);
    assert.strictEqual(groups[0][1].columns[0].insert, 15);
  });

  test("インデント幅が変わったら別グループになる", () => {
    const doc = mockDocument([
      '  "name": "foo",',     // indent 2
      '  "engines": {',       // indent 2
      '    "vscode": "^1",',  // indent 4 — 別グループ
      '    "node": "^20"',    // indent 4
      "  },",
      '  "version": "0.0.1"', // indent 2 — また別グループ
    ]);
    const groups = findAlignmentGroups(doc, [":"]);
    // インデント2の最初の2行で1グループ、インデント4の2行で1グループ。
    // 最後のindent2行は単独なのでグループにならない（≥2要件）。
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[1].length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 0);
    assert.strictEqual(groups[1][0].lineIndex, 2);
  });

  test("継続マーカー `\\`: インデント幅が違っても継続行はグループを分断しない", () => {
    // 継続行は視覚的に揃えるためインデントが行ごとに異なるのが普通なので、
    // 通常の「インデントが変わったら別グループ」ルールを適用してはいけない。
    const doc = mockDocument([
      "CFLAGS = -Wall -Wextra \\",
      "         -O2 \\",
      "         -g \\",
    ]);
    const groups = findAlignmentGroups(doc, ["\\"]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 3);
    const placements = computePaddings(groups);
    const aligned = groups[0].map((g) => {
      const p = placements.find((q) => q.lineIndex === g.lineIndex);
      return g.columns[0].visualColumn + (p ? p.padding : 0);
    });
    assert.strictEqual(aligned[0], aligned[1]);
    assert.strictEqual(aligned[1], aligned[2]);
  });

  test("継続マーカー `\\`: 継続が途切れた行でグループが終わる", () => {
    const doc = mockDocument([
      "CFLAGS = -Wall -Wextra \\",
      "         -O2",
      "LDFLAGS = -lm \\",
      "          -lpthread \\",
    ]);
    const groups = findAlignmentGroups(doc, ["\\"], "makefile");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 2);
    assert.strictEqual(groups[0][1].lineIndex, 3);
  });

  test("for 文の行は通常の代入とアライメントグループを共有しない", () => {
    const doc = mockDocument([
      "  let inString = false;",
      "  let escaped = false;",
      "  for (let i = 0; i < lineText.length; i++) {",
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 0);
    assert.strictEqual(groups[0][1].lineIndex, 1);
  });

  test("全行コメント行はグループを分断せず、かつ最大列を押し上げない", () => {
    const doc = mockDocument([
      "const x = 1;",         // = at 8
      "// const yyyyyy = 2;", // 全行コメント — 透過するがそれ自体は対象外
      "const z = 3;",         // = at 8
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [0, 2]);
    // 既にどちらも列8で揃っている（コメント行の `=`(列17) には引きずられない）
    assert.deepStrictEqual(computePaddings(groups), []);
  });

  test("CSS: セレクタ行はグループに含めず宣言行だけを揃える", () => {
    const doc = mockDocument([
      "a:hover {",          // セレクタ行 — 擬似クラスの `:` は対象外 → 演算子なし
      "  color: red;",      // : at 7
      "  background: blue;", // : at 12
      "}",
    ]);
    const groups = findAlignmentGroups(doc, [":"], "css");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 1);
    assert.strictEqual(groups[0][0].columns[0].insert, 7);
    assert.strictEqual(groups[0][1].columns[0].insert, 12);
  });

  test("CSS: 複数行にまたがるセレクタの疑似クラス `:` を宣言コロンとして誤って揃えない", () => {
    // `{` が同じ行にない継続セレクタ行（`.foo:hover,` / `.barbaz:focus,`）は、
    // まだ宣言ブロックに入っていない（ブレース深さ0）ので `:` は対象外になるべき。
    // 修正前はどちらの行も宣言コロンとして誤検出し、同じインデントの2行として
    // グループ化されてしまっていた。
    const doc = mockDocument([
      ".foo:hover,",
      ".barbaz:focus,",
      ".baz {",
      "  color: red;",
      "}",
    ]);
    const groups = findAlignmentGroups(doc, [":"], "css");
    assert.strictEqual(groups.length, 0);
  });

  test("インデント減少でも別グループになる", () => {
    const doc = mockDocument([
      '    "a": 1,',  // indent 4
      '    "b": 2,',  // indent 4
      '  "c": 3,',    // indent 2 — 別グループ
      '  "d": 4',     // indent 2
    ]);
    const groups = findAlignmentGroups(doc, [":"]);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 0);
    assert.strictEqual(groups[1][0].lineIndex, 2);
  });

  test("タブインデントの代入行は視覚カラムで揃える", () => {
    // tabSize 4: "\tx = 1;" の = は文字インデックス3・視覚カラム6、
    // "\tlongName = 2;" の = は文字インデックス10・視覚カラム13。
    const doc = mockDocument(["\tx = 1;", "\tlongName = 2;"]);
    const groups = findAlignmentGroups(doc, ["="], undefined, 4);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0][0].columns[0].insert, 3);
    assert.strictEqual(groups[0][0].columns[0].visualColumn, 6);
    assert.strictEqual(groups[0][1].columns[0].insert, 10);
    assert.strictEqual(groups[0][1].columns[0].visualColumn, 13);
  });

  test("tabSize を変えても同じグループにまとまる", () => {
    const doc = mockDocument(["\tx = 1;", "\tlongName = 2;"]);
    const groups = findAlignmentGroups(doc, ["="], undefined, 8);
    assert.strictEqual(groups.length, 1);
    // tabSize 8: \t→8。= の視覚カラムは 10 と 17。
    assert.strictEqual(groups[0][0].columns[0].visualColumn, 10);
    assert.strictEqual(groups[0][1].columns[0].visualColumn, 17);
  });

  test("連続行の行末コメント `//` をグループ化する", () => {
    const doc = mockDocument([
      "x = 1; // a",      // // at 7
      "total = 42; // b", // // at 12
    ]);
    const groups = findAlignmentGroups(doc, ["//"]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0][0].columns[0].insert, 7);
    assert.strictEqual(groups[0][1].columns[0].insert, 12);
  });

  test("丸ごとコメント行はグループを分断せず前後を同一グループとして揃える", () => {
    const doc = mockDocument([
      "x = 1; // a",
      "// 丸ごとコメント",
      "y = 2; // b",
    ]);
    const groups = findAlignmentGroups(doc, ["//"]);
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [0, 2]);
  });

  test("連続行の行末コメント `--`（Lua/SQL）をグループ化する", () => {
    const doc = mockDocument([
      "x = 1 -- a",      // -- at 6
      "total = 42 -- b", // -- at 11
    ]);
    const groups = findAlignmentGroups(doc, ["--"]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0][0].columns[0].insert, 6);
    assert.strictEqual(groups[0][1].columns[0].insert, 11);
  });

  test("連続行の行末コメント `;`（INI/asm）をグループ化する", () => {
    const doc = mockDocument([
      "x = 1 ; a",      // ; at 6
      "total = 42 ; b", // ; at 11
    ]);
    const groups = findAlignmentGroups(doc, [";"]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0][0].columns[0].insert, 6);
    assert.strictEqual(groups[0][1].columns[0].insert, 11);
  });

  test("スペース/タブ混在でも視覚インデントが同じなら同じグループになる", () => {
    // tabSize 4: タブ1個もスペース4個も視覚インデントは 4。
    // 文字数基準だと 1 と 4 で別グループに割れていた。
    const doc = mockDocument(["\tx = 1;", "    y = 2;"]);
    const groups = findAlignmentGroups(doc, ["="], undefined, 4);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
  });

  test("複合代入はパディングが演算子の手前に入り = が揃う", () => {
    const doc = mockDocument(["x += 1", "long -= 2"]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0][0].columns[0].insert, 2);
    assert.strictEqual(groups[0][0].columns[0].visualColumn, 3);
    assert.strictEqual(groups[0][1].columns[0].insert, 5);
    assert.strictEqual(groups[0][1].columns[0].visualColumn, 6);
    const placements = computePaddings(groups);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 3 },
    ]);
  });

  test("Makefile の := と ?= が演算子を分断せずに揃う", () => {
    const doc = mockDocument(["VAR := 1", "LONGVAR ?= 2"]);
    const groups = findAlignmentGroups(doc, ["="], "makefile");
    assert.strictEqual(groups.length, 1);
    const placements = computePaddings(groups);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 4 },
    ]);
  });

  test("マルチカラム: `=` と `#` の両方が揃う", () => {
    const doc = mockDocument(["x = 1 # a", "longer = 22 # b"]);
    const groups = findAlignmentGroups(doc, ["=", "#"], "python");
    assert.strictEqual(groups.length, 1);
    const placements = computePaddings(groups);
    // 行0: = を列7へ(+5)、# は 6+5=11 から列12へ(+1)
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 5 },
      { lineIndex: 0, character: 6, padding: 1 },
    ]);
  });

  test("マルチカラム: 第1カラムがない行も第2カラムだけ揃う", () => {
    const doc = mockDocument(["x = 1 # a", "foo(1) # b"]);
    const groups = findAlignmentGroups(doc, ["=", "#"], "python");
    assert.strictEqual(groups.length, 1);
    const placements = computePaddings(groups);
    // `=` は行0のみ→パディングなし。# は行0が6、行1が7 → 行0に+1
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 6, padding: 1 },
    ]);
  });

  test("マルチカラム: グループのエントリが columns を持つ", () => {
    const doc = mockDocument(["x = 1 # a", "y = 2 # b"]);
    const groups = findAlignmentGroups(doc, ["=", "#"], "python");
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0][0].columns, [
      { opIndex: 0, insert: 2, visualColumn: 2 },
      { opIndex: 1, insert: 6, visualColumn: 6 },
    ]);
  });

  test("YAML: 全行コメント行はグループを分断せず前後が同一グループとして揃う", () => {
    const doc = mockDocument([
      "a: 1",
      "# veryLongCommentedOutKey: 99",
      "b: 2",
    ]);
    const groups = findAlignmentGroups(doc, [":"], "yaml");
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [0, 2]);
  });

  test("`#` の全行コメント行はグループを分断せず前後が同一グループとして揃う", () => {
    const doc = mockDocument([
      "x = 1",
      "# veryLongCommentedOutName = 99",
      "y = 2",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "python");
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [0, 2]);
  });

  test("単純代入と複合代入が混在しても = の列で揃う", () => {
    // "x += 1" の = は視覚列3、"yy = 2" の = も視覚列3 — 既に揃っている
    const doc = mockDocument(["x += 1", "yy = 2"]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(computePaddings(groups), []);
  });

  test("全角文字を含む代入行は視覚カラムで揃える", () => {
    // "あ = 1;" の = は文字インデックス2・視覚カラム3（あ=2 + 空白=1）。
    // "あいう = 2;" の = は文字インデックス4・視覚カラム7。
    const doc = mockDocument(["あ = 1;", "あいう = 2;"]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0][0].columns[0].insert, 2);
    assert.strictEqual(groups[0][0].columns[0].visualColumn, 3);
    assert.strictEqual(groups[0][1].columns[0].insert, 4);
    assert.strictEqual(groups[0][1].columns[0].visualColumn, 7);
  });

  test("YAML: ブロックスカラー(`|`)の中身にある `:` はアライメント対象にならず、終了後は通常どおり整列される", () => {
    const doc = mockDocument([
      "a: 1",
      "b: |",
      "  make target: build",
      "c: 2",
      "dd: 3",
    ]);
    const groups = findAlignmentGroups(doc, [":"], "yaml");
    // ブロックスカラーの中身（行2）はどのグループにも含まれない
    assert.strictEqual(groups.length, 2);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [0, 1]);
    assert.deepStrictEqual(groups[1].map((g) => g.lineIndex), [3, 4]);
  });

  test("YAML: `>` の折り畳みブロックスカラーの中身も同様に除外される", () => {
    const doc = mockDocument(["a: 1", "b: >", "  folded: text", "c: 2"]);
    const groups = findAlignmentGroups(doc, [":"], "yaml");
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [0, 1]);
  });

  test("代入グループの途中に全行コメント行を挟んでも前後の = が同一グループとして揃う", () => {
    const doc = mockDocument([
      "const a = 1;",              // = at 8
      "// しきい値は実測から決めた",
      "const longName = 2;",       // = at 15
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [0, 2]);
    const placements = computePaddings(groups);
    // コメント行にはパディングが入らず、実コード行だけが列15に揃う
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 8, padding: 7 },
    ]);
  });

  test("空行は全行コメント行と違いグループを分断する", () => {
    const doc = mockDocument([
      "const a = 1;",
      "",
      "const longName = 2;",
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 0);
  });

  test("全行コメント行のインデントはグループのインデント比較に参加しない", () => {
    const doc = mockDocument([
      "  const a = 1;",                    // indent 2
      "      // 大きく異なるインデント",   // indent 6、全行コメント
      "  const longName = 2;",             // indent 2
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [0, 2]);
  });

  test("グループ開始前の全行コメント行は無視される", () => {
    const doc = mockDocument([
      "// header comment",
      "const a = 1;",
      "const longName = 2;",
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [1, 2]);
  });

  test("ブロックコメントだけの行もグループを分断しない", () => {
    const doc = mockDocument([
      "const a = 1;",
      "/* note */",
      "const longName = 2;",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "typescript");
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [0, 2]);
  });

  test("複数行ブロックコメントの開始行・継続行・終了行もグループを分断しない", () => {
    const doc = mockDocument([
      "const a = 1;",
      "/*",
      " * note",
      " */",
      "const longName = 2;",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "typescript");
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [0, 4]);
  });

  test("連続する switch の case/default 行はコロン整列のグループにならない（#336）", () => {
    const doc = mockDocument([
      "case 1:       return a;",
      "case 22:      return b;",
      "default:      return z;",
    ]);
    const groups = findAlignmentGroups(doc, [":", "="], "typescript");
    assert.strictEqual(groups.length, 0);
  });

  test("TS: switch でラップされていても case/default 行は対象外のまま（#345 の回帰確認）", () => {
    // #345 の修正で switch 本体かどうかをブレーススタックで追跡するようになった。
    // 実際の switch 文を外側の `{`（関数本体）でラップしても、switch 本体の
    // 検出自体が壊れて case/default のラベルコロンが誤って整列対象にならないことを確認する
    const doc = mockDocument([
      "function f(x) {",
      "  switch (x) {",
      "    case 1:       return a;",
      "    case 22:      return b;",
      "    default:      return z;",
      "  }",
      "}",
    ]);
    const groups = findAlignmentGroups(doc, [":", "="], "typescript");
    assert.strictEqual(groups.length, 0);
  });

  test("TS: インターフェースの `default` メンバー（末尾 `;`）はコロン整列の対象になる（#345）", () => {
    const doc = mockDocument([
      "interface Foo {",
      "  a: number;",
      "  default: string;",
      "}",
    ]);
    const groups = findAlignmentGroups(doc, [":"], "typescript");
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [1, 2]);
  });

  test("TS: オブジェクトリテラルの末尾カンマなし最終プロパティ `default` はコロン整列の対象になる（#345）", () => {
    const doc = mockDocument([
      "const config = {",
      "  a: 1,",
      "  default: 2",
      "};",
    ]);
    const groups = findAlignmentGroups(doc, [":"], "typescript");
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [1, 2]);
  });

  test("TS: switch の条件と `{` の間にブロックコメントがあっても switch 本体として検出する（#345）", () => {
    const doc = mockDocument([
      "switch (x) /* start */ {",
      "  case 1:       return a;",
      "  default:      return z;",
      "}",
    ]);
    const groups = findAlignmentGroups(doc, [":", "="], "typescript");
    assert.strictEqual(groups.length, 0);
  });

  test("TS: switch の case ブロック内に入れ子のオブジェクトリテラルがあっても `default` プロパティと外側の switch ラベルを区別する（#345）", () => {
    // ネストした非switchの `{`（case のブロックとオブジェクトリテラル）は
    // ブレーススタックに積まれ、閉じれば switch 本体のコンテキストへ正しく戻る
    const doc = mockDocument([
      "switch (x) {",
      "  case 1: {",
      "    const cfg = {",
      "      a: 1,",
      "      default: 2,",
      "    };",
      "  }",
      "  case 22:      return b;",
      "  default:      return z;",
      "}",
    ]);
    const groups = findAlignmentGroups(doc, [":", "="], "typescript");
    // 入れ子のオブジェクトリテラル(3,4行目)はコロン整列の対象になる
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].map((g) => g.lineIndex), [3, 4]);
  });
});

suite("findAlignmentGroups（複数行ブロックコメント / テンプレートリテラル）", () => {
  test("複数行ブロックコメント内の = は整列対象にならない", () => {
    const doc = mockDocument([
      "/*",
      " * a = 1",
      " */",
      "const x = 1;",
      "const longName = 2;",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "typescript");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 3);
    assert.strictEqual(groups[0][1].lineIndex, 4);
  });

  test("複数行テンプレートリテラル内の = は整列対象にならない", () => {
    const doc = mockDocument([
      "const s = `",
      "  x = 1",
      "`;",
      "const y = 2;",
      "const longName = 3;",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "typescript");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 3);
    assert.strictEqual(groups[0][1].lineIndex, 4);
  });

  test("初期状態に blockComment を渡すとスライス先頭からブロックコメント内として扱う", () => {
    const doc = mockDocument([
      " * still comment",
      " */",
      "const x = 1;",
      "const longName = 2;",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "typescript", 4, {
      ...initialLineScanState(),
      doc: "blockComment",
    });
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 2);
    assert.strictEqual(groups[0][1].lineIndex, 3);
  });
});

suite("findAlignmentGroups（Python triple-quote docstring）", () => {
  test('複数行にまたがる """ docstring 内の = はアライメント対象にならない', () => {
    const doc = mockDocument([
      "def f():",
      '    """',
      "    Example:",
      "        x = 1",
      "        longName = 2",
      '    """',
      "    return x",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "python");
    assert.strictEqual(groups.length, 0);
  });

  test('同一行で閉じる """ は従来通り機能する（前後の代入は整列する）', () => {
    const doc = mockDocument([
      'x = """oneline"""',
      "longName = 2",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "python");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
  });

  test("通常のシングル/ダブルクォート文字列や既存の # コメント検出に影響しない", () => {
    const doc = mockDocument([
      's = "a = 1"  # comment',
      "longName = 2",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "python");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
  });
});

suite("findAlignmentGroups（Ruby/PHP ヒアドキュメント）", () => {
  test("Ruby: ヒアドキュメント本文内の = は整列対象にならず、終端行の後は通常どおり整列される", () => {
    // 本文行をオープナー行と同じインデント（0）にして、ヒアドキュメント判定なしでは
    // インデント差によるグループ分割に頼らず本文が誤って地の文と同じグループに
    // 混ざることを検出できるようにする。
    const doc = mockDocument([
      "sql = <<~SQL",
      "SET x = 1",
      "SQL",
      "a = 2",
      "longName = 3",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "ruby");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 3);
    assert.strictEqual(groups[0][1].lineIndex, 4);
  });

  test("Ruby: ヒアドキュメント本文内の => も整列対象にならない", () => {
    // オープナー行自体にも => を含め、本文行の => が抑制されなければ
    // オープナー行と地続きのグループになってしまう構成にする。
    const doc = mockDocument([
      "a => 1 <<~SQL",
      "b => 2",
      "SQL",
      "c = 1 => d",
      "longName = 2 => e",
    ]);
    const groups = findAlignmentGroups(doc, ["=>"], "ruby");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 3);
    assert.strictEqual(groups[0][1].lineIndex, 4);
  });

  test("Ruby: x << 2 のような左シフトはヒアドキュメント開始と誤認せず通常どおり整列される", () => {
    const doc = mockDocument(["x = 1 << 2", "longName = 2"]);
    const groups = findAlignmentGroups(doc, ["="], "ruby");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
  });

  test("PHP: nowdoc（<<<'EOT'）本文内の = は整列対象にならない", () => {
    const doc = mockDocument([
      "$sql = <<<'EOT'",
      "SET x = 1",
      "EOT;",
      "$a = 2;",
      "$longName = 3;",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "php");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
    assert.strictEqual(groups[0][0].lineIndex, 3);
    assert.strictEqual(groups[0][1].lineIndex, 4);
  });

  test("PHP: heredoc（<<<EOT、クォートなし）本文内の = も整列対象にならない", () => {
    const doc = mockDocument([
      "$sql = <<<EOT",
      "SET x = 1",
      "EOT;",
      "$a = 2;",
      "$longName = 3;",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "php");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
  });
});

/** Builds a single-column AlignmentEntry for computePaddings tests. */
function entry(lineIndex: number, insert: number, visualColumn: number) {
  return { lineIndex, columns: [{ opIndex: 0, insert, visualColumn }] };
}

suite("computePaddings", () => {
  test("グループ内の各行を最大視覚カラムまでパディングする", () => {
    const placements = computePaddings([
      [entry(0, 8, 8), entry(1, 15, 15)],
    ]);
    // 行0 は 15-8=7 パディング、行1 は最大なのでスキップ。
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 8, padding: 7 },
    ]);
  });

  test("character は insert（文字インデックス）を使う", () => {
    // タブで visualColumn と insert が異なるケース。
    const placements = computePaddings([
      [entry(0, 3, 6), entry(1, 10, 13)],
    ]);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 3, padding: 7 },
    ]);
  });

  test("既に揃っているグループは空を返す", () => {
    const placements = computePaddings([
      [entry(0, 5, 5), entry(1, 5, 5)],
    ]);
    assert.deepStrictEqual(placements, []);
  });

  test("複数グループをまとめて処理する", () => {
    const placements = computePaddings([
      [entry(0, 2, 2), entry(1, 4, 4)],
      [entry(3, 1, 1), entry(4, 3, 3)],
    ]);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 2 },
      { lineIndex: 3, character: 1, padding: 2 },
    ]);
  });

  test("maxPadding: 超過の原因になる外れ値行を除外し残りで揃える", () => {
    const placements = computePaddings(
      [[entry(0, 10, 10), entry(1, 12, 12), entry(2, 50, 50)]],
      10
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 10, padding: 2 },
    ]);
  });

  test("maxPadding: 除外後もまだ超過するなら収束するまで反復して除外する", () => {
    const placements = computePaddings(
      [[entry(0, 10, 10), entry(1, 12, 12), entry(2, 30, 30), entry(3, 50, 50)]],
      10
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 10, padding: 2 },
    ]);
  });

  test("maxPadding: ちょうど maxPadding のパディングは許容する（境界値）", () => {
    const placements = computePaddings(
      [[entry(0, 10, 10), entry(1, 20, 20)]],
      10
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 10, padding: 10 },
    ]);
  });

  test("maxPadding: 1 超えたら外れ値が除外され、残り 1 行では揃えない", () => {
    const placements = computePaddings(
      [[entry(0, 10, 10), entry(1, 21, 21)]],
      10
    );
    assert.deepStrictEqual(placements, []);
  });

  test("maxPadding: 0 は無制限（従来挙動）", () => {
    const placements = computePaddings(
      [[entry(0, 10, 10), entry(1, 50, 50)]],
      0
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 10, padding: 40 },
    ]);
  });

  test("maxPadding: 除外はカラム単位で、外れ値行の別カラムは揃う", () => {
    const placements = computePaddings(
      [
        [
          {
            lineIndex: 0,
            columns: [
              { opIndex: 0, insert: 10, visualColumn: 10 },
              { opIndex: 1, insert: 60, visualColumn: 60 },
            ],
          },
          {
            lineIndex: 1,
            columns: [
              { opIndex: 0, insert: 50, visualColumn: 50 },
              { opIndex: 1, insert: 62, visualColumn: 62 },
            ],
          },
        ],
      ],
      10
    );
    // opIndex 0 は行1（50）が外れ値として除外され揃わないが、
    // opIndex 1 は 60 vs 62 で差 2 なので揃う。
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 60, padding: 2 },
    ]);
  });
});

suite("computeColumnPlan", () => {
  test("maxPadding 以内ならどの列も最大幅に揃える計画を返す", () => {
    const plan = computeColumnPlan(
      [
        [1, 2],
        [3, 1],
      ],
      10,
      (after) => after + 1
    );
    assert.deepStrictEqual(plan, [3, 6]);
  });

  test("超過する列は null（未整列）にし、以降の列は各行の実位置基準で続く", () => {
    // 列0: 幅1 と 幅20 で差19 > maxPadding(5) なので列0は揃えない(null)。
    // 列1 は各行が列0の実際の終端(1+1=2 と 20+1=21)から続き、
    // 幅3 と 幅1 で終端は 2+3=5 と 21+1=22、差17 > 5 なので列1も揃わない。
    const plan = computeColumnPlan(
      [
        [1, 3],
        [20, 1],
      ],
      5,
      (after) => after + 1
    );
    assert.deepStrictEqual(plan, [null, null]);
  });

  test("超過した列の直後でも差が縮まっていれば以降の列は揃う", () => {
    // 列0: 幅1 と 幅20 で差19 > maxPadding(5) なので列0は揃えない(null)。
    // 列1 は列0の実際の終端(2 と 21)からそれぞれ幅19, 0 を足すと
    // 21 と 21 で揃うので null にならず 21 に整列される。
    const plan = computeColumnPlan(
      [
        [1, 19],
        [20, 0],
      ],
      5,
      (after) => after + 1
    );
    assert.deepStrictEqual(plan, [null, 21]);
  });

  test("maxPadding 0 は無制限で常に整列する", () => {
    const plan = computeColumnPlan(
      [
        [1],
        [100],
      ],
      0,
      (after) => after + 1
    );
    assert.deepStrictEqual(plan, [100]);
  });

  test("列数が不揃いな行は自分の持つ列までしか参加しない", () => {
    const plan = computeColumnPlan(
      [
        [1, 2],
        [5],
      ],
      10,
      (after) => after + 1
    );
    assert.deepStrictEqual(plan, [5, 8]);
  });

  test("advance コールバックでタブストップ吸着など進み方をカスタムできる", () => {
    const plan = computeColumnPlan(
      [[5], [1]],
      10,
      (after) => (Math.floor(after / 4) + 1) * 4
    );
    // 列0の最大は5。advance(5) はタブストップで8に吸着する。
    assert.deepStrictEqual(plan, [5]);
  });
});

suite("visualColumn", () => {
  test("タブは次のタブストップまで展開する（tabSize 4）", () => {
    assert.strictEqual(visualColumn("\tx", 0, 4), 0); // 何もない手前
    assert.strictEqual(visualColumn("\tx", 1, 4), 4); // タブの直後
    assert.strictEqual(visualColumn("\tx", 2, 4), 5); // タブ+1文字の直後
  });

  test("タブ以外は1カラムずつ進む", () => {
    assert.strictEqual(visualColumn("abc", 3, 4), 3);
  });

  test("タブの後の文字位置はタブ展開を反映する", () => {
    // "\tab" の 'b'（文字インデックス2）は \t=4, a=5 の次なので視覚カラム5。
    assert.strictEqual(visualColumn("\tab", 2, 4), 5);
  });

  test("charIndex が行長を超えても破綻しない", () => {
    assert.strictEqual(visualColumn("ab", 10, 4), 2);
  });

  test("全角文字（East Asian Width Wide）は2カラム分進む", () => {
    // "日本語" は各文字が幅2。文字インデックス3の直前は視覚カラム6。
    assert.strictEqual(visualColumn("日本語", 3, 4), 6);
  });

  test("半角と全角が混在しても視覚幅で数える", () => {
    // "aあb": a=1, あ=2, b=1。インデックス2（bの直前）は3。
    assert.strictEqual(visualColumn("aあb", 1, 4), 1);
    assert.strictEqual(visualColumn("aあb", 2, 4), 3);
    assert.strictEqual(visualColumn("aあb", 3, 4), 4);
  });

  test("全角英字（Fullwidth）も幅2として数える", () => {
    assert.strictEqual(visualColumn("ＡＢ", 2, 4), 4);
  });

  test("絵文字（サロゲートペア）は幅2として数える", () => {
    // "😀=" の絵文字は 2 コードユニット・視覚幅 2。= の位置（インデックス2）は 2。
    assert.strictEqual(visualColumn("😀=", 2, 4), 2);
    // "a😀b": a=1, 😀=2。b（インデックス3）の視覚カラムは 3。
    assert.strictEqual(visualColumn("a😀b", 3, 4), 3);
  });

  test("CJK 拡張 B（U+20000 以降）は幅2として数える", () => {
    // "𠀀=" の 𠀀 は 2 コードユニット・視覚幅 2。
    assert.strictEqual(visualColumn("𠀀=", 2, 4), 2);
  });

  test("幅1の astral 文字（数学用英字など）は幅1として数える", () => {
    // "𝐀=" の 𝐀（U+1D400）は 2 コードユニットだが視覚幅 1。
    // コードユニット単位の走査では 2 と過大計上され整列がずれていた。
    assert.strictEqual(visualColumn("𝐀=", 2, 4), 1);
    assert.strictEqual(visualColumn("𝐀𝐁=", 4, 4), 2);
  });
});

suite("computeSliceBounds", () => {
  test("可視範囲にバッファを加えた範囲を返す", () => {
    assert.deepStrictEqual(
      computeSliceBounds(30000, 200, 210, () => false, 100, 1000),
      [100, 310]
    );
  });

  test("グループが続く間は境界まで拡張する", () => {
    const isGroupLine = (i: number) => i >= 50 && i <= 205;
    assert.deepStrictEqual(
      computeSliceBounds(30000, 200, 210, isGroupLine, 100, 1000),
      [50, 310]
    );
  });

  test("ファイル先頭・末尾でクランプする", () => {
    assert.deepStrictEqual(
      computeSliceBounds(30000, 20, 29990, () => false, 100, 1000),
      [0, 29999]
    );
  });

  test("拡張は limit で打ち切る", () => {
    assert.deepStrictEqual(
      computeSliceBounds(30000, 5000, 5010, () => true, 0, 1000),
      [4000, 6010]
    );
  });

  test("可視範囲の境界をまたぐグループがスライスでも全文スキャンと同じに揃う", () => {
    const lines: string[] = new Array<string>(20).fill("");
    lines[3] = "a = 1";
    lines[4] = "bb = 2";
    lines[5] = "ccc = 3";
    lines[6] = "dddd = 4";
    lines[7] = "e = 5";
    const isGroupLine = (i: number) =>
      findOperatorTargets(lines[i], ["="]).length > 0;
    const [s, e] = computeSliceBounds(lines.length, 5, 10, isGroupLine, 0, 1000);
    assert.strictEqual(s, 3);
    const slicePlacements = computePaddings(
      findAlignmentGroups(mockDocument(lines.slice(s, e + 1)), ["="])
    ).map((p) => ({ ...p, lineIndex: p.lineIndex + s }));
    const fullPlacements = computePaddings(
      findAlignmentGroups(mockDocument(lines), ["="])
    );
    assert.deepStrictEqual(slicePlacements, fullPlacements);
  });
});
