import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "dist-types"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The calendar's UI kit (date and time pickers, form and validator hooks,
    // providers) predates this lint config and was ported unchanged: it uses
    // `@ts-ignore`, `any` and expression statements throughout. These rules
    // stay on for everything the port wrote (src/api, the pages, the
    // session, booking and invitation code).
    files: [
      "src/components/calendar/**",
      "src/components/common/form-elements/**",
      "src/components/common/modals/modal-*/**",
      "src/components/common/popup/**",
      "src/hooks/useCalendar.ts",
      "src/hooks/useForm/**",
      "src/hooks/useModal.ts",
      "src/hooks/useThrottle.ts",
      "src/hooks/useValidator/**",
      "src/providers/**",
    ],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-wrapper-object-types": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
    },
  },
);
