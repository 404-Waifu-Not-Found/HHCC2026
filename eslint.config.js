const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  {
    ignores: [
      "**/dist/**",
      "**/.expo/**",
      "**/node_modules/**",
      "apps/app/public/runtime/**",
      "docs/screenshots/**",
    ],
  },
  expoConfig,
  {
    files: ["apps/extension/src/**/*.js"],
    languageOptions: {
      globals: {
        chrome: "readonly",
      },
    },
  },
  {
    files: ["apps/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='alert']",
          message: "Use an accessible in-app dialog instead of window.alert.",
        },
      ],
    },
  },
]);
