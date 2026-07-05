"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compareSemver,
  todayIso,
  validate,
  finalizeChangelog,
  bumpPackageJsonVersion,
} = require("./prepare-release.js");

const SAMPLE_CHANGELOG = [
  "# Changelog",
  "",
  "本文.",
  "",
  "## [Unreleased]",
  "",
  "### Added",
  "",
  "- 新機能を追加。",
  "",
  "## [0.7.0] - 2026-07-05",
  "",
  "### Fixed",
  "",
  "- バグを修正。",
  "",
  "[Unreleased]: https://github.com/upu/ghost-align/compare/v0.7.0...HEAD",
  "[0.7.0]: https://github.com/upu/ghost-align/releases/tag/v0.7.0",
  "",
].join("\n");

const EMPTY_UNRELEASED_CHANGELOG = SAMPLE_CHANGELOG.replace(
  "### Added\n\n- 新機能を追加。\n\n",
  ""
);

const SAMPLE_CHANGELOG_EN = SAMPLE_CHANGELOG.replace("新機能を追加", "Added a feature");

function changelogs(en, ja) {
  return [
    { label: "CHANGELOG.md", text: en },
    { label: "CHANGELOG.ja.md", text: ja },
  ];
}

test("compareSemver: 大小関係を返す", () => {
  assert.ok(compareSemver("0.8.0", "0.7.0") > 0);
  assert.equal(compareSemver("0.7.0", "0.7.0"), 0);
  assert.ok(compareSemver("0.7.0", "0.8.0") < 0);
});

test("todayIso: ローカル日付を YYYY-MM-DD で返す", () => {
  assert.equal(todayIso(new Date(2026, 6, 5)), "2026-07-05");
});

test("validate: 不正なバージョン形式はエラー文字列を返す", () => {
  const both = changelogs(SAMPLE_CHANGELOG_EN, SAMPLE_CHANGELOG);
  assert.match(validate("not-a-version", "0.7.0", both) ?? "", /x\.y\.z/);
  assert.match(validate("", "0.7.0", both) ?? "", /x\.y\.z/);
  assert.match(validate("0.8", "0.7.0", both) ?? "", /x\.y\.z/);
});

test("validate: 現行バージョン以下はエラーを返す", () => {
  const both = changelogs(SAMPLE_CHANGELOG_EN, SAMPLE_CHANGELOG);
  assert.ok(validate("0.7.0", "0.7.0", both));
  assert.ok(validate("0.6.0", "0.7.0", both));
});

test("validate: [Unreleased] が空ならファイル名入りのエラーを返す", () => {
  const error = validate(
    "0.8.0",
    "0.7.0",
    changelogs(EMPTY_UNRELEASED_CHANGELOG, SAMPLE_CHANGELOG)
  );
  assert.match(error ?? "", /CHANGELOG\.md/);
});

test("validate: ja 側だけ [Unreleased] が空でもエラーを返す（desync 検出）", () => {
  const error = validate(
    "0.8.0",
    "0.7.0",
    changelogs(SAMPLE_CHANGELOG_EN, EMPTY_UNRELEASED_CHANGELOG)
  );
  assert.match(error ?? "", /CHANGELOG\.ja\.md/);
});

test("validate: 両ファイルにエントリがあれば null を返す", () => {
  assert.equal(
    validate("0.8.0", "0.7.0", changelogs(SAMPLE_CHANGELOG_EN, SAMPLE_CHANGELOG)),
    null
  );
});

