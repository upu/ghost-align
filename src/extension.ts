import * as vscode from "vscode";
import {
  isAlignableScheme,
  isLanguageDisabled,
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
  // trigger a full re-scan on every keystroke. scheduleUpdate merges the
  // editors requested across calls within the debounce window (#364): a
  // scoped call followed by a full-update call before the timer fires still
  // decorates everything, and multiple scoped calls decorate their union
  // rather than redoing work for editors already covered.
  let pendingFullUpdate = false;
  const pendingEditors = new Set<vscode.TextEditor>();
  const debouncedFlush = debounce(() => {
    const full = pendingFullUpdate;
    const editors = Array.from(pendingEditors);
    pendingFullUpdate = false;
    pendingEditors.clear();
    updateDecorations(full ? undefined : editors);
  }, 80);
  const scheduleUpdate = (editors?: readonly vscode.TextEditor[]) => {
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
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateDecorations();
      // The status bar's language-disabled hint (#363) depends on the active
      // editor's languageId, so switching editors must refresh it too.
      updateStatusBar();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => updateDecorations()),
    // Alignment depends on tabSize (visualColumn), so a tabSize change —
    // from the status bar, a command, or indentation auto-detection right
    // after opening a file — must trigger a re-render.
    vscode.window.onDidChangeTextEditorOptions(() => scheduleUpdate()),
    // Large files are decorated per visible range, so scrolling must
    // recompute; small files are fully decorated and can ignore scrolling.
    // Only the scrolled editor needs it (#364) — other visible editors'
    // decorations are unaffected by this editor's scroll position.
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.lineCount >= LARGE_FILE_LINE_THRESHOLD) {
        scheduleUpdate([e.textEditor]);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      notifyCsvDocumentChange(e.document, e.contentChanges);
      notifyMarkdownDocumentChange(e.document, e.contentChanges);
      notifyLineScanDocumentChange(e.document, e.contentChanges);
      // Only editors showing the changed document need to re-decorate
      // (#364) — a split pane on an unrelated document is unaffected.
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
    // Changing an editor's language mode fires this with the new languageId
    // but doesn't fire onDidChangeActiveTextEditor/VisibleTextEditors (#395),
    // so without this the old language's alignment (and status bar hint)
    // lingers until the next edit or editor switch.
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
