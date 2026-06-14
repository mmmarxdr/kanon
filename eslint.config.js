// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * ESLint 9 flat config - KAN-62 baseline + KAN-92 type-aware gate
 *
 * All recommended rules are set to "warn" so eslint exits 0 on the legacy codebase
 * (KAN-62 strategy). The curated type-aware rules for packages/web are declared as
 * explicit "error" overrides that bypass the warnify() shim — see the web gate block.
 *
 * Grandfathering strategy: existing source files under packages/star/src are not
 * auto-fixed. Prettier is also configured to skip those paths. New files added
 * after this PR are covered by the baseline.
 */

// Downgrade all "error" rules in a config to "warn".
function warnify(config) {
  if (!config.rules) return config;
  const rules = Object.fromEntries(
    Object.entries(config.rules).map(([key, value]) => {
      if (Array.isArray(value)) {
        return [key, value[0] === "error" ? ["warn", ...value.slice(1)] : value];
      }
      return [key, value === "error" ? "warn" : value];
    })
  );
  return { ...config, rules };
}

// Build the ts-eslint recommended config array with all errors downgraded to warn.
const tsRecommendedWarn = tseslint.configs.recommended.map(warnify);

// Downgrade the @eslint/js recommended rules too.
const jsRecommendedWarn = warnify(js.configs.recommended);

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/.turbo/**",
      ".claude/**",
      "**/.stryker-tmp/**",
      "**/prisma/generated/**",
      "eslint.config.js",
      "vite.config.*",
      "vitest.config.*",
      "tailwind.config.*",
      "postcss.config.*",
      "playwright.config.*",
    ],
  },

  // Base JS recommended (errors downgraded to warn)
  jsRecommendedWarn,

  // TypeScript recommended (non-type-checked, errors downgraded to warn)
  ...tsRecommendedWarn,

  // All TypeScript source files
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
  },

  // React/Web package - add browser globals and react-hooks plugin
  {
    files: ["packages/web/**/*.tsx", "packages/web/**/*.ts"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // Downgrade react-hooks rules to warn so we exit 0 on legacy code.
      // KAN-92 will flip these to error once the codebase is clean.
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // KAN-92: Type-aware error gate — curated rules for packages/web production source only.
  //
  // These rules are declared as EXPLICIT errors here so they are NOT passed
  // through the warnify() shim applied to the recommended presets above.
  //
  // Scoped to production source (not test files, not vite/vitest configs) because:
  // - vite.config.ts / vitest.config.ts are not included in packages/web/tsconfig.json
  //   so parserOptions.project cannot resolve them.
  // - Test files use mock patterns that produce unsafe-* noise unrelated to
  //   the production reliability gate this AC targets.
  {
    files: ["packages/web/src/**/*.tsx", "packages/web/src/**/*.ts"],
    ignores: [
      "packages/web/src/**/*.test.tsx",
      "packages/web/src/**/*.test.ts",
      "packages/web/src/**/*.spec.tsx",
      "packages/web/src/**/*.spec.ts",
      "packages/web/src/**/__tests__/**",
    ],
    languageOptions: {
      parserOptions: {
        project: ["packages/web/tsconfig.json"],
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // Type-aware reliability rules — all at error
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/consistent-type-assertions": "error",
      // Flip from warn (KAN-62) to error now that violations are fixed
      "react-hooks/exhaustive-deps": "error",
    },
  },

  // Test files - keep any rule that fires on test code at warn level
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**/*.ts",
      "**/__tests__/**/*.tsx",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // Prettier - must be LAST to disable conflicting style rules
  prettierConfig
);
