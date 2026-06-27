<!--
  このファイルは VS Code Marketplace の拡張機能ページとして公開されます（利用者向け）。
  開発・ビルド・デバッグ・コントリビュートの手順は docs/CONTRIBUTING.md に書き、
  ここには利用者向けの内容だけを置いてください（開発者向けの記述を追加しないこと）。
-->

# Ghost Align

> Visually align operators like `=` without modifying your source code.

Ghost Align は VS Code 拡張機能です。`=` などのオペレーターの位置を、**ソースコードを一切変更せずに**、表示上だけで揃えます。

エディタの Decoration API を使って視覚的なパディングを差し込むだけなので、ファイルに余計な空白が保存されることはありません。Git の差分も汚れません。「コードは変えない、見た目だけ揃える」がコンセプトです。

## Before / After

実際のファイルの中身は変わりません。下は **見た目** のイメージです。

Before（揃っていない）:

```js
const x = 1;
const foo = 2;
const longName = 3;
```

After（Ghost Align 有効時の見た目）:

```js
const x        = 1;
const foo      = 2;
const longName = 3;
```

差し込まれた空白は装飾（ゴースト）であり、ファイルには保存されません。

## 動作の概要

- 連続する行をグループ化し、グループ内でオペレーターの位置を最も右の行に合わせます。
- インデント幅が変わると別グループとして扱うため、ネストしたブロック（JSON のオブジェクトなど）が異なる階層をまたいで揃うことはありません。
- `=` のアライメントでは、文字列・コメント・`( )`・`[ ]` の中の `=`、および `==` `!=` `<=` `>=` `=>` は対象外です（代入の `=` のみを揃えます）。
- 現在は `=` の揃えに対応しています。言語によって既定のオペレーターが変わり、`json` / `jsonc` / `yaml` / `css` / `scss` / `less` では `:`、`dotenv` / `properties` / `toml` では `=` を揃えます。今後さらに多くのオペレーターへの対応を予定しています。

## インストール

VS Code の拡張機能ビュー（`Ctrl+Shift+X`）で **Ghost Align** を検索し、Install を押します。

コマンドラインからは次のとおりです。

```bash
code --install-extension upu.ghost-align
```

Marketplace のページ: <https://marketplace.visualstudio.com/items?itemName=upu.ghost-align>

## 使い方

拡張機能を有効にすると、対象のオペレーターを含む行が自動的に揃って表示されます。

表示上のアライメントは、コマンドパレットから次のコマンドでオン／オフを切り替えられます。

- `Ghost Align: Toggle`（コマンド ID: `ghostAlign.toggle`）

`ghostAlign.showStatusBar` を有効にすると、ステータスバーに ON/OFF 表示が出て、クリックでもトグルできます。

## 設定

すべて `ghostAlign` 名前空間の設定です。

| 設定 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `ghostAlign.enabled` | boolean | `true` | 視覚的なアライメントを有効にします。 |
| `ghostAlign.showStatusBar` | boolean | `false` | Ghost Align の ON/OFF を示すステータスバー項目を表示します（クリックでトグル）。 |
| `ghostAlign.operators` | array | `["="]` | 揃える対象のオペレーター。現在の言語が `ghostAlign.operatorsByLanguage` に無い場合に使われます。 |
| `ghostAlign.operatorsByLanguage` | object | `{ "json": [":"], "jsonc": [":"], "yaml": [":"], "dotenv": ["="], "properties": ["="], "toml": ["="], "css": [":"], "scss": [":"], "less": [":"] }` | 言語 ID（`json`, `jsonc`, `typescript` など）ごとのオペレーター上書き。現在のドキュメントの言語がここに含まれる場合、`ghostAlign.operators` の代わりにこちらが使われます。 |
| `ghostAlign.ghostCharacter` | string | `" "`（U+00A0 / ノーブレークスペース） | ゴーストパディングに使う文字。通常の ASCII スペースはエディタの描画で 1 文字分に詰められてアライメントが崩れるため、NBSP（U+00A0）や en space（U+2002）を使ってください。設定 UI で空にすると既定値に戻ります。 |
| `ghostAlign.ghostColor` | string | `"rgba(128, 128, 128, 0.25)"` | ゴーストパディングの色（任意の CSS カラー文字列）。前景色・背景色の両方に適用され、実際の空白と区別できます。`"transparent"` で着色を無効化できます。設定 UI で空にすると既定値に戻ります。 |

## ライセンス

MIT
