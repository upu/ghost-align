# Changelog

🇯🇵 [日本語](CHANGELOG.ja.md)

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Added feature-scoped settings to toggle each alignment path individually: `ghostAlign.jsdoc.enabled` (JSDoc `@param` alignment, replaces `alignJsdocParams`), `ghostAlign.markdownTable.enabled` (Markdown table alignment), and `ghostAlign.csv.enabled` (CSV/TSV alignment) — all default `true`. Previously Markdown tables and CSV/TSV could only be turned off per language via `ghostAlign.disabledLanguages`.
- Added the `ghostAlign.alignUnknownLanguages` setting (default `true`). Set it to `false` to stop operator alignment in languages not listed in `ghostAlign.operatorsByLanguage` — until now, unlisted languages (HTML, SQL, plaintext, …) always fell back to the global `ghostAlign.operators` list. Languages you add to `operatorsByLanguage` yourself count as listed and stay aligned; the default keeps the current align-everywhere behavior.

### Changed

- The changelog is now written in English, with a Japanese companion ([CHANGELOG.ja.md](CHANGELOG.ja.md)) — the same arrangement as the README. Entries for past releases have been translated.

### Deprecated

- Deprecated `ghostAlign.alignJsdocParams` in favor of `ghostAlign.jsdoc.enabled`. The old key keeps working while the new one is left unset (an explicit new-key value wins), and the settings UI now points to the new key; removal is planned for a future major version.

### Removed

- Removed the `ghostAlign.ghostCharacter` setting (breaking change). Ghost padding is now always rendered with NBSP (U+00A0) — the setting was a footgun whose own description warned that an ASCII space breaks alignment (VS Code collapses consecutive ASCII spaces in decorations), and visual tuning is covered by `ghostAlign.ghostColor`. A leftover `ghostAlign.ghostCharacter` in settings is simply ignored. The `-` padding of Markdown separator rows and the ASCII-space output of Copy with Alignment were always independent of this setting and are unaffected.

## [0.7.1] - 2026-07-05

### Fixed