test("finalizeChangelog: 見出しの確定・空の Unreleased の再挿入・リンク参照の更新", () => {
  const result = finalizeChangelog(SAMPLE_CHANGELOG, "0.8.0", "2026-07-10");
  const lines = result.split("\n");
  const newUnreleasedIdx = lines.indexOf("## [Unreleased]");

  assert.notEqual(newUnreleasedIdx, -1);
  assert.equal(lines[newUnreleasedIdx + 1], "");
  assert.equal(lines[newUnreleasedIdx + 2], "## [0.8.0] - 2026-07-10");
  assert.ok(result.includes("- 新機能を追加。"));
  assert.ok(result.includes("[Unreleased]: https://github.com/upu/ghost-align/compare/v0.8.0...HEAD"));
  assert.ok(result.includes("[0.8.0]: https://github.com/upu/ghost-align/releases/tag/v0.8.0"));
  assert.ok(result.includes("[0.7.0]: https://github.com/upu/ghost-align/releases/tag/v0.7.0"));
});

test("finalizeChangelog: CRLF の入力は CRLF のまま書き戻す", () => {
  const crlf = SAMPLE_CHANGELOG.replace(/\n/g, "\r\n");
  const result = finalizeChangelog(crlf, "0.8.0", "2026-07-10");
  const bareLfCount = (result.match(/(?<!\r)\n/g) ?? []).length;
  assert.equal(bareLfCount, 0);
  assert.ok(result.includes("\r\n"));
});

test("finalizeChangelog: 大部分が CRLF で一部だけ LF という混在入力でも見出しを正しく認識する", () => {
  // 実運用で踏んだ壊れ方の再現: ファイル全体は CRLF だが、挿入された一部だけ LF になっている。
  // これを CRLF 前提で split すると見出し行が後続行と結合され、見出しを見失う。
  const crlfBase = SAMPLE_CHANGELOG.replace(/\n/g, "\r\n");
  const mixed = crlfBase.replace(
    "## [Unreleased]\r\n\r\n### Added\r\n\r\n- 新機能を追加。\r\n\r\n",
    "## [Unreleased]\n\n### Added\n\n- 新機能を追加。\n\n"
  );
  const result = finalizeChangelog(mixed, "0.8.0", "2026-07-10");
  // result はこの入力全体の支配的な改行（CRLF）で結合されるため、行の厳密一致ではなく部分一致で見る。
  assert.ok(result.includes("## [0.8.0] - 2026-07-10"));
  assert.ok(result.includes("- 新機能を追加。"));
});

test("finalizeChangelog: Unreleased 見出しが無ければ例外を投げる", () => {
  assert.throws(() => finalizeChangelog("# Changelog\n", "0.8.0", "2026-07-10"));
});

test("finalizeChangelog: label 指定時は例外メッセージにそのファイル名が入る", () => {
  assert.throws(
    () => finalizeChangelog("# Changelog\n", "0.8.0", "2026-07-10", "CHANGELOG.ja.md"),
    /CHANGELOG\.ja\.md/
  );
});

test("finalizeChangelog: ja の本文でも同じ確定処理がそのまま適用できる", () => {
  const result = finalizeChangelog(SAMPLE_CHANGELOG, "0.8.0", "2026-07-10", "CHANGELOG.ja.md");
  assert.ok(result.includes("## [0.8.0] - 2026-07-10"));
  assert.ok(result.includes("- 新機能を追加。"));
  assert.ok(result.includes("[Unreleased]: https://github.com/upu/ghost-align/compare/v0.8.0...HEAD"));
});

test("bumpPackageJsonVersion: version フィールドだけを書き換える", () => {
  const pkg = '{\n  "name": "ghost-align",\n  "version": "0.7.0",\n  "other": "x"\n}\n';
  const result = bumpPackageJsonVersion(pkg, "0.8.0");
  assert.ok(result.includes('"version": "0.8.0"'));
  assert.ok(result.includes('"name": "ghost-align"'));
  assert.ok(result.includes('"other": "x"'));
  assert.equal(JSON.parse(result).version, "0.8.0");
});

test("bumpPackageJsonVersion: version フィールドが無ければ例外を投げる", () => {
  assert.throws(() => bumpPackageJsonVersion('{\n  "name": "x"\n}\n', "0.8.0"));
});
