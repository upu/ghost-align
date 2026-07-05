import * as vscode from "vscode";
import { findOperatorTargets, DocScanState } from "../../finders";

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// #203: finders.ts から削除された findOperatorTarget / findOperatorColumn
// 互換 API を、現行の findOperatorTargets から組み立てるテスト専用ヘルパー。
// 単一演算子・第1カラムのみを見る既存テストの検証意図はそのまま維持する。
export function findOperatorTarget(
  lineText: string,
  operators: string[],
  languageId?: string,
  initialState: DocScanState = "code"
): { insert: number; align: number } | null {
  const columns = findOperatorTargets(lineText, operators, languageId, initialState);
  return columns.length > 0
    ? { insert: columns[0].insert, align: columns[0].align }
    : null;
}

export function findOperatorColumn(
  lineText: string,
  operators: string[],
  languageId?: string,
  initialState: DocScanState = "code"
): number | null {
  const target = findOperatorTarget(lineText, operators, languageId, initialState);
  return target ? target.align : null;
}

// vscode.TextDocument の最小限モック
export function mockDocument(lines: string[]) {
  return {
    lineCount: lines.length,
    lineAt(i: number) {
      return { text: lines[i] };
    },
  } as any;
}

// vscode.WorkspaceConfiguration の最小限モック。values に入っているキーは
// 「ユーザーが明示設定した」扱いで、inspect からは globalValue として見える。
export function mockConfig(values: Record<string, unknown>) {
  return {
    get<T>(key: string, defaultValue: T): T {
      return (key in values ? values[key] : defaultValue) as T;
    },
    inspect<T>(key: string): { globalValue?: T } | undefined {
      return key in values ? { globalValue: values[key] as T } : {};
    },
  };
}

// vscode.Memento (globalState) の最小限モック
export function mockState(values: Record<string, unknown>) {
  return {
    get<T>(key: string, defaultValue: T): T {
      return (key in values ? values[key] : defaultValue) as T;
    },
  };
}

// vscode.TextEditor の最小限モック（setDecorations 呼び出しを記録する）
export function mockEditor(
  languageId: string,
  lines: string[] = [],
  visibleRanges: { start: number; end: number }[] = [],
  selection: vscode.Selection = new vscode.Selection(0, 0, 0, 0)
) {
  const calls: vscode.DecorationOptions[][] = [];
  const editor = {
    document: {
      languageId,
      lineCount: lines.length,
      lineAt(i: number) {
        return { text: lines[i] };
      },
    },
    visibleRanges: visibleRanges.map((r) => ({
      start: { line: r.start },
      end: { line: r.end },
    })),
    options: { tabSize: 2 },
    selection,
    setDecorations(_type: unknown, decorations: vscode.DecorationOptions[]) {
      calls.push(decorations);
    },
  } as unknown as vscode.TextEditor;
  return { editor, calls };
}
