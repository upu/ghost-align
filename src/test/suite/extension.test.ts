import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { findOperatorTargets, findAssignmentEquals } from "../../finders";
import { findAlignmentGroups, computePaddings } from "../../paddings";
import { buildAlignedText } from "../../copyAligned";
import {
  resolveGhostSettings,
  resolveAlignmentPath,
  resolveOperatorsForLanguage,
  isLanguageDisabled,
  toggleDisabledLanguage,
  decorateEditor,
  computeDocumentPlacements,
  buildCopyAlignedText,
  resolveInitialEnabled,
  statusBarText,
  isAlignableScheme,
  debounce,
  notifyCsvDocumentChange,
  notifyMarkdownDocumentChange,
  DEFAULT_GHOST_CHAR,
  DEFAULT_GHOST_COLOR,
  DEFAULT_OPERATORS_BY_LANGUAGE,
} from "../../extension";
import {
  wait,
  mockDocument,
  mockConfig,
  mockState,
  mockEditor,
  findOperatorTarget,
} from "./testHelpers";

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

  test("ghostColor が空文字列ならデフォルトにフォールバックする", () => {
    const s = resolveGhostSettings(mockConfig({ ghostColor: "" }));
    assert.strictEqual(s.ghostColor, DEFAULT_GHOST_COLOR);
  });

  test("ghostColor のユーザー設定値があればそれが使われる", () => {
    const s = resolveGhostSettings(mockConfig({ ghostColor: "red" }));
    assert.strictEqual(s.ghostColor, "red");
  });

  test("廃止された ghostCharacter 設定が残っていても無視され、常に NBSP でパディングする", () => {
    const s = resolveGhostSettings(
      mockConfig({ ghostCharacter: "·" }) // middle dot
    );
    assert.strictEqual(s.ghostChar, DEFAULT_GHOST_CHAR);
  });

  test('"transparent" は色を消す値として保持される（フォールバックしない）', () => {
    const s = resolveGhostSettings(mockConfig({ ghostColor: "transparent" }));
    assert.strictEqual(s.ghostColor, "transparent");
  });
});

