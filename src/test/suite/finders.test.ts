import * as assert from "assert";
import {
  findOperatorTargets,
  initialQuoteState,
  advanceQuoteState,
  advanceCommentState,
  computeLineStateBefore,
  isYamlBlockScalarContent,
  nextYamlBlockScalarState,
  computeYamlBlockScalarStateBefore,
} from "../../finders";
import { findOperatorTarget, findOperatorColumn } from "./testHelpers";

suite("advanceQuoteState", () => {
  test("文字列外の通常文字は消費しない", () => {
    const state = initialQuoteState();
    assert.strictEqual(advanceQuoteState(state, "x", new Set(['"'])), false);
    assert.strictEqual(state.quote, false);
  });

  test("quoteChars に含まれる文字で文字列を開始する", () => {
    const state = initialQuoteState();
    const quoteChars = new Set(['"']);
    assert.strictEqual(advanceQuoteState(state, '"', quoteChars), true);
    assert.strictEqual(state.quote, '"');
  });

  test("同じ引用符で文字列を終了する", () => {
    const state = initialQuoteState();
    const quoteChars = new Set(['"']);
    advanceQuoteState(state, '"', quoteChars);
    assert.strictEqual(advanceQuoteState(state, "a", quoteChars), true);
    assert.strictEqual(advanceQuoteState(state, '"', quoteChars), true);
    assert.strictEqual(state.quote, false);
  });

  test("バックスラッシュの直後の引用符はエスケープされ終了しない", () => {
    const state = initialQuoteState();
    const quoteChars = new Set(['"']);
    advanceQuoteState(state, '"', quoteChars);
    advanceQuoteState(state, "\\", quoteChars);
    assert.strictEqual(advanceQuoteState(state, '"', quoteChars), true);
    assert.strictEqual(state.quote, '"');
  });

  test("quoteChars に含まれない引用符は文字列を開始しない", () => {
    const state = initialQuoteState();
    const quoteChars = new Set(['"']);
    assert.strictEqual(advanceQuoteState(state, "'", quoteChars), false);
    assert.strictEqual(state.quote, false);
  });

  test("開始した引用符と異なる引用符は文字列を終了しない", () => {
    const state = initialQuoteState();
    const quoteChars = new Set(['"', "'"]);
    advanceQuoteState(state, "'", quoteChars);
    assert.strictEqual(advanceQuoteState(state, '"', quoteChars), true);
    assert.strictEqual(state.quote, "'");
    assert.strictEqual(advanceQuoteState(state, "'", quoteChars), true);
    assert.strictEqual(state.quote, false);
  });
});

suite("advanceCommentState", () => {
  test("コメントでない文字は false を返す", () => {
    const line = "const x = 1;";
    assert.strictEqual(
      advanceCommentState(line, 0, line[0], { cStyle: true }),
      false
    );
  });

  test("markers に一致する行頭コメントは break を返す", () => {
    const line = "# comment";
    assert.strictEqual(
      advanceCommentState(line, 0, line[0], { markers: ["#"] }),
      "break"
    );
  });

  test("markers は空白の後でのみコメント開始として扱う", () => {
    const line = "value#x";
    assert.strictEqual(
      advanceCommentState(line, 5, line[5], { markers: ["#"] }),
      false
    );
  });

  test("cStyle: // は break を返す", () => {
    const line = "a // comment";
    assert.strictEqual(
      advanceCommentState(line, 2, line[2], { cStyle: true }),
      "break"
    );
  });

  test("cStyleLineComment: false なら // はコメントとして扱わない", () => {
    const line = "url(http://example.com)";
    assert.strictEqual(
      advanceCommentState(line, 9, line[9], {
        cStyle: true,
        cStyleLineComment: false,
      }),
      false
    );
  });

  test("閉じた /* */ は閉じ位置の次のインデックスを返す", () => {
    const line = "a /* c */ b";
    const close = line.indexOf("*/");
    assert.strictEqual(
      advanceCommentState(line, 2, line[2], { cStyle: true }),
      close + 1
    );
  });

  test("閉じていない /* は break を返す", () => {
    const line = "a /* unterminated";
    assert.strictEqual(
      advanceCommentState(line, 2, line[2], { cStyle: true }),
      "break"
    );
  });
});

suite("computeLineStateBefore", () => {
  test("ブロックコメントが閉じないまま終わっていれば blockComment を返す", () => {
    const lines = ["const a = 1;", "/*", "still open"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "typescript"),
      "blockComment"
    );
  });

  test("ブロックコメントが閉じていれば code を返す", () => {
    const lines = ["/*", "comment", "*/", "const a = 1;"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "typescript"),
      "code"
    );
  });

  test("テンプレートリテラルが閉じないまま終わっていれば template を返す（TS/JS のみ）", () => {
    const lines = ["const s = `", "still open"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "typescript"),
      "template"
    );
  });

  test("テンプレートリテラルが閉じていれば code を返す", () => {
    const lines = ["const s = `", "still open", "`;"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "typescript"),
      "code"
    );
  });

  test("ブロックコメント/テンプレートリテラルを扱わない言語は常に code を返す", () => {
    const lines = ["/*", "still open"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "python"),
      "code"
    );
  });

  test("言語未指定なら C 系コメントとして扱う", () => {
    const lines = ["/*", "still open"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i]),
      "blockComment"
    );
  });

  test('Python の複数行 """ docstring が閉じないまま終わっていれば pyTripleDouble を返す', () => {
    const lines = ["def f():", '    """', "    still open"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "python"),
      "pyTripleDouble"
    );
  });

  test("Python の複数行 ''' docstring が閉じないまま終わっていれば pyTripleSingle を返す", () => {
    const lines = ["def f():", "    '''", "    still open"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "python"),
      "pyTripleSingle"
    );
  });

  test('Python の複数行 """ docstring が閉じていれば code を返す', () => {
    const lines = ["def f():", '    """', "    x = 1", '    """', "    return x"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "python"),
      "code"
    );
  });

  test('Python の # コメント内の """ は docstring の開始として扱わない', () => {
    const lines = ['x = 1  # """ not a docstring', "still open"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "python"),
      "code"
    );
  });
});

