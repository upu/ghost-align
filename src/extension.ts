import * as vscode from "vscode";

// Decoration type: the base style is empty; per-instance renderOptions inject the padding
const alignDecorationType = vscode.window.createTextEditorDecorationType({});

// Fallbacks used when the user clears a setting to an empty string in the UI.
// Keep these in sync with the defaults in package.json.
// NBSP (U+00A0) instead of ASCII space: VS Code collapses consecutive ASCII
// spaces in decoration `contentText`, so plain " ".repeat(N) renders as a
// single space and breaks alignment. NBSP renders identically in monospace
// fonts but is not collapsed.
const DEFAULT_GHOST_CHAR = " ";
const DEFAULT_GHOST_COLOR = "rgba(128, 128, 128, 0.25)";

let enabled = true;

export function activate(context: vscode.ExtensionContext) {
  // Toggle command
  context.subscriptions.push(
    vscode.commands.registerCommand("ghostAlign.toggle", () => {
      enabled = !enabled;
      vscode.window.showInformationMessage(
        `Align Without Edit: ${enabled ? "ON" : "OFF"}`
      );
      if (enabled) {
        updateDecorations();
      } else {
        clearDecorations();
      }
    })
  );

  // Update on editor / document changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => updateDecorations()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) {
        updateDecorations();
      }
    })
  );

  updateDecorations();
}

export function deactivate() {
  clearDecorations();
}

function clearDecorations() {
  for (const editor of vscode.window.visibleTextEditors) {
    editor.setDecorations(alignDecorationType, []);
  }
}

// ── Core logic ──────────────────────────────────────────────────────────

/**
 * Resolve the ghost-align settings from a VS Code-like configuration object.
 * An empty string from the settings UI is treated as "use default" so a
 * cleared field cannot silently break the feature (empty char → no padding,
 * empty color → invisible ghost).
 */
export function resolveGhostSettings(
  config: { get<T>(key: string, defaultValue: T): T }
): { operators: string[]; ghostChar: string; ghostColor: string } {
  return {
    operators: config.get<string[]>("operators", ["="]),
    ghostChar: config.get<string>("ghostCharacter", DEFAULT_GHOST_CHAR) || DEFAULT_GHOST_CHAR,
    ghostColor: config.get<string>("ghostColor", DEFAULT_GHOST_COLOR) || DEFAULT_GHOST_COLOR,
  };
}

/** Find the column of the first alignment-target operator on a line. */
export function findOperatorColumn(
  lineText: string,
  operators: string[]
): number | null {
  for (const op of operators) {
    // For "=" we need to avoid matching ==, !=, <=, >=, =>
    if (op === "=") {
      const match = lineText.match(
        /(?<![=!<>])=(?!=)/
      );
      if (match && match.index !== undefined) {
        return match.index;
      }
    } else {
      const idx = lineText.indexOf(op);
      if (idx !== -1) {
        return idx;
      }
    }
  }
  return null;
}

/**
 * Group consecutive lines that contain an operator.
 * Returns arrays of { lineIndex, operatorColumn }.
 */
export function findAlignmentGroups(
  document: vscode.TextDocument,
  operators: string[]
): { lineIndex: number; operatorColumn: number }[][] {
  const groups: { lineIndex: number; operatorColumn: number }[][] = [];
  let currentGroup: { lineIndex: number; operatorColumn: number }[] = [];

  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;
    const col = findOperatorColumn(lineText, operators);

    if (col !== null) {
      currentGroup.push({ lineIndex: i, operatorColumn: col });
    } else {
      if (currentGroup.length >= 2) {
        groups.push(currentGroup);
      }
      currentGroup = [];
    }
  }
  if (currentGroup.length >= 2) {
    groups.push(currentGroup);
  }

  return groups;
}

function updateDecorations() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const config = vscode.workspace.getConfiguration("ghostAlign");
  if (!config.get<boolean>("enabled", true) || !enabled) {
    clearDecorations();
    return;
  }

  const { operators, ghostChar, ghostColor } = resolveGhostSettings(config);
  const groups = findAlignmentGroups(editor.document, operators);
  const decorations: vscode.DecorationOptions[] = [];

  for (const group of groups) {
    const maxCol = Math.max(...group.map((g) => g.operatorColumn));

    for (const entry of group) {
      const padding = maxCol - entry.operatorColumn;
      if (padding <= 0) {
        continue; // already at the max position
      }

      const pos = new vscode.Position(entry.lineIndex, entry.operatorColumn);
      const range = new vscode.Range(pos, pos);

      decorations.push({
        range,
        renderOptions: {
          before: {
            contentText: ghostChar.repeat(padding),
            color: ghostColor,
            backgroundColor: ghostColor,
          },
        },
      });
    }
  }

  editor.setDecorations(alignDecorationType, decorations);
}
