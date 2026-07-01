# Changelog

このプロジェクトの主要な変更点を記録する。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

## [Unreleased]

### Fixed

- Markdown テーブルのセル内インラインコード（`` `a|b` ``）に含まれる `|` を列区切りと誤認して該当行の列がずれる問題を修正。バックティックで囲まれたコードスパン内の `|` は区切りとして扱わないようにした。
- フェンスドコードブロック（` ``` ` / `~~~`）内に書いたテーブル風の行（コード例など）が誤って整列対象になる問題を修正。フェンスの開閉を追跡し、フェンス内の行はテーブル検出の対象外にした。

## [0.1.0] - 2026-06-30

### Added

- Markdown テーブルの列の表示整列に対応。ソースを変えずに、各列の `|` 区切りが縦に揃って見えるようゴーストパディングを挿入する（ヘッダ行・区切り行・データ行を含むテーブルを検出。セル内のエスケープ `\|` も考慮）。
- 行末コメント（`//` / `#`）の整列に対応。`ghostAlign.operators` / `ghostAlign.operatorsByLanguage` に `"//"` または `"#"` を指定すると、連続する行のコメント開始位置を揃える（例: TypeScript で `"typescript": ["//"]`）。文字列内・`http://` などの URL・行全体がコメントの行は対象外。整列は 1 行 1 カラムで、`operators` の並び順が優先度になる。

### Changed

- Marketplace のカテゴリを `Formatters` から `Visualization` に変更。Ghost Align はソースをフォーマットせず表示のみ整える拡張のため、フォーマッタを期待した誤認を避ける。

### Fixed

- CSS / SCSS / LESS で、擬似クラス（`a:hover`）・擬似要素（`::before`）・`url(http://...)` 内の `:` をアライメント対象から誤検出しないよう修正。プロパティ宣言の `:`（例: `color: red`）のみを揃える。
- タブを含む行・タブインデントで桁がずれる問題を修正。アライメントとグループ分割を文字数ではなく視覚カラム（`editor.tabSize` を反映）で計算するようにした。スペースとタブで見た目が同じインデントの行も同じグループにまとまる。
- エディタを分割（split）したとき、非アクティブ側の可視エディタが整列されない問題を修正。可視なすべてのエディタに整列を適用し、可視構成の変更でも再描画するようにした。

## [0.0.1] - 2026-06-28

### Added

- 初回リリース。
- Decoration API による `=` のゴーストアライメント。ソースコードを変更せず、連続する行のオペレーター位置を表示上で揃える。
- `Ghost Align: Toggle` コマンド（`ghostAlign.toggle`）で有効・無効を切り替え。
- 設定項目:
  - `ghostAlign.enabled` — 視覚的アライメントの有効・無効。
  - `ghostAlign.operators` — 揃えるオペレーターの一覧（デフォルト `["="]`）。
  - `ghostAlign.operatorsByLanguage` — 言語 ID 別のオペレーター上書き。既定で `json` / `jsonc` / `yaml` / `css` / `scss` / `less` は `:`、`dotenv` / `properties` / `toml` は `=` を揃える。
  - `ghostAlign.showStatusBar` — Ghost Align の ON/OFF を示すステータスバー項目の表示（既定 `false`、クリックでトグル）。
  - `ghostAlign.ghostCharacter` — ゴーストパディングに使う文字（デフォルトは NBSP）。
  - `ghostAlign.ghostColor` — ゴーストパディングの色付け。実際の空白と区別できるよう前景・背景に適用。
- 設定変更時にデコレーションを再描画。

### Changed

- ゴーストパディングを実際の空白と視覚的に区別できるよう色付け。
- 文字列・括弧内、および行・ブロックコメント内の `=` をアライメント対象から除外。

[Unreleased]: https://github.com/upu/ghost-align/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/upu/ghost-align/releases/tag/v0.1.0
[0.0.1]: https://github.com/upu/ghost-align/releases/tag/v0.0.1
