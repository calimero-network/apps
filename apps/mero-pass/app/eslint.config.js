// Flat config, and the file name is the whole point.
//
// This app shipped a `.eslint.config.mjs` — note the LEADING DOT — written in
// the eslintrc object format and importing `eslint-define-config`, which is not
// a dependency of this app. ESLint 9 looks for `eslint.config.(js|mjs|cjs)`, so
// it never read that file: `pnpm run lint` exited 2 with "couldn't find an
// eslint.config.js" and had done since the flat-config migration. Nothing in
// CI runs lint for this app either, so the failure was invisible from both
// ends and the app has effectively never been linted.
//
// Matches mero-stream's and mero-meet's config so the fleet's rules agree.

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/generated"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
