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

  test("package.json にエディタ右クリックメニュー用の貢献が登録されている", () => {
    const ext = vscode.extensions.getExtension("upu.ghost-align");
    assert.ok(ext, "拡張機能が読み込まれていること");
    const editorContextMenus: { command: string; group?: string; when?: string }[] =
      ext!.packageJSON?.contributes?.menus?.["editor/context"] ?? [];
    const entry = editorContextMenus.find((m) => m.command === "ghostAlign.copyAligned");
    assert.ok(entry, "ghostAlign.copyAligned が editor/context メニューに存在すること");
    assert.strictEqual(entry!.group, "9_cutcopypaste");
    assert.strictEqual(entry!.when, "editorTextFocus");
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

  test("有効かつ現在言語が無効化されていれば言語名付きで表示する", () => {
    assert.strictEqual(statusBarText(true, "css"), "Ghost Align: ON (css off)");
  });

  test("全体 OFF のときは言語が無効化されていても OFF のみ表示する", () => {
    assert.strictEqual(statusBarText(false, "css"), "Ghost Align: OFF");
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

suite("再デコレート対象のスコープ限定 (#364)", () => {
  function stubCommon(restorers: (() => void)[]) {
    const dummyDisposable = { dispose() {} };
    const fakeStatusBarItem = {
      command: "",
      tooltip: "",
      text: "",
      show() {},
      hide() {},
      dispose() {},
    };
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
    stub(vscode.window, "createStatusBarItem", (() => fakeStatusBarItem) as unknown as typeof vscode.window.createStatusBarItem);
    stub(vscode.commands, "registerCommand", (() => dummyDisposable) as unknown as typeof vscode.commands.registerCommand);
    stub(vscode.window, "onDidChangeActiveTextEditor", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeActiveTextEditor);
    stub(vscode.window, "onDidChangeVisibleTextEditors", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeVisibleTextEditors);
    stub(vscode.window, "onDidChangeTextEditorOptions", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeTextEditorOptions);
    stub(vscode.workspace, "onDidChangeConfiguration", (() => dummyDisposable) as unknown as typeof vscode.workspace.onDidChangeConfiguration);
    return { dummyDisposable };
  }

  test("ドキュメント変更時、そのドキュメントを表示していないエディタは再デコレートされない", async function () {
    this.timeout(5000);

    const restorers: (() => void)[] = [];
    stubCommon(restorers);

    let documentChangeCallback:
      | ((e: { document: vscode.TextDocument; contentChanges: never[] }) => void)
      | undefined;

    const { editor: editorA, calls: callsA } = mockEditor("typescript", ["a = 1"]);
    const { editor: editorB, calls: callsB } = mockEditor("typescript", ["bb = 2"]);
    (editorA.document as unknown as { uri: { scheme: string } }).uri = { scheme: "file" };
    (editorB.document as unknown as { uri: { scheme: string } }).uri = { scheme: "file" };

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
    stub(
      vscode.window,
      "onDidChangeTextEditorVisibleRanges",
      (() => ({ dispose() {} })) as unknown as typeof vscode.window.onDidChangeTextEditorVisibleRanges
    );
    stub(vscode.workspace, "onDidChangeTextDocument", ((cb: typeof documentChangeCallback) => {
      documentChangeCallback = cb;
      return { dispose() {} };
    }) as unknown as typeof vscode.workspace.onDidChangeTextDocument);
    stub(vscode.window, "visibleTextEditors", [editorA, editorB] as unknown as typeof vscode.window.visibleTextEditors);

    try {
      const context = {
        subscriptions: [] as { dispose(): void }[],
        globalState: mockState({}),
        workspaceState: mockState({}),
      } as unknown as vscode.ExtensionContext;
      activate(context);

      assert.ok(documentChangeCallback, "onDidChangeTextDocument が購読されていること");

      const callsBeforeA = callsA.length;
      const callsBeforeB = callsB.length;

      documentChangeCallback!({ document: editorA.document, contentChanges: [] });
      await wait(200); // debounce (80ms) が発火するのを待つ

      assert.ok(
        callsA.length > callsBeforeA,
        "変更されたドキュメントを表示するエディタは再デコレートされること"
      );
      assert.strictEqual(
        callsB.length,
        callsBeforeB,
        "無関係なドキュメントを表示するエディタは再デコレートされないこと"
      );
    } finally {
      for (const restore of restorers.reverse()) {
        restore();
      }
    }
  });

  test("visibleRanges変更時、イベントのtextEditor以外は再デコレートされない", async function () {
    this.timeout(5000);

    const restorers: (() => void)[] = [];
    stubCommon(restorers);

    let visibleRangesCallback:
      | ((e: { textEditor: vscode.TextEditor }) => void)
      | undefined;

    // onDidChangeTextEditorVisibleRanges だけが対象を絞る条件
    // (lineCount >= LARGE_FILE_LINE_THRESHOLD) を持つため、大ファイル相当の
    // 行数を用意する。中身は演算子検出が軽く済むよう単純な行を繰り返す。
    const largeLines = new Array(10000).fill("a = 1");
    const { editor: editorA, calls: callsA } = mockEditor("typescript", largeLines, [
      { start: 0, end: 10 },
    ]);
    const { editor: editorB, calls: callsB } = mockEditor("typescript", ["bb = 2"]);
    (editorA.document as unknown as { uri: { scheme: string } }).uri = { scheme: "file" };
    (editorB.document as unknown as { uri: { scheme: string } }).uri = { scheme: "file" };

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
    stub(vscode.window, "onDidChangeTextEditorVisibleRanges", ((cb: typeof visibleRangesCallback) => {
      visibleRangesCallback = cb;
      return { dispose() {} };
    }) as unknown as typeof vscode.window.onDidChangeTextEditorVisibleRanges);
    stub(vscode.workspace, "onDidChangeTextDocument", (() => ({ dispose() {} })) as unknown as typeof vscode.workspace.onDidChangeTextDocument);
    stub(vscode.window, "visibleTextEditors", [editorA, editorB] as unknown as typeof vscode.window.visibleTextEditors);

    try {
      const context = {
        subscriptions: [] as { dispose(): void }[],
        globalState: mockState({}),
        workspaceState: mockState({}),
      } as unknown as vscode.ExtensionContext;
      activate(context);

      assert.ok(
        visibleRangesCallback,
        "onDidChangeTextEditorVisibleRanges が購読されていること"
      );

      const callsBeforeA = callsA.length;
      const callsBeforeB = callsB.length;

      visibleRangesCallback!({ textEditor: editorA });
      await wait(200); // debounce (80ms) が発火するのを待つ

      assert.ok(
        callsA.length > callsBeforeA,
        "スクロールしたエディタ自身は再デコレートされること"
      );
      assert.strictEqual(
        callsB.length,
        callsBeforeB,
        "スクロールしていない他の可視エディタは再デコレートされないこと"
      );
    } finally {
      for (const restore of restorers.reverse()) {
        restore();
      }
    }
  });
});

suite("言語モード変更時の再デコレートとステータスバー更新 (#395)", () => {
  function stubCommon(restorers: (() => void)[]) {
    const dummyDisposable = { dispose() {} };
    const fakeStatusBarItem = {
      command: "",
      tooltip: "",
      text: "",
      show() {},
      hide() {},
      dispose() {},
    };
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
    stub(vscode.window, "createStatusBarItem", (() => fakeStatusBarItem) as unknown as typeof vscode.window.createStatusBarItem);
    stub(vscode.commands, "registerCommand", (() => dummyDisposable) as unknown as typeof vscode.commands.registerCommand);
    stub(vscode.window, "onDidChangeActiveTextEditor", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeActiveTextEditor);
    stub(vscode.window, "onDidChangeVisibleTextEditors", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeVisibleTextEditors);
    stub(vscode.window, "onDidChangeTextEditorOptions", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeTextEditorOptions);
    stub(vscode.window, "onDidChangeTextEditorVisibleRanges", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeTextEditorVisibleRanges);
    stub(vscode.workspace, "onDidChangeTextDocument", (() => dummyDisposable) as unknown as typeof vscode.workspace.onDidChangeTextDocument);
    stub(vscode.workspace, "onDidChangeConfiguration", (() => dummyDisposable) as unknown as typeof vscode.workspace.onDidChangeConfiguration);
    return { fakeStatusBarItem };
  }

  test("onDidOpenTextDocument の発火で、そのドキュメントを表示するエディタだけが再デコレートされる", async function () {
    this.timeout(5000);

    const restorers: (() => void)[] = [];
    stubCommon(restorers);

    let openDocumentCallback:
      | ((document: vscode.TextDocument) => void)
      | undefined;

    const { editor: editorA, calls: callsA } = mockEditor("plaintext", ["a = 1"]);
    const { editor: editorB, calls: callsB } = mockEditor("typescript", ["bb = 2"]);
    (editorA.document as unknown as { uri: { scheme: string } }).uri = { scheme: "file" };
    (editorB.document as unknown as { uri: { scheme: string } }).uri = { scheme: "file" };

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
    stub(vscode.workspace, "onDidOpenTextDocument", ((cb: typeof openDocumentCallback) => {
      openDocumentCallback = cb;
      return { dispose() {} };
    }) as unknown as typeof vscode.workspace.onDidOpenTextDocument);
    stub(vscode.window, "visibleTextEditors", [editorA, editorB] as unknown as typeof vscode.window.visibleTextEditors);

    try {
      const context = {
        subscriptions: [] as { dispose(): void }[],
        globalState: mockState({}),
        workspaceState: mockState({}),
      } as unknown as vscode.ExtensionContext;
      activate(context);

      assert.ok(openDocumentCallback, "onDidOpenTextDocument が購読されていること");

      const callsBeforeA = callsA.length;
      const callsBeforeB = callsB.length;

      // 言語モード変更は同一ドキュメントに対して新しい languageId で
      // onDidOpenTextDocument が発火する形で観測される。
      (editorA.document as unknown as { languageId: string }).languageId = "python";
      openDocumentCallback!(editorA.document);
      await wait(200); // debounce (80ms) が発火するのを待つ

      assert.ok(
        callsA.length > callsBeforeA,
        "言語モードが変更されたドキュメントを表示するエディタは再デコレートされること"
      );
      assert.strictEqual(
        callsB.length,
        callsBeforeB,
        "無関係なドキュメントを表示するエディタは再デコレートされないこと"
      );
    } finally {
      for (const restore of restorers.reverse()) {
        restore();
      }
    }
  });

  test("onDidOpenTextDocument の発火でステータスバーの言語別無効化表示が更新される", function () {
    this.timeout(5000);

    const restorers: (() => void)[] = [];
    const { fakeStatusBarItem } = stubCommon(restorers);

    let openDocumentCallback:
      | ((document: vscode.TextDocument) => void)
      | undefined;

    const { editor } = mockEditor("plaintext", ["a: 1"]);
    (editor.document as unknown as { uri: { scheme: string } }).uri = { scheme: "file" };

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

    const originalActiveEditorDescriptor = Object.getOwnPropertyDescriptor(
      vscode.window,
      "activeTextEditor"
    );
    Object.defineProperty(vscode.window, "activeTextEditor", {
      configurable: true,
      get: () => editor,
    });
    restorers.push(() => {
      if (originalActiveEditorDescriptor) {
        Object.defineProperty(
          vscode.window,
          "activeTextEditor",
          originalActiveEditorDescriptor
        );
      } else {
        delete (vscode.window as unknown as { activeTextEditor?: unknown })
          .activeTextEditor;
      }
    });

    const fakeGhostAlignConfig = {
      get<T>(key: string, defaultValue: T): T {
        if (key === "showStatusBar") {
          return true as unknown as T;
        }
        if (key === "disabledLanguages") {
          return ["yaml"] as unknown as T;
        }
        return defaultValue;
      },
    };
    stub(
      vscode.workspace,
      "getConfiguration",
      ((section?: string) =>
        section === "ghostAlign"
          ? fakeGhostAlignConfig
          : { get: () => undefined }) as unknown as typeof vscode.workspace.getConfiguration
    );
    stub(vscode.workspace, "onDidOpenTextDocument", ((cb: typeof openDocumentCallback) => {
      openDocumentCallback = cb;
      return { dispose() {} };
    }) as unknown as typeof vscode.workspace.onDidOpenTextDocument);
    stub(vscode.window, "visibleTextEditors", [editor] as unknown as typeof vscode.window.visibleTextEditors);

    try {
      const context = {
        subscriptions: [] as { dispose(): void }[],
        globalState: mockState({}),
        workspaceState: mockState({}),
      } as unknown as vscode.ExtensionContext;
      activate(context);

      assert.ok(openDocumentCallback, "onDidOpenTextDocument が購読されていること");
      assert.strictEqual(
        fakeStatusBarItem.text,
        "Ghost Align: ON",
        "前提: 変更前は無効化言語表示になっていないこと"
      );

      (editor.document as unknown as { languageId: string }).languageId = "yaml";
      openDocumentCallback!(editor.document);

      assert.strictEqual(
        fakeStatusBarItem.text,
        "Ghost Align: ON (yaml off)",
        "disabledLanguages に該当する言語へ切り替えると即座に反映されること"
      );
    } finally {
      for (const restore of restorers.reverse()) {
        restore();
      }
    }
  });
});

suite("アクティブエディタ切替時のステータスバー追従 (#363)", () => {
  test("無効化言語⇔通常言語の切り替えでステータスバー表示が追従する", () => {
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

    let activeEditorChangeCallback: (() => void) | undefined;
    let currentActiveEditor: vscode.TextEditor | undefined;

    const { editor: cssEditor } = mockEditor("css", ["a { color: red; }"]);
    const { editor: tsEditor } = mockEditor("typescript", ["a = 1"]);

    const originalActiveEditorDescriptor = Object.getOwnPropertyDescriptor(
      vscode.window,
      "activeTextEditor"
    );
    Object.defineProperty(vscode.window, "activeTextEditor", {
      configurable: true,
      get: () => currentActiveEditor,
    });
    restorers.push(() => {
      if (originalActiveEditorDescriptor) {
        Object.defineProperty(
          vscode.window,
          "activeTextEditor",
          originalActiveEditorDescriptor
        );
      } else {
        delete (vscode.window as unknown as { activeTextEditor?: unknown })
          .activeTextEditor;
      }
    });

    const fakeGhostAlignConfig = {
      get<T>(key: string, defaultValue: T): T {
        if (key === "showStatusBar") {
          return true as unknown as T;
        }
        if (key === "disabledLanguages") {
          return ["css"] as unknown as T;
        }
        return defaultValue;
      },
    };
    stub(
      vscode.workspace,
      "getConfiguration",
      ((section?: string) =>
        section === "ghostAlign"
          ? fakeGhostAlignConfig
          : { get: () => undefined }) as unknown as typeof vscode.workspace.getConfiguration
    );

    stub(vscode.window, "createStatusBarItem", (() => fakeStatusBarItem) as unknown as typeof vscode.window.createStatusBarItem);
    stub(vscode.commands, "registerCommand", (() => dummyDisposable) as unknown as typeof vscode.commands.registerCommand);
    stub(vscode.window, "onDidChangeActiveTextEditor", ((cb: () => void) => {
      activeEditorChangeCallback = cb;
      return dummyDisposable;
    }) as unknown as typeof vscode.window.onDidChangeActiveTextEditor);
    stub(vscode.window, "onDidChangeVisibleTextEditors", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeVisibleTextEditors);
    stub(vscode.window, "onDidChangeTextEditorVisibleRanges", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeTextEditorVisibleRanges);
    stub(vscode.window, "onDidChangeTextEditorOptions", (() => dummyDisposable) as unknown as typeof vscode.window.onDidChangeTextEditorOptions);
    stub(vscode.workspace, "onDidChangeTextDocument", (() => dummyDisposable) as unknown as typeof vscode.workspace.onDidChangeTextDocument);
    stub(vscode.workspace, "onDidChangeConfiguration", (() => dummyDisposable) as unknown as typeof vscode.workspace.onDidChangeConfiguration);
    stub(vscode.window, "visibleTextEditors", [] as unknown as typeof vscode.window.visibleTextEditors);

    try {
      const context = {
        subscriptions: [] as { dispose(): void }[],
        globalState: mockState({}),
        workspaceState: mockState({}),
      } as unknown as vscode.ExtensionContext;
      activate(context);

      assert.ok(
        activeEditorChangeCallback,
        "onDidChangeActiveTextEditor が購読されていること"
      );

      currentActiveEditor = cssEditor;
      activeEditorChangeCallback!();
      assert.strictEqual(
        fakeStatusBarItem.text,
        "Ghost Align: ON (css off)",
        "無効化言語に切り替えると言語名付き表示になること"
      );

      currentActiveEditor = tsEditor;
      activeEditorChangeCallback!();
      assert.strictEqual(
        fakeStatusBarItem.text,
        "Ghost Align: ON",
        "通常言語に戻すと言語名なし表示になること"
      );
    } finally {
      for (const restore of restorers.reverse()) {
        restore();
      }
    }
  });
});
