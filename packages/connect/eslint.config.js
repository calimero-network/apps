// Lints one rule: no deprecated API. mero-js's wrappers (`client.getOrg(...)`,
// `client.invite(...)`, ...) are deprecated for its generated methods
// (`client.orgs.get({ org })`, ...), so a call to one fails `pnpm lint`.
// Tests are left out: their fakes may still be written by the wrapper names
// (`withRoutes` in `@calimero-apps/connect/testing` routes the generated
// methods to them).
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["vitest.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-deprecated": "error",
    },
  },
);
