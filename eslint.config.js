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
    // Type-aware linting for the TypeScript sources and tests. Scoped to *.ts
    // so the `project` option is not applied to the flat-config file below.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // This flat-config file is CommonJS JS; lint it without type information so
    // `eslint .` / editor integrations don't fail on it not being in the project.
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      // Turn off the type-checked rules (this file is linted without a project)
      // and allow require() in this CommonJS config file.
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
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