suite("computeLineStateBefore（Ruby/PHP ヒアドキュメント）", () => {
  test("Ruby: 閉じていないヒアドキュメントは終端子つきの heredoc 状態を返す", () => {
    const lines = ["sql = <<~SQL", "  SET x = 1"];
    assert.deepStrictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "ruby"),
      { kind: "heredoc", terminator: "SQL" }
    );
  });

  test("Ruby: 終端行まで含めれば code に戻る", () => {
    const lines = ["sql = <<~SQL", "  SET x = 1", "SQL"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "ruby"),
      "code"
    );
  });

  test("Ruby: <<- / 素の <<EOS / クォート付き識別子も開始として認識する", () => {
    for (const opener of ["<<-SQL", "<<SQL", '<<~"SQL"', "<<~'SQL'"]) {
      const lines = [`sql = ${opener}`, "  still open"];
      assert.deepStrictEqual(
        computeLineStateBefore(lines.length, (i) => lines[i], "ruby"),
        { kind: "heredoc", terminator: "SQL" },
        opener
      );
    }
  });

  test("Ruby: 左シフト演算子はヒアドキュメント開始と誤認しない", () => {
    const lines = ["x = 1 << 2", "still open"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "ruby"),
      "code"
    );
  });

  test("PHP: nowdoc（<<<'EOT'）が閉じていなければ heredoc 状態を返す", () => {
    const lines = ["$sql = <<<'EOT'", "  SET x = 1"];
    assert.deepStrictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "php"),
      { kind: "heredoc", terminator: "EOT" }
    );
  });

  test("PHP: heredoc（<<<EOT、クォートなし）も同様に扱う", () => {
    const lines = ["$sql = <<<EOT", "  SET x = 1"];
    assert.deepStrictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "php"),
      { kind: "heredoc", terminator: "EOT" }
    );
  });

  test("PHP: 終端行が `;` などを伴っていても終了として認識する", () => {
    const lines = ["$sql = <<<EOT", "  SET x = 1", "EOT;"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "php"),
      "code"
    );
  });

  test("Ruby/PHP 以外の言語では << はヒアドキュメントとして扱わない", () => {
    const lines = ["x = 1 <<~SQL", "still open"];
    assert.strictEqual(
      computeLineStateBefore(lines.length, (i) => lines[i], "typescript"),
      "code"
    );
  });
});

