---
type: クイックスタート
title: Ghost Align 開発者向けクイックスタート
description: Ghost Align の製品原則、主要な実装領域、ローカル開発の入口、および詳細 Wiki への案内です。
resource: https://github.com/upu/ghost-align
tags: [vscode-extension, typescript, alignment, quickstart]
---

# Ghost Align 開発者向けクイックスタート

Ghost Align は、ソース本文や Git 差分を変更せずに `=` などを表示上だけ整列する VS Code 拡張機能です。`TextEditorDecoration` の `before` 装飾でゴースト余白を描画し、必要なら同じ配置計画を実スペースへ変換してクリップボードにコピーします。製品の中心原則は**非破壊**です。利用者向けの設定と制約は `README.ja.md`、開発手順の一次資料は `docs/CONTRIBUTING.md` にあります。

## 読む順序

| 確認したいこと | 読むページ | 実装上の入口 |
| --- | --- | --- |
| 起動、イベント、経路選択、キャッシュ | [実行時アーキテクチャ](architecture/overview.md) | `src/extension.ts`, `src/decorate.ts`, `src/config.ts` |
| 機能ごとの検出、配置、コピー | [整列機能と非破壊コピー](workflows/alignment.md) | `src/finders.ts`, `src/paddings.ts`, `src/markdown.ts`, `src/csv.ts` |
| ファイル単位の変更起点 | [ソースマップ](architecture/source-map.md) | `src/`, `src/test/suite/`, `package.json` |
| ビルド、テスト、VSIX、リリース | [開発、テスト、パッケージ、リリース](operations/contributing.md) | `scripts/`, `.github/workflows/` |

## ローカルでの開始手順

統合テストは `out-tsc/test/**` を読むため、少なくとも一度 `npm run compile` が必要です。

```bash
npm install
npm run watch
npm run compile
npm test
```

VS Code でリポジトリを開いて `F5` を実行すると、拡張を読み込んだデバッグウィンドウが起動します。本番向けバンドルは `npm run build`、配布物の検査を含む確認は `npm run check:package` です。完全な検証順序は [開発、テスト、パッケージ、リリース](operations/contributing.md) を参照してください。

## 主要な設計境界

- **VS Code 統合** — `src/extension.ts` がコマンド、装飾タイプ、ドキュメントリンク、エディタイベントを登録し、[実行時アーキテクチャ](architecture/overview.md) の配置パイプラインを起動します。
- **設定と経路選択** — `src/config.ts` は言語と `ghostAlign.*` 設定から `markdown`、`csv`、`operators`、`none` を一箇所で決めます。この選択が [整列機能と非破壊コピー](workflows/alignment.md) の専用処理へ分岐します。
- **共通の配置表現** — すべての整列方式は `Placement[]` を作り、`src/decorate.ts` が表示装飾へ、`src/copyAligned.ts` がコピー用テキストへ変換します。
- **性能と構文安全性** — `src/finders.ts` の複数行スキャン状態、`src/paddings.ts` の視覚列・グループ化、CSV/Markdown/長大グループのキャッシュは、大規模文書でもスクロール位置で整列が揺れないことを目的とします。

## 変更時の最短チェック

1. 機能が属する経路を [整列機能と非破壊コピー](workflows/alignment.md) と [ソースマップ](architecture/source-map.md) で特定する。
2. 対応する `src/test/suite/*.test.ts` を更新する。構文検出では文字列・コメント・複数行状態の回帰を追加する。
3. `npm run lint`、`npm run compile`、`npm run test:scripts`、`npm test`、`npm run check:package` を実行する。Linux では CI と同じく `xvfb-run -a npm test` を使う。
4. 利用者影響があれば `CHANGELOG.md` と `CHANGELOG.ja.md` の両方を更新し、設定・コマンド変更なら README と `docs/features/reference.md` の同期も確認する。

## 最近の開発上の焦点

`v1.7.0` の直前には、CSV/TSV の小数点整列、テーブルセル URL のホスト表示短縮、複数行クォート CSV、Markdown コードブロック除外、Unicode 幅、言語構文の誤検出、大規模ファイルの長大な演算子グループを集中的に改善しています。特に #447 は、可視範囲だけで計算すると長い連続グループの揃え先がスクロールで変わる問題を `LongOperatorGroupCache` で解決しました。性能最適化と構文境界を変更する場合は、[実行時アーキテクチャ](architecture/overview.md) と対応テストをセットで確認してください。

## Backlog

- なし。初期 Wiki は起動・配置処理、主要機能、テスト・配布・文書運用を対象にしています。利用者向けの詳細な設定一覧は重複させず `README.ja.md` と `docs/features/reference.md` を正本として参照します。
