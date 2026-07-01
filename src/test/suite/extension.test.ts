import * as assert from "assert";
import * as vscode from "vscode";
import {
  findOperatorColumn,
  findOperatorTarget,
  findAlignmentGroups,
  visualColumn,
  computePaddings,
  findPipePositions,
  isDelimiterRow,
  findMarkdownTables,
  computeMarkdownTablePaddings,
  resolveGhostSettings,
  resolveOperatorsForLanguage,
  resolveInitialEnabled,
  statusBarText,
  debounce,
  DEFAULT_GHOST_CHAR,
  DEFAULT_GHOST_COLOR,
  initialQuoteState,
  advanceQuoteState,
} from "../../extension";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// vscode.TextDocument の最小限モック
function mockDocument(lines: string[]) {
  return {
    lineCount: lines.length,
    lineAt(i: number) {
      return { text: lines[i] };
    },
  } as any;
}

// vscode.WorkspaceConfiguration の最小限モック
function mockConfig(values: Record<string, unknown>) {
  return {
    get<T>(key: string, defaultValue: T): T {
      return (key in values ? values[key] : defaultValue) as T;
    },
  };
}

// vscode.Memento (globalState) の最小限モック
function mockState(values: Record<string, unknown>) {
  return {
    get<T>(key: string, defaultValue: T): T {
      return (key in values ? values[key] : defaultValue) as T;
    },
  };
}

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

  test("`#` コメント言語では `//` をコメント扱いしない（Python の切り捨て除算）", () => {
    assert.strictEqual(
      findOperatorColumn("y = a // b", ["="], "python"),
      2
    );
  });

  test("languageId なしでは従来どおり `#` をコメント扱いしない", () => {
    assert.strictEqual(findOperatorColumn("# x = 1", ["="]), 4);
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
});

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
      return g.visualColumn + (p ? p.padding : 0);
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

  test("operatorColumn が正しい値を持つ", () => {
    const doc = mockDocument([
      "const x = 1;",       // = at 8
      "const longName = 2;", // = at 15
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups[0][0].operatorColumn, 8);
    assert.strictEqual(groups[0][1].operatorColumn, 15);
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

  test("コメント行はグループの最大列を押し上げない", () => {
    // 修正前は `// const yyyyyy = 2;` の `=`(列17)を拾い、3行が1グループに
    // まとまって x/z のパディングが列17まで伸びていた。修正後はコメント行が
    // 演算子なし扱いとなり、両側が単独行になるためグループ化されない。
    const doc = mockDocument([
      "const x = 1;",         // = at 8
      "// const yyyyyy = 2;", // コメント行 — 演算子なし扱い
      "const z = 3;",         // = at 8
    ]);
    const groups = findAlignmentGroups(doc, ["="]);
    assert.strictEqual(groups.length, 0);
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
    assert.strictEqual(groups[0][0].operatorColumn, 7);
    assert.strictEqual(groups[0][1].operatorColumn, 12);
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
    assert.strictEqual(groups[0][0].operatorColumn, 3);
    assert.strictEqual(groups[0][0].visualColumn, 6);
    assert.strictEqual(groups[0][1].operatorColumn, 10);
    assert.strictEqual(groups[0][1].visualColumn, 13);
  });

  test("tabSize を変えても同じグループにまとまる", () => {
    const doc = mockDocument(["\tx = 1;", "\tlongName = 2;"]);
    const groups = findAlignmentGroups(doc, ["="], undefined, 8);
    assert.strictEqual(groups.length, 1);
    // tabSize 8: \t→8。= の視覚カラムは 10 と 17。
    assert.strictEqual(groups[0][0].visualColumn, 10);
    assert.strictEqual(groups[0][1].visualColumn, 17);
  });

  test("連続行の行末コメント `//` をグループ化する", () => {
    const doc = mockDocument([
      "x = 1; // a",      // // at 7
      "total = 42; // b", // // at 12
    ]);
    const groups = findAlignmentGroups(doc, ["//"]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0][0].operatorColumn, 7);
    assert.strictEqual(groups[0][1].operatorColumn, 12);
  });

  test("丸ごとコメント行はグループを分断する", () => {
    const doc = mockDocument([
      "x = 1; // a",
      "// 丸ごとコメント",
      "y = 2; // b",
    ]);
    const groups = findAlignmentGroups(doc, ["//"]);
    assert.strictEqual(groups.length, 0);
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
    assert.strictEqual(groups[0][0].operatorColumn, 2);
    assert.strictEqual(groups[0][0].visualColumn, 3);
    assert.strictEqual(groups[0][1].operatorColumn, 5);
    assert.strictEqual(groups[0][1].visualColumn, 6);
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

  test("`#` コメント行はグループを分断し最大列を押し上げない", () => {
    const doc = mockDocument([
      "x = 1",
      "# veryLongCommentedOutName = 99",
      "y = 2",
    ]);
    const groups = findAlignmentGroups(doc, ["="], "python");
    assert.strictEqual(groups.length, 0);
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
    assert.strictEqual(groups[0][0].operatorColumn, 2);
    assert.strictEqual(groups[0][0].visualColumn, 3);
    assert.strictEqual(groups[0][1].operatorColumn, 4);
    assert.strictEqual(groups[0][1].visualColumn, 7);
  });
});

suite("computePaddings", () => {
  test("グループ内の各行を最大視覚カラムまでパディングする", () => {
    const placements = computePaddings([
      [
        { lineIndex: 0, operatorColumn: 8, visualColumn: 8 },
        { lineIndex: 1, operatorColumn: 15, visualColumn: 15 },
      ],
    ]);
    // 行0 は 15-8=7 パディング、行1 は最大なのでスキップ。
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 8, padding: 7 },
    ]);
  });

  test("character は operatorColumn（文字インデックス）を使う", () => {
    // タブで visualColumn と operatorColumn が異なるケース。
    const placements = computePaddings([
      [
        { lineIndex: 0, operatorColumn: 3, visualColumn: 6 },
        { lineIndex: 1, operatorColumn: 10, visualColumn: 13 },
      ],
    ]);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 3, padding: 7 },
    ]);
  });

  test("既に揃っているグループは空を返す", () => {
    const placements = computePaddings([
      [
        { lineIndex: 0, operatorColumn: 5, visualColumn: 5 },
        { lineIndex: 1, operatorColumn: 5, visualColumn: 5 },
      ],
    ]);
    assert.deepStrictEqual(placements, []);
  });

  test("複数グループをまとめて処理する", () => {
    const placements = computePaddings([
      [
        { lineIndex: 0, operatorColumn: 2, visualColumn: 2 },
        { lineIndex: 1, operatorColumn: 4, visualColumn: 4 },
      ],
      [
        { lineIndex: 3, operatorColumn: 1, visualColumn: 1 },
        { lineIndex: 4, operatorColumn: 3, visualColumn: 3 },
      ],
    ]);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 2 },
      { lineIndex: 3, character: 1, padding: 2 },
    ]);
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
});

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
      { lineIndex: 1, character: 6, padding: 3 },
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
      { lineIndex: 1, character: 6, padding: 2 },
      { lineIndex: 2, character: 4, padding: 4 },
      { lineIndex: 2, character: 9, padding: 1 },
    ]);
  });
});