suite("findOperatorColumn", () => {
  test("単純な代入の = を見つける", () => {
    assert.strictEqual(findOperatorColumn("const x = 1;", ["="]), 8);
  });

  test("長い変数名でも正しい位置を返す", () => {
    assert.strictEqual(findOperatorColumn("const longName = 2;", ["="]), 15);
  });

  test("== を無視する", () => {
    assert.strictEqual(findOperatorColumn("if (a == b) {}", ["="]), null);
  });

  test("!= を無視する", () => {
    assert.strictEqual(findOperatorColumn("if (a != b) {}", ["="]), null);
  });

  test("<= を無視する", () => {
    assert.strictEqual(findOperatorColumn("if (a <= b) {}", ["="]), null);
  });

  test(">= を無視する", () => {
    assert.strictEqual(findOperatorColumn("if (a >= b) {}", ["="]), null);
  });

  test("=> を無視する", () => {
    assert.strictEqual(findOperatorColumn("const f = (x) => x;", ["="]), 8);
  });

  test("= がない行は null を返す", () => {
    assert.strictEqual(findOperatorColumn("console.log(x);", ["="]), null);
  });

  test("空行は null を返す", () => {
    assert.strictEqual(findOperatorColumn("", ["="]), null);
  });

  test("for 文の初期化句の `=` は無視する", () => {
    assert.strictEqual(
      findOperatorColumn("for (let i = 0; i < n; i++) {", ["="]),
      null
    );
  });

  test("関数のデフォルト引数の `=` は無視する", () => {
    assert.strictEqual(
      findOperatorColumn("function f(a = 1, b = 2) {}", ["="]),
      null
    );
  });

  test("カッコ内の `=` を無視しつつ外側の代入を検出する", () => {
    // `const ok = a == b;` の最初の `=` を返す。比較演算子の `==` は無視。
    assert.strictEqual(
      findOperatorColumn("const ok = a == b;", ["="]),
      9
    );
  });

  test("文字列内の `=` は無視する", () => {
    // `"a=b"` の中の `=` ではなく、その後ろの代入の `=` を返す
    assert.strictEqual(
      findOperatorColumn('const s = "a=b";', ["="]),
      8
    );
  });

  test("シングルクォート文字列内の `=` も無視する", () => {
    assert.strictEqual(
      findOperatorColumn("const s = 'a=b';", ["="]),
      8
    );
  });

  test("行末コメント内の `=` は無視する", () => {
    assert.strictEqual(
      findOperatorColumn("const x = 1; // y = 2", ["="]),
      8
    );
  });

  test("丸ごとコメント行は null を返す", () => {
    assert.strictEqual(findOperatorColumn("// const x = 1;", ["="]), null);
  });

  test("単一行ブロックコメント内の `=` は無視する", () => {
    assert.strictEqual(
      findOperatorColumn("const x = 1; /* y = 2 */", ["="]),
      8
    );
  });

  test("ブロックコメント内にしか `=` がない行は null を返す", () => {
    assert.strictEqual(findOperatorColumn("/* x = 1 */", ["="]), null);
  });

  test("ブロックコメントの後ろにある代入を検出する", () => {
    assert.strictEqual(
      findOperatorColumn("/* note */ const x = 1;", ["="]),
      19
    );
  });

  test("文字列内の `//` をコメント開始と誤認しない", () => {
    assert.strictEqual(
      findOperatorColumn('const url = "http://x";', ["="]),
      10
    );
  });

  test("`:` を JSON の行で検出する", () => {
    assert.strictEqual(
      findOperatorColumn('  "name": "foo",', [":"]),
      8
    );
  });

  test("文字列内の `:` は無視する", () => {
    // `"foo: bar"` の中の `:` ではなく、その後ろのキーバリュー区切りの `:` を返す
    assert.strictEqual(
      findOperatorColumn('  "foo: bar": 1', [":"]),
      12
    );
  });

  test("文字列内にしか `:` がない行は null を返す", () => {
    assert.strictEqual(
      findOperatorColumn('  "only : here"', [":"]),
      null
    );
  });

  test("エスケープされたダブルクォートを終端と誤認しない", () => {
    // "esc \": x" : 1 — \" は文字列の終端ではない。最初の生 `:` はインデックス 13
    assert.strictEqual(
      findOperatorColumn('"esc \\": x": 1', [":"]),
      11
    );
  });

  test("`:` のない JSON 行は null を返す", () => {
    assert.strictEqual(findOperatorColumn("{", [":"]), null);
  });

  test("YAML: シングルクォートキー内の `:` ではなく本来の区切りの `:` を返す", () => {
    assert.strictEqual(findOperatorColumn("'a:b': 1", [":"]), 5);
  });

  test("JSON: ダブルクォート文字列内のアポストロフィで引用符追跡が崩れない（回帰）", () => {
    assert.strictEqual(
      findOperatorColumn('  "it\'s fine": 1', [":"]),
      13
    );
  });

  test("テンプレートリテラル内の `=` は代入として検出しない", () => {
    assert.strictEqual(findOperatorColumn("`a=b`;", ["="]), null);
  });

  test("テンプレートリテラル内の `:` は CSS 宣言として検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("`color: red`;", [":"], "css"),
      null
    );
  });

  test("テンプレートリテラル内の `//` は行末コメントとして検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("x = 1; `a // b`;", ["//"]),
      null
    );
  });

  test("テンプレートリテラル内の `#` は行末コメントとして検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("x = 1 `a # b`", ["#"]),
      null
    );
  });

  test("YAML/JSON: バッククォートは文字列扱いしない（意図的な設計判断の固定）", () => {
    // JSON/YAML にバッククォートの構文はない。この関数はバッククォートを
    // 引用符として追跡しないため、行中に対になっていないバッククォートが
    // あっても本来の区切り `:` を正しく返す。
    assert.strictEqual(findOperatorColumn("`weird: 1", [":"]), 6);
  });

  test("CSS: 擬似クラスの `:` ではなく宣言の `:` を返す", () => {
    // `a:hover { color: red; }` の宣言 `:`（列15）を返す。`a:hover` の `:`（列1）は対象外。
    assert.strictEqual(
      findOperatorColumn("a:hover { color: red; }", [":"], "css"),
      15
    );
  });

  test("CSS: 擬似要素 `::before` の `:` を対象にしない", () => {
    assert.strictEqual(
      findOperatorColumn('.foo::before { content: ""; }', [":"], "css"),
      22
    );
  });

  test("CSS: url() 内の `:` ではなくプロパティの `:` を返す", () => {
    assert.strictEqual(
      findOperatorColumn("  background: url(http://a.b/c)", [":"], "css"),
      12
    );
  });

  test("CSS: ブロックのない宣言行は最初の `:` を返す", () => {
    assert.strictEqual(findOperatorColumn("  color: red;", [":"], "css"), 7);
  });

  test("CSS: 値が空でない `:` のない行は null を返す", () => {
    assert.strictEqual(findOperatorColumn("a:hover {", [":"], "css"), null);
  });

  test("languageId 未指定なら CSS 用検出は使わない（従来どおり最初の `:`）", () => {
    assert.strictEqual(
      findOperatorColumn("a:hover { color: red; }", [":"]),
      1
    );
  });

  test("SCSS: `//` 行コメント内の `:` は対象外", () => {
    assert.strictEqual(
      findOperatorColumn("// color: red", [":"], "scss"),
      null
    );
  });

  test("LESS: `//` 行コメント内の `:` は対象外", () => {
    assert.strictEqual(
      findOperatorColumn("// color: red", [":"], "less"),
      null
    );
  });

  test("SCSS: 宣言後の `//` コメントは宣言の `:` を返す", () => {
    assert.strictEqual(
      findOperatorColumn("color: red; // note", [":"], "scss"),
      5
    );
  });

  test("CSS: `//` はコメントではないため値中でも宣言の `:` に影響しない", () => {
    assert.strictEqual(
      findOperatorColumn("color: red // not a comment", [":"], "css"),
      5
    );
  });

  test("CSS: ブロックコメント `/* */` 内の `:` は対象外", () => {
    assert.strictEqual(findOperatorColumn("/* a: b */", [":"], "css"), null);
  });

  test("CSS: ブロックコメントの後ろにある宣言の `:` を返す", () => {
    assert.strictEqual(
      findOperatorColumn("/* note */ color: red;", [":"], "css"),
      16
    );
  });

  test("TS: 型注釈の `:` を検出する", () => {
    assert.strictEqual(
      findOperatorColumn("const x: number = 1;", [":"], "typescript"),
      7
    );
  });

  test("TS: interface プロパティの `:` を検出する", () => {
    assert.strictEqual(
      findOperatorColumn("  name: string;", [":"], "typescript"),
      6
    );
  });

  test("TS: 関数引数の型注釈の `:` を検出する", () => {
    // `function f(a: number) {}` の `a:` の `:`（列12）を返す
    assert.strictEqual(
      findOperatorColumn("function f(a: number) {}", [":"], "typescript"),
      12
    );
  });

  test("JS: オブジェクトリテラルの `key:` の `:` を検出する", () => {
    assert.strictEqual(
      findOperatorColumn("  id: 1,", [":"], "javascript"),
      4
    );
  });

  test("TS: オプショナルプロパティ `?:` の `:` を型コロンとして検出する", () => {
    // `name?: string` の `?` は三項演算子ではなくオプショナルマーカー。`:`（列7）を返す
    assert.strictEqual(
      findOperatorColumn("  name?: string;", [":"], "typescript"),
      7
    );
  });

  test("TS: 三項演算子の `:` は対象外（型コロンがなければ null）", () => {
    assert.strictEqual(
      findOperatorColumn("const x = cond ? a : b;", [":"], "typescript"),
      null
    );
  });

  test("TS: 型コロンの後に三項演算子があっても型コロンを返す", () => {
    // `const x: number = cond ? a : b;` の型注釈 `:`（列7）を返す
    assert.strictEqual(
      findOperatorColumn("const x: number = cond ? a : b;", [":"], "typescript"),
      7
    );
  });

  test("TS: 文字列内の `:` は対象外", () => {
    assert.strictEqual(
      findOperatorColumn('const s = "a: b";', [":"], "typescript"),
      null
    );
  });

  test("TS: 行コメント内の `:` は対象外", () => {
    assert.strictEqual(
      findOperatorColumn("// id: number", [":"], "typescript"),
      null
    );
  });

  test("TS: ブロックコメント内の `:` は対象外、後続の型コロンを返す", () => {
    assert.strictEqual(
      findOperatorColumn("/* a: b */ id: number", [":"], "typescript"),
      13
    );
  });

  test("TS: オプショナルチェイニング `?.` は三項演算子扱いしない", () => {
    // `?.` は三項の `?` ではないので、後続の型コロン `x:`（列22）を返す
    assert.strictEqual(
      findOperatorColumn("const v = a?.b as { x: number };", [":"], "typescript"),
      21
    );
  });

  test("行末コメント `//` の位置を返す", () => {
    assert.strictEqual(findOperatorColumn("const x = 1; // note", ["//"]), 13);
  });

  test("丸ごとコメント行の `//` は対象外", () => {
    assert.strictEqual(findOperatorColumn("// just a comment", ["//"]), null);
  });

  test("インデント付きの丸ごとコメント行も対象外", () => {
    assert.strictEqual(findOperatorColumn("   // comment", ["//"]), null);
  });

  test("文字列内の `//` は拾わない", () => {
    assert.strictEqual(findOperatorColumn('const u = "a//b";', ["//"]), null);
  });

  test("URL（http://）の `//` は拾わない", () => {
    assert.strictEqual(findOperatorColumn("const u = http://x", ["//"]), null);
  });

  test("ブロックコメント内の `//` は拾わない", () => {
    assert.strictEqual(findOperatorColumn("x = 1; /* a // b */", ["//"]), null);
  });

  test("行末コメント `#` の位置を返す", () => {
    assert.strictEqual(findOperatorColumn("x = 1 # note", ["#"]), 6);
  });

  test("丸ごとコメント行の `#` は対象外", () => {
    assert.strictEqual(findOperatorColumn("# comment", ["#"]), null);
  });

  test("空白前置のない `#` は行末コメント扱いしない", () => {
    assert.strictEqual(findOperatorColumn("value#x", ["#"]), null);
  });

  test("文字列内の `#` は拾わない", () => {
    assert.strictEqual(findOperatorColumn('name = "a#b"', ["#"]), null);
  });

  test("operators の並び順が優先度になる（先頭が優先）", () => {
    // `=` を先に置けば代入の `=`、`//` を先に置けば行末コメントを返す
    assert.strictEqual(findOperatorColumn("x = 1; // c", ["=", "//"]), 2);
    assert.strictEqual(findOperatorColumn("x = 1; // c", ["//", "="]), 7);
  });

  test("汎用フォールバック: `=`/`:`/`//`/`#`/`=>` 以外の演算子はリテラル一致で検出する", () => {
    assert.strictEqual(findOperatorColumn("a -> b -> c", ["->"]), 2);
  });

  test("汎用フォールバック: 一致しなければ null を返す", () => {
    assert.strictEqual(findOperatorColumn("const x = 1;", ["->"]), null);
  });

  test("汎用フォールバックは文字列内のリテラルも区別なく検出する（文字列/コメント考慮なし）", () => {
    assert.strictEqual(findOperatorColumn('const s = "a->b";', ["->"]), 12);
  });

  test("`=>` はアロー関数の位置を返す", () => {
    assert.strictEqual(findOperatorColumn("const f = (x) => x;", ["=>"]), 14);
  });

  test("`=>` は代入の `=` を誤検出しない", () => {
    assert.strictEqual(findOperatorColumn("const x = 1;", ["=>"]), null);
  });

  test("`=>` は括弧内のアロー関数も検出する", () => {
    assert.strictEqual(findOperatorColumn("arr.map((x) => x);", ["=>"]), 12);
  });

  test("`=>` は文字列内を対象外にする", () => {
    assert.strictEqual(findOperatorColumn('const s = "a => b";', ["=>"]), null);
  });

  test("`=>` は行コメント内を対象外にする", () => {
    assert.strictEqual(findOperatorColumn("const x = 1; // a => b", ["=>"]), null);
  });

  test("`=>` はブロックコメント内を対象外にする", () => {
    assert.strictEqual(findOperatorColumn("/* a => b */", ["=>"]), null);
  });

  test("宇宙船演算子 `<=>` を `=>` として誤検出しない", () => {
    assert.strictEqual(findOperatorColumn("a <=> b", ["=>"]), null);
  });

  test("宇宙船演算子 `<=>` を含んでいてもハッシュロケット `=>` は検出する", () => {
    assert.strictEqual(findOperatorColumn("a <=> b, c => d", ["=>"]), 11);
  });

  test("複合代入 `+=` は = の位置（揃え列）を返す", () => {
    assert.strictEqual(findOperatorColumn("x += 1", ["="]), 3);
  });

  test("`#` コメント言語では丸ごとコメント行の `=` を検出しない", () => {
    for (const lang of [
      "python",
      "shellscript",
      "ruby",
      "makefile",
      "toml",
      "dotenv",
      "properties",
      "ini",
    ]) {
      assert.strictEqual(
        findOperatorColumn("# default = 3", ["="], lang),
        null,
        lang
      );
    }
  });

  test("`#` コメント言語ではインデント付きコメント行も検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("  # x = 1", ["="], "python"),
      null
    );
  });

  test("INI の `;` コメント行の `=` を検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("; key = value", ["="], "ini"),
      null
    );
  });

  test("トレーリング `#` コメントより前の `=` は従来どおり検出する", () => {
    assert.strictEqual(
      findOperatorColumn("x = 1  # old = 2", ["="], "python"),
      2
    );
  });

  test("空白前置のない `#` はコメント扱いしない（shell の $# など）", () => {
    assert.strictEqual(
      findOperatorColumn("x=$#y", ["="], "shellscript"),
      1
    );
  });

  test("文字列内の `#` はコメント開始にならない", () => {
    assert.strictEqual(
      findOperatorColumn('s = "# not comment"', ["="], "python"),
      2
    );
  });

  test('同一行で閉じる triple-quote は従来通り = を検出する（Python）', () => {
    assert.strictEqual(
      findOperatorColumn('x = """oneline"""', ["="], "python"),
      2
    );
  });

  test("`#` コメント言語では `//` をコメント扱いしない（Python の切り捨て除算）", () => {
    assert.strictEqual(
      findOperatorColumn("y = a // b", ["="], "python"),
      2
    );
  });

  test("languageId なしでは従来どおり `#` をコメント扱いしない", () => {
    assert.strictEqual(findOperatorColumn("# x = 1", ["="]), 4);
  });

  test("Lua: `--` コメント行の `=` を検出しない", () => {
    assert.strictEqual(findOperatorColumn("-- x = 1", ["="], "lua"), null);
  });

  test("Lua: トレーリング `--` コメントより前の `=` は検出する", () => {
    assert.strictEqual(
      findOperatorColumn("x = 1 -- old = 2", ["="], "lua"),
      2
    );
  });

  test("Lua: 減算の `-` はコメント扱いしない", () => {
    assert.strictEqual(findOperatorColumn("x = a - b", ["="], "lua"), 2);
  });

  test("Lua: 比較演算子 `~=` を代入として検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("if a ~= b then", ["="], "lua"),
      null
    );
  });

  test("PHP: `#` コメント行の `=` を検出しない", () => {
    assert.strictEqual(findOperatorColumn("# x = 1", ["="], "php"), null);
  });

  test("PHP: `//` コメント行の `=` も検出しない（C スタイル併用）", () => {
    assert.strictEqual(findOperatorColumn("// x = 1", ["="], "php"), null);
  });

  test("PHP: 単一行ブロックコメント内の `=` も検出しない", () => {
    assert.strictEqual(findOperatorColumn("/* x = 1 */", ["="], "php"), null);
  });

  test("YAML: 丸ごとコメント行の `:` を検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("# key: value", [":"], "yaml"),
      null
    );
  });

  test("YAML: インデント付きコメント行の `:` も検出しない", () => {
    assert.strictEqual(findOperatorColumn("  # a: b", [":"], "yaml"), null);
  });

  test("YAML: トレーリングコメントより前の `:` は従来どおり検出する", () => {
    assert.strictEqual(
      findOperatorColumn("key: 1  # note: x", [":"], "yaml"),
      3
    );
  });

  test("YAML: 空白前置のない `#` はコメント扱いしない", () => {
    assert.strictEqual(findOperatorColumn("a#b: 1", [":"], "yaml"), 3);
  });

  test("JSONC: `//` 行コメント内の `:` を検出しない", () => {
    assert.strictEqual(
      findOperatorColumn('// "a": 1', [":"], "jsonc"),
      null
    );
  });

  test("JSONC: 単一行ブロックコメント内の `:` を検出しない", () => {
    assert.strictEqual(
      findOperatorColumn('/* "a": 1 */', [":"], "jsonc"),
      null
    );
  });

  test("JSONC: ブロックコメントの後ろの `:` は検出する", () => {
    assert.strictEqual(
      findOperatorColumn('/* x */ "a": 1', [":"], "jsonc"),
      11
    );
  });

  test("JSON: コメント構文がないため `#` の後の `:` も従来どおり検出する", () => {
    assert.strictEqual(findOperatorColumn("# x: 1", [":"], "json"), 3);
  });
});