suite("resolveAlignmentPath", () => {
  test("markdown は markdown パスになる", () => {
    assert.deepStrictEqual(resolveAlignmentPath("markdown", mockConfig({})), {
      kind: "markdown",
    });
  });

  test("csv / tsv はそれぞれの区切り文字を持つ csv パスになる", () => {
    assert.deepStrictEqual(resolveAlignmentPath("csv", mockConfig({})), {
      kind: "csv",
      delimiter: ",",
    });
    assert.deepStrictEqual(resolveAlignmentPath("tsv", mockConfig({})), {
      kind: "csv",
      delimiter: "\t",
    });
  });

  test("TypeScript は operators パスで既定オペレーターと JSDoc 整列 ON になる", () => {
    assert.deepStrictEqual(resolveAlignmentPath("typescript", mockConfig({})), {
      kind: "operators",
      operators: [":", "="],
      alignJsdoc: true,
    });
  });

  test("alignJsdocParams=false なら operators パスの alignJsdoc も false", () => {
    const path = resolveAlignmentPath(
      "typescript",
      mockConfig({ alignJsdocParams: false })
    );
    assert.strictEqual(path.kind, "operators");
    assert.strictEqual(
      path.kind === "operators" ? path.alignJsdoc : undefined,
      false
    );
  });

  test("TS/JS 以外の言語では alignJsdoc は常に false", () => {
    assert.deepStrictEqual(resolveAlignmentPath("python", mockConfig({})), {
      kind: "operators",
      operators: ["="],
      alignJsdoc: false,
    });
  });

  test("markdownTable.enabled=false なら markdown は none パスになる", () => {
    assert.deepStrictEqual(
      resolveAlignmentPath(
        "markdown",
        mockConfig({ "markdownTable.enabled": false })
      ),
      { kind: "none" }
    );
  });

  test("csv.enabled=false なら csv / tsv は none パスになる", () => {
    const config = mockConfig({ "csv.enabled": false });
    assert.deepStrictEqual(resolveAlignmentPath("csv", config), {
      kind: "none",
    });
    assert.deepStrictEqual(resolveAlignmentPath("tsv", config), {
      kind: "none",
    });
  });

  test("jsdoc.enabled=false なら operators パスの alignJsdoc が false になる", () => {
    const path = resolveAlignmentPath(
      "typescript",
      mockConfig({ "jsdoc.enabled": false })
    );
    assert.strictEqual(
      path.kind === "operators" ? path.alignJsdoc : undefined,
      false
    );
  });

  test("新キー jsdoc.enabled の明示は旧 alignJsdocParams より優先される", () => {
    const path = resolveAlignmentPath(
      "typescript",
      mockConfig({ "jsdoc.enabled": true, alignJsdocParams: false })
    );
    assert.strictEqual(
      path.kind === "operators" ? path.alignJsdoc : undefined,
      true
    );
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

  test("python / shellscript / ini / makefile は既定で `=` を揃える", () => {
    // グローバル operators を上書きしても、これらの言語はマップ側の `=` を返す
    // （フォールバックではなく DEFAULT_OPERATORS_BY_LANGUAGE に含まれていること）
    const config = mockConfig({ operators: [":"] });
    for (const lang of ["python", "shellscript", "ini", "makefile"]) {
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
      swift: ["let x = 1", "let longName = 2"],
      kotlin: ["val x = 1", "val longName = 2"],
      dart: ["var x = 1;", "var longName = 2;"],
      zig: ["const x = 1;", "const longName = 2;"],
    };
    for (const [lang, lines] of Object.entries(samples)) {
      const operators = resolveOperatorsForLanguage(mockConfig({}), lang);
      const groups = findAlignmentGroups(mockDocument(lines), operators, lang);
      assert.strictEqual(groups.length, 1, lang);
      const paddings = computePaddings(groups);
      const aligned = groups[0].map((g) => {
        const p = paddings.find((q) => q.lineIndex === g.lineIndex);
        return g.columns[0].visualColumn + (p ? p.padding : 0);
      });
      assert.strictEqual(aligned[0], aligned[1], lang);
    }
  });

  test("マップにない言語はグローバル `operators` にフォールバックする", () => {
    assert.deepStrictEqual(
      resolveOperatorsForLanguage(mockConfig({}), "plaintext"),
      ["="]
    );
  });

  test("alignUnknownLanguages=false なら operatorsByLanguage に無い言語は整列されない", () => {
    assert.deepStrictEqual(
      resolveOperatorsForLanguage(
        mockConfig({ alignUnknownLanguages: false }),
        "plaintext"
      ),
      []
    );
  });

  test("alignUnknownLanguages=false でもユーザーが operatorsByLanguage に追加した言語は整列される", () => {
    const config = mockConfig({
      alignUnknownLanguages: false,
      operatorsByLanguage: { ...DEFAULT_OPERATORS_BY_LANGUAGE, sql: ["="] },
    });
    assert.deepStrictEqual(resolveOperatorsForLanguage(config, "sql"), ["="]);
  });

  test("alignUnknownLanguages=false でも既定の対象言語は従来どおり整列される", () => {
    assert.deepStrictEqual(
      resolveOperatorsForLanguage(
        mockConfig({ alignUnknownLanguages: false }),
        "python"
      ),
      ["="]
    );
  });

  test("TS/TSX/JS/JSX は既定で `:` と `=` を揃える", () => {
    for (const lang of [
      "typescript",
      "typescriptreact",
      "javascript",
      "javascriptreact",
    ]) {
      assert.deepStrictEqual(
        resolveOperatorsForLanguage(mockConfig({}), lang),
        [":", "="],
        lang
      );
    }
  });

  test("TS: 既定設定で型注釈の `:` と代入の `=` が連続行で両方揃う", () => {
    const operators = resolveOperatorsForLanguage(
      mockConfig({}),
      "typescript"
    );
    const doc = mockDocument([
      "const x: number = 1;",
      "const longName: str = 2;",
    ]);
    const groups = findAlignmentGroups(doc, operators, "typescript");
    assert.strictEqual(groups.length, 1);
    const placements = computePaddings(groups);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 7, padding: 7 },
      { lineIndex: 1, character: 20, padding: 3 },
    ]);
  });

  test("TS: switch の case ラベルの `:` も既定で揃う（意図した挙動）", () => {
    const operators = resolveOperatorsForLanguage(
      mockConfig({}),
      "typescript"
    );
    const doc = mockDocument(["  case 1:", "  case 22:"]);
    const groups = findAlignmentGroups(doc, operators, "typescript");
    assert.strictEqual(groups.length, 1);
    const placements = computePaddings(groups);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 8, padding: 1 },
    ]);
  });

  test("ruby / php / rust は既定で `=` と `=>` を揃える", () => {
    for (const lang of ["ruby", "php", "rust"]) {
      assert.deepStrictEqual(
        resolveOperatorsForLanguage(mockConfig({}), lang),
        ["=", "=>"],
        lang
      );
    }
  });

  test("go / lua / c / cpp / csharp / java は既定で `=` を揃える", () => {
    const config = mockConfig({ operators: [":"] });
    for (const lang of ["go", "lua", "c", "cpp", "csharp", "java"]) {
      assert.deepStrictEqual(
        resolveOperatorsForLanguage(config, lang),
        ["="],
        lang
      );
    }
  });

  test("swift / kotlin / dart / zig は既定で `=` を揃える", () => {
    const config = mockConfig({ operators: [":"] });
    for (const lang of ["swift", "kotlin", "dart", "zig"]) {
      assert.deepStrictEqual(
        resolveOperatorsForLanguage(config, lang),
        ["="],
        lang
      );
    }
  });

  test("Ruby: ハッシュロケット `=>` が連続行で揃う", () => {
    const doc = mockDocument(['"a" => 1,', '"long" => 2,']);
    const groups = findAlignmentGroups(doc, ["=", "=>"], "ruby");
    assert.strictEqual(groups.length, 1);
    const placements = computePaddings(groups);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 3 },
    ]);
  });

  test("Rust: match アームの `=>` が連続行で揃う", () => {
    const doc = mockDocument(["Some(x) => x + 1,", "None => 0,"]);
    const groups = findAlignmentGroups(doc, ["=", "=>"], "rust");
    assert.strictEqual(groups.length, 1);
    const placements = computePaddings(groups);
    assert.deepStrictEqual(placements, [
      { lineIndex: 1, character: 5, padding: 3 },
    ]);
  });

  test("Rust: ライフタイム `&'static str` を含む行でも代入の `=` を検出する", () => {
    const line = "let s: &'static str = \"x\";";
    assert.deepStrictEqual(findOperatorTarget(line, ["="], "rust"), {
      insert: 20,
      align: 20,
    });
  });

  test("Rust: ライフタイム `'a` を含む行でも代入の `=` を検出する", () => {
    const line = "let x: &'a str = y;";
    assert.deepStrictEqual(findOperatorTarget(line, ["="], "rust"), {
      insert: 15,
      align: 15,
    });
  });

  test("Rust: char リテラル内の `=` は代入として検出しない（回帰）", () => {
    const line = "let c = '=';";
    assert.deepStrictEqual(findOperatorTargets(line, ["="], "rust"), [
      { opIndex: 0, insert: 6, align: 6 },
    ]);
  });

  test("Rust: ライフタイムを含む match アーム行でも `=>` を検出する", () => {
    const line = "x: &'a str => 1,";
    assert.deepStrictEqual(findOperatorTarget(line, ["=>"], "rust"), {
      insert: 11,
      align: 11,
    });
  });

  test("Rust: raw string `r#\"...\"#` 内部の `\"` を跨いだ `=` を誤検出しない", () => {
    const line = 'let s = r#"a="x=y"z"#;';
    assert.deepStrictEqual(findAssignmentEquals(line, "rust"), [
      { insert: 6, align: 6 },
    ]);
  });

  test("Rust: 内部に `\"` を含まない単純な raw string `r\"...\"` は従来通り動作する", () => {
    const line = 'let s = r"a=b";';
    assert.deepStrictEqual(findAssignmentEquals(line, "rust"), [
      { insert: 6, align: 6 },
    ]);
  });

  test("Rust: 二重ハッシュの raw string `r##\"...\"##` は単一 `\"#` の偽終端で閉じない", () => {
    const line = 'let s = r##"a="#b=c"##;';
    assert.deepStrictEqual(findAssignmentEquals(line, "rust"), [
      { insert: 6, align: 6 },
    ]);
  });

  test("Rust: raw string 内の `=>` はアロー演算子として検出しない", () => {
    const line = 'r#"a"x=>y"z"# => 1,';
    assert.deepStrictEqual(findOperatorTarget(line, ["=>"], "rust"), {
      insert: 14,
      align: 14,
    });
  });

  test("PHP: 連想配列の `=>` が連続行で揃う", () => {
    const doc = mockDocument(["'a' => 1,", "'long' => 2,"]);
    const groups = findAlignmentGroups(doc, ["=", "=>"], "php");
    assert.strictEqual(groups.length, 1);
    const placements = computePaddings(groups);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 3 },
    ]);
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
      "plaintext"
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

