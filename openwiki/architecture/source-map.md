---
type: ソースマップ
title: 実装と変更起点の地図
description: Ghost Align の機能変更を開始する場所、設定・テスト・配布物への接続を示す実践的なソースマップです。
tags: [source-map, typescript, vscode-extension]
---

# 実装と変更起点の地図

変更は機能名ではなく「経路」「構文検出」「幅と配置」「VS Code 統合」のどこに属するかで始点を選ぶと追いやすくなります。実行時の接続は[実行時アーキテクチャ](overview.md)、機能別の振る舞いは[整列機能と非破壊コピー](../workflows/alignment.md)を参照してください。

## 実行時の主要ファイル

| 変更したいこと | 最初に読むファイル | 連動して確認するファイル |
| --- | --- | --- |
| VS Code コマンド、イベント、状態 | `src/extension.ts` | `src/decorate.ts`, `src/config.ts`, `src/test/suite/extension.test.ts` |
| 設定、既定値、言語別の経路 | `src/config.ts` と `package.json` | `src/test/suite/config.test.ts` |
| Decoration、可視範囲、大ファイルキャッシュ | `src/decorate.ts` | `src/paddings.ts`, `src/test/suite/decorate.test.ts` |
| 演算子の検出・文字列やコメントの除外 | `src/finders.ts` | `src/test/suite/finders.test.ts` |
| グループ化、視覚列、外れ値処理 | `src/paddings.ts` | `src/test/suite/paddings.test.ts` |
| 実スペースでのコピー | `src/copyAligned.ts` | `src/test/suite/copyAligned.test.ts` |
| JSDoc のタグ列 | `src/jsdoc.ts` | `src/test/suite/jsdoc.test.ts` |
| Markdown 表 | `src/markdown.ts` | `src/test/suite/markdown.test.ts` |
| CSV/TSV、数値列 | `src/csv.ts` | `src/test/suite/csv.test.ts` |
| URL 表示短縮とリンク範囲 | `src/urlShorten.ts` | `src/decorate.ts`, `src/test/suite/urlShorten.test.ts` |

## 設定を変える場合

公開設定のスキーマと既定値は `package.json` の `contributes.configuration`、実行時の解決と防御的な正規化は `src/config.ts` にあります。両者の言語別既定値・CSV 区切り既定値はテストで比較されるため、片方だけの変更は通りません。

設定がレンダリングへ届く流れは、`package.json` -> `src/config.ts` の解決 -> `src/extension.ts` の設定変更イベント -> `src/decorate.ts` の再描画です。特に `ghostAlign.disabledLanguages` は Markdown、CSV、JSDoc を含む言語全体を止めるため、機能限定の `*.enabled` 設定と混同しないでください。

## ビルド・成果物・文書

- `scripts/esbuild.js` は `src/extension.ts` を CommonJS の `out/extension.js` へバンドルします。`vscode` は外部依存のままです。
- `tsconfig.json` はテストを `out-tsc/test/**` へ出力し、`.vscode-test.mjs` と `npm test` がその出力を使います。
- `scripts/check-package-contents.js` は VSIX に含める内容を検査します。`out/`、`out-tsc/`、`dist/`、`ghost-align.vsix` は生成物です。
- 利用者向け説明は `README.md` / `README.ja.md`、開発手順は `docs/CONTRIBUTING.md`、機能詳細は `docs/features/` です。公開 README に開発者向け手順を混在させない方針です。

これらのビルドと配布の実行手順、各領域の回帰テスト選択は、[開発、テスト、パッケージ、リリース](../operations/contributing.md) が説明します。