suite("findOperatorTarget", () => {
  test("単純代入は insert と align が一致する", () => {
    assert.deepStrictEqual(findOperatorTarget("const x = 1;", ["="]), {
      insert: 8,
      align: 8,
    });
  });

  test("`+=` は演算子先頭が insert、`=` が align になる", () => {
    assert.deepStrictEqual(findOperatorTarget("x += 1", ["="]), {
      insert: 2,
      align: 3,
    });
  });

  test("`-=` `*=` `/=` `%=` `&=` `|=` `^=` も演算子先頭が insert になる", () => {
    for (const op of ["-", "*", "/", "%", "&", "|", "^"]) {
      assert.deepStrictEqual(
        findOperatorTarget(`x ${op}= 1`, ["="]),
        { insert: 2, align: 3 },
        op
      );
    }
  });

  test("Makefile の `:=` を分断しない", () => {
    assert.deepStrictEqual(findOperatorTarget("VAR := 1", ["="]), {
      insert: 4,
      align: 5,
    });
  });

  test("Makefile の `?=` を分断しない", () => {
    assert.deepStrictEqual(findOperatorTarget("LONGVAR ?= 2", ["="]), {
      insert: 8,
      align: 9,
    });
  });

  test("`**=` `||=` `&&=` `??=` は2文字前が insert になる", () => {
    for (const op of ["**", "||", "&&", "??"]) {
      assert.deepStrictEqual(
        findOperatorTarget(`x ${op}= 1`, ["="]),
        { insert: 2, align: 4 },
        op
      );
    }
  });

  test("`<<=` `>>=` は複合代入として検出する（比較 `<=` `>=` と区別）", () => {
    assert.deepStrictEqual(findOperatorTarget("x <<= 1", ["="]), {
      insert: 2,
      align: 4,
    });
    assert.deepStrictEqual(findOperatorTarget("x >>= 1", ["="]), {
      insert: 2,
      align: 4,
    });
  });

  test("比較演算子 `==` `!=` `<=` `>=` は引き続き対象外", () => {
    for (const line of ["a == b", "a != b", "a <= b", "a >= b"]) {
      assert.strictEqual(findOperatorTarget(line, ["="]), null, line);
    }
  });

  test("`=>` は引き続き対象外", () => {
    assert.strictEqual(findOperatorTarget("() => 1", ["="]), null);
  });

  test("Ruby の正規表現マッチ `=~` は代入として検出しない", () => {
    assert.strictEqual(findOperatorTarget("a =~ /x/", ["="], "ruby"), null);
  });

  test("C++: 桁区切りの `'`（奇数個）が文字列開始と誤認されず後続の `=` を検出する", () => {
    const target = findOperatorTarget("f(1'000); y = 2;", ["="], "cpp");
    assert.deepStrictEqual(target, { insert: 12, align: 12 });
  });

  test("C: 桁区切りの `'` は 0x 付き16進数でも文字列開始と誤認しない", () => {
    const target = findOperatorTarget("f(0x1'000); y = 2;", ["="], "c");
    assert.deepStrictEqual(target, { insert: 14, align: 14 });
  });

  test("C++: char リテラル `'='` 内の `=` は引き続き文字列として除外する（回帰）", () => {
    assert.deepStrictEqual(
      findOperatorTargets("char c = '=';", ["="], "cpp"),
      [{ opIndex: 0, insert: 7, align: 7 }]
    );
  });

  test("`=` を含む多文字演算子は代入として検出しない（網羅）", () => {
    const lines = [
      "a == b",
      "a === b",
      "a != b",
      "a !== b",
      "a <= b",
      "a >= b",
      "a => b",
      "a =~ b",
      "a ~= b",
    ];
    for (const line of lines) {
      assert.deepStrictEqual(findOperatorTargets(line, ["="]), [], line);
    }
  });

  test("Swift: `!=` を代入として検出しない", () => {
    assert.strictEqual(
      findOperatorTarget("if a != b {", ["="], "swift"),
      null
    );
  });

  test("Swift: nil 結合代入 `??=` を分断しない", () => {
    assert.deepStrictEqual(
      findOperatorTarget("value ??= 1", ["="], "swift"),
      { insert: 6, align: 8 }
    );
  });

  test("Kotlin: 参照等価 `===` / `!==` を代入として検出しない", () => {
    assert.strictEqual(findOperatorTarget("a === b", ["="], "kotlin"), null);
    assert.strictEqual(findOperatorTarget("a !== b", ["="], "kotlin"), null);
  });

  test("Dart: null 結合代入 `??=` を分断しない", () => {
    assert.deepStrictEqual(
      findOperatorTarget("value ??= 1;", ["="], "dart"),
      { insert: 6, align: 8 }
    );
  });

  test("Zig: `!=` を代入として検出しない", () => {
    assert.strictEqual(
      findOperatorTarget("if (a != b) {", ["="], "zig"),
      null
    );
  });

  test("`=` 以外の演算子は insert と align が常に一致する", () => {
    assert.deepStrictEqual(findOperatorTarget('  "a": 1', [":"]), {
      insert: 5,
      align: 5,
    });
  });

  test("Python の `//=`（切り捨て除算代入）を分断しない", () => {
    assert.deepStrictEqual(findOperatorTarget("x //= 2", ["="], "python"), {
      insert: 2,
      align: 4,
    });
  });

  test("PHP の `.=`（文字列連結代入）を分断しない", () => {
    assert.deepStrictEqual(
      findOperatorTarget('$s .= "x";', ["="], "php"),
      { insert: 3, align: 4 }
    );
  });

  test("Rust の `..=`（閉区間レンジ）は代入として検出しない", () => {
    assert.strictEqual(
      findOperatorTarget("for i in 0..=n {", ["="], "rust"),
      null
    );
  });
});

