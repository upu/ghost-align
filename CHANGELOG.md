# Changelog

このプロジェクトの主要な変更点を記録する。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

## [Unreleased]

### Fixed

- CSS / SCSS / LESS で、擬似クラス（`a:hover`）・擬似要素（`::before`）・`url(http://...)` 内の `:` をアライメント対象から誤検出しないよう修正。プロパティ宣言の `:`（例: `color: red`）のみを揃える。

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

[Unreleased]: https://github.com/upu/ghost-align/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/upu/ghost-align/releases/tag/v0.0.1
