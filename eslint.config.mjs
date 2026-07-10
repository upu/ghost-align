// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["out/**", "out-tsc/**", "dist/**"],
  },
  {
    // src/**: TypeScript, type-checked lint (catches floating promises etc.,
    // which matter a lot for a VS Code extension's async APIs — see #370).
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // src/finders.ts intentionally embeds U+200B between `*` and `/` inside
      // JSDoc examples of `/* ... */` so the example text doesn't prematurely
      // close the enclosing doc comment (see the finders-edge-cases rule).
      // Only comments need the exemption; irregular whitespace in real code
      // stays an error.
      "no-irregular-whitespace": ["error", { skipComments: true }],
      // The codebase already names intentionally-unused parameters with a
      // leading underscore (e.g. mock methods that must match a vscode.*
      // signature but only use some of its parameters). Without this,
      // no-unused-vars only forgives an unused arg when a later, used arg
      // follows it (its default "after-used" behavior) — an unused arg with
      // nothing after it, like `_key` in an otherwise-empty parameter list,
      // still errors even with the underscore.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // src/test/**: test mocks intentionally model only the subset of a
    // vscode.* interface each test needs and hand it to code typed against
    // the full interface, so `any` and the unsafe-* family fire on nearly
    // every mock call. Keep type-checked linting (no-floating-promises etc.)
    // active; only the any-driven noise is relaxed here.
    files: ["src/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    // scripts/**: plain CommonJS Node scripts, not part of the tsconfig
    // TS program, so they get the untyped JS ruleset plus Node globals.
    files: ["scripts/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["eslint.config.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
);