suite("findOperatorTargets", () => {
  test("複数演算子をリスト順にカラムとして返す", () => {
    assert.deepStrictEqual(
      findOperatorTargets("x = 1  # a", ["=", "#"], "python"),
      [
        { opIndex: 0, insert: 2, align: 2 },
        { opIndex: 1, insert: 7, align: 7 },
      ]
    );
  });

  test("後段の演算子は前段より後方の出現だけを対象にする", () => {
    // "//" が先頭カラムのとき、その手前にある `=` は第2カラムにならない
    assert.deepStrictEqual(
      findOperatorTargets("x = 1; // c", ["//", "="]),
      [{ opIndex: 0, insert: 7, align: 7 }]
    );
  });

  test("見つからない演算子はスキップして次の演算子を探す", () => {
    // `#` がない行でも `=>` は第3カラムとして拾われる
    assert.deepStrictEqual(
      findOperatorTargets("const f = (x) => x;", ["=", "#", "=>"]),
      [
        { opIndex: 0, insert: 8, align: 8 },
        { opIndex: 2, insert: 14, align: 14 },
      ]
    );
  });

  test("先頭の演算子がない行は後段の演算子だけを返す", () => {
    assert.deepStrictEqual(
      findOperatorTargets("foo(1)  # b", ["=", "#"], "python"),
      [{ opIndex: 1, insert: 8, align: 8 }]
    );
  });

  test("同じ演算子を2回並べると2つ目の出現が第2カラムになる", () => {
    assert.deepStrictEqual(findOperatorTargets("a -> b -> c", ["->", "->"]), [
      { opIndex: 0, insert: 2, align: 2 },
      { opIndex: 1, insert: 7, align: 7 },
    ]);
  });

  test("演算子が1つも見つからなければ空配列", () => {
    assert.deepStrictEqual(findOperatorTargets("foo()", ["=", "#"]), []);
  });

  test("複合代入は第1カラムでも insert/align を分けて返す", () => {
    assert.deepStrictEqual(
      findOperatorTargets("x += 1  # a", ["=", "#"], "python"),
      [
        { opIndex: 0, insert: 2, align: 3 },
        { opIndex: 1, insert: 8, align: 8 },
      ]
    );
  });

  test("コメント内の後段演算子は対象にならない", () => {
    // python: # 以降はコメントなので、その中の 2 個目の # は… 1個目が
    // トレーリングコメントとして第2カラムになるのみ
    assert.deepStrictEqual(
      findOperatorTargets("x = 1  # a = 2", ["=", "="], "python"),
      [{ opIndex: 0, insert: 2, align: 2 }]
    );
  });

  test("blockComment 状態から開始すると閉じるまでの内容は無視する", () => {
    assert.deepStrictEqual(
      findOperatorTargets("comment */ x = 1", ["="], undefined, "blockComment"),
      [{ opIndex: 0, insert: 13, align: 13 }]
    );
  });

  test("blockComment 状態のまま行内で閉じなければ演算子は検出しない", () => {
    assert.deepStrictEqual(
      findOperatorTargets("still a = 1 comment", ["="], undefined, "blockComment"),
      []
    );
  });

  test("template 状態から開始すると閉じるまでの内容は無視する", () => {
    assert.deepStrictEqual(
      findOperatorTargets("abc` x = 1", ["="], "typescript", "template"),
      [{ opIndex: 0, insert: 7, align: 7 }]
    );
  });

  test("pyTripleDouble 状態から開始すると閉じるまでの内容は無視する", () => {
    assert.deepStrictEqual(
      findOperatorTargets('still docstring """ x = 1', ["="], "python", "pyTripleDouble"),
      [{ opIndex: 0, insert: 22, align: 22 }]
    );
  });

  test("pyTripleDouble 状態のまま行内で閉じなければ演算子は検出しない", () => {
    assert.deepStrictEqual(
      findOperatorTargets("still x = 1 docstring", ["="], "python", "pyTripleDouble"),
      []
    );
  });

  test('pyTripleSingle は """ では閉じない（引用符の種類を区別する）', () => {
    assert.deepStrictEqual(
      findOperatorTargets('still """ not closing x = 1', ["="], "python", "pyTripleSingle"),
      []
    );
  });

  test("同一行 triple-quote 内に奇数個の埋め込み引用符があっても誤検出しない（Python）", () => {
    assert.deepStrictEqual(
      findOperatorTargets('x = """a "quote example = 1"""', ["=", "="], "python"),
      [{ opIndex: 0, insert: 2, align: 2 }]
    );
  });

  test("template 状態のまま行内で閉じなければ演算子は検出しない", () => {
    assert.deepStrictEqual(
      findOperatorTargets("still x = 1 template", ["="], "typescript", "template"),
      []
    );
  });
});

