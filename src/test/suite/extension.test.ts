import * as assert from "assert";
import * as vscode from "vscode";
import { findOperatorColumn, findAlignmentGroups } from "../../extension";

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
});
