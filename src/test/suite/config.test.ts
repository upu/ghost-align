import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { findOperatorTargets, findAssignmentEquals } from "../../finders";
import { findAlignmentGroups, computePaddings } from "../../paddings";
import {
  resolveGhostSettings,
  resolveAlignmentPath,
  resolveOperatorsForLanguage,
  resolveCsvDelimiter,
  isLanguageDisabled,
  toggleDisabledLanguage,
  isAlignableScheme,
  DEFAULT_GHOST_CHAR,
  DEFAULT_GHOST_COLOR,
  DEFAULT_OPERATORS_BY_LANGUAGE,
  DEFAULT_CSV_DELIMITERS,
} from "../../config";
import { mockDocument, mockConfig, findOperatorTarget } from "./testHelpers";

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

  test("csv.delimiters でユーザーが csv をセミコロンに上書きできる", () => {
    const config = mockConfig({ "csv.delimiters": { csv: ";" } });
    assert.deepStrictEqual(resolveAlignmentPath("csv", config), {
      kind: "csv",
      delimiter: ";",
    });
  });

  test("csv.delimiters に追加した独自 languageId が csv パスに乗る", () => {
    const config = mockConfig({
      "csv.delimiters": { "csv (semicolon)": ";" },
    });
    assert.deepStrictEqual(
      resolveAlignmentPath("csv (semicolon)", config),
      { kind: "csv", delimiter: ";" }
    );
  });

  test("csv.delimiters が未設定の独自 languageId は csv パスに乗らず operators パスになる", () => {
    const path = resolveAlignmentPath("csv (semicolon)", mockConfig({}));
    assert.strictEqual(path.kind, "operators");
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

suite("resolveCsvDelimiter", () => {
  test("既定値は csv=カンマ、tsv=タブ", () => {
    assert.strictEqual(resolveCsvDelimiter(mockConfig({}), "csv"), ",");
    assert.strictEqual(resolveCsvDelimiter(mockConfig({}), "tsv"), "\t");
  });

  test("DEFAULT_CSV_DELIMITERS が package.json の既定値と一致する", () => {
    assert.deepStrictEqual(DEFAULT_CSV_DELIMITERS, { csv: ",", tsv: "\t" });
  });

  test("csv.delimiters でユーザーが区切り文字を上書きできる", () => {
    const config = mockConfig({ "csv.delimiters": { csv: ";" } });
    assert.strictEqual(resolveCsvDelimiter(config, "csv"), ";");
  });

  test("csv.delimiters に無い languageId は undefined（CSV パス対象外）", () => {
    assert.strictEqual(
      resolveCsvDelimiter(mockConfig({}), "typescript"),
      undefined
    );
  });

  test("csv.delimiters に追加した独自 languageId を解決できる", () => {
    const config = mockConfig({
      "csv.delimiters": { "csv (semicolon)": ";" },
    });
    assert.strictEqual(
      resolveCsvDelimiter(config, "csv (semicolon)"),
      ";"
    );
  });

  test("2文字以上の値は不正として既定値にフォールバックする（csv/tsv）", () => {
    const config = mockConfig({ "csv.delimiters": { csv: ";;" } });
    assert.strictEqual(resolveCsvDelimiter(config, "csv"), ",");
  });

  test('ダブルクォートは不正として拒否され既定値にフォールバックする', () => {
    const config = mockConfig({ "csv.delimiters": { csv: '"' } });
    assert.strictEqual(resolveCsvDelimiter(config, "csv"), ",");
  });

  test("空文字は不正として既定値にフォールバックする", () => {
    const config = mockConfig({ "csv.delimiters": { tsv: "" } });
    assert.strictEqual(resolveCsvDelimiter(config, "tsv"), "\t");
  });

  test("独自 languageId の不正値は undefined に落ちる（既定値が無いため）", () => {
    const config = mockConfig({
      "csv.delimiters": { "csv (semicolon)": ";;" },
    });
    assert.strictEqual(
      resolveCsvDelimiter(config, "csv (semicolon)"),
      undefined
    );
  });

  test("csv.delimiters 自体が不正な型（null）でも csv/tsv は既定値にフォールバックする", () => {
    const config = mockConfig({ "csv.delimiters": null });
    assert.strictEqual(resolveCsvDelimiter(config, "csv"), ",");
    assert.strictEqual(resolveCsvDelimiter(config, "tsv"), "\t");
  });

  test("csv.delimiters 自体が不正な型（配列）でも csv/tsv は既定値にフォールバックする", () => {
    const config = mockConfig({ "csv.delimiters": [";"] });
    assert.strictEqual(resolveCsvDelimiter(config, "csv"), ",");
    assert.strictEqual(resolveCsvDelimiter(config, "tsv"), "\t");
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

  test("yaml / css / scss / less / graphql は既定で `:` を揃える", () => {
    for (const lang of ["yaml", "css", "scss", "less", "graphql"]) {
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
      terraform: ["region = \"us-east-1\"", "instance_type = \"t3.micro\""],
      proto3: ["name = 1;", "id = 2;"],
      elixir: ["x = 1", "longer_name = 2"],
      perl: ["my $x = 1;", "my $longer_name = 2;"],
      sql: ["x = 1", "longer_name = 2"],
      haskell: ["x = 1", "longerName = 2"],
      powershell: ["$x = 1", "$longerName = 2"],
      dockerfile: ["ENV X=1", "ENV LONGER_NAME=2"],
      scala: ["val x = 1", "val longerName = 2"],
      groovy: ["def x = 1", "def longerName = 2"],
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

  test("グローバル operators の空文字・空白のみ・非文字列は静かに除外される", () => {
    const config = mockConfig({
      operators: ["", "  ", "=", 42, null, undefined, "\t"],
    });
    assert.deepStrictEqual(
      resolveOperatorsForLanguage(config, "plaintext"),
      ["="]
    );
  });

  test("operatorsByLanguage の空文字・空白のみ・非文字列も静かに除外される", () => {
    const config = mockConfig({
      operatorsByLanguage: {
        ...DEFAULT_OPERATORS_BY_LANGUAGE,
        python: ["", "=", "  ", 1, null],
      },
    });
    assert.deepStrictEqual(resolveOperatorsForLanguage(config, "python"), [
      "=",
    ]);
  });

  test("不正な演算子だけの設定は空配列になり、ハングせず整列対象なしとして扱われる", () => {
    const config = mockConfig({ operators: ["", "   ", 0, false] });
    assert.deepStrictEqual(
      resolveOperatorsForLanguage(config, "plaintext"),
      []
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

  test("TS: switch の case ラベルの `:` は既定設定でも揃わない（#336）", () => {
    const operators = resolveOperatorsForLanguage(
      mockConfig({}),
      "typescript"
    );
    const doc = mockDocument(["  case 1:", "  case 22:"]);
    const groups = findAlignmentGroups(doc, operators, "typescript");
    assert.strictEqual(groups.length, 0);
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

  test("terraform / proto3 / elixir / perl は既定で `=` を揃える", () => {
    const config = mockConfig({ operators: [":"] });
    for (const lang of ["terraform", "proto3", "elixir", "perl"]) {
      assert.deepStrictEqual(
        resolveOperatorsForLanguage(config, lang),
        ["="],
        lang
      );
    }
  });

  test("sql / haskell / powershell / dockerfile / scala / groovy は既定で `=` を揃える", () => {
    const config = mockConfig({ operators: [":"] });
    for (const lang of [
      "sql",
      "haskell",
      "powershell",
      "dockerfile",
      "scala",
      "groovy",
    ]) {
      assert.deepStrictEqual(
        resolveOperatorsForLanguage(config, lang),
        ["="],
        lang
      );
    }
  });

  test("r は既定で `<-` と `=` を揃える", () => {
    assert.deepStrictEqual(
      resolveOperatorsForLanguage(mockConfig({}), "r"),
      ["<-", "="]
    );
  });

  test("GraphQL: フィールド定義の `:` が連続行で揃う", () => {
    const doc = mockDocument(["name: String!", "longerName: Int!"]);
    const groups = findAlignmentGroups(doc, [":"], "graphql");
    assert.strictEqual(groups.length, 1);
    const placements = computePaddings(groups);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 4, padding: 6 },
    ]);
  });

  test("R: 代入演算子 `<-` が連続行で揃う", () => {
    const doc = mockDocument(["x <- 1", "longer_name <- 2"]);
    const groups = findAlignmentGroups(doc, ["<-", "="], "r");
    assert.strictEqual(groups.length, 1);
    const placements = computePaddings(groups);
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 2, padding: 10 },
    ]);
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

suite("README 言語一覧プロースとの同期", () => {
  // #317: DEFAULT_OPERATORS_BY_LANGUAGE に言語を追加したのに README の「動作の
  // 概要」のプロース（`= is aligned by default` の文）を更新し忘れる、という
  // ズレを機械的に検出する。文言の意味までは検証できないが、キーの抜け漏れは防げる。
  function readmeContents(): { file: string; content: string }[] {
    const ext = vscode.extensions.getExtension("upu.ghost-align");
    assert.ok(ext, "拡張機能が読み込まれていること");
    const root = ext!.extensionPath;
    return ["README.md", "README.ja.md"].map((file) => ({
      file,
      content: fs.readFileSync(path.join(root, file), "utf8"),
    }));
  }

  function languageListLine(content: string): string | undefined {
    return content
      .split("\n")
      .find(
        (line) =>
          line.includes("is aligned by default") ||
          line.includes("既定では `=` を揃えます")
      );
  }

  // 言語一覧プロースの行から言語 ID 候補（英小文字+数字の単語）だけを拾う。演算子
  // トークン（`=` `:` `=>` `<-`）は記号始まりなので混ざらず、`ghostAlign.operators`
  // のようなドット/大文字混じりの設定キーも取りこぼす（バッククォート内が完全に
  // 小文字+数字でないと一致しない）。`true`/`false` のような真偽値リテラルだけは
  // 形が言語 ID と区別できないため明示的に除外する。
  const NON_LANGUAGE_TOKENS = new Set(["true", "false"]);

  function languageIdsInLine(line: string): string[] {
    return [...line.matchAll(/`([a-z][a-z0-9]*)`/g)]
      .map((m) => m[1])
      .filter((token) => !NON_LANGUAGE_TOKENS.has(token));
  }

  test("DEFAULT_OPERATORS_BY_LANGUAGE の全言語が両 README の言語一覧プロースに過不足なく含まれている", () => {
    const expected = Object.keys(DEFAULT_OPERATORS_BY_LANGUAGE).sort();
    for (const { file, content } of readmeContents()) {
      const line = languageListLine(content);
      assert.ok(line, `${file} に言語一覧プロースの行があること`);
      const actual = [...new Set(languageIdsInLine(line!))].sort();
      assert.deepStrictEqual(
        actual,
        expected,
        `${file} の言語一覧プロースが DEFAULT_OPERATORS_BY_LANGUAGE と一致すること`
      );
    }
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

  test("csv.delimiters の既定値が DEFAULT_CSV_DELIMITERS と一致する", () => {
    const props = configProperties();
    assert.deepStrictEqual(
      props["ghostAlign.csv.delimiters"]?.default,
      DEFAULT_CSV_DELIMITERS
    );
  });

  test("廃止された ghostCharacter が contributes.configuration に存在しない", () => {
    const props = configProperties();
    assert.strictEqual(props["ghostAlign.ghostCharacter"], undefined);
  });

  test("DEFAULT_GHOST_CHAR は NBSP（U+00A0）であり ASCII space ではない", () => {
    // VS Code は decoration の contentText 内で連続する ASCII space を1文字に
    // 潰すため、ASCII space だとパディングが折り畳まれてアライメントが壊れる。
    assert.strictEqual(DEFAULT_GHOST_CHAR, "\u00A0");
    assert.notStrictEqual(DEFAULT_GHOST_CHAR, " ");
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
