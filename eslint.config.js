import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Browser storage and network APIs are banned outright: the vault lives in
// Rust, and the MVP makes no network requests. See docs/adr/0001-stack.md.
const BANNED_GLOBALS = [
  ["localStorage", "Vault data must never touch web storage."],
  ["sessionStorage", "Vault data must never touch web storage."],
  ["indexedDB", "Vault data must never touch web storage."],
  ["caches", "Vault data must never touch web storage."],
  ["fetch", "Vaultair makes no network requests."],
  ["XMLHttpRequest", "Vaultair makes no network requests."],
  ["WebSocket", "Vaultair makes no network requests."],
  ["EventSource", "Vaultair makes no network requests."],
  ["eval", "No dynamic code."],
];

const bannedGlobals = BANNED_GLOBALS.map(([name, message]) => ({ name, message }));
const bannedProperties = ["window", "globalThis", "self", "navigator"].flatMap((object) => [
  ...BANNED_GLOBALS.map(([property, message]) => ({ object, property, message })),
  ...(object === "navigator" ? [{ object, property: "sendBeacon", message: "No network." }] : []),
]);

export default tseslint.config(
  { ignores: ["dist", "target", "src-tauri", "crates", "node_modules", "src/ipc/bindings.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-console": "error",
      "no-debugger": "error",
      "no-restricted-globals": ["error", ...bannedGlobals],
      "no-restricted-properties": ["error", ...bannedProperties],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Function']", message: "No dynamic code." },
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "No raw HTML." },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    rules: { "@typescript-eslint/only-throw-error": "off" },
  },
  {
    files: ["*.config.{js,ts}", "scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
