import * as assert from "assert";
import {
  findOperatorTargets,
  findAssignmentEquals,
  initialQuoteState,
  advanceQuoteState,
  advanceCommentState,
  computeLineStateBefore,
  isYamlBlockScalarContent,
  nextYamlBlockScalarState,
  computeYamlBlockScalarStateBefore,
  isWholeLineComment,
  computeLineScanStateBefore,
  LineScanCheckpointCache,
  nextTsBraceState,
  TsBraceState,
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

suite("isWholeLineComment", () => {
  test("`//` 全行コメントは true", () => {
    assert.strictEqual(isWholeLineComment("// comment", undefined, "code"), true);
  });

  test("先頭に空白があっても `//` 全行コメントなら true", () => {
    assert.strictEqual(isWholeLineComment("   // comment", undefined, "code"), true);
  });

  test("`#`（Python）の全行コメントは true", () => {
    assert.strictEqual(isWholeLineComment("# comment", "python", "code"), true);
  });

  test("`#`（YAML）の全行コメントも true（resolveDocScanOptions ではなく lineCommentMarkers を直接参照）", () => {
    assert.strictEqual(isWholeLineComment("# comment", "yaml", "code"), true);
  });

  test("コード付き行末コメントは false（全行コメントではない）", () => {
    assert.strictEqual(
      isWholeLineComment("const x = 1; // comment", undefined, "code"),
      false
    );
  });

  test("空行は false", () => {
    assert.strictEqual(isWholeLineComment("", undefined, "code"), false);
  });

  test("空白のみの行は false", () => {
    assert.strictEqual(isWholeLineComment("   ", undefined, "code"), false);
  });

  test("実コードのみの行は false", () => {
    assert.strictEqual(isWholeLineComment("const x = 1;", undefined, "code"), false);
  });

  test("1行で閉じるブロックコメントだけの行は true", () => {
    assert.strictEqual(isWholeLineComment("/* note */", "typescript", "code"), true);
  });

  test("1行で閉じないブロックコメント開始行は true", () => {
    assert.strictEqual(isWholeLineComment("/*", "typescript", "code"), true);
  });

  test("blockComment 状態で始まり閉じずに終わる行は true", () => {
    assert.strictEqual(
      isWholeLineComment(" * still open", "typescript", "blockComment"),
      true
    );
  });

  test("blockComment 状態で始まり閉じた後は空白のみなら true", () => {
    assert.strictEqual(
      isWholeLineComment(" */  ", "typescript", "blockComment"),
      true
    );
  });

  test("blockComment 状態で始まり閉じた後に実コードがあれば false", () => {
    assert.strictEqual(
      isWholeLineComment(" */ const x = 1;", "typescript", "blockComment"),
      false
    );
  });

  test("template / triple-quote 状態はコメントではないので false", () => {
    assert.strictEqual(isWholeLineComment("still open", "typescript", "template"), false);
    assert.strictEqual(
      isWholeLineComment("still open", "python", "pyTripleDouble"),
      false
    );
  });

  test("heredoc 状態はコメントではないので false", () => {
    assert.strictEqual(
      isWholeLineComment("SET x = 1", "ruby", { kind: "heredoc", terminator: "SQL" }),
      false
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

  test("TS: `case X:` のラベルコロンは対象外", () => {
    assert.strictEqual(
      findOperatorColumn("  case 1:", [":"], "typescript"),
      null
    );
  });

  test("TS: `default:` のラベルコロンは対象外", () => {
    assert.strictEqual(
      findOperatorColumn("  default:", [":"], "typescript"),
      null
    );
  });

  test("TS: `case X: return ...;` の行にラベルコロン以外の `:` がなければ対象外", () => {
    assert.strictEqual(
      findOperatorColumn("  case 1: return a;", [":"], "typescript"),
      null
    );
  });

  test("TS: `case X:` 行の後続コロン（オブジェクトリテラル等）は対象のまま", () => {
    // `case 1: obj = { a: 1 };` のラベルコロンは除外し、`a:`（列19）を返す
    assert.strictEqual(
      findOperatorColumn("  case 1: obj = { a: 1 };", [":"], "typescript"),
      19
    );
  });

  test("TS: `case` の値部分の三項演算子とラベルコロンをどちらも除外する", () => {
    assert.strictEqual(
      findOperatorColumn("  case cond ? 1 : 2:", [":"], "typescript"),
      null
    );
  });

  test("TS: `case` で始まらない識別子（`caseValue:`）は通常のコロンとして検出する", () => {
    assert.strictEqual(
      findOperatorColumn("  caseValue: 1,", [":"], "typescript"),
      11
    );
  });

  test("TS: `default` を含むが `default:` ラベルではない行（型注釈）は通常のコロンとして検出する", () => {
    assert.strictEqual(
      findOperatorColumn("  defaultValue: 1,", [":"], "typescript"),
      14
    );
  });

  test("TS: `case` という名前のプロパティキー（コロン前に空白あり）は通常のコロンとして検出する", () => {
    // `case : 1,` は `case` の直後が空白のみでコロンに続くため、実際は
    // case 式を持たない（switch のラベルにはなり得ない）プロパティキー。
    // コロン（列7）を返す
    assert.strictEqual(
      findOperatorColumn("  case : 1,", [":"], "typescript"),
      7
    );
  });

  test("TS: `default` という名前のプロパティキー（末尾カンマあり）は通常のコロンとして検出する", () => {
    // `default: 1,` は switch のラベルではなくオブジェクト/型のプロパティ。
    // 末尾カンマを手がかりにラベル扱いせず、コロン（列9）を返す
    assert.strictEqual(
      findOperatorColumn("  default: 1,", [":"], "typescript"),
      9
    );
  });

  test("TS: `default` プロパティの末尾カンマの後ろに行末コメントがあっても通常のコロンとして検出する", () => {
    // `default: 1, // note` はカンマの後ろにコメントが続く。ラベル判定の
    // 「末尾カンマ」チェックはコメントを除いて見るので、プロパティとして
    // 扱われコロン（列9）を返す
    assert.strictEqual(
      findOperatorColumn("  default: 1, // note", [":"], "typescript"),
      9
    );
  });

  test("TS: `default` プロパティの値に途中のブロックコメントがあっても末尾コメントだけを取り除く", () => {
    // `default: fn(/*x*/), /* note */` の末尾カンマ判定は末尾のブロック
    // コメントだけを取り除くべきで、貪欲マッチだと先頭の `/*x*/` まで
    // 巻き込んでカンマが見えなくなってしまう。プロパティとして扱われ
    // コロン（列9）を返す
    assert.strictEqual(
      findOperatorColumn("  default: fn(/*x*/), /* note */", [":"], "typescript"),
      9
    );
  });

  test("TS: `default` プロパティの値に `//` を含む文字列（URL等）があっても末尾コメントと誤認しない", () => {
    // `default: "http://x", // note` の値の中の `//` はコメントではない。
    // 末尾カンマ判定は文字列を認識した上で行末コメントだけを取り除くので、
    // プロパティとして扱われコロン（列9）を返す
    assert.strictEqual(
      findOperatorColumn('  default: "http://x", // note', [":"], "typescript"),
      9
    );
  });

  test("TS: `case` とラベル値の間にブロックコメントが直接続いてもラベルコロンは対象外", () => {
    // `case/*comment*/1:` はコメントが空白の代わりに `case` の直後に来る書き方。
    // 字句上は空白と等価なので、通常の `case 1:` と同じくラベルコロン（列18）を除外する
    assert.strictEqual(
      findOperatorColumn("  case/*comment*/1:", [":"], "typescript"),
      null
    );
  });

  test("TS: 既知の制約 — 周囲の行のコンテキストなしで `default: string;` 単体を渡すとラベル扱いになる", () => {
    // findOperatorColumn はこの行だけを渡すため、周囲の `{...}` が switch 本体か
    // オブジェクト/型リテラルかを示すクロスライン情報（tsBraceTop）がない。
    // その場合は元のヒューリスティック（末尾カンマの有無）にフォールバックし、
    // 末尾カンマのない `default: string;` はラベル扱いのまま。実際のドキュメント
    // スキャン（LineScanState の tsBraces、#345）ではこの行を含む `interface`/
    // オブジェクトリテラルの `{` が追跡されるため、この制約は発生しない
    // （findAlignmentGroups の "TS: インターフェースの `default` メンバー..." テスト参照）
    assert.strictEqual(
      findOperatorColumn("  default: string;", [":"], "typescript"),
      null
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

  test("行末コメント `--`（Lua/SQL）の位置を返す", () => {
    assert.strictEqual(findOperatorColumn("x = 1 -- note", ["--"]), 6);
  });

  test("丸ごとコメント行の `--` は対象外", () => {
    assert.strictEqual(findOperatorColumn("-- just a comment", ["--"]), null);
  });

  test("空白前置のない `--` は行末コメント扱いしない（`x--` の誤検出回避）", () => {
    assert.strictEqual(findOperatorColumn("x--", ["--"]), null);
  });

  test("文字列内の `--` は拾わない", () => {
    assert.strictEqual(findOperatorColumn('s = "a--b"', ["--"]), null);
  });

  test("行末コメント `;`（INI/asm）の位置を返す", () => {
    assert.strictEqual(findOperatorColumn("x = 1 ; note", [";"]), 6);
  });

  test("丸ごとコメント行の `;` は対象外", () => {
    assert.strictEqual(findOperatorColumn("; just a comment", [";"]), null);
  });

  test("空白前置のない `;` は行末コメント扱いしない（区切りの `a;b` 誤検出回避）", () => {
    assert.strictEqual(findOperatorColumn("a;b", [";"]), null);
  });

  test("文字列内の `;` は拾わない", () => {
    assert.strictEqual(findOperatorColumn('s = "a;b"', [";"]), null);
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

  test("汎用フォールバック: 文字列内のリテラルは整列対象にならない", () => {
    assert.strictEqual(findOperatorColumn('const s = "a->b";', ["->"]), null);
  });

  test("汎用フォールバック: 行コメント内のリテラルは整列対象にならない", () => {
    assert.strictEqual(findOperatorColumn("const x = 1; // a -> b", ["->"]), null);
  });

  test("汎用フォールバック: ブロックコメント内のリテラルは整列対象にならない", () => {
    assert.strictEqual(findOperatorColumn("const x = 1; /* a -> b */", ["->"]), null);
  });

  test("汎用フォールバック: 文字列外のリテラルは従来どおり検出する", () => {
    const line = 'const s = "a->b"; c -> d';
    assert.strictEqual(findOperatorColumn(line, ["->"]), 20);
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
      "elixir",
      "perl",
      "powershell",
      "dockerfile",
      "r",
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

  test("Terraform: `#` コメント行の `=` を検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("# x = 1", ["="], "terraform"),
      null
    );
  });

  test("Terraform: `//` コメント行の `=` も検出しない（# / // 併用）", () => {
    assert.strictEqual(
      findOperatorColumn("// x = 1", ["="], "terraform"),
      null
    );
  });

  test("Terraform: 単一行ブロックコメント内の `=` も検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("/* x = 1 */", ["="], "terraform"),
      null
    );
  });

  test("`--` コメント言語（SQL/Haskell）では丸ごとコメント行の `=` を検出しない", () => {
    for (const lang of ["sql", "haskell"]) {
      assert.strictEqual(findOperatorColumn("-- x = 1", ["="], lang), null, lang);
    }
  });

  test("`--` コメント言語（SQL/Haskell）ではトレーリングコメントより前の `=` を検出する", () => {
    for (const lang of ["sql", "haskell"]) {
      assert.strictEqual(
        findOperatorColumn("x = 1 -- old = 2", ["="], lang),
        2,
        lang
      );
    }
  });

  test("PowerShell: `#` コメント行の `=` を検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("# $x = 1", ["="], "powershell"),
      null
    );
  });

  test("PowerShell: トレーリング `#` コメントより前の `=` は検出する", () => {
    assert.strictEqual(
      findOperatorColumn("$x = 1  # old = 2", ["="], "powershell"),
      3
    );
  });

  test("Dockerfile: `#` コメント行の `=` を検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("# ENV X=1", ["="], "dockerfile"),
      null
    );
  });

  test("Dockerfile: トレーリング `#` コメントより前の `=` は検出する", () => {
    assert.strictEqual(
      findOperatorColumn("ENV X=1  # old=2", ["="], "dockerfile"),
      5
    );
  });

  test("GraphQL: `#` コメント行の `:` を検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("# name: String", [":"], "graphql"),
      null
    );
  });

  test("GraphQL: トレーリング `#` コメントより前の `:` は検出する", () => {
    assert.strictEqual(
      findOperatorColumn("name: String  # note: x", [":"], "graphql"),
      4
    );
  });

  test("Scala: `//` コメント行の `=` を検出しない", () => {
    assert.strictEqual(findOperatorColumn("// x = 1", ["="], "scala"), null);
  });

  test("Scala: 単一行ブロックコメント内の `=` も検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("/* x = 1 */", ["="], "scala"),
      null
    );
  });

  test("Groovy: `//` コメント行の `=` を検出しない", () => {
    assert.strictEqual(findOperatorColumn("// x = 1", ["="], "groovy"), null);
  });

  test("Groovy: 単一行ブロックコメント内の `=` も検出しない", () => {
    assert.strictEqual(
      findOperatorColumn("/* x = 1 */", ["="], "groovy"),
      null
    );
  });

  test("R: `#` コメント行の `<-` を検出しない", () => {
    assert.strictEqual(findOperatorColumn("# x <- 1", ["<-"], "r"), null);
  });

  test("R: トレーリング `#` コメントより前の `<-` は検出する", () => {
    assert.strictEqual(
      findOperatorColumn("x <- 1  # old <- 2", ["<-"], "r"),
      2
    );
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

suite("findOperatorColumn: TS/JS 分割代入デフォルト値の `=`（#361）", () => {
  test("分割代入デフォルト値の = ではなく外側の代入 = を返す", () => {
    const line = "const { a = 1 } = obj;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("JavaScript でも同様に外側の代入 = を返す", () => {
    const line = "const { a = 1 } = obj;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "javascript"),
      line.lastIndexOf("=")
    );
  });

  test("単文ブロック内の本物の代入 = は引き続き検出する（一律の {} 除外はしない）", () => {
    const line = "if (ready) { count = 0; }";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.indexOf("=")
    );
  });

  test("JS でも {} ブロック内の本物の代入は引き続き検出する", () => {
    const line = "function f() { total = 1; }";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "javascript"),
      line.indexOf("=")
    );
  });

  test("アロー関数コールバック内の代入は従来どおり対象外", () => {
    const line = "items.forEach((x) => { total = total + x; })";
    assert.strictEqual(findOperatorColumn(line, ["="], "typescript"), null);
  });

  test("ネストした分割代入でも外側の代入 = のみ検出する", () => {
    const line = "const { a: { b = 1 } } = obj;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("デフォルト値が式（関数呼び出し）でも外側の代入 = のみ検出する", () => {
    const line = "const { a = f(1, 2) } = obj;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("型注釈付きの分割代入でも外側の代入 = を検出する", () => {
    const line = "const { a = 1 }: T = obj;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("複数のデフォルト値があっても外側の代入 = のみ検出する", () => {
    const line = "const { a = 1, b = 2 } = obj;";
    assert.deepStrictEqual(
      findOperatorTargets(line, ["="], "typescript").map((t) => t.align),
      [line.lastIndexOf("=")]
    );
  });

  test("行末コメント付きでも外側の代入 = を検出する", () => {
    const line = "const { a = 1 } = obj; // note";
    const realEquals = line.indexOf("=", line.indexOf("}"));
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      realEquals
    );
  });

  test("} と = の間にブロックコメントを挟んでも外側の代入 = を検出する", () => {
    const line = "const { a = 1 } /* c */ = obj;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("スコープ外の言語（languageId 未指定）では従来どおりの挙動のまま", () => {
    // この修正は TS/JS 限定（TS_JS_LANGUAGES）。他言語で {} が分割代入を
    // 意味するとは限らないため、意図的に対象を広げない。
    const line = "const { a = 1 } = obj;";
    assert.strictEqual(
      findOperatorColumn(line, ["="]),
      line.indexOf("=")
    );
  });
});

