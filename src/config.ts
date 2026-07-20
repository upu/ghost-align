import { TS_JS_LANGUAGES } from "./finders";

// Fallbacks used when the user clears a setting to an empty string in the UI.
// Keep these in sync with the defaults in package.json.
// NBSP (U+00A0) instead of ASCII space: VS Code collapses consecutive ASCII
// spaces in decoration `contentText`, so plain " ".repeat(N) renders as a
// single space and breaks alignment. NBSP renders identically in monospace
// fonts but is not collapsed.
export const DEFAULT_GHOST_CHAR = "\u00A0";
export const DEFAULT_GHOST_COLOR = "rgba(128, 128, 128, 0.25)";

/**
 * Resolve the ghost-align rendering settings. The padding character is fixed
 * to NBSP (the `ghostCharacter` setting was removed in #260 — VS Code
 * collapses consecutive ASCII spaces in decorations, so a custom character
 * was a footgun); only the color is configurable. An empty string from the
 * settings UI is treated as "use default" so a cleared field cannot silently
 * make the ghost invisible.
 */
export function resolveGhostSettings(
  config: { get<T>(key: string, defaultValue: T): T }
): { ghostChar: string; ghostColor: string } {
  return {
    ghostChar: DEFAULT_GHOST_CHAR,
    ghostColor: config.get<string>("ghostColor", DEFAULT_GHOST_COLOR) || DEFAULT_GHOST_COLOR,
  };
}

// Default per-language operator overrides. Keep in sync with package.json
// (verified by a test that deep-compares this against the package.json default).
export const DEFAULT_OPERATORS_BY_LANGUAGE: Record<string, string[]> = {
  json: [":"],
  jsonc: [":"],
  yaml: [":"],
  typescript: [":", "="],
  typescriptreact: [":", "="],
  javascript: [":", "="],
  javascriptreact: [":", "="],
  dotenv: ["="],
  properties: ["="],
  toml: ["="],
  ini: ["="],
  python: [":", "="],
  shellscript: ["="],
  ruby: ["=", "=>"],
  makefile: ["="],
  css: [":"],
  scss: [":"],
  less: [":"],
  php: ["=", "=>"],
  rust: ["=", "=>"],
  go: ["="],
  lua: ["="],
  c: ["="],
  cpp: ["="],
  csharp: ["="],
  java: ["="],
  swift: ["="],
  kotlin: ["="],
  dart: ["="],
  zig: ["="],
  terraform: ["="],
  proto3: ["="],
  elixir: ["="],
  perl: ["="],
  sql: ["="],
  haskell: ["="],
  powershell: ["="],
  dockerfile: ["="],
  graphql: [":"],
  scala: ["="],
  groovy: ["="],
  r: ["<-", "="],
};

/**
 * Drop operator entries that would never match anything sensible: non-string
 * values, and strings that are empty or whitespace-only (a `settings.json`
 * typo like `""` or `"  "` is a realistic user mistake since these arrays are
 * hand-edited). This is the single sanitization point for operator settings
 * — see {@link resolveOperatorsForLanguage} — so both `ghostAlign.operators`
 * and `ghostAlign.operatorsByLanguage` entries are safe by the time they
 * reach the alignment pipeline (#335: an empty-string operator previously
 * reached findLiteralOccurrences in finders.ts and looped forever).
 */
function sanitizeOperators(operators: unknown): string[] {
  if (!Array.isArray(operators)) {
    return [];
  }
  return operators.filter(
    (op): op is string => typeof op === "string" && op.trim() !== ""
  );
}

/**
 * Resolve the operator list for a given language. The per-language map takes
 * precedence; if the language is not listed, fall back to the global
 * `operators` setting (default `["="]`) — unless `alignUnknownLanguages` is
 * off, in which case unlisted languages are not aligned at all. A language
 * the user added to `operatorsByLanguage` counts as listed (VS Code merges
 * the user's object with the default map), so the opt-out never mutes an
 * explicit entry. Both sources are sanitized via {@link sanitizeOperators}
 * before being returned.
 */
export function resolveOperatorsForLanguage(
  config: { get<T>(key: string, defaultValue: T): T },
  languageId: string
): string[] {
  const byLang = config.get<Record<string, string[]>>(
    "operatorsByLanguage",
    DEFAULT_OPERATORS_BY_LANGUAGE
  );
  if (byLang && Object.prototype.hasOwnProperty.call(byLang, languageId)) {
    return sanitizeOperators(byLang[languageId]);
  }
  if (!config.get<boolean>("alignUnknownLanguages", true)) {
    return [];
  }
  return sanitizeOperators(config.get<string[]>("operators", ["="]));
}