suite("isLanguageDisabled", () => {
  test("disabledLanguages に載っている言語は true", () => {
    assert.strictEqual(
      isLanguageDisabled(mockConfig({ disabledLanguages: ["yaml"] }), "yaml"),
      true
    );
  });

  test("disabledLanguages に載っていない言語は false", () => {
    assert.strictEqual(
      isLanguageDisabled(
        mockConfig({ disabledLanguages: ["yaml"] }),
        "typescript"
      ),
      false
    );
  });

  test("デフォルト（空配列）はどの言語も無効化しない", () => {
    assert.strictEqual(
      isLanguageDisabled(mockConfig({}), "typescript"),
      false
    );
  });
});

suite("toggleDisabledLanguage", () => {
  test("まだ無効化されていない言語は追加され disabled: true を返す", () => {
    const result = toggleDisabledLanguage(["yaml"], "shellscript");
    assert.deepStrictEqual(result.next, ["yaml", "shellscript"]);
    assert.strictEqual(result.disabled, true);
  });

  test("既に無効化されている言語は除かれ disabled: false を返す", () => {
    const result = toggleDisabledLanguage(["yaml", "shellscript"], "yaml");
    assert.deepStrictEqual(result.next, ["shellscript"]);
    assert.strictEqual(result.disabled, false);
  });

  test("元の配列を変更しない", () => {
    const original = ["yaml"];
    toggleDisabledLanguage(original, "shellscript");
    assert.deepStrictEqual(original, ["yaml"]);
  });
});

