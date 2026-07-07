<!--
  このファイルは VS Code Marketplace の拡張機能ページとして公開されます（利用者向け）。
  開発・ビルド・デバッグ・コントリビュートの手順は docs/CONTRIBUTING.md に書き、
  ここには利用者向けの内容だけを置いてください（開発者向けの記述を追加しないこと）。
-->

🇬🇧 [English](README.md)

# Ghost Align

> Visually align operators like `=` without modifying your source code.

Ghost Align は VS Code 拡張機能です。`=` などのオペレーターの位置を、**ソースコードを一切変更せずに**、表示上だけで揃えます。

エディタの Decoration API を使って視覚的なパディングを差し込むだけなので、ファイルに余計な空白が保存されることはありません。Git の差分も汚れません。「コードは変えない、見た目だけ揃える」がコンセプトです。

## デモ

`=` の整列（ソースは変更されません。トグルで ON/OFF）:

![= の整列のデモ](https://raw.githubusercontent.com/upu/ghost-align/main/media/demo_js.gif)

JSON の `:` の整列:

![JSON の : 整列のデモ](https://raw.githubusercontent.com/upu/ghost-align/main/media/demo_json.gif)

Markdown テーブルの列整列:

![Markdown テーブルの整列のデモ](https://raw.githubusercontent.com/upu/ghost-align/main/media/demo_md.gif)

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
- アロー関数（`=>`）は独立したトークンとして揃えられます。`ghostAlign.operators`（または `operatorsByLanguage`）に `"=>"` を追加すると、`const onClick = (e) => ...` のような連続行の `=>` の位置が揃います。文字列・コメント内の出現は対象外です。
- 行末の継続マーカー（`\`）も独立したトークンとして揃えられます。`ghostAlign.operators`（または `operatorsByLanguage`）に `"\\"` を追加すると、シェルスクリプトや Makefile、C プリプロセッサの `#define` 継続行の末尾 `\` の位置が揃います。対象になるのは行の最後の非空白文字である `\` のみで、文字列やエスケープシーケンス内の `\` は対象外です。どの言語でも既定では無効（オプトイン）です。
- 既定では `=` を揃えます。言語によって既定のオペレーターが変わり、`json` / `jsonc` / `yaml` / `css` / `scss` / `less` / `graphql` では `:`、`dotenv` / `properties` / `toml` / `ini` / `python` / `shellscript` / `makefile` / `go` / `lua` / `c` / `cpp` / `csharp` / `java` / `sql` / `haskell` / `powershell` / `dockerfile` / `scala` / `groovy` では `=` を揃えます。`ruby` / `php` / `rust` では `=` に加えて `=>`（ハッシュロケット・連想配列・match アーム）も揃えます。`r` では `=` に加えて慣用的な代入演算子 `<-` も揃えます。それ以外の言語はグローバルの `ghostAlign.operators`（既定 `=`）にフォールバックします。`ghostAlign.alignUnknownLanguages` を `false` にすると、`operatorsByLanguage` に載っている言語だけを揃えます。
- JavaScript/TypeScript では、連続する JSDoc の `@param` 行も整列します。パラメータ名のカラムと説明文のカラムがそれぞれ縦に揃います（`ghostAlign.jsdoc.enabled` で無効化できます）。
- 行末コメント（`//` / `#` / `--` / `;`）の整列にも対応しています（`ghostAlign.operators` などに `"//"` / `"#"` / `"--"` / `";"` を指定するオプトイン。文字列内・`http://` などの URL・行全体がコメントの行は対象外。`//` 以外のマーカーは直前が空白であることも条件で、例えば `x--y` の `--` や `a;b` の `;` のようにコードと直接繋がったマーカーをコメントと誤認しません）。
- 1行だけ極端に長い行があると他の行に大量のゴーストが入りますが、`ghostAlign.maxPadding` で上限を設定すると、外れ値の行を除外して残りの行だけで揃えます（既定は無制限）。
- Markdown では、テーブルの列（`|` 区切り）が縦に揃って見えるようにします（`ghostAlign.markdownTable.enabled` で無効化できます）。
- CSV / TSV のドキュメント（言語 ID が `csv` / `tsv` の場合。Rainbow CSV などの拡張機能が提供します — VS Code 単体では `.csv` はプレーンテキストとして開かれます）では、区切り文字が縦に揃って見えるように列を整列します。ダブルクォートで囲まれたフィールド内のカンマ（RFC 4180、`""` エスケープを含む）は区切りとして扱いません。`ghostAlign.csv.enabled` で無効化できます。
- タブを含む行でも、タブ幅（`editor.tabSize`）を考慮して視覚的な位置で揃えます。

## インストール

VS Code の拡張機能ビュー（`Ctrl+Shift+X`）で **Ghost Align** を検索し、Install を押します。

コマンドラインからは次のとおりです。

```bash
code --install-extension upu.ghost-align
```

Marketplace のページ: <https://marketplace.visualstudio.com/items?itemName=upu.ghost-align>

## 使い方

拡張機能を有効にすると、対象のオペレーターを含む行が自動的に揃って表示されます。

表示上のアライメントは、コマンドパレットから次のコマンドでオン／オフを切り替えられます。状態はワークスペースごとに保持され、ウィンドウのリロード後も維持されます（トグルを使ったことのないワークスペースは、ワークスペース単位トグル導入前に保存した状態を引き継ぎます。新規インストールでは ON）。

- `Ghost Align: Toggle`（コマンド ID: `ghostAlign.toggle`）

`ghostAlign.showStatusBar` を有効にすると、ステータスバーに ON/OFF 表示が出て、クリックでもトグルできます。

## 設定

すべて `ghostAlign` 名前空間の設定です。

| 設定 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `ghostAlign.showStatusBar` | boolean | `false` | Ghost Align の ON/OFF を示すステータスバー項目を表示します（クリックでトグル）。 |
| `ghostAlign.operators` | array | `["="]` | 揃える対象のオペレーター。現在の言語が `ghostAlign.operatorsByLanguage` に無い場合に使われます。`"="`（代入）、`":"`（JSON/YAML のキーや CSS の宣言）、`"//"` / `"#"` / `"--"` / `";"`（行末コメント）、`"=>"`（アロー関数）、`"\\"`（行末の継続マーカー。シェルスクリプトや Makefile、C プリプロセッサの `#define` 継続行など）に対応。`"="`、`"=>"`、`"\\"` は文字列・コメント内の出現を除外します。それ以外の文字列はそのまま一致します。並び順は優先度かつ左から右へのカラム順です。リストの各オペレーターがそれぞれ独立したカラムとして同じ行の中で揃います（例: `["=", "#"]` なら代入と行末コメントの両方が揃う）。 |
| `ghostAlign.operatorsByLanguage` | object | `{ "json": [":"], "jsonc": [":"], "yaml": [":"], "dotenv": ["="], "properties": ["="], "toml": ["="], "ini": ["="], "python": ["="], "shellscript": ["="], "ruby": ["=", "=>"], "makefile": ["="], "css": [":"], "scss": [":"], "less": [":"], "php": ["=", "=>"], "rust": ["=", "=>"], "go": ["="], "lua": ["="], "c": ["="], "cpp": ["="], "csharp": ["="], "java": ["="] }` | 言語 ID（`json`, `jsonc`, `typescript` など）ごとのオペレーター上書き。現在のドキュメントの言語がここに含まれる場合、`ghostAlign.operators` の代わりにこちらが使われます。 |
| `ghostAlign.disabledLanguages` | array | `[]` | Ghost Align を丸ごと無効化する言語 ID のリスト（例: `markdown`, `yaml`）。Markdown テーブル / CSV / JSDoc の整列も含めて無効になります。`ghostAlign.operatorsByLanguage` より優先されます。 |
| `ghostAlign.alignUnknownLanguages` | boolean | `true` | `ghostAlign.operatorsByLanguage` に載っていない言語も、グローバルの `ghostAlign.operators` で整列するかどうか。`false` にすると明示された言語だけを揃えます（自分で `operatorsByLanguage` に追加した言語は対象のまま）。明示ブロックリストの `ghostAlign.disabledLanguages` と違い、載っていない言語のフォールバックを一括で止めます。Markdown テーブルと CSV/TSV は専用の整列パスのため影響を受けません。 |
| `ghostAlign.jsdoc.enabled` | boolean | `true` | JavaScript/TypeScript で、連続する JSDoc `@param` 行のパラメータ名カラムと説明文カラムを揃えます。 |
| `ghostAlign.markdownTable.enabled` | boolean | `true` | Markdown テーブルの列整列。`false` にするとテーブル整列だけを無効化します（Markdown を丸ごと無効にするには `ghostAlign.disabledLanguages` を使います）。 |
| `ghostAlign.csv.enabled` | boolean | `true` | CSV/TSV の列整列。`false` にすると CSV/TSV の整列だけを無効化します（言語ごと無効にするには `ghostAlign.disabledLanguages` を使います）。 |
| `ghostAlign.maxPadding` | number | `0` | 1行・1カラムあたりに挿入するゴースト文字数の上限。演算子と JSDoc `@param` の整列では、極端に長い外れ値の行を除外して残りの行だけで揃えます。Markdown テーブルと CSV/TSV の整列では、外れ値セルを含む列だけが整列をスキップされます（表の形は保たれ、以降の列は整列を続けます）。`0` は無制限。 |
| `ghostAlign.ghostColor` | string | `"rgba(128, 128, 128, 0.25)"` | ゴーストパディングの色（任意の CSS カラー文字列）。前景色・背景色の両方に適用され、実際の空白と区別できます。`"transparent"` で着色を無効化できます。設定 UI で空にすると既定値に戻ります。 |

`ghostAlign.alignJsdocParams` は非推奨になりました。今後は `ghostAlign.jsdoc.enabled` を使ってください（新キーが未設定の間は旧キーも引き続き有効です）。

## ライセンス

MIT
