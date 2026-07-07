import * as assert from "assert";
import * as vscode from "vscode";
import { resolveInitialEnabled, statusBarText, debounce, activate } from "../../extension";
import { wait, mockState, mockEditor } from "./testHelpers";

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

suite("エディタの tabSize 変更時の再描画", () => {
  test("onDidChangeTextEditorOptions の発火で可視エディタが再デコレートされる", async function () {
    this.timeout(5000);

    // activate() は実際にすでに一度（onStartupFinished で）走っているため、
    // 同じコマンド ID を二重登録すると vscode.commands.registerCommand が例外を
    // 投げる。activate() が触る vscode.window / vscode.commands の該当箇所を
    // すべて無害化した上で、実際の activate() をもう一度呼び出し、
    // onDidChangeTextEditorOptions に渡されたコールバックだけを捕捉して直接発火
    // させることで、真の VS Code イベントやパッケージ済み dist に頼らずに配線を検証する。
    const dummyDisposable = { dispose() {} };
    const fakeStatusBarItem = {
      command: "",
      tooltip: "",
      text: "",
      show() {},
      hide() {},
      dispose() {},
    };

    const restorers: (() => void)[] = [];
    function stub<O extends object, K extends keyof O>(obj: O, key: K, value: O[K]) {
      const original = Object.getOwnPropertyDescriptor(obj, key);
      Object.defineProperty(obj, key, {
        configurable: true,
        value,
      });
      restorers.push(() => {
        if (original) {
          Object.defineProperty(obj, key, original);
        } else {
          delete obj[key];
        }
      });
    }

    let optionsChangeCallback: (() => void) | undefined;

    const { editor: fakeEditor, calls } = mockEditor("typescript", [
      "a = 1",
      "bb = 2",
    ]);
    (fakeEditor.document as unknown as { uri: { scheme: string } }).uri = {
      scheme: "file",
    };

    stub(vscode.window, "createStatusBarItem", (() => fakeStatusBarItem) as unknown as typeof vscode.window.createStatusBarItem);
    stub(vscode.commands, "registerCommand", (() => dummyDisposable) as unknown as typeof vscode.commands.registerCommand);
    stub(vscode.window, "onDidChangeActiveTextEditor", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeActiveTextEditor);
    stub(vscode.window, "onDidChangeVisibleTextEditors", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeVisibleTextEditors);
    stub(vscode.window, "onDidChangeTextEditorVisibleRanges", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeTextEditorVisibleRanges);
    stub(vscode.workspace, "onDidChangeTextDocument", (() => dummyDisposable) as unknown as typeof vscode.workspace.onDidChangeTextDocument);
    stub(vscode.workspace, "onDidChangeConfiguration", (() => dummyDisposable) as unknown as typeof vscode.workspace.onDidChangeConfiguration);
    stub(vscode.window, "onDidChangeTextEditorOptions", ((cb: () => void) => {
      optionsChangeCallback = cb;
      return dummyDisposable;
    }) as unknown as typeof vscode.window.onDidChangeTextEditorOptions);
    stub(vscode.window, "visibleTextEditors", [fakeEditor] as unknown as typeof vscode.window.visibleTextEditors);

    try {
      const context = {
        subscriptions: [] as { dispose(): void }[],
        globalState: mockState({}),
        workspaceState: mockState({}),
      } as unknown as vscode.ExtensionContext;
      activate(context);

      assert.ok(
        optionsChangeCallback,
        "onDidChangeTextEditorOptions が購読されていること"
      );
      const callsBefore = calls.length;

      optionsChangeCallback!();
      await wait(200); // debounce (80ms) が発火するのを待つ

      assert.ok(
        calls.length > callsBefore,
        "onDidChangeTextEditorOptions のコールバックで再デコレートが走ること"
      );
    } finally {
      for (const restore of restorers.reverse()) {
        restore();
      }
    }
  });
});
