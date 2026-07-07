import * as assert from "assert";
import * as vscode from "vscode";
import { buildAlignedText } from "../../copyAligned";
import {
  decorateEditor,
  computeDocumentPlacements,
  buildCopyAlignedText,
  notifyCsvDocumentChange,
  notifyMarkdownDocumentChange,
} from "../../decorate";
import { mockConfig, mockDocument, mockEditor } from "./testHelpers";

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