/**
 * Whether decoration should be fully disabled for `languageId` via
 * `ghostAlign.disabledLanguages`. Takes priority over `operatorsByLanguage`.
 */
export function isLanguageDisabled(
  config: { get<T>(key: string, defaultValue: T): T },
  languageId: string
): boolean {
  const disabledLanguages = config.get<string[]>("disabledLanguages", []);
  return (
    Array.isArray(disabledLanguages) && disabledLanguages.includes(languageId)
  );
}

/**
 * Toggle `languageId`'s membership in a `disabledLanguages` list: adds it if
 * absent, removes it if present. Pure — the command handler is responsible
 * for reading/writing the actual setting; this just computes the next value
 * and whether the toggle disabled or re-enabled the language, for the
 * result message.
 */
export function toggleDisabledLanguage(
  disabledLanguages: string[],
  languageId: string
): { next: string[]; disabled: boolean } {
  if (disabledLanguages.includes(languageId)) {
    return {
      next: disabledLanguages.filter((l) => l !== languageId),
      disabled: false,
    };
  }
  return { next: [...disabledLanguages, languageId], disabled: true };
}

/**
 * Which scope `ghostAlign.toggleLanguage` should write `disabledLanguages`
 * to. VS Code resolves the effective value with workspace taking precedence
 * over global, so writing to Global while a workspace value exists silently
 * has no visible effect (#362) — this decides "workspace" whenever the user
 * (or `.vscode/settings.json`) has an explicit workspace-level value,
 * otherwise "global" as before. workspaceFolder-scoped values are not
 * consulted here (multi-root handling is left for a future issue).
 */
export function resolveDisabledLanguagesTarget(
  config: GhostAlignConfig
): "workspace" | "global" {
  const inspected = config.inspect?.<string[]>("disabledLanguages");
  return inspected?.workspaceValue !== undefined ? "workspace" : "global";
}

/** Language IDs that use the Markdown table alignment path instead of operators. */
const MARKDOWN_LANGUAGES = new Set(["markdown"]);

// Default per-language CSV/TSV delimiters. Keep in sync with package.json
// (verified by a test that deep-compares this against the package.json default).
export const DEFAULT_CSV_DELIMITERS: Record<string, string> = {
  csv: ",",
  tsv: "\t",
};

/**
 * Validate a `csv.delimiters` entry: only a single-character string is
 * accepted. `"` is rejected even though it is one character, since it is the
 * RFC 4180 quoting character findCsvDelimiterPositions relies on — treating
 * it as the delimiter would make quote-state tracking meaningless.
 */
function sanitizeCsvDelimiter(delimiter: unknown): string | undefined {
  return typeof delimiter === "string" && delimiter.length === 1 && delimiter !== '"'
    ? delimiter
    : undefined;
}

/**
 * Resolve the CSV/TSV delimiter for `languageId` from `ghostAlign.csv.delimiters`,
 * or undefined if the language has no entry in the merged default+user map
 * (i.e. it is not a CSV-family language at all, so it should not take the
 * CSV path). A language present in the map with an invalid value falls back
 * to the built-in default for `csv`/`tsv`; for a language the user added
 * themselves with no built-in default, an invalid value resolves to
 * undefined — same as if the entry were absent — so it falls through to the
 * operators path instead of aligning on a bogus delimiter. The setting value
 * itself is read as unknown: a hand-edited `settings.json` could set
 * `csv.delimiters` to `null` or an array instead of an object, and that must
 * not silently drop csv/tsv out of the CSV path, so a non-object value is
 * treated the same as an unset one (falls back to DEFAULT_CSV_DELIMITERS).
 */
export function resolveCsvDelimiter(
  config: { get<T>(key: string, defaultValue: T): T },
  languageId: string
): string | undefined {
  const raw = config.get<unknown>("csv.delimiters", DEFAULT_CSV_DELIMITERS);
  const byLang: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : DEFAULT_CSV_DELIMITERS;
  if (!Object.prototype.hasOwnProperty.call(byLang, languageId)) {
    return undefined;
  }
  const sanitized = sanitizeCsvDelimiter(byLang[languageId]);
  return sanitized !== undefined ? sanitized : DEFAULT_CSV_DELIMITERS[languageId];
}

/**
 * The slice of vscode.WorkspaceConfiguration the resolvers need. `inspect`
 * is optional so plain `{ get }` mocks keep working; without it,
 * explicit-vs-default detection falls back to `get` with an undefined
 * default.
 */
export type GhostAlignConfig = {
  get<T>(key: string, defaultValue: T): T;
  inspect?<T>(key: string):
    | {
        globalValue?: T;
        workspaceValue?: T;
        workspaceFolderValue?: T;
        globalLanguageValue?: T;
        workspaceLanguageValue?: T;
        workspaceFolderLanguageValue?: T;
      }
    | undefined;
};