suite("debounce", () => {
  test("短時間の連続呼び出しは1回にまとめられる", async () => {
    let calls = 0;
    const d = debounce(() => calls++, 20);
    d();
    d();
    d();
    await wait(50);
    assert.strictEqual(calls, 1);
  });

  test("最後に渡した引数で呼ばれる", async () => {
    const received: number[] = [];
    const d = debounce((n: number) => received.push(n), 20);
    d(1);
    d(2);
    d(3);
    await wait(50);
    assert.deepStrictEqual(received, [3]);
  });

  test("cancel() で保留中の呼び出しが破棄される", async () => {
    let calls = 0;
    const d = debounce(() => calls++, 20);
    d();
    d.cancel();
    await wait(50);
    assert.strictEqual(calls, 0);
  });

  test("発火後に cancel() を呼んでも何も起きない", async () => {
    let calls = 0;
    const d = debounce(() => calls++, 20);
    d();
    await wait(50);
    assert.strictEqual(calls, 1);
    d.cancel();
    await wait(50);
    assert.strictEqual(calls, 1);
  });

  test("cancel() を二重に呼んでもエラーにならない", async () => {
    let calls = 0;
    const d = debounce(() => calls++, 20);
    d();
    d.cancel();
    d.cancel();
    await wait(50);
    assert.strictEqual(calls, 0);
  });
});

suite("resolveGhostSettings", () => {
  test("設定が何もなければデフォルト値が使われる", () => {
    const s = resolveGhostSettings(mockConfig({}));
    assert.strictEqual(s.ghostChar, DEFAULT_GHOST_CHAR);
    assert.strictEqual(s.ghostColor, DEFAULT_GHOST_COLOR);
  });

  test("ghostCharacter が空文字列ならデフォルトにフォールバックする", () => {
    const s = resolveGhostSettings(mockConfig({ ghostCharacter: "" }));
    assert.strictEqual(s.ghostChar, DEFAULT_GHOST_CHAR);
  });

  test("ghostColor が空文字列ならデフォルトにフォールバックする", () => {
    const s = resolveGhostSettings(mockConfig({ ghostColor: "" }));
    assert.strictEqual(s.ghostColor, DEFAULT_GHOST_COLOR);
  });

  test("ユーザー設定値があればそれが使われる", () => {
    const s = resolveGhostSettings(
      mockConfig({
        ghostCharacter: "·", // middle dot
        ghostColor: "red",
      })
    );
    assert.strictEqual(s.ghostChar, "·");
    assert.strictEqual(s.ghostColor, "red");
  });

  test('"transparent" は色を消す値として保持される（フォールバックしない）', () => {
    const s = resolveGhostSettings(mockConfig({ ghostColor: "transparent" }));
    assert.strictEqual(s.ghostColor, "transparent");
  });
});

