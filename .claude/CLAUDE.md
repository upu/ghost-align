# Ghost Align

VS Code拡張機能。コードを変更せずに、表示上でオペレーター（`=`など）の位置を揃える。

## ビルド・実行

```bash
npm install
npm run build        # 本番バンドル（esbuild + minify、.vsix 用）
npm run watch        # esbuild の watch ビルド（F5 デバッグ用）
npm run compile      # tsc。テスト出力（out-tsc/test/**）と型チェックを兼ねる
npm run check-types  # 型チェックのみ（tsc --noEmit）
```

配布物は esbuild でバンドルする（`esbuild.js`、`vscode:prepublish` → `npm run build`）。
テストは tsc 出力に依存するため `compile` を維持しており、CI も `npm run compile` → `npm test` を実行する。

デバッグ: VS Codeで `F5` → 「Run Extension」を選択

## プロジェクト構成

- `src/extension.ts` — メインロジック（唯一のソースファイル）
- `package.json` — 拡張機能の定義、コマンド、設定項目
- `esbuild.js` — 本番バンドルのビルドスクリプト
- `.vscode/launch.json` — デバッグ設定

## アーキテクチャ

- VS CodeのDecoration APIを使い、ソースコードを変更せずに視覚的なパディングを挿入
- 連続する行をグループ化し、グループ内でオペレーターの位置を最も右の行に合わせる
- 設定の名前空間は `ghostAlign`（例: `ghostAlign.enabled`, `ghostAlign.operators`）
- コマンドIDは `ghostAlign.toggle`

## 将来の方針

- `=` 以外のオペレーター（`:`, `//`, `=>` など）のアライメント対応を追加予定
- 「コードを変えずに見た目を整える」というコンセプトに沿った機能に特化する

## ワークフロー

GitHub Flow を採用。main は常にリリース可能な状態を保つ。

- issue 駆動で進める。改善点を優先度付きの GitHub issue にし、1 つずつ実装・merge する
- main へ直接 push しない。変更は必ず作業ブランチ → PR 経由で入れる
  - ブランチは最新の `origin/main` から切る
  - PR は CI（`test`）が green になってから squash merge する
  - merge 後は不要になった作業ブランチを削除する
- main にはブランチ保護（ruleset）がかかっており、直接 push・force push・削除は禁止
  - 設定の確認場所: GitHub の Settings → Rules → Rulesets
- コミットメッセージは Windows / PowerShell の here-string だと `@` や複数行で壊れやすい。一時ファイル＋ `git commit -F <file>`、または Bash ツールの heredoc（`git commit -m "$(cat <<'EOF' … EOF)"`）で渡す

## 行動原則

- 3ステップ以上のタスクは Plan モードで計画してから着手する
- コードを読まずに書かない。変更対象と周辺コードを必ず確認する
- 変更は必要な箇所のみ。スコープ外の改善点を見つけたら issue 登録を提案する
- テストで動作を証明できるまで完了としない
- スキル化・フック化・エージェント化したほうがよさそうな作業に気づいたら、随時提案する
  - スキル化: 繰り返す手順やワークフローを `/コマンド` 化できそうなとき
  - フック化: 「今後 X したら必ず Y する」のような自動化（テスト実行・lint など）を settings.json で仕込めそうなとき
  - エージェント化: 独立して並行・委譲できるまとまった調査やタスクがあるとき