suite("YAML ブロックスカラー継続状態", () => {
  test("`key: |` の次の行はインデントが深ければブロックスカラーの中身", () => {
    const state = nextYamlBlockScalarState("b: |", null);
    assert.strictEqual(state, 0);
    assert.strictEqual(
      isYamlBlockScalarContent("  make target: build", state),
      true
    );
  });

  test("`key: >` でも同様に扱う", () => {
    const state = nextYamlBlockScalarState("b: >", null);
    assert.strictEqual(isYamlBlockScalarContent("  folded: text", state), true);
  });

  test("chomping indicator（`|-` `|+` `>-` `>+`）つきでも認識する", () => {
    for (const header of ["b: |-", "b: |+", "b: >-", "b: >+"]) {
      assert.strictEqual(nextYamlBlockScalarState(header, null), 0, header);
    }
  });

  test("インデントがキー行以下に戻った行はブロックスカラーの中身ではない", () => {
    const opened = nextYamlBlockScalarState("b: |", null);
    const afterContent = nextYamlBlockScalarState(
      "  make target: build",
      opened
    );
    assert.strictEqual(isYamlBlockScalarContent("c: 2", afterContent), false);
  });

  test("空行・空白のみの行はブロックスカラーの継続として扱う", () => {
    const opened = nextYamlBlockScalarState("b: |", null);
    assert.strictEqual(isYamlBlockScalarContent("", opened), true);
    assert.strictEqual(isYamlBlockScalarContent("   ", opened), true);
  });

  test("クォートされた値やコメント行は誤ってブロックスカラーの開始と認識しない", () => {
    assert.strictEqual(nextYamlBlockScalarState('b: ">"', null), null);
    assert.strictEqual(nextYamlBlockScalarState("  # key: |", null), null);
  });

  test("通常の YAML 行（ブロックスカラーでない）は null のまま", () => {
    assert.strictEqual(nextYamlBlockScalarState("a: 1", null), null);
  });

  test("computeYamlBlockScalarStateBefore はスライス開始行より前から続くブロックスカラーの基準インデントを返す", () => {
    const lines = ["a: 1", "b: |", "  make target: build"];
    assert.strictEqual(
      computeYamlBlockScalarStateBefore(lines.length, (i) => lines[i]),
      0
    );
  });

  test("computeYamlBlockScalarStateBefore はブロックスカラーが閉じていれば null を返す", () => {
    const lines = ["a: 1", "b: |", "  content", "c: 2"];
    assert.strictEqual(
      computeYamlBlockScalarStateBefore(lines.length, (i) => lines[i]),
      null
    );
  });
});