suite("resolveOperatorsForLanguage", () => {
  test("JSON は既定で `:` を揃える", () => {
    assert.deepStrictEqual(
      resolveOperatorsForLanguage(mockConfig({}), "json"),
      [":"]
    );
  });

  test("JSONC も既定で `:` を揃える", () => {
    assert.deepStrictEqual(
      resolveOperatorsForLanguage(mockConfig({}), "jsonc"),
      [":"]
    );
  });

  test("yaml / css / scss / less は既定で `:` を揃える", () => {
    for (const lang of ["yaml", "css", "scss", "less"]) {
      assert.deepStrictEqual(
        resolveOperatorsForLanguage(mockConfig({}), lang),
        [":"],
        lang
      );
    }
  });

  test("dotenv / properties / toml は既定で `=` を揃える", () => {
    for (const lang of ["dotenv", "properties", "toml"]) {
      assert.deepStrictEqual(
        resolveOperatorsForLanguage(mockConfig({}), lang),
        ["="],
        lang
      );
    }
  });

  test("python / shellscript / ruby / ini / makefile は既定で `=` を揃える", () => {
    // グローバル operators を上書きしても、これらの言語はマップ側の `=` を返す
    // （フォールバックではなく DEFAULT_OPERATORS_BY_LANGUAGE に含まれていること）
    const config = mockConfig({ operators: [":"] });
    for (const lang of ["python", "shellscript", "ruby", "ini", "makefile"]) {
      assert.deepStrictEqual(
        resolveOperatorsForLanguage(config, lang),
        ["="],
        lang
      );
    }
  });

  test("追加言語のサンプルで代入の `=` が連続行で揃う", () => {
    const samples: Record<string, string[]> = {
      python: ["x = 1", "longer = 2"],
      shellscript: ["X=1", "LONGER=2"],
      ruby: ["x = 1", "longer = 2"],
      ini: ["key = 1", "longerkey = 2"],
      makefile: ["VAR = 1", "LONGVAR = 2"],
    };
    for (const [lang, lines] of Object.entries(samples)) {
      const operators = resolveOperatorsForLanguage(mockConfig({}), lang);
      const groups = findAlignmentGroups(mockDocument(lines), operators, lang);
      assert.strictEqual(groups.length, 1, lang);
      const paddings = computePaddings(groups);
      const aligned = groups[0].map((g) => {
        const p = paddings.find((q) => q.lineIndex === g.lineIndex);
        return g.visualColumn + (p ? p.padding : 0);
      });
      assert.strictEqual(aligned[0], aligned[1], lang);
    }
  });

  test("マップにない言語はグローバル `operators` にフォールバックする", () => {
    assert.deepStrictEqual(
      resolveOperatorsForLanguage(mockConfig({}), "typescript"),
      ["="]
    );
  });

  test("ユーザーが operatorsByLanguage を設定すれば反映される", () => {
    const ops = resolveOperatorsForLanguage(
      mockConfig({
        operatorsByLanguage: { yaml: [":"], typescript: ["=", ":"] },
      }),
      "typescript"
    );
    assert.deepStrictEqual(ops, ["=", ":"]);
  });

  test("operatorsByLanguage を空オブジェクトで上書きするとどの言語もフォールバックする", () => {
    const ops = resolveOperatorsForLanguage(
      mockConfig({
        operatorsByLanguage: {},
        operators: ["="],
      }),
      "json"
    );
    assert.deepStrictEqual(ops, ["="]);
  });

  test("operators がユーザー設定で上書きされていればフォールバック先がそれになる", () => {
    const ops = resolveOperatorsForLanguage(
      mockConfig({ operators: ["=", "=>"] }),
      "typescript"
    );
    assert.deepStrictEqual(ops, ["=", "=>"]);
  });

  test("operatorsByLanguage で言語を空配列に上書きすると整列が無効化される（フォールバックしない）", () => {
    const ops = resolveOperatorsForLanguage(
      mockConfig({ operatorsByLanguage: { json: [] }, operators: ["="] }),
      "json"
    );
    assert.deepStrictEqual(ops, []);
  });
});

suite("resolveInitialEnabled", () => {
  test("globalState 未設定ならデフォルトで有効（既存ユーザーは ON のまま）", () => {
    assert.strictEqual(resolveInitialEnabled(mockState({})), true);
  });

  test("OFF を保存していればリロード後も無効のまま復元する", () => {
    assert.strictEqual(resolveInitialEnabled(mockState({ enabled: false })), false);
  });

  test("ON を保存していれば有効で復元する", () => {
    assert.strictEqual(resolveInitialEnabled(mockState({ enabled: true })), true);
  });
});

suite("statusBarText", () => {
  test("有効なら ON を表示する", () => {
    assert.strictEqual(statusBarText(true), "Ghost Align: ON");
  });

  test("無効なら OFF を表示する", () => {
    assert.strictEqual(statusBarText(false), "Ghost Align: OFF");
  });
});
