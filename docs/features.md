# Features

拡張機能の「コンセプト＋機能インベントリ」を1ページにまとめた開発用ドキュメント。dev-flow:plan-next や「この拡張機能でほしい機能は？」のような現状把握のたびにソースを読み直さずに済むようにするためのもの。

利用者向けの使い方・設定の説明は [README.md](../README.md) / [README.ja.md](../README.ja.md) を、ソース構成・アーキテクチャは `.claude/CLAUDE.md` を参照。同じ内容をここで重複して説明しない。

## コンセプト

Ghost Align は「コードを変えずに、表示上でオペレーターの位置を揃える」ことに特化した VS Code 拡張機能。

やること:

- VS Code の Decoration API で見た目上の空白（ゴーストパディング）を挿入する。ファイルの実体・Git の差分は一切変更しない。
- 連続する行をグループ化し、グループ内でオペレーター（`=` など）の位置を最も右の行に合わせる。
- 対応言語ごとに既定のオペレーターセットを持ち、`ghostAlign.operatorsByLanguage` で言語別に上書きできる。
- 演算子アライメントに加えて、Markdown テーブル・CSV/TSV・JSDoc `@param` など、揃える対象が異なる複数の整列パスを同じ「表示のみ」の原則の下で提供する。
- 実スペースが必要な場面（他人に共有するコードなど）向けに、ゴーストパディングを実文字列として書き出す Copy with Alignment コマンドを提供する。

やらないこと:

- ソースコードの自動整形・保存時の書き換え（prettier のようなフォーマッタの代替）は行わない。挿入する空白は常に表示専用で、ファイルには保存されない。
- コード変更を伴う機能（リファクタリング、コード生成、Lint 修正など）は対象外。
- 「表示上で整える」というコンセプトに沿わない機能は追加しない。範囲外の改善案は個別の GitHub issue で検討する。

## 機能インベントリ

整列パスごとに、対応する設定キー・コマンド ID をまとめる。各設定・コマンドの詳細な説明は README の「Settings」節を参照。

### operators（演算子アライメント）

行内の `=` `:` `=>` `<-` `\` や、行末コメントマーカー（`//` `#` `--` `;`）などの位置を揃える、最も基本の整列パス。

- 設定キー: `ghostAlign.operators`, `ghostAlign.operatorsByLanguage`, `ghostAlign.alignUnknownLanguages`
- 言語別の既定オペレーターは `DEFAULT_OPERATORS_BY_LANGUAGE`（`src/config.ts`）が真実。一覧は README の「How it works」プロース（`= is aligned by default` の文）を参照 — このドキュメントでは重複させない（#317）。

### Markdown テーブル

Markdown の `|` テーブル列を、パイプの位置が揃うように整列する。区切り行のアラインメントマーカー（`---:` 右寄せ・`:---:` 中央寄せ・`:---`／`---` 左寄せ）に従い、ヘッダー・データ行のセル内容もその寄せで揃える。

- 設定キー: `ghostAlign.markdownTable.enabled`

### CSV・TSV

`csv` / `tsv` 言語 ID のドキュメントで、区切り文字の位置が揃うように整列する。RFC 4180 のクォート規則（`"` で囲まれたフィールド内の区切り文字は無視）を考慮する。

- 設定キー: `ghostAlign.csv.enabled`, `ghostAlign.csv.delimiters`
- 既定の区切り文字は `DEFAULT_CSV_DELIMITERS`（`src/config.ts`）が真実（既定は `csv` = `,`、`tsv` = タブ）。

### JSDoc @param

JavaScript/TypeScript で、連続する JSDoc `@param` 行のパラメータ名列・説明列を揃える。

- 設定キー: `ghostAlign.jsdoc.enabled`（廃止予定の `ghostAlign.alignJsdocParams` は `ghostAlign.jsdoc.enabled` が未設定のときのみ後方互換で参照される）

### Copy with Alignment

ゴーストパディングを実スペースとして書き出したテキストをクリップボードにコピーする。共有・貼り付け先で見た目を保ちたいときに使う。

- コマンド: `ghostAlign.copyAligned`（コマンドパレット、およびエディタの右クリックメニュー）

### トグル・言語別無効化

拡張機能全体、または言語単位で整列表示の ON/OFF を切り替える。

- 拡張機能全体の ON/OFF: コマンド `ghostAlign.toggle`
- 現在の言語だけを無効化/再有効化: コマンド `ghostAlign.toggleLanguage`（内部的に `ghostAlign.disabledLanguages` を書き換える）
- ステータスバー表示: 設定キー `ghostAlign.showStatusBar`
- 1行あたりのパディング量の上限: 設定キー `ghostAlign.maxPadding`
- ゴーストパディングの色: 設定キー `ghostAlign.ghostColor`

## 設定・コマンド一覧

`package.json` の `contributes` が真実。ここには索引としてキー・ID だけを列挙する。説明文は README の設定表と重複させない。

### 設定キー（`ghostAlign.*`）

- `ghostAlign.showStatusBar`
- `ghostAlign.operators`
- `ghostAlign.operatorsByLanguage`
- `ghostAlign.disabledLanguages`
- `ghostAlign.alignUnknownLanguages`
- `ghostAlign.jsdoc.enabled`
- `ghostAlign.markdownTable.enabled`
- `ghostAlign.csv.enabled`
- `ghostAlign.csv.delimiters`
- `ghostAlign.alignJsdocParams`（非推奨。`ghostAlign.jsdoc.enabled` 未設定時のみ参照される）
- `ghostAlign.maxPadding`
- `ghostAlign.ghostColor`

### コマンド

- `ghostAlign.toggle` — Ghost Align: Toggle
- `ghostAlign.copyAligned` — Ghost Align: Copy with Alignment
- `ghostAlign.toggleLanguage` — Ghost Align: Disable/Enable for Current Language

## メンテナンス

このドキュメントは以下の点でメンテコストを抑えている:

- 設定キー・コマンド ID の一覧は同期テスト（`src/test/suite/config.test.ts` の「docs/features.md との同期」suite）が package.json との過不足を機械検証する。キーの追加・削除・改名は CI で検出され、このファイルの更新が強制される。
- 対応言語一覧・設定の詳細な説明文はここに複製せず、真実のソース（`src/config.ts` の `DEFAULT_OPERATORS_BY_LANGUAGE` / `DEFAULT_CSV_DELIMITERS`）や README の該当節への参照に留めている。
- コンセプト節の散文は変化が稀な前提で機械検証の対象外としている。挙動の詳細な説明はテストとソースを正とする。
