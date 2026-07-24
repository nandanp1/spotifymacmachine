import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "out/**",
      "release/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    files: [
      "*.config.{js,mjs,ts}",
      "electron.vite.config.ts",
      "src/main/**/*.ts",
      "src/preload/**/*.ts",
      "tests/**/*.ts",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "electron",
              message:
                "Renderer code must use the typed preload API instead of Electron.",
            },
            {
              name: "keytar",
              message:
                "Keychain access belongs in the Electron main process.",
            },
          ],
          patterns: [
            {
              group: ["node:*", "@main/*", "@preload/*"],
              message:
                "Renderer code cannot cross into a privileged process boundary.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": [
        "warn",
        { "allowConstantExport": true }
      ],
    },
  },
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "electron",
              message:
                "Shared modules must stay serializable and process-agnostic.",
            },
            {
              name: "keytar",
              message:
                "Keychain access belongs in the Electron main process.",
            },
          ],
          patterns: [
            {
              group: ["node:*", "@main/*", "@preload/*", "@renderer/*"],
              message:
                "Shared modules cannot depend on a process-specific implementation.",
            },
          ],
        },
      ],
    },
  },
);
