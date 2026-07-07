"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isGitCommitCommand } = require("./block-main-commit.js");

test("isGitCommitCommand: 単純な git commit を検出する", () => {
  assert.equal(isGitCommitCommand("git commit -m \"msg\""), true);
  assert.equal(isGitCommitCommand("git commit --amend"), true);
});

test("isGitCommitCommand: 複合コマンド内の git commit も検出する", () => {
  assert.equal(isGitCommitCommand("git add -A && git commit -m \"msg\""), true);
  assert.equal(isGitCommitCommand("cd sub && git commit -m \"msg\""), true);
  assert.equal(isGitCommitCommand("git status; git commit -m \"msg\""), true);
});

test("isGitCommitCommand: グローバルオプションを挟んでも検出する", () => {
  assert.equal(isGitCommitCommand("git -C repo commit -m \"msg\""), true);
  assert.equal(isGitCommitCommand("git -c user.name=x commit -m \"msg\""), true);
  assert.equal(isGitCommitCommand("git --work-tree /tmp/wt commit -m \"msg\""), true);
  assert.equal(isGitCommitCommand("git --git-dir /tmp/repo/.git commit -m \"msg\""), true);
  assert.equal(isGitCommitCommand("git --git-dir=/tmp/repo/.git commit -m \"msg\""), true);
});

test("isGitCommitCommand: env/command/sudo などのラッパー越しでも検出する", () => {
  assert.equal(isGitCommitCommand("env FOO=1 git commit -m \"msg\""), true);
  assert.equal(isGitCommitCommand("command git commit -m \"msg\""), true);
  assert.equal(isGitCommitCommand("sudo git commit -m \"msg\""), true);
  assert.equal(isGitCommitCommand("FOO=1 BAR=2 git commit -m \"msg\""), true);
});

test("isGitCommitCommand: commit 以外の git コマンドは検出しない", () => {
  assert.equal(isGitCommitCommand("git status"), false);
  assert.equal(isGitCommitCommand("git checkout -b feature"), false);
  assert.equal(isGitCommitCommand("git switch main"), false);
  assert.equal(isGitCommitCommand("git branch -D old-branch"), false);
  assert.equal(isGitCommitCommand("git log --grep=commit"), false);
});

test("isGitCommitCommand: git 以外のコマンドや不正な入力は検出しない", () => {
  assert.equal(isGitCommitCommand("npm test"), false);
  assert.equal(isGitCommitCommand(undefined), false);
  assert.equal(isGitCommitCommand(null), false);
  assert.equal(isGitCommitCommand(123), false);
});
