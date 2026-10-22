import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig(
  {
    ignores: [
      "dist/**",
      "action/dist/**",
      "e2e-browser/.artifacts/**",
      "node_modules/**",
      ".wrangler/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    plugins: {
      import: importPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: [
            "tsconfig.json",
            "tsconfig.worker.json",
            "tsconfig.scripts.json",
            "tsconfig.eslint.json",
            "tsconfig.eslint-config.json",
            "e2e-browser/tsconfig.json",
          ],
        },
      },
    },
    rules: {
      "no-console": "error",
      "import/no-restricted-paths": [
        "error",
        {
          basePath: import.meta.dirname,
          zones: [
            { target: "./src/core", from: ".", except: ["./src/core"] },
            {
              target: "src/worker/**",
              from: ["extension/**", "web/**", "src/ui/**", "src/i18n/**"],
            },
            {
              target: "cli/**",
              from: "extension/**",
            },
            {
              target: "share/**",
              from: "extension/**",
            },
            {
              target: "./web",
              from: "./extension",
              except: ["./web-host.ts"],
              message:
                "The web dashboard reaches the extension only through extension/web-host.ts.",
            },
            {
              target: "./extension/settings",
              from: "./extension/console",
              message: "Move what settings needs from the console into extension/ui.",
            },
            {
              target: [
                "extension/console/*.ts",
                "extension/console/!(main).tsx",
                "extension/console/pages/**",
              ],
              from: "./extension/settings",
              message: "Only the console entry (main.tsx) may compose settings pages.",
            },
            {
              target: "./extension/lib",
              from: ["./extension/ui", "./src/ui"],
              message: "Library modules must not depend on UI modules.",
            },
          ],
        },
      ],
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["eslint.config.mjs", "tools/brand/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["tools/brand/cdp.mjs"],
    languageOptions: {
      globals: {
        WebSocket: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: [
          "tsconfig.json",
          "tsconfig.worker.json",
          "tsconfig.scripts.json",
          "tsconfig.eslint.json",
          "tsconfig.eslint-config.json",
          "e2e-browser/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/prefer-promise-reject-errors": ["error", { allowThrowingUnknown: true }],
      curly: ["error", "all"],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use an `as const` object instead of an enum.",
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.worker.json",
      },
    },
  },
  {
    files: ["cli/**/*.{ts,tsx}", "scripts/**/*.{ts,tsx}", "tools/brand/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["test/**/*.{ts,tsx}", "e2e-browser/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/worker/log.ts", "extension/lib/log.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use an `as const` object instead of an enum.",
        },
        {
          selector: "ImportDeclaration[source.value=/^(node:|[^./][^:]*)/]",
          message: "Core modules may only import other core modules.",
        },
        {
          selector: "ImportDeclaration[source.value=/^\\//]",
          message: "Core modules may only import other core modules.",
        },
        {
          selector: "ExportNamedDeclaration[source.value=/^(node:|[^./][^:]*)/]",
          message: "Core modules may only export from other core modules.",
        },
        {
          selector: "ExportNamedDeclaration[source.value=/^\\//]",
          message: "Core modules may only export from other core modules.",
        },
        {
          selector: "ExportAllDeclaration[source.value=/^(node:|[^./][^:]*)/]",
          message: "Core modules may only export from other core modules.",
        },
        {
          selector: "ExportAllDeclaration[source.value=/^\\//]",
          message: "Core modules may only export from other core modules.",
        },
        {
          selector: "TSImportType[source.value=/^(node:|[^./][^:]*)/]",
          message: "Core modules may only import types from other core modules.",
        },
        {
          selector: "ImportExpression",
          message: "Core modules may not use dynamic imports.",
        },
        {
          selector: "TSImportEqualsDeclaration",
          message: "Core modules may not use import-equals declarations.",
        },
      ],
    },
  },
  {
    files: [
      "extension/**/*.{ts,tsx}",
      "web/**/*.{ts,tsx}",
      "src/**/*.{ts,tsx}",
      "cli/**/*.{ts,tsx}",
      "share/**/*.ts",
    ],
    ignores: ["src/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../*"],
              message:
                "Use a # import from package.json (#core, #ui, #i18n, #worker, #ext) instead of climbing two folders.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "src/core/**",
      "src/worker/at-rest.ts",
      "src/worker/webauthn.ts",
      "src/worker/jwt.ts",
      "extension/lib/passkey/authenticator.ts",
      "extension/lib/import/bitwarden.ts",
      "extension/lib/import/openpgp.ts",
      "extension/lib/import/proton-passkey.ts",
      "test/**",
      "e2e-browser/**",
      "scripts/**",
      "tools/**",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "crypto",
          property: "subtle",
          message: "Use src/core/primitives.ts or src/core/crypto.ts instead of crypto.subtle.",
        },
      ],
    },
  },
  {
    files: ["extension/background.ts", "src/worker/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "window", message: "Do not use window in Worker/background code." },
      ],
    },
  },
  {
    ...prettier,
    rules: {
      ...prettier.rules,
      curly: ["error", "all"],
    },
  },
);
