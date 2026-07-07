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

配布物は esbuild でバンドルします（`scripts/esbuild.js`、`vscode:prepublish` → `npm run build`）。テストは tsc 出力に依存するため `compile` を維持しています。

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
- ユーザー影響のある変更は `CHANGELOG.md`（英語・正）と `CHANGELOG.ja.md`（日本語）両方の `[Unreleased]` に追記します。詳しくは [changelog-guide.md](changelog-guide.md) を参照してください。

## リリース

リリースは2段階に分かれます。

1. **リリース PR のマージまで** — `/release x.y.z` スキルが担当します。`CHANGELOG.md` と `CHANGELOG.ja.md` の `[Unreleased]` を `## [x.y.z] - YYYY-MM-DD` に確定し、`package.json` の version を bump、PR → CI green → merge します。
2. **main へのマージ後（自動）** — `main` への push で `.github/workflows/release.yml` が起動します。`package.json` の version に対応する `vx.y.z` の GitHub Release がまだ存在しないときだけ、`npm run package` で `.vsix` を生成 → GitHub Release を作成して `.vsix` を添付（`vx.y.z` タグはこの Release 作成の副作用として作られます。手動でのタグ作成・push は不要です）→ VS Code Marketplace に公開します。リリースノートは `CHANGELOG.md` の該当版セクションから生成されます。

`vx.y.z` の GitHub Release が既に存在する version での `main` への push（通常のマージ）は no-op で終了し、何も公開されません。

### 必要なシークレット

Marketplace 公開には Personal Access Token が必要です。

- リポジトリの **Settings → Secrets and variables → Actions** に `VSCE_PAT` を登録します（Azure DevOps で発行する、Marketplace の Manage 権限を持つ PAT）。
- `VSCE_PAT` が未設定の場合、release.yml は GitHub Release の作成までで止まり、Marketplace 公開ステップはスキップされます。