suite("findOperatorTargets: 行末の継続マーカー `\\`", () => {
  test("行末の `\\` を検出する", () => {
    const line = "CFLAGS = -Wall -Wextra \\";
    assert.deepStrictEqual(findOperatorTargets(line, ["\\"]), [
      { opIndex: 0, insert: line.length - 1, align: line.length - 1 },
    ]);
  });

  test("`\\` の後ろに空白があっても最後の非空白文字なら検出する", () => {
    const line = "SOURCES = foo.c \\   ";
    assert.deepStrictEqual(findOperatorTargets(line, ["\\"]), [
      { opIndex: 0, insert: 16, align: 16 },
    ]);
  });

  test("`\\` がない行は空配列", () => {
    assert.deepStrictEqual(findOperatorTargets("echo done", ["\\"]), []);
  });

  test("行の途中の `\\`（末尾ではない）は検出しない", () => {
    assert.deepStrictEqual(
      findOperatorTargets("echo \\ foo", ["\\"]),
      []
    );
  });

  test("未終端の文字列内で終わる `\\` はエスケープとして扱い検出しない", () => {
    assert.deepStrictEqual(
      findOperatorTargets('const s = "abc\\', ["\\"]),
      []
    );
  });

  test("行全体がコメントの `\\` は検出しない（shellscript の `#` コメント）", () => {
    assert.deepStrictEqual(
      findOperatorTargets("# comment continues \\", ["\\"], "shellscript"),
      []
    );
  });

  test("C/C++ の `#define` 継続行は `#` をコメントとして扱わず検出する", () => {
    const line = "#define ADD(a, b) \\";
    assert.deepStrictEqual(findOperatorTargets(line, ["\\"], "c"), [
      { opIndex: 0, insert: line.length - 1, align: line.length - 1 },
    ]);
  });

  test("Makefile の継続行を検出する", () => {
    const line = "SOURCES = foo.c \\";
    assert.deepStrictEqual(findOperatorTargets(line, ["\\"], "makefile"), [
      { opIndex: 0, insert: line.length - 1, align: line.length - 1 },
    ]);
  });

  test("C++14 の桁区切り `'`（例: 1'000、奇数個の `'`）があっても文字列開始と誤認せず継続行として検出する", () => {
    const line = "#define BIG 1'000 \\";
    assert.deepStrictEqual(findOperatorTargets(line, ["\\"], "cpp"), [
      { opIndex: 0, insert: line.length - 1, align: line.length - 1 },
    ]);
  });
});
