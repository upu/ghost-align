import * as vscode from "vscode";
import {
  isAlignableScheme,
  isLanguageDisabled,
  resolveAlignmentPath,
  resolveDisabledLanguagesTarget,
  resolveGhostSettings,
  resolveShortenUrls,
  toggleDisabledLanguage,
} from "./config";
import {
  LARGE_FILE_LINE_THRESHOLD,
  buildCopyAlignedText,
  clearDecorations,
  clearEditorDecorations,
  createAlignDecorationType,
  createUrlShortenDecorationTypes,
  createUrlShortenLinkProvider,
  decorateEditor,
  notifyCsvDocumentChange,
  notifyMarkdownDocumentChange,
  notifyLineScanDocumentChange,
  notifyLongOperatorGroupDocumentChange,
} from "./decorate";

// Memento key under which the toggle state is persisted across reloads
// (workspaceState per workspace, globalState as the migration fallback).
const ENABLED_STATE_KEY = "enabled";

let enabled = true;

// Status bar item reflecting the current ON/OFF state; clicking it toggles.
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Resolve the toggle state from persisted storage. The workspace's own value
 * wins; a workspace where the toggle was never used falls back to the global
 * value (where releases before the per-workspace toggle stored it), and
 * defaults to enabled so existing users keep the feature on.
 */
export function resolveInitialEnabled(
  globalState: { get<T>(key: string, defaultValue: T): T },
  workspaceState?: { get<T>(key: string, defaultValue: T): T }
): boolean {
  const workspaceValue = workspaceState?.get<boolean | undefined>(
    ENABLED_STATE_KEY,
    undefined
  );
  if (typeof workspaceValue === "boolean") {
    return workspaceValue;
  }
  return globalState.get<boolean>(ENABLED_STATE_KEY, true);
}

/**
 * Label shown in the status bar for the given toggle state. `disabledLanguageId`,
 * when set, means the active editor's language is individually disabled via
 * `ghostAlign.disabledLanguages` (#363) — surfaced only while the extension is
 * otherwise ON, since OFF already communicates "nothing is aligned".
 */
export function statusBarText(
  isEnabled: boolean,
  disabledLanguageId?: string
): string {
  if (!isEnabled) {
    return "Ghost Align: OFF";
  }
  return disabledLanguageId
    ? `Ghost Align: ON (${disabledLanguageId} off)`
    : "Ghost Align: ON";
}

type ScheduleUpdate = (editors?: readonly vscode.TextEditor[]) => void;

function registerDecorationResources(context: vscode.ExtensionContext): void {
  context.subscriptions.push(createAlignDecorationType());
  const { hide: urlHideDecorationType, host: urlHostDecorationType } =
    createUrlShortenDecorationTypes();
  context.subscriptions.push(urlHideDecorationType, urlHostDecorationType);
  // CSV の languageId は設定で任意に追加できるため、固定リストではなく全言語を対象にする。
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider("*", createUrlShortenLinkProvider())
  );
  enabled = resolveInitialEnabled(context.globalState, context.workspaceState);
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "ghostAlign.toggle";
  statusBarItem.tooltip = "Toggle Ghost Align";
  context.subscriptions.push(statusBarItem);
}

function createUpdateScheduler(context: vscode.ExtensionContext): ScheduleUpdate {
  // debounce 中の全体更新と editor 限定更新を統合し、後から来た要求を取りこぼさない。
  let pendingFullUpdate = false;
  const pendingEditors = new Set<vscode.TextEditor>();
  const debouncedFlush = debounce(() => {
    const full = pendingFullUpdate;
    const editors = Array.from(pendingEditors);
    pendingFullUpdate = false;
    pendingEditors.clear();
    updateDecorations(full ? undefined : editors);
  }, 80);
  const scheduleUpdate: ScheduleUpdate = (editors) => {
    if (editors) {
      for (const editor of editors) {
        pendingEditors.add(editor);
      }
    } else {
      pendingFullUpdate = true;
    }
    debouncedFlush();
  };
  context.subscriptions.push({
    dispose: () => {
      debouncedFlush.cancel();
      pendingFullUpdate = false;
      pendingEditors.clear();
    },
  });
  return scheduleUpdate;
}

function registerToggleCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ghostAlign.toggle", () => {
      enabled = !enabled;
      void context.workspaceState.update(ENABLED_STATE_KEY, enabled);
      vscode.window.showInformationMessage(statusBarText(enabled));
      if (enabled) {
        updateDecorations();
      } else {
        clearDecorations();
      }
      updateStatusBar();
    })
  );
}

function registerCopyAlignedCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ghostAlign.copyAligned", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const config = vscode.workspace.getConfiguration("ghostAlign");
      const text = buildCopyAlignedText(editor, config, enabled);
      await vscode.env.clipboard.writeText(text);
    })
  );
}

function registerToggleLanguageCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ghostAlign.toggleLanguage", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const config = vscode.workspace.getConfiguration("ghostAlign");
      const languageId = editor.document.languageId;
      const { next, disabled } = toggleDisabledLanguage(
        config.get<string[]>("disabledLanguages", []),
        languageId
      );
      // workspace 値があれば global 値を上書きしても表示に反映されないため、実効 scope に戻す。
      const target =
        resolveDisabledLanguagesTarget(config) === "workspace"
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
      await config.update("disabledLanguages", next, target);
      vscode.window.showInformationMessage(
        `Ghost Align: ${disabled ? "disabled" : "enabled"} for ${languageId}`
      );
    })
  );
}

function registerCommands(context: vscode.ExtensionContext): void {
  registerToggleCommand(context);
  registerCopyAlignedCommand(context);
  registerToggleLanguageCommand(context);
}

function registerEditorListeners(
  context: vscode.ExtensionContext,
  scheduleUpdate: ScheduleUpdate
): void {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateDecorations();
      updateStatusBar();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      updateDecorations();
    }),
    vscode.window.onDidChangeTextEditorOptions(() => {
      scheduleUpdate();
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.lineCount >= LARGE_FILE_LINE_THRESHOLD) {
        scheduleUpdate([e.textEditor]);
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const config = vscode.workspace.getConfiguration("ghostAlign");
      if (!resolveShortenUrls(config)) {
        return;
      }
      const path = resolveAlignmentPath(e.textEditor.document.languageId, config);
      if (path.kind === "csv" || path.kind === "markdown") {
        scheduleUpdate([e.textEditor]);
      }
    })
  );
}

function registerWorkspaceListeners(
  context: vscode.ExtensionContext,
  scheduleUpdate: ScheduleUpdate
): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      notifyCsvDocumentChange(e.document, e.contentChanges);
      notifyMarkdownDocumentChange(e.document, e.contentChanges);
      notifyLineScanDocumentChange(e.document, e.contentChanges);
      notifyLongOperatorGroupDocumentChange(e.document, e.contentChanges);
      const shownEditors = vscode.window.visibleTextEditors.filter(
        (editor) => editor.document === e.document
      );
      if (shownEditors.length > 0) {
        scheduleUpdate(shownEditors);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ghostAlign")) {
        updateDecorations();
        updateStatusBar();
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      const shownEditors = vscode.window.visibleTextEditors.filter(
        (editor) => editor.document === document
      );
      if (shownEditors.length > 0) {
        scheduleUpdate(shownEditors);
        updateStatusBar();
      }
    })
  );
}

export function activate(context: vscode.ExtensionContext) {
  registerDecorationResources(context);
  const scheduleUpdate = createUpdateScheduler(context);
  registerCommands(context);
  registerEditorListeners(context, scheduleUpdate);
  registerWorkspaceListeners(context, scheduleUpdate);
  updateDecorations();
  updateStatusBar();
}

export function deactivate() {
  clearDecorations();
}

function updateStatusBar() {
  if (!statusBarItem) {
    return;
  }
  const config = vscode.workspace.getConfiguration("ghostAlign");
  if (!config.get<boolean>("showStatusBar", false)) {
    statusBarItem.hide();
    return;
  }
  const languageId = vscode.window.activeTextEditor?.document.languageId;
  const disabledLanguageId =
    languageId && isLanguageDisabled(config, languageId)
      ? languageId
      : undefined;
  statusBarItem.text = statusBarText(enabled, disabledLanguageId);
  statusBarItem.show();
}

/**
 * Wrap `fn` so that rapid successive calls collapse into a single deferred
 * call, fired `delayMs` after the last invocation. The returned function
 * exposes `cancel()` to drop any pending call (used on deactivate so a timer
 * cannot fire against a disposed decoration type).
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number
): { (...args: A): void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delayMs);
  };
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return wrapped;
}

/**
 * Re-decorate the given editors, or all visible editors when `editors` is
 * omitted (#364). Callers pass a scoped list for events caused by a single
 * editor (document edit, scroll); events that can affect any visible editor
 * (active editor switch, visible-editors change, configuration change,
 * toggle ON) still call this with no argument. Editors are re-checked
 * against the current `visibleTextEditors` so one closed between the event
 * firing and the debounce flushing is silently skipped.
 */
function updateDecorations(editors?: readonly vscode.TextEditor[]) {
  if (!enabled) {
    clearDecorations();
    return;
  }
  const config = vscode.workspace.getConfiguration("ghostAlign");

  const { ghostChar, ghostColor } = resolveGhostSettings(config);
  const visible = vscode.window.visibleTextEditors;
  const targets = editors
    ? editors.filter((editor) => visible.includes(editor))
    : visible;
  for (const editor of targets) {
    if (!isAlignableScheme(editor.document.uri.scheme)) {
      clearEditorDecorations(editor);
      continue;
    }
    decorateEditor(editor, config, ghostChar, ghostColor);
  }
}
