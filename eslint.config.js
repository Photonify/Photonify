// ESLint v10 flat config with type-aware linting.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  // Global ignores (must be its own object with only `ignores` to be global).
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', '**/*.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // TypeScript resolves identifiers itself; the core rule flags globals.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Test idioms that fight type-aware linting but are correct here:
    // chai assertions read as unused expressions (`expect(x).to.be.true`),
    // aws-sdk-client-mock fakes use async signatures without awaiting, and
    // stubbing `S3Client.prototype.destroy` reads an unbound method.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  }
);