suite("findOperatorColumn: ジェネリクス既定型引数の `=`（#413）", () => {
  test("TS: 既定型引数の = ではなく行末の型定義の = を返す", () => {
    const line = "type Result<T = unknown> = T;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("TS: 既定型引数の後にアロー関数型が続いても型定義の = を返す", () => {
    const line = "type Handler<E = Error> = (err: E) => void;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.indexOf("= (")
    );
  });

  test("TS: 既定値がネストしたジェネリクス（>> で閉じる）でも型定義の = を返す", () => {
    const line = "type D<M = Map<string, number>> = M;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("TS: 既定値が関数型（=> を含む）でも型引数リストの終わりを誤認しない", () => {
    const line = "type F<C = () => void> = C;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("TS: 既定値がタプル型でも型定義の = を返す", () => {
    const line = "type A<T extends unknown[] = []> = T;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("TS: 既定値が = を含む文字列リテラル型でも型定義の = を返す", () => {
    const line = 'type S<T = "a=b"> = T;';
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("TS: 複数の既定型引数があっても型定義の = のみ検出する", () => {
    const line = "type P<A = 1, B = 2> = [A, B];";
    assert.deepStrictEqual(
      findOperatorTargets(line, ["="], "typescript").map((t) => t.align),
      [line.lastIndexOf("=")]
    );
  });

  test("TS: 既定値がオブジェクト型（`;` 区切りメンバー）でも型定義の = を返す", () => {
    const line = "type O<T = { a: string; b: number }> = T;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("TSX でも既定型引数の = を除外する", () => {
    const line = "type R<T = unknown> = T;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescriptreact"),
      line.lastIndexOf("=")
    );
  });

  test("TS: 既定値なしのジェネリクスを含む行は従来どおり代入の = を返す", () => {
    const line = "const m: Map<string, number> = new Map();";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.indexOf("=")
    );
  });

  test("TS: 行内に既定型引数の = しかなければ null を返す", () => {
    const line = "class Box<T = string> {";
    assert.strictEqual(findOperatorColumn(line, ["="], "typescript"), null);
  });

  test("TS: 関数宣言の型引数既定値とデフォルト引数だけの行は null を返す", () => {
    const line = "function f<T, U = T>(a: T, b?: U): void {}";
    assert.strictEqual(findOperatorColumn(line, ["="], "typescript"), null);
  });

  test("TS: 型引数つき関数呼び出しの行は代入の = を返す", () => {
    const line = "const r = identity<number>(42);";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.indexOf("=")
    );
  });

  test("TS: 行末コメント内のジェネリクス風テキストは影響しない", () => {
    const line = "type A<T = X> = T; // Map<K = V>";
    assert.deepStrictEqual(
      findOperatorTargets(line, ["="], "typescript").map((t) => t.align),
      [line.indexOf("= T;")]
    );
  });

  test("TS: 型引数リスト内にブロックコメントがあっても既定値の = を除外する", () => {
    const line = "type A</* c */ T = X> = T;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.lastIndexOf("=")
    );
  });

  test("TS: 文字列内のジェネリクス風テキストは影響しない", () => {
    const line = 'const s = "<T = X>";';
    assert.strictEqual(
      findOperatorColumn(line, ["="], "typescript"),
      line.indexOf("=")
    );
  });

  test("C++: template の既定型引数と括弧内のデフォルト引数だけの行は null を返す", () => {
    const line = "template<typename T = int> void f(int x = 0);";
    assert.strictEqual(findOperatorColumn(line, ["="], "cpp"), null);
  });

  test("C++: `template <` と空白を挟むスタイルでも既定型引数の = を除外する", () => {
    const line = "template <class T = std::vector<int>> struct S;";
    assert.strictEqual(findOperatorColumn(line, ["="], "cpp"), null);
  });

  test("C++: `a < b = c` の比較と代入の組み合わせは = を検出したまま", () => {
    const line = "a < b = c";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "cpp"),
      line.indexOf("=")
    );
  });

  test("C++: 識別子直後の `<` でも対応する `>` がなければ = を検出したまま", () => {
    const line = "a<b = c";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "cpp"),
      line.indexOf("=")
    );
  });

  test("C++: 空白なしの比較式（`;` を挟む）を型引数リストと誤認しない", () => {
    const line = "x=a<b;y=c>d;";
    assert.deepStrictEqual(
      findAssignmentEquals(line, "cpp").map((t) => t.align),
      [1, 7]
    );
  });

  test("C++: シフト演算子 `<<` は型引数リストの開始と誤認しない", () => {
    const line = "mask = bits<<2;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "cpp"),
      line.indexOf("=")
    );
  });

  test("C++: 三項演算子を含む比較式を型引数リストと誤認しない", () => {
    const line = "int v = a<b ? x : y;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "cpp"),
      line.indexOf("=")
    );
  });

  test("Rust: struct の既定型引数の = しかない行は null を返す", () => {
    const line = "struct S<T = String> { field: T }";
    assert.strictEqual(findOperatorColumn(line, ["="], "rust"), null);
  });

  test("Rust: 型エイリアスでは既定型引数ではなく行末の = を返す", () => {
    const line = "type Alias<T = String> = Vec<T>;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "rust"),
      line.lastIndexOf("=")
    );
  });

  test("Rust: ライフタイムを含む既定型引数でも除外する", () => {
    const line = "struct R<'a, T = &'a str> { x: T }";
    assert.strictEqual(findOperatorColumn(line, ["="], "rust"), null);
  });

  test("Rust: fn ポインタ型既定値の `->` で型引数リストの終わりを誤認しない", () => {
    const line = "type P<F = fn() -> i32> = F;";
    assert.strictEqual(
      findOperatorColumn(line, ["="], "rust"),
      line.lastIndexOf("=")
    );
  });

  test("スコープ外の言語（languageId 未指定）では従来どおりの挙動のまま", () => {
    // この修正はジェネリクス/テンプレート既定引数を持つ言語限定。他言語の
    // `<`/`>` は常に比較・不等号でありうるため、意図的に対象を広げない。
    const line = "type Result<T = unknown> = T;";
    assert.strictEqual(
      findOperatorColumn(line, ["="]),
      line.indexOf("=")
    );
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

  test("空文字の演算子を渡してもハングせず、マッチなしとして終了する", () => {
    // config 側で空文字は除外される想定だが、最後の防衛線としてここでも
    // 無限ループ（i += op.length - 1 が負になる事故）にならないことを保証する。
    assert.deepStrictEqual(findOperatorTargets("ab", [""]), []);
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

suite("TS/JS switch 本体ブレーススタック（nextTsBraceState、#345）", () => {
  test("`switch (x) {` は switch 本体として積む", () => {
    assert.deepStrictEqual(nextTsBraceState("switch (x) {", []), ["switch"]);
  });

  test("空白なし `switch(x){` でも switch 本体として積む", () => {
    assert.deepStrictEqual(nextTsBraceState("switch(x){", []), ["switch"]);
  });

  test("条件式に入れ子の `(...)` があっても対応する `{` を正しく switch と判定する", () => {
    assert.deepStrictEqual(
      nextTsBraceState("switch (getValue(a, b)) {", []),
      ["switch"]
    );
  });

  test("`interface Foo {` のような switch 以外の `{` は other として積む", () => {
    assert.deepStrictEqual(nextTsBraceState("interface Foo {", []), ["other"]);
  });

  test("`.switch(x) {` はメンバーアクセスなので switch と誤認しない", () => {
    assert.deepStrictEqual(nextTsBraceState("obj.switch(x) {", []), ["other"]);
  });

  test("条件と `{` の間のブロックコメントは switch 判定を妨げない", () => {
    assert.deepStrictEqual(
      nextTsBraceState("switch (x) /* start */ {", []),
      ["switch"]
    );
  });

  test("`}` はスタックの最上位をポップする", () => {
    const opened = nextTsBraceState("switch (x) {", []);
    assert.deepStrictEqual(nextTsBraceState("}", opened), []);
  });

  test("入れ子の `{`/`}` を正しくスタックとして push/pop する", () => {
    let state: TsBraceState = [];
    state = nextTsBraceState("switch (x) {", state);
    state = nextTsBraceState("  case 1: {", state);
    assert.deepStrictEqual(state, ["switch", "other"]);
    state = nextTsBraceState("  }", state);
    assert.deepStrictEqual(state, ["switch"]);
  });

  test("文字列・行コメント内の `switch(` は switch と誤認しない", () => {
    assert.deepStrictEqual(
      nextTsBraceState('const s = "switch (x) {";', []),
      []
    );
    assert.deepStrictEqual(nextTsBraceState("// switch (x) {", []), []);
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

suite("LineScanCheckpointCache", () => {
  // interval=5 のブロックコメントを跨ぐ行構成: 0行目で開き7行目で閉じるので、
  // 5行目のチェックポイントは「コメント内」、10行目のチェックポイントは「コード」になる。
  const commentSpanningLines = [
    "/*", "x", "x", "x", "x", // 0-4: still inside the comment
    "x", "x", "*/", // 5-7: still inside until the close on line 7
    "a = 1;", "b = 2;", // 8-9: back to code
    "c = 3;", "d = 4;", // 10-11
  ];

  test("チェックポイントから求めた開始状態は、先頭からの全行スキャン(computeLineScanStateBefore)と一致する", () => {
    const cache = new LineScanCheckpointCache(5);
    // スクロールを想定し、行き来する順序でも一致することを確認する。
    for (const target of [12, 3, 7, 5, 0, 10, 12]) {
      const expected = computeLineScanStateBefore(
        target,
        (i) => commentSpanningLines[i],
        "typescript"
      );
      const actual = cache.stateBefore(
        target,
        (i) => commentSpanningLines[i],
        "typescript"
      );
      assert.deepStrictEqual(actual, expected, `target=${target}`);
    }
  });

  test("編集開始行以降のチェックポイントは破棄され、それ以前のチェックポイントは温存されて再利用される", () => {
    const lines = commentSpanningLines.slice();
    const cache = new LineScanCheckpointCache(5);
    // ウォームアップ: 5, 10 行目にチェックポイントができる。
    cache.stateBefore(12, (i) => lines[i], "typescript");

    // 10行目を編集してブロックコメントを開かなくする。10行目より前(<=10)の
    // チェックポイントは温存されるはずなので、5行目のチェックポイントは無効化されず
    // 温存される一方、10行目のチェックポイント自体はまだ有効（10行目より前の行にしか
    // 依存しないため）。
    lines[10] = "e = 5;";
    cache.invalidateFrom(10);

    let scannedFrom = Infinity;
    const spyLineAt = (i: number) => {
      scannedFrom = Math.min(scannedFrom, i);
      return lines[i];
    };
    const actual = cache.stateBefore(12, spyLineAt, "typescript");

    const expected = computeLineScanStateBefore(12, (i) => lines[i], "typescript");
    assert.deepStrictEqual(actual, expected);
    // 0行目からの再スキャンではなく、10行目のチェックポイントから再開しているはず。
    assert.strictEqual(scannedFrom, 10);
  });

  test("編集開始行より前のチェックポイントを破棄する編集では、0行目から再スキャンされる", () => {
    const lines = commentSpanningLines.slice();
    const cache = new LineScanCheckpointCache(5);
    cache.stateBefore(12, (i) => lines[i], "typescript");

    // 0行目の編集はすべてのチェックポイント(5, 10行目)を無効化する。
    lines[0] = "/* comment */";
    cache.invalidateFrom(0);

    let scannedFrom = Infinity;
    const spyLineAt = (i: number) => {
      scannedFrom = Math.min(scannedFrom, i);
      return lines[i];
    };
    const actual = cache.stateBefore(12, spyLineAt, "typescript");

    const expected = computeLineScanStateBefore(12, (i) => lines[i], "typescript");
    assert.deepStrictEqual(actual, expected);
    assert.strictEqual(scannedFrom, 0);
  });

  test("言語IDが変わるとチェックポイントは再利用されず、新しい言語で再計算される", () => {
    // 未終端の `/*` は TypeScript ではブロックコメントとして残り続けるが、
    // shellscript には C 言語風コメントの概念がないため無視され "code" のままになる。
    // 言語IDが変わったのにチェックポイントを使い回すと、この差異を見誤る。
    const lines = ["/*", "x", "x", "x", "x", "x", "x"];
    const cache = new LineScanCheckpointCache(5);
    cache.stateBefore(6, (i) => lines[i], "shellscript");

    const actual = cache.stateBefore(6, (i) => lines[i], "typescript");
    const expected = computeLineScanStateBefore(6, (i) => lines[i], "typescript");
    assert.deepStrictEqual(actual, expected);
    assert.strictEqual(expected.doc, "blockComment");
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