suite("decorateEditor と disabledLanguages", () => {
  test("disabledLanguages に載った言語では装飾が一切適用されない", () => {
    const { editor, calls } = mockEditor("yaml", ["a = 1", "bb = 2"]);
    decorateEditor(
      editor,
      mockConfig({
        disabledLanguages: ["yaml"],
        operators: ["="],
      }) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], []);
  });

  test("disabledLanguages は operatorsByLanguage より優先される", () => {
    const { editor, calls } = mockEditor("yaml", ["a = 1", "bb = 2"]);
    decorateEditor(
      editor,
      mockConfig({
        disabledLanguages: ["yaml"],
        operatorsByLanguage: { yaml: ["="] },
      }) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.deepStrictEqual(calls[0], []);
  });

  test("markdownTable.enabled=false なら Markdown テーブルが整列されない", () => {
    const { editor, calls } = mockEditor("markdown", [
      "| a | b |",
      "|---|---|",
      "| 1 | 22 |",
    ]);
    decorateEditor(
      editor,
      mockConfig({
        "markdownTable.enabled": false,
      }) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.deepStrictEqual(calls[0], []);
  });

  test("csv.enabled=false なら CSV / TSV が整列されない", () => {
    const { editor, calls } = mockEditor("csv", ["a,b", "aaa,b"]);
    decorateEditor(
      editor,
      mockConfig({
        "csv.enabled": false,
      }) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.deepStrictEqual(calls[0], []);
  });

  test("既定では Markdown テーブルも CSV も整列される", () => {
    const md = mockEditor("markdown", ["| a | b |", "|---|---|", "| 1 | 22 |"]);
    decorateEditor(
      md.editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.ok(md.calls[0].length > 0);

    const csv = mockEditor("csv", ["a,b", "aaa,b"]);
    decorateEditor(
      csv.editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.ok(csv.calls[0].length > 0);
  });

  test("disabledLanguages に載っていない言語では通常どおり整列される", () => {
    const { editor, calls } = mockEditor("typescript", ["a = 1", "bb = 2"]);
    decorateEditor(
      editor,
      mockConfig({
        disabledLanguages: ["json"],
        operators: ["="],
      }) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].length > 0);
  });
});

suite("decorateEditor と可視範囲モード（大きい Markdown）", () => {
  test("可視範囲より上で開いたフェンス内のテーブル風行は整列されない", () => {
    const lineCount = 10001;
    const lines = new Array<string>(lineCount).fill("filler");
    lines[0] = "```";
    lines[9990] = "| not | a | table |";
    lines[9991] = "|-----|---|-------|";
    const { editor, calls } = mockEditor("markdown", lines, [
      { start: 9990, end: 9995 },
    ]);
    decorateEditor(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.deepStrictEqual(calls[0], []);
  });

  test("可視範囲より上のフェンスが閉じていればテーブル風行は通常どおり整列される", () => {
    const lineCount = 10001;
    const lines = new Array<string>(lineCount).fill("filler");
    lines[0] = "```";
    lines[1] = "```";
    lines[9990] = "| h | hh |";
    lines[9991] = "|---|----|";
    lines[9992] = "| dddd | d |";
    const { editor, calls } = mockEditor("markdown", lines, [
      { start: 9990, end: 9995 },
    ]);
    decorateEditor(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.ok(calls[0].length > 0);
  });
});

suite("computeDocumentPlacements", () => {
  test("演算子パスは findAlignmentGroups + computePaddings と同じ結果になる", () => {
    const lines = ["a = 1", "bb = 2"];
    const placements = computeDocumentPlacements(
      lines,
      mockDocument(lines),
      "typescript",
      mockConfig({ operators: ["="] }) as unknown as vscode.WorkspaceConfiguration,
      2
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 1 },
    ]);
  });

  test("markdown 言語ではテーブルのパイプ整列を計算する", () => {
    const lines = ["| a | bb |", "| --- | --- |", "| ccc | d |"];
    const placements = computeDocumentPlacements(
      lines,
      mockDocument(lines),
      "markdown",
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 2 },
      { lineIndex: 0, character: 9, padding: 1 },
      { lineIndex: 2, character: 10, padding: 2 },
    ]);
  });

  test("csv 言語では区切り文字の列整列を計算する", () => {
    const lines = ["a,b,c", '"x,y",zz,w'];
    const placements = computeDocumentPlacements(
      lines,
      mockDocument(lines),
      "csv",
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 1, padding: 4 },
      { lineIndex: 0, character: 3, padding: 1 },
    ]);
  });

  test("markdown 言語でも maxPadding が渡り、外れ値セルのある列は揃えない", () => {
    const lines = [
      "|a|cccccccccccccccccccc|",
      "|-|--------------------|",
      "|xxxxxxxxxxxxxxxxxxxx||",
    ];
    const placements = computeDocumentPlacements(
      lines,
      mockDocument(lines),
      "markdown",
      mockConfig({ maxPadding: 10 }) as unknown as vscode.WorkspaceConfiguration,
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 2, character: 22, padding: 1 },
    ]);
  });

  test("csv 言語でも maxPadding が渡り、外れ値セルのある列は揃えない", () => {
    const lines = [
      "a,bbbbbbbbbbbbbbb,c",
      "aaaaaaaaaaaaaaaaaaaa,ddddd,c",
    ];
    const placements = computeDocumentPlacements(
      lines,
      mockDocument(lines),
      "csv",
      mockConfig({ maxPadding: 10 }) as unknown as vscode.WorkspaceConfiguration,
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 17, padding: 9 },
    ]);
  });

  test("TS/JS では JSDoc @param の整列も合成される", () => {
    const lines = [" * @param {number} count x", " * @param {string} s 説明"];
    const placements = computeDocumentPlacements(
      lines,
      mockDocument(lines),
      "typescript",
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      4
    );
    assert.deepStrictEqual(placements, [
      { lineIndex: 1, character: 21, padding: 4 },
    ]);
  });
});

