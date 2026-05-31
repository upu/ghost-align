# Changelog

このプロジェクトの主要な変更点を記録する。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

## [Unreleased]

## [0.0.1] - 2026-05-31

### Added

- 初回リリース。
- Decoration API による `=` のゴーストアライメント。ソースコードを変更せず、連続する行のオペレーター位置を表示上で揃える。
- `Ghost Align: Toggle` コマンド（`ghostAlign.toggle`）で有効・無効を切り替え。
- 設定項目:
  - `ghostAlign.enabled` — 視覚的アライメントの有効・無効。
  - `ghostAlign.operators` — 揃えるオペレーターの一覧（デフォルト `["="]`）。
  - `ghostAlign.operatorsByLanguage` — 言語 ID 別のオペレーター上書き（デフォルトで `json` / `jsonc` は `:` を揃える）。
  - `ghostAlign.ghostCharacter` — ゴーストパディングに使う文字（デフォルトは NBSP）。
  - `ghostAlign.ghostColor` — ゴーストパディングの色付け。実際の空白と区別できるよう前景・背景に適用。
- 設定変更時にデコレーションを再描画。

### Changed

- ゴーストパディングを実際の空白と視覚的に区別できるよう色付け。
- 文字列・括弧内、および行・ブロックコメント内の `=` をアライメント対象から除外。

[Unreleased]: https://github.com/upu/ghost-align/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/upu/ghost-align/releases/tag/v0.0.1
