import * as assert from "assert";
import * as vscode from "vscode";
import {
  findOperatorColumn,
  findAlignmentGroups,
  resolveGhostSettings,
  resolveOperatorsForLanguage,
} from "../../extension";

// vscode.TextDocument の最小限モック
function mockDocument(lines: string[]) {
  return {
    lineCount: lines.length,
    lineAt(i: number) {
      return { text: lines[i] };
    },
  } as any;
}

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
});

// vscode.WorkspaceConfiguration の最小限モック
function mockConfig(values: Record<string, unknown>) {
  return {
    get<T>(key: string, defaultValue: T): T {
      return (key in values ? values[key] : defaultValue) as T;
    },
  };
}

suite("resolveGhostSettings", () => {
  const DEFAULT_CHAR = " "; // NBSP
  const DEFAULT_COLOR = "rgba(128, 128, 128, 0.25)";

  test("設定が何もなければデフォルト値が使われる", () => {
    const s = resolveGhostSettings(mockConfig({}));
    assert.strictEqual(s.ghostChar, DEFAULT_CHAR);
    assert.strictEqual(s.ghostColor, DEFAULT_COLOR);
  });

  test("ghostCharacter が空文字列ならデフォルトにフォールバックする", () => {
    const s = resolveGhostSettings(mockConfig({ ghostCharacter: "" }));
    assert.strictEqual(s.ghostChar, DEFAULT_CHAR);
  });

  test("ghostColor が空文字列ならデフォルトにフォールバックする", () => {
    const s = resolveGhostSettings(mockConfig({ ghostColor: "" }));
    assert.strictEqual(s.ghostColor, DEFAULT_COLOR);
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
});