suite("buildCopyAlignedText", () => {
  test("選択がなければドキュメント全体を対象にする（演算子整列）", () => {
    const { editor } = mockEditor("typescript", ["a = 1", "bb = 2"]);
    const text = buildCopyAlignedText(
      editor,
      mockConfig({ operators: ["="] }) as unknown as vscode.WorkspaceConfiguration
    );
    assert.strictEqual(text, "a  = 1\nbb = 2");
  });

  test("選択範囲があればその範囲だけを対象にする", () => {
    const { editor } = mockEditor(
      "typescript",
      ["a = 1", "bb = 2"],
      [],
      new vscode.Selection(0, 0, 0, 5)
    );
    const text = buildCopyAlignedText(
      editor,
      mockConfig({ operators: ["="] }) as unknown as vscode.WorkspaceConfiguration
    );
    assert.strictEqual(text, "a  = 1");
  });

  test("選択範囲外の行を含むグループでも、表示と同じアライメント先で揃える", () => {
    // 選択は0-1行目だけだが、2行目（選択範囲外）が最も右にあるためそこに揃う。
    const lines = ["a = 1", "bb = 2", "ccc = 3"];
    const config = mockConfig({
      operators: ["="],
    }) as unknown as vscode.WorkspaceConfiguration;
    const { editor } = mockEditor(
      "typescript",
      lines,
      [],
      new vscode.Selection(0, 0, 1, 6)
    );
    const text = buildCopyAlignedText(editor, config);
    const expected = buildAlignedText(
      lines,
      computeDocumentPlacements(lines, mockDocument(lines), "typescript", config, 2),
      { startLine: 0, startChar: 0, endLine: 1, endChar: 6 }
    );
    assert.strictEqual(text, expected);
  });

  test("disabledLanguages の言語ではパディングを挿入せずそのままコピーする", () => {
    const { editor } = mockEditor("yaml", ["a = 1", "bb = 2"]);
    const text = buildCopyAlignedText(
      editor,
      mockConfig({
        disabledLanguages: ["yaml"],
        operators: ["="],
      }) as unknown as vscode.WorkspaceConfiguration
    );
    assert.strictEqual(text, "a = 1\nbb = 2");
  });

  test("markdown テーブルの整列もコピー時に実スペース化される", () => {
    const lines = ["| a | bb |", "| --- | --- |", "| ccc | d |"];
    const { editor } = mockEditor("markdown", lines);
    const text = buildCopyAlignedText(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration
    );
    const expected = buildAlignedText(
      lines,
      [
        { lineIndex: 0, character: 4, padding: 2 },
        { lineIndex: 0, character: 9, padding: 1 },
        { lineIndex: 2, character: 10, padding: 2 },
      ],
      null
    );
    assert.strictEqual(text, expected);
  });

  test("csv の列整列もコピー時に実スペース化される", () => {
    const lines = ["a,b,c", '"x,y",zz,w'];
    const { editor } = mockEditor("csv", lines);
    const text = buildCopyAlignedText(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration
    );
    const expected = buildAlignedText(
      lines,
      [
        { lineIndex: 0, character: 1, padding: 4 },
        { lineIndex: 0, character: 3, padding: 1 },
      ],
      null
    );
    assert.strictEqual(text, expected);
  });

  test("JSDoc @param の整列もコピー時に実スペース化される", () => {
    const lines = [" * @param {number} count x", " * @param {string} s 説明"];
    const { editor } = mockEditor("typescript", lines);
    const text = buildCopyAlignedText(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration
    );
    const expected = buildAlignedText(
      lines,
      [{ lineIndex: 1, character: 21, padding: 4 }],
      null
    );
    assert.strictEqual(text, expected);
  });
});

suite("ghostAlign.copyAligned コマンド", () => {
  test("package.json にコマンドパレット用のコマンドが登録されている", () => {
    const ext = vscode.extensions.getExtension("upu.ghost-align");
    assert.ok(ext, "拡張機能が読み込まれていること");
    const commands: { command: string; title: string }[] =
      ext!.packageJSON?.contributes?.commands ?? [];
    assert.ok(
      commands.some((c) => c.command === "ghostAlign.copyAligned"),
      "ghostAlign.copyAligned コマンドが package.json に存在すること"
    );
  });
});

suite("ghostAlign.toggleLanguage コマンド", () => {
  test("package.json にコマンドパレット用のコマンドが登録されている", () => {
    const ext = vscode.extensions.getExtension("upu.ghost-align");
    assert.ok(ext, "拡張機能が読み込まれていること");
    const commands: { command: string; title: string }[] =
      ext!.packageJSON?.contributes?.commands ?? [];
    assert.ok(
      commands.some((c) => c.command === "ghostAlign.toggleLanguage"),
      "ghostAlign.toggleLanguage コマンドが package.json に存在すること"
    );
  });
});

