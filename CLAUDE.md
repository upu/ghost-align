# Ghost Align

VS Code拡張機能。コードを変更せずに、表示上でオペレーター（`=`など）の位置を揃える。

## ビルド・実行

```bash
npm install
npm run compile    # TypeScriptのビルド
npm run watch      # ファイル変更時に自動ビルド
```

デバッグ: VS Codeで `F5` → 「Run Extension」を選択

## プロジェクト構成

- `src/extension.ts` — メインロジック（唯一のソースファイル）
- `package.json` — 拡張機能の定義、コマンド、設定項目
- `.vscode/launch.json` — デバッグ設定

## アーキテクチャ

- VS CodeのDecoration APIを使い、ソースコードを変更せずに視覚的なパディングを挿入
- 連続する行をグループ化し、グループ内でオペレーターの位置を最も右の行に合わせる
- 設定の名前空間は `ghostAlign`（例: `ghostAlign.enabled`, `ghostAlign.operators`）
- コマンドIDは `ghostAlign.toggle`

## 将来の方針

- `=` 以外のオペレーター（`:`, `//`, `=>` など）のアライメント対応を追加予定
- 「コードを変えずに見た目を整える」というコンセプトに沿った機能に特化する

## 行動原則

- 3ステップ以上のタスクは Plan モードで計画してから着手する
- コードを読まずに書かない。変更対象と周辺コードを必ず確認する
- 変更は必要な箇所のみ。スコープ外の改善点を見つけたら issue 登録を提案する
- テストで動作を証明できるまで完了としない
