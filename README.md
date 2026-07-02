<!--
  This file is published as the extension's page on the VS Code Marketplace (user-facing).
  Build/debug/contribution instructions belong in docs/CONTRIBUTING.md —
  keep this file limited to user-facing content only.
-->

🇯🇵 [日本語](README.ja.md)

# Ghost Align

> Visually align operators like `=` without modifying your source code.

Ghost Align is a VS Code extension. It aligns the position of operators like `=` **without ever touching your source code** — the alignment is purely visual.

It works by inserting visual padding using the editor's Decoration API, so no extra whitespace is ever saved to the file, and your Git diffs stay clean. The concept: "never change the code, only align how it looks."

## Demo

Aligning `=` (the source is never modified; toggle it on/off):

![Demo of = alignment](https://raw.githubusercontent.com/upu/ghost-align/main/media/demo_js.gif)

Aligning `:` in JSON:

![Demo of JSON : alignment](https://raw.githubusercontent.com/upu/ghost-align/main/media/demo_json.gif)

Aligning Markdown table columns:

![Demo of Markdown table alignment](https://raw.githubusercontent.com/upu/ghost-align/main/media/demo_md.gif)

## Before / After

The actual file contents never change. What follows is an image of **how it looks**.

Before (not aligned):

```js
const x = 1;
const foo = 2;
const longName = 3;
```

After (with Ghost Align enabled):

```js
const x        = 1;
const foo      = 2;
const longName = 3;
```

The inserted whitespace is a decoration (a "ghost") and is never saved to the file.

## How it works

- Consecutive lines are grouped, and within each group the operator position is aligned to match the rightmost line.
- A change in indentation width starts a new group, so nested blocks (such as JSON objects) never get aligned across different nesting levels.
- For `=` alignment, `=` inside strings, comments, `( )`, `[ ]`, and multi-character operators such as `==` `!=` `<=` `>=` `=>` are excluded (only assignment `=` is aligned).
- Arrow functions (`=>`) can be aligned as their own token: add `"=>"` to `ghostAlign.operators` (or `operatorsByLanguage`) to line up consecutive lines like `const onClick = (e) => ...`. Occurrences inside strings and comments are excluded.
- `=` is aligned by default. The default operator varies by language: `json` / `jsonc` / `yaml` / `css` / `scss` / `less` align `:`, while `dotenv` / `properties` / `toml` / `ini` / `python` / `shellscript` / `makefile` / `go` / `lua` / `c` / `cpp` / `csharp` / `java` align `=`. `ruby` / `php` / `rust` align `=>` (hash rockets, associative arrays, match arms) in addition to `=`.
- In JavaScript/TypeScript, consecutive JSDoc `@param` lines are also aligned: the parameter-name column and the description column line up vertically (disable via `ghostAlign.alignJsdocParams`).
- Trailing line comments (`//` / `#`) can also be aligned (opt-in via `"//"` / `"#"` in `ghostAlign.operators` etc.; comments inside strings, URLs like `http://`, and lines that are entirely a comment are excluded).
- If a single extremely long line would force a large amount of ghost padding onto the other lines, you can cap it with `ghostAlign.maxPadding` — outlier lines are excluded and the remaining lines are aligned without them (default is unlimited).
- In Markdown, table columns (separated by `|`) are aligned so they line up vertically.
- In CSV / TSV documents (language ID `csv` / `tsv`, as provided by extensions like Rainbow CSV — VS Code itself opens `.csv` as plain text), columns are aligned so the delimiters line up vertically. Commas inside double-quoted fields (RFC 4180, including `""` escapes) are not treated as delimiters.
- Lines containing tabs are aligned by their visual column, taking the tab width (`editor.tabSize`) into account.

## Installation

Search for **Ghost Align** in the VS Code Extensions view (`Ctrl+Shift+X`) and click Install.

From the command line:

```bash
code --install-extension upu.ghost-align
```

Marketplace page: <https://marketplace.visualstudio.com/items?itemName=upu.ghost-align>

## Usage

Once enabled, lines containing a target operator are automatically displayed aligned.

You can toggle the visual alignment on/off from the Command Palette (the state persists across window reloads):

- `Ghost Align: Toggle` (command ID: `ghostAlign.toggle`)

Enabling `ghostAlign.showStatusBar` adds an ON/OFF indicator to the status bar, which you can also click to toggle.

## Settings

All settings live under the `ghostAlign` namespace.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `ghostAlign.showStatusBar` | boolean | `false` | Show a status bar item indicating Ghost Align ON/OFF (click to toggle). |
| `ghostAlign.operators` | array | `["="]` | Operators to align (used when the current language is not listed in `ghostAlign.operatorsByLanguage`). Supported special tokens: `"="` (assignment), `":"` (JSON/YAML key or CSS declaration), `"//"` and `"#"` (trailing line comments), `"=>"` (arrow function). The `"="` and `"=>"` tokens exclude occurrences inside strings and comments. Any other string is matched literally. The list order defines both the priority and the left-to-right column order: each listed operator is aligned as its own column on the same line (e.g. `["=", "#"]` aligns assignments and then trailing comments). |
| `ghostAlign.operatorsByLanguage` | object | `{ "json": [":"], "jsonc": [":"], "yaml": [":"], "dotenv": ["="], "properties": ["="], "toml": ["="], "ini": ["="], "python": ["="], "shellscript": ["="], "ruby": ["=", "=>"], "makefile": ["="], "css": [":"], "scss": [":"], "less": [":"], "php": ["=", "=>"], "rust": ["=", "=>"], "go": ["="], "lua": ["="], "c": ["="], "cpp": ["="], "csharp": ["="], "java": ["="] }` | Per-language operator overrides keyed by languageId (e.g. `json`, `jsonc`, `typescript`). If the current document's language is listed here, this list is used in place of `ghostAlign.operators`. |
| `ghostAlign.alignJsdocParams` | boolean | `true` | Align the parameter-name and description columns of consecutive JSDoc `@param` lines in JavaScript/TypeScript. |
| `ghostAlign.maxPadding` | number | `0` | Maximum number of ghost characters inserted per alignment column on a single line. When aligning a group would require more, the extremely long outlier lines are excluded and the remaining lines are aligned without them. `0` means unlimited. Does not apply to Markdown table alignment. |
| `ghostAlign.ghostCharacter` | string | `" "` (U+00A0, non-breaking space) | Character used for ghost padding. Defaults to a non-breaking space (U+00A0), which renders like a half-width space but is not collapsed by the editor's rendering. Plain ASCII spaces will be collapsed to one cell and break alignment — use NBSP or en-space (U+2002) if you customize this. Leaving this empty in the settings UI falls back to the default. |
| `ghostAlign.ghostColor` | string | `"rgba(128, 128, 128, 0.25)"` | Tint color of the ghost padding (any CSS color string). Applied as both foreground and background so whitespace padding is distinguishable from real spaces. Leaving this empty in the settings UI falls back to the default; set `"transparent"` to disable tinting entirely. |

## License

MIT
