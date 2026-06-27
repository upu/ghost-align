# コントリビュートガイド

Ghost Align の開発者向け手順です。利用者向けの説明は [../README.md](../README.md) を参照してください。

## ドキュメント構成

- `README.md` — **利用者向け**。VS Code Marketplace の拡張機能ページとして公開される。開発者向けの記述は置かない。
- `docs/CONTRIBUTING.md`（このファイル） — **開発者向け**。ビルド・デバッグ・ワークフロー。`.vsix` には同梱しない。
- `docs/changelog-guide.md` — CHANGELOG の運用ガイド。

## セットアップ

```bash
npm install
```

## ビルド・実行

```bash
npm run build        # 本番バンドル（esbuild + minify、.vsix 用）
npm run watch        # esbuild の watch ビルド（F5 デバッグ用）
npm run compile      # tsc。テスト出力（out-tsc/test/**）と型チェックを兼ねる
npm run check-types  # 型チェックのみ（tsc --noEmit）
```

配布物は esbuild でバンドルします（`esbuild.js`、`vscode:prepublish` → `npm run build`）。テストは tsc 出力に依存するため `compile` を維持しています。

## デバッグ

VS Code でリポジトリを開き、`F5` → 「Run Extension」を選択すると、拡張機能を読み込んだデバッグ用ウィンドウが起動します。

## テスト

```bash
npm test
```

## VSIX の生成・インストール

```bash
npm run package          # ghost-align.vsix を生成
npm run install:vsix     # 生成した VSIX をインストール
npm run package:install  # 生成とインストールをまとめて実行
```

## ワークフロー

GitHub Flow を採用しています。`main` は常にリリース可能な状態を保ちます。

- 変更は作業ブランチ → PR 経由で入れます（`main` へ直接 push しない）。ブランチは最新の `origin/main` から切ります。
- PR は CI（`test`）が green になってから squash merge します。
- ユーザー影響のある変更は `CHANGELOG.md` の `[Unreleased]` に追記します。詳しくは [changelog-guide.md](changelog-guide.md) を参照してください。
