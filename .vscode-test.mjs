import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out-tsc/test/suite/**/*.test.js",
});
