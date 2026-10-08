import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", "test-results", "playwright-report", "blob-report"] },
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
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      // Native dialogs block the page, ignore the app theme/locale and are unstyled on phones.
      "no-restricted-globals": [
        "error",
        ...["confirm", "alert", "prompt"].map((name) => ({
          name,
          message:
            "Use `useConfirm()` (src/components/common/confirm-context.ts) for confirmations and `toast` from sonner for messages instead of native browser dialogs.",
        })),
      ],
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis", "self"].flatMap((object) =>
          ["confirm", "alert", "prompt"].map((property) => ({
            object,
            property,
            message:
              "Use `useConfirm()` (src/components/common/confirm-context.ts) for confirmations and `toast` from sonner for messages instead of native browser dialogs.",
          })),
        ),
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Rows come from the typed client (`Tables<"x">` etc.); narrow `unknown` instead of `any`.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  eslintPluginPrettier,
);
