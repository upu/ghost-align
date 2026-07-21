# Features Reference

コンセプト・全体像は [overview.md](./overview.md) を参照。このページは整列パスごとの詳細（対応する設定キー・コマンド ID）をまとめた索引。各設定・コマンドの説明文そのものは README の「Settings」節を参照し、ここでは重複させない。

## 機能インベントリ

### operators（演算子アライメント）

行内の `=` `:` `=>` `<-` `\` や、行末コメントマーカー（`//` `#` `--` `;`）などの位置を揃える、最も基本の整列パス。

- 設定キー: `ghostAlign.operators`, `ghostAlign.operatorsByLanguage`, `ghostAlign.alignUnknownLanguages`
- 言語別の既定オペレーターは `DEFAULT_OPERATORS_BY_LANGUAGE`（`src/config.ts`）が真実。一覧は README の「How it works」プロース（`= is aligned by default` の文）を参照 — このドキュメントでは重複させない（#317）。

### Markdown テーブル

Markdown の `|` テーブル列を、パイプの位置が揃うように整列する。区切り行のアラインメントマーカー（`---:` 右寄せ・`:---:` 中央寄せ・`:---`／`---` 左寄せ）に従い、ヘッダー・データ行のセル内容もその寄せで揃える。

- 設定キー: `ghostAlign.markdownTable.enabled`

### CSV・TSV

`csv` / `tsv` 言語 ID のドキュメントで、区切り文字の位置が揃うように整列する。RFC 4180 のクォート規則（`"` で囲まれたフィールド内の区切り文字は無視）を考慮する。`ghostAlign.csv.alignNumbersRight`（既定 false）を有効にすると、データセルが全て数値とみなせる列だけ右寄せになる（1行目はヘッダーとして数値判定から除外されるが、右寄せ自体は適用される）。小数を含む列では、セル全体の右寄せでなく小数点の位置で揃える（整数のみのセルは整数部の桁数で揃う）。

- 設定キー: `ghostAlign.csv.enabled`, `ghostAlign.csv.delimiters`, `ghostAlign.csv.alignNumbersRight`
- 既定の区切り文字は `DEFAULT_CSV_DELIMITERS`（`src/config.ts`）が真実（既定は `csv` = `,`、`tsv` = タブ）。

### URL 短縮表示（テーブルセル内、#418）

CSV/TSV の全セル、および Markdown テーブルセル内（テーブル外の本文は対象外）の http(s) URL を、ホスト部分だけの表示に短縮する。`[github.com]` のようにホスト名を実テキストのまま `[` `]` で囲み、scheme・userinfo・パス・クエリ・フラグメントは decoration（`textDecoration` への CSS 注入）で視覚的に隠すだけで、ソースバッファは変更しない。ホストが実テキストのため文字自体は見た目どおりクリック可能で、Ctrl+クリックで開く URL は専用の `DocumentLinkProvider`（`computeUrlShortenLinks`）が host の範囲だけを対象に提供する。VS Code 組み込みの汎用リンク検出は半角カンマを行末以外では区切りとみなさないため、CSV セルのように空白のない区切りで隣接するセルまで巻き込んでしまう（Markdown の `|` は組み込み側でも区切り文字扱いのため問題ない）——これを避けるための独自 provider。カーソル・選択が短縮中の URL に触れると一時的に全文表示へ展開する。列の整列（ゴーストパディング）は短縮後の幅を基準に計算するため、長い URL のせいで列が間延びしない。ブール1つで on/off する（既定オン、長さしきい値なし＝検出したら常に短縮）。

- 設定キー: `ghostAlign.shortenUrls`

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
- `ghostAlign.csv.alignNumbersRight`
- `ghostAlign.shortenUrls`
- `ghostAlign.alignJsdocParams`（非推奨。`ghostAlign.jsdoc.enabled` 未設定時のみ参照される）
- `ghostAlign.maxPadding`
- `ghostAlign.ghostColor`

### コマンド

- `ghostAlign.toggle` — Ghost Align: Toggle
- `ghostAlign.copyAligned` — Ghost Align: Copy with Alignment
- `ghostAlign.toggleLanguage` — Ghost Align: Disable/Enable for Current Language

## メンテナンス

このドキュメントは以下の点でメンテコストを抑えている:

- 設定キー・コマンド ID の一覧は同期テスト（`src/test/suite/config.test.ts` の「docs/features/reference.md との同期」suite）が package.json との過不足を機械検証する。キーの追加・削除・改名は CI で検出され、このファイルの更新が強制される。
- 対応言語一覧・設定の詳細な説明文はここに複製せず、真実のソース（`src/config.ts` の `DEFAULT_OPERATORS_BY_LANGUAGE` / `DEFAULT_CSV_DELIMITERS`）や README の該当節への参照に留めている。
- コンセプト・柱の構成は [overview.md](./overview.md) 側にまとめ、変化が稀な前提で機械検証の対象外としている。挙動の詳細な説明はテストとソースを正とする。