- Fixed custom tokens in `ghostAlign.operators` (or `operatorsByLanguage`) — strings other than the built-in tokens (`=`/`:`/`=>`/`//`/`#`/`\`) — also matching occurrences inside string literals and comments. Like the built-in tokens, only occurrences outside strings and comments are now aligned.
- Fixed `=`/`=>` inside the body of Ruby heredocs (`<<~SQL` / `<<-SQL` / `<<SQL`, including quoted identifiers) and PHP heredocs/nowdocs (`<<<EOT` / `<<<'EOT'`) being mistaken for real code and aligned. The body is now tracked across lines from the opening line to the terminating identifier line, and operator detection is skipped inside it. Ruby's left-shift operator (`x << 2`) is distinguished from a heredoc opener and keeps aligning as before.

## [0.7.0] - 2026-07-05

### Added

- Notebook cell editors (URI scheme `vscode-notebook-cell`), such as Jupyter, are now aligned. `=` alignment in Python cells and table alignment in Markdown cells work the same as in regular files.
- Added the line-continuation marker `\` (backslash) as a new alignment token. Specify `"\\"` in `ghostAlign.operators` (or `operatorsByLanguage`) to vertically align the trailing `\` of lines that continue onto the next one, as in shell scripts, Makefiles, or C preprocessor `#define` continuations. Only a `\` that is the last non-whitespace character on the line is aligned; `\` inside strings or escape sequences is not. Opt-in — it is not added to any language's default operators.

### Changed

- `ghostAlign.maxPadding` now also applies to Markdown table and CSV/TSV alignment. When a single cell is extremely wide, only the column containing it skips alignment (the table keeps its shape), and later columns keep aligning based on each row's actual positions. Previously only operator alignment and JSDoc `@param` respected the limit.

### Fixed

- Fixed operators like `=` inside Python multi-line triple-quoted strings (`"""..."""` / `'''...'''`) being aligned — sample code in a docstring (like `x = 1`) was mistaken for a real assignment. The open/close state of triple quotes is now tracked across lines, as for `/* ... */` block comments and TS/JS template literals (v0.5.0). Triple quotes that close on the same line keep working as before.
- Fixed `:` inside YAML block scalars (`key: |` / `key: >`, including chomping indicators such as `|-`/`|+`/`>-`/`>+`) being mistaken for YAML mapping colons and aligned. Block scalars end with a decrease in indentation (unlike CSS blocks or Markdown fences, which close with a delimiter), so the continuation state is now tracked across lines relative to the key line's indentation. A common case is shell scripts following `run: |` in GitHub Actions.
- Fixed `=`/`=>` inside Rust raw string literals (`r"..."` / `r#"..."#` / `r##"..."##`, and so on) being mistaken for real code when the literal contains a literal `"` — a plain quote toggle broke there. The opening and closing delimiters matching the number of `#`s (`r` + `#`\*N + `"` … `"` + `#`\*N) are now recognized as a single token. Raw strings that do not close on a single line (multi-line) remain out of scope, like other constructs.

## [0.6.0] - 2026-07-04

### Added

- Added the command `Ghost Align: Disable/Enable for Current Language` (`ghostAlign.toggleLanguage`). It adds or removes the active editor's language in `ghostAlign.disabledLanguages` in one step and reports the result in a notification — no more editing settings by typing the languageId by hand.

### Fixed

- Fixed pseudo-class/pseudo-element `:` in CSS/SCSS/LESS comma-separated selectors spanning multiple lines (lines like `.foo:hover,` with no `{` on the same line) being misdetected as declaration colons and mixed into alignment. The `{`/`}` block depth is now tracked across lines, and `:` on lines where no rule block is open yet is excluded.
- Fixed column alignment positions changing with the scroll position in huge Markdown files of 10,000+ lines when a single table exceeded the visible range plus its extension limit (1,000 lines). As with CSV/TSV (fixed in v0.5.0), table column widths are now computed once from the whole document and cached (recomputed on edits only, not on scroll).

## [0.5.0] - 2026-07-03

### Added

- Added the command `Ghost Align: Copy with Alignment` (`ghostAlign.copyAligned`). It copies the selection (or the whole document when nothing is selected) to the clipboard with the currently displayed ghost padding inserted as real ASCII spaces. It also works with the Markdown table / CSV・TSV / JSDoc `@param` alignment paths, and always uses ASCII spaces regardless of the ghost character setting for compatibility at the destination. The document itself is not modified.

### Changed

- Markdown table separator rows (`|---|:--:|`) are now padded with `-` instead of the `ghostCharacter` setting. The rule line looks continuous, and the padding is inserted at the end of the dash run (right before the trailing `:` for right-aligned `---:` / centered `:---:`), so the alignment marker `:` stays at the cell edge. Copy with Alignment also materializes separator rows with `-`, so copied tables stay valid GFM. Data rows keep following the `ghostCharacter` setting.

### Fixed

- Fixed operators like `=` inside multi-line `/* ... */` block comments and multi-line TypeScript/JavaScript template literals (backticks) being aligned together with regular code outside the comment/literal. Each line's starting state is now tracked at the document level (or slice level in visible-range mode) instead of per line.
- Fixed code fences (` ``` ` / `~~~`) opened above the visible range not being tracked in large Markdown files of 10,000+ lines. Fence opens/closes are now cheaply pre-scanned up to the start of the visible range, and when the visible range starts inside a fence, table-like lines within it are excluded from alignment. Normal-size files, which scan every line, behave the same as before.
- Fixed the fallback default used when `ghostAlign.ghostCharacter` is cleared to an empty string in the settings UI: the code fell back to an ASCII space instead of the intended NBSP (U+00A0). VS Code collapses consecutive ASCII spaces in decorations to a single character, so alignment silently broke through this path.
- Resolved the known limitation (documented in v0.3.0) where column alignment in CSV/TSV files of 10,000+ lines could shift with the scroll position. Per-column maximum widths are now precomputed from all lines and cached; only decoration generation is limited to the visible range. On edits, only the changed lines are rescanned, so large files are not re-read on every keystroke.

## [0.4.0] - 2026-07-03

### Added

- Added Swift / Kotlin / Dart / Zig to the default alignment languages. `=` assignments now align across groups, without misdetecting Swift/Dart's `??=` or Kotlin's `===` / `!==`.
- Added the `ghostAlign.disabledLanguages` setting. List languageIds to disable alignment entirely — including Markdown tables / CSV / JSDoc — for documents in those languages. It takes precedence over `ghostAlign.operatorsByLanguage`.

### Changed

- Changed the default alignment targets for TypeScript / TypeScriptReact / JavaScript / JavaScriptReact from `=` only to `:` and `=`. The `:` of type annotations and object literals (ternaries, strings, and comments excluded) now aligns by default as a second column alongside assignment `=`. `case` label `:` falls under the same detection, so consecutive `case` labels aligning by default is intended behavior.

### Fixed

- Fixed PHP's compound assignment `.=` (`$s .= "x";`) not being recognized as an assignment, so padding was inserted between `.` and `=`, visually splitting the operator. As with `+=`, the insert position is now at `.` and the alignment position at `=`. Also fixed Rust's inclusive range `0..=n` having its `=` misdetected as an assignment and polluting alignment groups.
- Fixed the `=>` part of the spaceship operator `<=>` (Ruby / PHP, e.g. `a <=> b`) being misdetected as an arrow/hash rocket and aligned.
- Fixed lines containing Rust lifetimes (`&'static str`, `'a`, and so on) treating `'` as the start of a string, breaking `=` / `=>` detection through the end of the line. In Rust, `'` is no longer treated as a general quote; only char literals (`'x'`, `'\n'`, and so on) are individually skipped. Handling of `'...'` strings in other languages is unchanged.
- Fixed C / C++ digit separators `'` (`1'000'000`) being mistaken for an opening quote — an odd count on a line hid every `=` through the end of the line. A `'` surrounded by hex digits (`0-9a-fA-F`) is now skipped as a digit separator. Char literals like `char c = '=';` are still excluded as strings.

## [0.3.0] - 2026-07-02

### Added

- Expanded the default alignment languages. Go / Lua / C / C++ / C# / Java are now aligned on `=`, and Ruby / PHP / Rust align `=>` (hash rockets, associative arrays, match arms) by default in addition to `=`. Lua's `--` comments and its `~=` comparison operator, and PHP's `#` comments, are correctly excluded.
- Added CSV / TSV column alignment. Documents with language ID `csv` / `tsv` (provided by extensions such as Rainbow CSV) get non-destructive alignment of comma-separated (tab-separated for TSV) columns so the separators appear vertically aligned. Commas inside double quotes (RFC 4180, including `""` escapes) are not treated as separators.
- Added the `ghostAlign.maxPadding` setting. It caps the number of ghost characters inserted per line and column; in a group where a single line is extremely long, the outlier is excluded and the remaining lines align among themselves. `0` (default) means unlimited — the previous behavior.
- Added alignment of consecutive JSDoc `@param` lines in JavaScript / TypeScript. The parameter name column after the `{type}` and the following description column each align vertically (bracket notation for optional parameters like `[name=default]` is supported). Enabled by default; can be disabled with `ghostAlign.alignJsdocParams`.
- Added multi-column alignment of several operators on one line. The list order of `ghostAlign.operators` (and `operatorsByLanguage`) now serves as both priority and left-to-right column order; for example, `["=", "#"]` aligns assignment `=` across consecutive lines and then also aligns trailing `#` comments. A later operator only matches occurrences after the previous column, and listing the same operator twice makes its first and second occurrences separate columns.

### Changed

- In large files of 10,000+ lines, alignment recomputation is now limited to the visible range (a ±100-line buffer, extended to group boundaries) and follows scrolling. Editing cost is proportional to the visible range instead of the whole file. Groups straddling the visible-range boundary are extended to the boundary and align correctly. Known limitations: in huge CSV/TSV files, column alignment is based on the maximum width within the visible range, and in huge Markdown files, code fences opened above the visible range are not tracked. Normal-size files behave the same.

### Removed

- Removed the `ghostAlign.enabled` setting (breaking change). Enabling/disabling is unified into the toggle command (`Ghost Align: Toggle`, persisted across windows). Previously the state was duplicated between the setting and the toggle, and the status bar and notifications could show "ON" even when the setting had the extension disabled. A leftover `ghostAlign.enabled` in settings is simply ignored.

### Fixed

- Fixed Ruby's regex match operator `=~` (`a =~ /x/`) having its `=` misdetected as an assignment and aligned.
- Fixed visual misalignment on lines containing characters outside the BMP (surrogate pairs). Character width is now computed per code point: emoji (U+1F300 and later) and CJK Unified Ideographs Extension B and later count as width 2, while width-1 characters such as mathematical alphanumerics count as 1 (variation selectors and ZWJ emoji sequences remain a known limitation).
- Fixed alignment decorations being applied to non-file editors — the output panel, debug console, search editor — potentially distorting log views. Alignment is now limited to regular files (`file` / `untitled` / `vscode-remote` / `vscode-vfs` schemes).
- Fixed the `:` in fully commented-out YAML lines (`# key: value`) being misdetected as a key separator, which merged surrounding alignment groups or pushed columns out. `:` inside JSONC `//` line comments and single-line `/* ... */` block comments is now excluded too (JSON has no comment syntax, so its behavior is unchanged).
- Fixed the `=` in fully commented-out lines like `# x = 1` (and `;` comments for INI) being misdetected as an assignment in Python / shell scripts / Ruby / Makefile / TOML / dotenv / properties / INI, which merged surrounding alignment groups or pushed columns out. These languages no longer treat `//` as a comment, so Python's floor division (`a // b`) and `//=` are handled correctly.
- Fixed ghost padding being inserted in the middle of compound assignment operators (`+=` `-=` `*=` `/=` `%=` `&=` `|=` `^=` `**=` `||=` `&&=` `??=`, Makefile/Go `:=` `?=`, and shift assignments `<<=` `>>=`) — for example between `+` and `=` — breaking the display. Padding now goes before the operator, and groups align on the `=` column.

## [0.2.0] - 2026-07-01

### Added

- Added Python / shell scripts / Ruby / INI / Makefile to the default `=` alignment targets. As with `dotenv` / `properties` / `toml`, the defaults of `ghostAlign.operatorsByLanguage` now include `python` / `shellscript` / `ruby` / `ini` / `makefile` as `["="]` (consecutive assignment lines in these languages align without any configuration).
- Added arrow function (`=>`) alignment. Specify `"=>"` in `ghostAlign.operators` / `ghostAlign.operatorsByLanguage` to align the position of `=>` across consecutive lines (for example, runs of lines like `const onClick = (e) => ...`). `=>` inside strings and comments is excluded.
- Added TypeScript / JavaScript type annotation colon (`:`) alignment. Configure `ghostAlign.operatorsByLanguage` with e.g. `"typescript": [":"]` to align the `:` of type annotations on variable declarations, function parameters, interface/type properties, and object literal `key: value` across consecutive lines. Ternary `:` (`cond ? a : b`) and `:` inside strings and comments are excluded.

### Fixed

- Fixed columns shifting on Markdown table rows whose cells contain inline code with a `|` (`` `a|b` ``) — the `|` was mistaken for a column separator. `|` inside backtick code spans is no longer treated as a separator.
- Fixed table-like lines written inside fenced code blocks (` ``` ` / `~~~`) — such as code samples — being aligned. Fence opens/closes are tracked and lines inside fences are excluded from table detection.
- Fixed `:` inside SCSS / LESS `//` line comments being misdetected as an alignment target (CSS has no `//` comment syntax, so this exclusion applies to SCSS/LESS only).
- Fixed `:` inside CSS / SCSS / LESS block comments (`/* ... */`) being misdetected as an alignment target. Applies to block comments closed within a single line only (block comments spanning multiple lines remain a known limitation).
- Fixed `:` inside YAML single-quoted keys (`'a:b': 1`) being misdetected as a separator. Single-quote tracking was added to `findColonOutsideString`, which is shared with JSON/JSONC (JSON does not use single-quoted strings, so its existing behavior is unaffected).
- Fixed `=`/`:`/`//`/`#` inside template literals (backticks) being misdetected as alignment targets. Applies to template literals closed within a single line only (ones spanning multiple lines remain a known limitation). The JSON/YAML `:` detection (`findColonOutsideString`) is left untouched, as backticks have no syntactic meaning there.
- Fixed visual misalignment on lines containing full-width characters (East Asian Width Wide/Fullwidth, such as Japanese). Full-width characters now count as width 2, so Markdown table separators and operator alignment line up as displayed even when cells contain full-width text (surrogate-pair characters such as emoji remain a known limitation).

## [0.1.0] - 2026-06-30

### Added

- Added visual alignment of Markdown table columns. Ghost padding makes each column's `|` separators appear vertically aligned without changing the source (tables with a header row, separator row, and data rows are detected; escaped `\|` inside cells is handled).
- Added trailing comment (`//` / `#`) alignment. Specify `"//"` or `"#"` in `ghostAlign.operators` / `ghostAlign.operatorsByLanguage` to align where comments start across consecutive lines (for example, `"typescript": ["//"]`). Occurrences inside strings, URLs such as `http://`, and whole-line comments are excluded. Alignment is one column per line, with the order of `operators` as priority.

### Changed

- Changed the Marketplace category from `Formatters` to `Visualization`. Ghost Align never formats the source — it only adjusts the display — so this avoids being mistaken for a formatter.

### Fixed

- Fixed `:` in CSS / SCSS / LESS pseudo-classes (`a:hover`), pseudo-elements (`::before`), and `url(http://...)` being misdetected as alignment targets. Only the property declaration `:` (for example `color: red`) is aligned.
- Fixed misaligned columns on lines containing tabs or tab indentation. Alignment and group splitting are now computed in visual columns (respecting `editor.tabSize`) instead of character counts. Lines whose indentation looks the same with spaces and with tabs now group together.
- Fixed the inactive visible editor not being aligned when the editor is split. Alignment is applied to every visible editor and redrawn when the visible editor set changes.

## [0.0.1] - 2026-06-28

### Added

- Initial release.
- Ghost alignment of `=` via the Decoration API. Operator positions across consecutive lines are aligned visually without modifying the source code.
- `Ghost Align: Toggle` command (`ghostAlign.toggle`) to enable and disable the extension.
- Settings:
  - `ghostAlign.enabled` — enable or disable the visual alignment.
  - `ghostAlign.operators` — list of operators to align (default `["="]`).
  - `ghostAlign.operatorsByLanguage` — per-language-ID operator overrides. By default `json` / `jsonc` / `yaml` / `css` / `scss` / `less` align `:`, and `dotenv` / `properties` / `toml` align `=`.
  - `ghostAlign.showStatusBar` — show a status bar item indicating whether Ghost Align is ON or OFF (default `false`; click to toggle).
  - `ghostAlign.ghostCharacter` — character used for ghost padding (defaults to NBSP).
  - `ghostAlign.ghostColor` — color for ghost padding, applied to both foreground and background so it can be told apart from real whitespace.
- Redraw decorations when the configuration changes.

### Changed

- Colored ghost padding so it is visually distinguishable from real whitespace.
- Excluded `=` inside strings, brackets, and line/block comments from alignment.

[Unreleased]: https://github.com/upu/ghost-align/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/upu/ghost-align/releases/tag/v0.7.1
[0.7.0]: https://github.com/upu/ghost-align/releases/tag/v0.7.0
[0.6.0]: https://github.com/upu/ghost-align/releases/tag/v0.6.0
[0.5.0]: https://github.com/upu/ghost-align/releases/tag/v0.5.0
[0.4.0]: https://github.com/upu/ghost-align/releases/tag/v0.4.0
[0.3.0]: https://github.com/upu/ghost-align/releases/tag/v0.3.0
[0.2.0]: https://github.com/upu/ghost-align/releases/tag/v0.2.0
[0.1.0]: https://github.com/upu/ghost-align/releases/tag/v0.1.0
[0.0.1]: https://github.com/upu/ghost-align/releases/tag/v0.0.1
