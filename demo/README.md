# デモ素材

README 用のスクリーンショット/GIF（[#59](https://github.com/upu/ghost-align/issues/59)）を撮るためのサンプルです。配布パッケージ（VSIX）には含めません（`.vscodeignore` で `demo/**` を除外）。

## ファイル

- `sample.js` — `=` の整列（デフォルトで有効）。主役の GIF 向け。
- `sample.json` — `:` の整列（JSON はデフォルトで有効）。
- `sample.md` — Markdown テーブルの列整列。
- `sample.csv` — CSV の区切り文字整列と `ghostAlign.shortenUrls`（URL のドメイン短縮表示）。

## GIF の撮り方（目安）

1. 録画ツールを起動し、録画枠をコードに寄せる。Windows 標準の Snipping Tool（`Win + Shift + S` またはスタートメニューから）で録画から GIF 書き出しまで完結できる。[ScreenToGif](https://www.screentogif.com/) など他ツールでもよい。
2. フォントは大きめ（`Editor: Font Size` 16〜18）、ミニマップ/パンくずは OFF が見やすい。
3. トグルを映すなら設定 `ghostAlign.showStatusBar` を `true` にして、ステータスバーの「Ghost Align」をクリックして ON/OFF する（またはコマンドパレットの `Ghost Align: Toggle`）。
4. 流れ: 揃っていない状態で 1 秒 → ON にして揃う様子 → 行を選択して実テキストは不変だと見せる → OFF で戻す。
5. 余分なフレームを削り、2〜3MB 以下で書き出す。

## README への載せ方

- 撮った GIF はサンプルごとに `media/demo_<種別>.gif` に置く（`sample.js` → `media/demo_js.gif`、`sample.json` → `media/demo_json.gif`、`sample.md` → `media/demo_md.gif`）。
- Marketplace は相対パス画像を表示しないため、README では raw URL で参照する:

  ```markdown
  ![Demo of = alignment](https://raw.githubusercontent.com/upu/ghost-align/main/media/demo_js.gif)
  ```

- `media/*.gif` は VSIX に同梱しない（`.vscodeignore` で除外済み）。同梱すると `npm run check:package` が想定外ファイルとして失敗する。
