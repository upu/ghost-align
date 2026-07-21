# Features Overview

拡張機能の「コンセプト＋機能の柱」を概要レベルでまとめた開発用ドキュメント。dev-flow:plan-next や「この拡張機能でほしい機能は？」のような現状把握のたびにソースを読み直さずに済むようにするためのもの。

設定キー・コマンド ID など詳細な機能インベントリは [reference.md](./reference.md) を参照。利用者向けの使い方・設定の説明は [README.md](../../README.md) / [README.ja.md](../../README.ja.md) を、ソース構成・アーキテクチャは `.claude/CLAUDE.md` を参照。同じ内容をここで重複して説明しない。

## コンセプト

Ghost Align は「コードを変えずに、表示上でオペレーターの位置を揃える」ことに特化した VS Code 拡張機能。VS Code の Decoration API で見た目上の空白（ゴーストパディング）を挿入するだけで、ファイルの実体・Git の差分は一切変更しない。

やらないこと:

- ソースコードの自動整形・保存時の書き換え（prettier のようなフォーマッタの代替）は行わない。
- コード変更を伴う機能（リファクタリング、コード生成、Lint 修正など）は対象外。
- 「表示上で整える」というコンセプトに沿わない機能は追加しない。範囲外の改善案は個別の GitHub issue で検討する。

## 機能の3本柱

### 1. オペレーターアライメント

行内の `=` `:` `=>` などの演算子や、行末コメントマーカーの位置を、連続する行のグループ内で最も右の行に合わせる、最も基本の整列パス。対応言語ごとに既定のオペレーターセットを持ち、言語別に上書きできる。

JSDoc `@param` 行のパラメータ名・説明列の整列も、この柱と同じ「列を揃える」考え方をコメント構文向けに適用したサブ機能。

詳細は [reference.md#operators](./reference.md#operators演算子アライメント) / [reference.md#jsdoc-param](./reference.md#jsdoc-param) を参照。

### 2. テーブルの列整列（Markdown / CSV・TSV）

Markdown テーブルの `|` 列、および CSV/TSV の区切り文字の位置を、それぞれの構文規則（Markdown の寄せマーカー、RFC 4180 のクォート規則）に従って揃える。

テーブルセル内の URL をホスト名だけの表示に短縮する機能も、列が長い URL のせいで間延びしないようにするこの柱のサブ機能。

詳細は [reference.md#markdown-テーブル](./reference.md#markdown-テーブル) / [reference.md#csvtsv](./reference.md#csvtsv) / [reference.md#url-短縮表示テーブルセル内418](./reference.md#url-短縮表示テーブルセル内418) を参照。

### 3. Copy with Alignment（ゴースト付きコピー）

実スペースが必要な場面（他人に共有するコードなど）向けに、ゴーストパディングを実文字列として書き出してクリップボードにコピーするコマンド。

詳細は [reference.md#copy-with-alignment](./reference.md#copy-with-alignment) を参照。

## その他

拡張機能全体・言語単位のトグルなど、上記3本柱を支える設定・コマンドは柱として独立させず、[reference.md](./reference.md) の索引にまとめている。