/**
 * The value the user explicitly set for `key` at any scope (most specific
 * wins, mirroring VS Code's own precedence), or undefined when the key is
 * untouched. `get` can't tell "explicitly set to the default" from "unset",
 * which is exactly the distinction the migration fallback below needs.
 */
function explicitSetting<T>(
  config: GhostAlignConfig,
  key: string
): T | undefined {
  if (!config.inspect) {
    return config.get<T | undefined>(key, undefined);
  }
  const inspected = config.inspect<T>(key);
  if (!inspected) {
    return undefined;
  }
  return (
    inspected.workspaceFolderLanguageValue ??
    inspected.workspaceLanguageValue ??
    inspected.globalLanguageValue ??
    inspected.workspaceFolderValue ??
    inspected.workspaceValue ??
    inspected.globalValue
  );
}

/**
 * Resolve a feature-scoped `<feature>.enabled` toggle. An explicit value on
 * the new key wins; otherwise an explicit value on the deprecated legacy key
 * is honored (migration fallback, see #259); otherwise the feature is on.
 */
export function resolveFeatureEnabled(
  config: GhostAlignConfig,
  key: string,
  legacyKey?: string
): boolean {
  const explicit = explicitSetting<boolean>(config, key);
  if (typeof explicit === "boolean") {
    return explicit;
  }
  if (legacyKey !== undefined) {
    const legacy = explicitSetting<boolean>(config, legacyKey);
    if (typeof legacy === "boolean") {
      return legacy;
    }
  }
  return true;
}

/** Which alignment path a language uses, with the settings that path needs. */
export type AlignmentPath =
  | { kind: "none" }
  | { kind: "markdown" }
  | { kind: "csv"; delimiter: string; alignNumbersRight: boolean }
  | { kind: "operators"; operators: string[]; alignJsdoc: boolean };

/**
 * Resolve the alignment path for `languageId` in one place, so the dispatch
 * cannot drift between the decoration pass and Copy with Alignment (they
 * used to duplicate this resolution). A path whose feature toggle is off
 * resolves to `none` — the language keeps its dedicated path rather than
 * falling back to operator alignment it never had.
 */
export function resolveAlignmentPath(
  languageId: string,
  config: GhostAlignConfig
): AlignmentPath {
  if (MARKDOWN_LANGUAGES.has(languageId)) {
    return resolveFeatureEnabled(config, "markdownTable.enabled")
      ? { kind: "markdown" }
      : { kind: "none" };
  }
  const delimiter = resolveCsvDelimiter(config, languageId);
  if (delimiter !== undefined) {
    return resolveFeatureEnabled(config, "csv.enabled")
      ? {
          kind: "csv",
          delimiter,
          alignNumbersRight: config.get<boolean>("csv.alignNumbersRight", false),
        }
      : { kind: "none" };
  }
  return {
    kind: "operators",
    operators: resolveOperatorsForLanguage(config, languageId),
    alignJsdoc:
      TS_JS_LANGUAGES.has(languageId) &&
      resolveFeatureEnabled(config, "jsdoc.enabled", "alignJsdocParams"),
  };
}

/**
 * Resolve `ghostAlign.maxPadding` from settings: a non-negative integer, or
 * 0 (unlimited) for any invalid or non-positive value. Shared by every
 * alignment path (operators, JSDoc, Markdown tables, CSV/TSV).
 */
export function resolveMaxPadding(
  config: { get<T>(key: string, defaultValue: T): T }
): number {
  const raw = config.get<number>("maxPadding", 0);
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : 0;
}

/**
 * Resolve `ghostAlign.shortenUrls` (#418, default false): a single opt-in
 * toggle for both the CSV/TSV (every cell) and Markdown table (table cells
 * only) alignment paths, so it lives here as a standalone resolver rather
 * than inside AlignmentPath's per-path settings.
 */
export function resolveShortenUrls(
  config: { get<T>(key: string, defaultValue: T): T }
): boolean {
  return config.get<boolean>("shortenUrls", false);
}

// Allowlist of URI schemes that receive alignment decorations. Editors like
// the output panel (`output`), debug console, or search editor also appear in
// visibleTextEditors; an allowlist keeps unknown non-file schemes out, which
// an exclusion list would not.
const ALIGNABLE_SCHEMES = new Set([
  "file",
  "untitled",
  "vscode-remote",
  "vscode-vfs",
  "vscode-notebook-cell",
]);

/** Whether documents with this URI scheme should be aligned. */
export function isAlignableScheme(scheme: string): boolean {
  return ALIGNABLE_SCHEMES.has(scheme);
}
