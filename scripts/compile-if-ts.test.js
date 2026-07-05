"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldCompile } = require("./compile-if-ts.js");

test("shouldCompile: .ts ファイルでは compile する", () => {
  assert.equal(shouldCompile("C:\\repo\\src\\extension.ts"), true);
  assert.equal(shouldCompile("src/finders.ts"), true);
  assert.equal(shouldCompile("src/test/suite/extension.test.ts"), true);
});

test("shouldCompile: TypeScript と無関係なファイルでは compile しない", () => {
  assert.equal(shouldCompile("CHANGELOG.md"), false);
  assert.equal(shouldCompile("README.ja.md"), false);
  assert.equal(shouldCompile(".claude\\skills\\ship\\SKILL.md"), false);
  assert.equal(shouldCompile("package.json"), false);
  assert.equal(shouldCompile("scripts/prepare-release.js"), false);
});

test("shouldCompile: file_path が取れないときは安全側に倒して compile する", () => {
  assert.equal(shouldCompile(undefined), true);
  assert.equal(shouldCompile(null), true);
  assert.equal(shouldCompile(123), true);
});