suite("decorateEditor と可視範囲モード（複数行ブロックコメント）", () => {
  test("可視範囲より上で閉じていないブロックコメント内の演算子は整列されない", () => {
    const lineCount = 10001;
    const lines = new Array<string>(lineCount).fill("filler");
    lines[0] = "/*";
    lines[9990] = "  a = 1;";
    lines[9991] = "  longName = 2;";
    const { editor, calls } = mockEditor("typescript", lines, [
      { start: 9990, end: 9995 },
    ]);
    decorateEditor(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.deepStrictEqual(calls[0], []);
  });

  test("可視範囲より上でブロックコメントが閉じていれば演算子は通常どおり整列される", () => {
    const lineCount = 10001;
    const lines = new Array<string>(lineCount).fill("filler");
    lines[0] = "/*";
    lines[1] = "*/";
    lines[9990] = "  a = 1;";
    lines[9991] = "  longName = 2;";
    const { editor, calls } = mockEditor("typescript", lines, [
      { start: 9990, end: 9995 },
    ]);
    decorateEditor(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.ok(calls[0].length > 0);
  });
});

suite("decorateEditor と可視範囲モード（CSS ブロック深さ）", () => {
  test("可視範囲より上で開いたルールブロックが閉じていなければ宣言行は通常どおり整列される", () => {
    const lineCount = 10001;
    const lines = new Array<string>(lineCount).fill("filler");
    lines[0] = ".foo {";
    lines[9990] = "  a: 1;";
    lines[9991] = "  longName: 2;";
    const { editor, calls } = mockEditor("css", lines, [
      { start: 9990, end: 9995 },
    ]);
    decorateEditor(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.ok(calls[0].length > 0);
  });

  test("可視範囲より上でルールブロックが閉じていれば、可視範囲内の疑似クラス `:` はセレクタ継続として除外される", () => {
    const lineCount = 10001;
    const lines = new Array<string>(lineCount).fill("filler");
    lines[0] = ".prev {";
    lines[1] = "  color: red;";
    lines[2] = "}";
    lines[9990] = ".foo:hover,";
    lines[9991] = ".barbaz:focus,";
    const { editor, calls } = mockEditor("css", lines, [
      { start: 9990, end: 9995 },
    ]);
    decorateEditor(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.deepStrictEqual(calls[0], []);
  });
});

suite("decorateEditor と可視範囲モード（YAML ブロックスカラー）", () => {
  test("可視範囲より上で開いたブロックスカラーが閉じていなければ、中身の `:` は整列されない", () => {
    const lineCount = 10001;
    // インデント2の filler で、キー行(indent 0)より深いままブロックスカラーが
    // ファイル末尾近くまで閉じずに続いている状況を再現する。
    const lines = new Array<string>(lineCount).fill("  filler");
    lines[0] = "a: |";
    lines[9990] = "  make target: build";
    lines[9991] = "  another target: test";
    const { editor, calls } = mockEditor("yaml", lines, [
      { start: 9990, end: 9995 },
    ]);
    decorateEditor(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.deepStrictEqual(calls[0], []);
  });

  test("可視範囲より上でブロックスカラーがインデントの減少で終了していれば、通常どおり整列される", () => {
    const lineCount = 10001;
    const lines = new Array<string>(lineCount).fill("filler");
    lines[0] = "a: |";
    lines[1] = "  content";
    lines[2] = "b: 2"; // インデント0に戻り、ブロックスカラーはここで終了
    lines[9990] = "make target: build";
    lines[9991] = "another target: test";
    const { editor, calls } = mockEditor("yaml", lines, [
      { start: 9990, end: 9995 },
    ]);
    decorateEditor(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      " ",
      "gray"
    );
    assert.ok(calls[0].length > 0);
  });
});

suite("decorateEditor と Markdown 区切り行の `-` パディング", () => {
  test("区切り行は `-` で見える文字として描画され、データ行は ghostCharacter のまま", () => {
    const lines = ["| a | b |", "| --- | --- |", "| cccccc | d |"];
    const { editor, calls } = mockEditor("markdown", lines);
    decorateEditor(
      editor,
      mockConfig({}) as unknown as vscode.WorkspaceConfiguration,
      "_",
      "gray"
    );
    const delimDecos = calls[0].filter((d) => d.range.start.line === 1);
    assert.strictEqual(delimDecos.length, 1);
    assert.strictEqual(delimDecos[0].renderOptions?.before?.contentText, "---");
    // `-` を可視にするため文字色は指定しない（ゴースト印の背景色のみ）
    assert.strictEqual(delimDecos[0].renderOptions?.before?.color, undefined);
    assert.strictEqual(
      delimDecos[0].renderOptions?.before?.backgroundColor,
      "gray"
    );
    const dataDecos = calls[0].filter((d) => d.range.start.line !== 1);
    assert.ok(dataDecos.length > 0);
    for (const d of dataDecos) {
      assert.ok(d.renderOptions?.before?.contentText?.split("").every((c) => c === "_"));
      assert.strictEqual(d.renderOptions?.before?.color, "gray");
    }
  });
});

suite("decorateEditor と可視範囲モード（大きい CSV/TSV）", () => {
  const config = () => mockConfig({}) as unknown as vscode.WorkspaceConfiguration;

  test("可視範囲外の最長セルを基準に揃い、スクロールしても揃え位置が変わらない", () => {
    const lines = new Array<string>(10001).fill("a,b");
    lines[0] = "aaaaaaaaaa,b";
    const { editor, calls } = mockEditor("csv", lines, [
      { start: 9000, end: 9040 },
    ]);
    decorateEditor(editor, config(), " ", "gray");
    assert.ok(calls[0].length > 0);
    for (const d of calls[0]) {
      assert.strictEqual(d.renderOptions?.before?.contentText, " ".repeat(9));
    }
    (editor as unknown as {
      visibleRanges: { start: { line: number }; end: { line: number } }[];
    }).visibleRanges = [{ start: { line: 0 }, end: { line: 40 } }];
    decorateEditor(editor, config(), " ", "gray");
    assert.ok(calls[1].length > 0);
    for (const d of calls[1]) {
      assert.strictEqual(d.renderOptions?.before?.contentText, " ".repeat(9));
    }
    assert.ok(calls[1].every((d) => d.range.start.line !== 0));
  });

  test("編集で最長セルが縮んだら変更行の再計算だけで揃え直される", () => {
    const lines = new Array<string>(10001).fill("a,b");
    lines[0] = "aaaaaaaaaa,b";
    const { editor, calls } = mockEditor("csv", lines, [{ start: 0, end: 40 }]);
    decorateEditor(editor, config(), " ", "gray");
    assert.ok(calls[0].length > 0);
    lines[0] = "a,b";
    notifyCsvDocumentChange(editor.document, [
      { range: new vscode.Range(0, 0, 0, "aaaaaaaaaa,b".length), text: "a,b" },
    ]);
    decorateEditor(editor, config(), " ", "gray");
    assert.deepStrictEqual(calls[1], []);
  });
});

suite("decorateEditor と可視範囲モード（大きい Markdown テーブル）", () => {
  const config = () => mockConfig({}) as unknown as vscode.WorkspaceConfiguration;

  test("可視範囲外の最長セルを基準に揃い、スクロールしても揃え位置が変わらない", () => {
    const lines = new Array<string>(10001).fill("| x | y |");
    lines[0] = "| a | b |";
    lines[1] = "| --- | --- |";
    lines[2] = "| xxxxxxxxxx | y |"; // 可視範囲から遠く離れた最長セル
    const { editor, calls } = mockEditor("markdown", lines, [
      { start: 9000, end: 9040 },
    ]);
    decorateEditor(editor, config(), " ", "gray");
    assert.ok(calls[0].length > 0);
    assert.ok(
      calls[0].some((d) => d.renderOptions?.before?.contentText?.length === 9)
    );
    (editor as unknown as {
      visibleRanges: { start: { line: number }; end: { line: number } }[];
    }).visibleRanges = [{ start: { line: 9500 }, end: { line: 9540 } }];
    decorateEditor(editor, config(), " ", "gray");
    assert.ok(calls[1].length > 0);
    assert.ok(
      calls[1].some((d) => d.renderOptions?.before?.contentText?.length === 9)
    );
  });

  test("編集でテーブル内容が変わったらキャッシュが無効化され揃え直される", () => {
    const lines = new Array<string>(10001).fill("| x | y |");
    lines[0] = "| a | b |";
    lines[1] = "| --- | --- |";
    lines[2] = "| xxxxxxxxxx | y |";
    const { editor, calls } = mockEditor("markdown", lines, [
      { start: 9000, end: 9040 },
    ]);
    decorateEditor(editor, config(), " ", "gray");
    assert.ok(
      calls[0].some((d) => d.renderOptions?.before?.contentText?.length === 9)
    );

    lines[2] = "| x | y |"; // 最長セルを解消（残る最大幅は区切り行の "---" = 3）
    notifyMarkdownDocumentChange(editor.document);
    decorateEditor(editor, config(), " ", "gray");
    assert.ok(calls[1].length > 0);
    for (const d of calls[1]) {
      assert.strictEqual(d.renderOptions?.before?.contentText?.length, 2);
    }
  });
});

suite("README 設定表との同期", () => {
  // 設定キーの過不足は機械的に照合できる（#280）。v1.0.0 の作業中に
  // disabledLanguages の行が 0.4.0 以来ずっと欠落していたのが見つかった。
  // 説明文の内容の鮮度（意味的なずれ）はここでは検証できない。
  type ConfigProp = { markdownDeprecationMessage?: string };

  function configProperties(): Record<string, ConfigProp> {
    const ext = vscode.extensions.getExtension("upu.ghost-align");
    assert.ok(ext, "拡張機能が読み込まれていること");
    return ext!.packageJSON?.contributes?.configuration?.properties ?? {};
  }

  function readmeContents(): { file: string; content: string }[] {
    const ext = vscode.extensions.getExtension("upu.ghost-align");
    const root = ext!.extensionPath;
    return ["README.md", "README.ja.md"].map((file) => ({
      file,
      content: fs.readFileSync(path.join(root, file), "utf8"),
    }));
  }

  function tableKeys(content: string): string[] {
    return [...content.matchAll(/^\| `(ghostAlign\.[^`]+)` \|/gm)].map(
      (m) => m[1]
    );
  }

  test("contributes.configuration の全キー（deprecated 除く）が両 README の設定表に載っている", () => {
    const props = configProperties();
    const readmes = readmeContents();
    for (const [key, prop] of Object.entries(props)) {
      if (prop.markdownDeprecationMessage) {
        continue;
      }
      for (const { file, content } of readmes) {
        assert.ok(
          tableKeys(content).includes(key),
          `${key} の行が ${file} の設定表にあること`
        );
      }
    }
  });

  test("設定表の全行が package.json に存在するキーである（廃止キーの行が残っていない）", () => {
    const props = configProperties();
    for (const { file, content } of readmeContents()) {
      for (const key of tableKeys(content)) {
        assert.ok(
          key in props,
          `${file} の設定表の ${key} が package.json に存在すること`
        );
      }
    }
  });

  test("deprecated キーは設定表に行を持たない（脚注での案内に統一）", () => {
    const props = configProperties();
    for (const { file, content } of readmeContents()) {
      for (const key of tableKeys(content)) {
        assert.ok(
          !props[key]?.markdownDeprecationMessage,
          `${file} の設定表に deprecated キー ${key} の行が無いこと`
        );
      }
    }
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

  test("workspaceState の OFF は globalState の ON より優先される", () => {
    assert.strictEqual(
      resolveInitialEnabled(
        mockState({ enabled: true }),
        mockState({ enabled: false })
      ),
      false
    );
  });

  test("workspaceState の ON は globalState の OFF より優先される", () => {
    assert.strictEqual(
      resolveInitialEnabled(
        mockState({ enabled: false }),
        mockState({ enabled: true })
      ),
      true
    );
  });

  test("workspaceState 未設定なら globalState にフォールバックする（既存の保存値を引き継ぐ）", () => {
    assert.strictEqual(
      resolveInitialEnabled(mockState({ enabled: false }), mockState({})),
      false
    );
  });

  test("どちらも未設定ならデフォルトで有効", () => {
    assert.strictEqual(
      resolveInitialEnabled(mockState({}), mockState({})),
      true
    );
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

suite("isAlignableScheme", () => {
  test("通常ファイル・未保存・リモート系・ノートブックセルのスキーマは整列対象", () => {
    assert.strictEqual(isAlignableScheme("file"), true);
    assert.strictEqual(isAlignableScheme("untitled"), true);
    assert.strictEqual(isAlignableScheme("vscode-remote"), true);
    assert.strictEqual(isAlignableScheme("vscode-vfs"), true);
    assert.strictEqual(isAlignableScheme("vscode-notebook-cell"), true);
  });

  test("出力パネル・デバッグ・検索エディタなどは整列対象外", () => {
    assert.strictEqual(isAlignableScheme("output"), false);
    assert.strictEqual(isAlignableScheme("debug"), false);
    assert.strictEqual(isAlignableScheme("search-editor"), false);
    assert.strictEqual(isAlignableScheme("comment"), false);
  });
});

suite("有効/無効の一本化", () => {
  test("ghostAlign.enabled 設定は廃止されている（トグル状態に一本化）", () => {
    // 設定とトグルの二重管理が表示と実効状態の食い違いを生んでいた。
    // 設定スキーマに残っていれば再導入の退行とみなす。
    const ext = vscode.extensions.getExtension("upu.ghost-align");
    assert.ok(ext, "拡張機能が読み込まれていること");
    const props =
      ext.packageJSON?.contributes?.configuration?.properties ?? {};
    assert.ok(
      !("ghostAlign.enabled" in props),
      "ghostAlign.enabled が設定スキーマに存在しない"
    );
    assert.ok("ghostAlign.operators" in props);
  });
});

suite("package.json との既定値同期", () => {
  // extension.ts のコメント頼みの二重管理（DEFAULT_OPERATORS_BY_LANGUAGE /
  // DEFAULT_GHOST_CHAR / DEFAULT_GHOST_COLOR ⇔ package.json の default）が
  // 片方だけ更新されて食い違うと、設定 UI の表示と実効値が静かにずれる。
  function configProperties(): Record<string, { default?: unknown }> {
    const ext = vscode.extensions.getExtension("upu.ghost-align");
    assert.ok(ext, "拡張機能が読み込まれていること");
    return ext!.packageJSON?.contributes?.configuration?.properties ?? {};
  }

  test("operatorsByLanguage の既定値が DEFAULT_OPERATORS_BY_LANGUAGE と一致する", () => {
    const props = configProperties();
    assert.deepStrictEqual(
      props["ghostAlign.operatorsByLanguage"]?.default,
      DEFAULT_OPERATORS_BY_LANGUAGE
    );
  });

  test("operators の既定値が resolveOperatorsForLanguage のフォールバックと一致する", () => {
    const props = configProperties();
    assert.deepStrictEqual(props["ghostAlign.operators"]?.default, ["="]);
  });

  test("廃止された ghostCharacter が contributes.configuration に存在しない", () => {
    const props = configProperties();
    assert.strictEqual(props["ghostAlign.ghostCharacter"], undefined);
  });

  test("ghostColor の既定値が DEFAULT_GHOST_COLOR と一致する", () => {
    const props = configProperties();
    assert.strictEqual(
      props["ghostAlign.ghostColor"]?.default,
      DEFAULT_GHOST_COLOR
    );
  });

  test("alignUnknownLanguages が default true で登録されている", () => {
    const props = configProperties();
    assert.strictEqual(props["ghostAlign.alignUnknownLanguages"]?.default, true);
  });

  test("機能スコープの enabled キーが default true で登録されている", () => {
    const props = configProperties();
    for (const key of [
      "ghostAlign.jsdoc.enabled",
      "ghostAlign.markdownTable.enabled",
      "ghostAlign.csv.enabled",
    ]) {
      assert.strictEqual(props[key]?.default, true, key);
    }
  });

  test("旧 alignJsdocParams に新キーへ誘導する deprecation メッセージが付いている", () => {
    const props = configProperties() as Record<
      string,
      { markdownDeprecationMessage?: string }
    >;
    const message =
      props["ghostAlign.alignJsdocParams"]?.markdownDeprecationMessage;
    assert.ok(message && message.includes("ghostAlign.jsdoc.enabled"));
  });
});
