---
name: test-and-package
description: Run the test suite and, only if it passes, build the VSIX package. Use when the user wants to verify the extension and produce a distributable .vsix (e.g. "/test-and-package", "テストしてパッケージ", "ship a build").
---

# Test and Package

Verify the extension with its tests, then produce a VSIX only when tests pass.

## Steps

1. **Compile** — run `npm run compile`. Stop and report if it fails.
2. **Test** — run `npm test` (this launches VS Code via `@vscode/test-cli`; it takes time, that's expected). Show the result summary.
3. **Gate** — if any test fails, STOP. Do not package. Report which tests failed.
4. **Package** — only when all tests pass, run `npm run package` to produce `ghost-align.vsix`.
5. **Report** — state the test result and the path of the generated `.vsix`.

## Notes

- If the user adds `install` (e.g. "/test-and-package install"), run `npm run package:install` at step 4 instead, to also install the VSIX into the local VS Code.
- Never package or install if tests did not pass.
