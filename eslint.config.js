// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'dist-e2e/*', 'api/**'],
  },
  {
    // `any` switches the type checker off for a value; use `unknown` and narrow it instead.
    // `import type` keeps type-only imports out of the bundle and makes the dependency obvious.
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // `typeof import('x')` is still needed inside jest.mock factories, where import statements
      // are not allowed, so type annotations of that form stay legal.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
    },
  },
  {
    // Jest setup files run under Jest, which provides these globals.
    files: ['test/**/*.js'],
    languageOptions: {
      globals: { jest: 'readonly', beforeEach: 'readonly', afterEach: 'readonly' },
    },
  },
  {
    // jest.mock factories cannot use imports, and jest.isolateModules needs require().
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Last, so it switches off every stylistic rule that would fight Prettier.
  prettierConfig,
]);
