# CHANGELOG 運用ガイド

このリポジトリの変更履歴 [`CHANGELOG.md`](../CHANGELOG.md) の書き方・運用方針をまとめたコントリビューター向け資料です（本体の変更履歴そのものではありません）。

## 準拠する規約

- フォーマットは [Keep a Changelog 1.1.0](https://keepachangelog.com/ja/1.1.0/) に準拠します。
- バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

CHANGELOG は **機械ではなく人間のため**のものです。コミットログの羅列ではなく、読んで変更が分かる要約を書きます。

## 変更の種類（グループ）

エントリは次の6グループに分類します。

| グループ | 用途 |
| --- | --- |
| `Added` | 新機能 |
| `Changed` | 既存機能の変更 |
| `Deprecated` | 近く削除される機能 |
| `Removed` | 削除された機能 |
| `Fixed` | バグ修正 |
| `Security` | 脆弱性対応 |

## 運用フロー

1. **各 PR で `[Unreleased]` に積む** — ユーザー影響のある変更は、PR の中で `CHANGELOG.md` の `## [Unreleased]` セクションに該当グループの1行を追記します。
2. **リリース時に確定** — `[Unreleased]` を `## [x.y.z] - YYYY-MM-DD`（ISO 8601 日付）にリネームし、新しい空の `[Unreleased]` を作り直します。最新版が先頭になるようにし、末尾の compare リンクを更新します。この確定作業は将来 `/release` スキルに集約する予定です（[#50](https://github.com/upu/ghost-align/issues/50)）。

## 書く / 書かない の基準

判断基準は1つ、**公開される拡張機能の挙動・見た目・インストール体験が変わるか** です。

- **書く**: 新機能、バグ修正、挙動・既定値の変更、設定項目の追加/変更、廃止（deprecation）、利用者が体感するパッケージ/性能の変化。
- **書かない（N/A）**: 内部リファクタ、ビルド・CI、テスト、ドキュメント、Claude スキルなど、利用者に影響しない変更。N/A の場合は PR にその旨を記します。

> 一部の変更だけ書かれた CHANGELOG は、ない場合と同じくらい危険です。ユーザー影響のある変更は漏らさず書きます。

## 関連する場所

この運用は次の箇所にも反映されています。

- `CHANGELOG.md` 冒頭 — 準拠規約の宣言
- `.claude/skills/ship/SKILL.md` step 4 — `/ship` での Unreleased 追記手順
- `.github/pull_request_template.md` — PR のチェック項目（追記 / N/A）
