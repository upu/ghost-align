---
name: test-and-package
description: Run the test suite and verify the package contents, then only if both pass build a local .vsix. Use when the user wants to verify the extension and produce a .vsix to install or hand-test locally — not the official release artifact, which dev-flow:release cuts via the tagged Release workflow (e.g. "/test-and-package", "テストしてパッケージ", "ship a build").
---

# Test and Package

Verify the extension with its tests, then produce a VSIX only when tests pass.

## Steps

1. **Compile** — run `npm run compile`. Stop and report if it fails.
2. **Test** — run `npm test` (this launches VS Code via `@vscode/test-cli`; it takes time, that's expected). Show the result summary.
3. **Gate** — if any test fails, STOP. Do not package. Report which tests failed.
4. **Verify package contents** — run `npm run check:package`. This lists what `vsce` would bundle and checks it against the allowlist in `scripts/check-package-contents.js`, catching unintended inclusions (e.g. `out/test/**`) or a missing expected file before anything ships. This is the same gate CI runs, so a `.vsix` you build here matches what CI would bless. If it fails, STOP and report — do not distribute a wrong-contents package; fix `.vscodeignore`, or if the change is intentional, update `EXPECTED` in that script.
5. **Package** — only when tests and the content check pass, run `npm run package` to produce `ghost-align.vsix`.
6. **Report** — state the test result, the content-check result, and the path of the generated `.vsix`.

## Notes

- If the user adds `install` (e.g. "/test-and-package install"), run `npm run package:install` at the package step instead, to also install the VSIX into the local VS Code.
- Never package or install unless both the tests and the content check passed.
