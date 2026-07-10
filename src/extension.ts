import * as vscode from "vscode";
import {
  isAlignableScheme,
  resolveDisabledLanguagesTarget,
  resolveGhostSettings,
  toggleDisabledLanguage,
} from "./config";
import {
  LARGE_FILE_LINE_THRESHOLD,
  buildCopyAlignedText,
  clearDecorations,
  clearEditorDecorations,
  createAlignDecorationType,
  decorateEditor,
  notifyCsvDocumentChange,
  notifyMarkdownDocumentChange,
  notifyLineScanDocumentChange,
} from "./decorate";

// Memento key under which the toggle state is persisted across reloads
// (workspaceState per workspace, globalState as the migration fallback).
const ENABLED_STATE_KEY = "enabled";

let enabled = true;

// Status bar item reflecting the current ON/OFF state; clicking it toggles.
let statusBarItem: vscode.StatusBarItem;

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

/** Label shown in the status bar for the given toggle state. */
export function statusBarText(isEnabled: boolean): string {
  return `Ghost Align: ${isEnabled ? "ON" : "OFF"}`;
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(createAlignDecorationType());

  enabled = resolveInitialEnabled(context.globalState, context.workspaceState);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "ghostAlign.toggle";
  statusBarItem.tooltip = "Toggle Ghost Align";
  context.subscriptions.push(statusBarItem);

  // Debounce document-edit updates so rapid typing in large files does not
  // trigger a full re-scan on every keystroke.
  const debouncedUpdate = debounce(updateDecorations, 80);
  context.subscriptions.push({ dispose: () => debouncedUpdate.cancel() });

  // Toggle command
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

  // Copy with Alignment: turns the current ghost padding into real ASCII
  // spaces and copies it, without touching the source document.
  context.subscriptions.push(
    vscode.commands.registerCommand("ghostAlign.copyAligned", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const config = vscode.workspace.getConfiguration("ghostAlign");
      const text = buildCopyAlignedText(editor, config);
      await vscode.env.clipboard.writeText(text);
    })
  );

  // Disable/Enable for Current Language: one-touch toggle of the active
  // editor's languageId in ghostAlign.disabledLanguages. Re-render is not
  // needed here: the settings update fires onDidChangeConfiguration below.
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
      // A workspace value (e.g. from .vscode/settings.json) always beats a
      // global one when VS Code resolves the effective setting, so writing
      // to Global while such a value exists would have no visible effect
      // (#362) — write back to whichever scope is actually in effect.
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

  // Update on editor / document / configuration changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => updateDecorations()),
    vscode.window.onDidChangeVisibleTextEditors(() => updateDecorations()),
    // Alignment depends on tabSize (visualColumn), so a tabSize change —
    // from the status bar, a command, or indentation auto-detection right
    // after opening a file — must trigger a re-render.
    vscode.window.onDidChangeTextEditorOptions(() => debouncedUpdate()),
    // Large files are decorated per visible range, so scrolling must
    // recompute; small files are fully decorated and can ignore scrolling.
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.lineCount >= LARGE_FILE_LINE_THRESHOLD) {
        debouncedUpdate();
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      notifyCsvDocumentChange(e.document, e.contentChanges);
      notifyMarkdownDocumentChange(e.document);
      notifyLineScanDocumentChange(e.document, e.contentChanges);
      const shown = vscode.window.visibleTextEditors.some(
        (editor) => editor.document === e.document
      );
      if (shown) {
        debouncedUpdate();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ghostAlign")) {
        updateDecorations();
        updateStatusBar();
      }
    })
  );

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
  statusBarItem.text = statusBarText(enabled);
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

function updateDecorations() {
  if (!enabled) {
    clearDecorations();
    return;
  }
  const config = vscode.workspace.getConfiguration("ghostAlign");

  const { ghostChar, ghostColor } = resolveGhostSettings(config);
  for (const editor of vscode.window.visibleTextEditors) {
    if (!isAlignableScheme(editor.document.uri.scheme)) {
      clearEditorDecorations(editor);
      continue;
    }
    decorateEditor(editor, config, ghostChar, ghostColor);
  }
}
