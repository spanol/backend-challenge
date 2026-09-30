import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const frameworkImports = ['@nestjs/**', '@mikro-orm/**', '@aws-sdk/**'];

export default defineConfig([
  globalIgnores(['node_modules/**', 'coverage/**', 'dist/**', 'test-results/**', '.tmp/**']),
  {
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      'no-console': 'error',
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                ...frameworkImports,
                'node:*',
                'bun:*',
                'prom-client',
                'rxjs',
                '**/application/**',
                '**/infrastructure/**',
                '**/adapters/**',
              ],
              message: 'O domínio deve permanecer puro e independente das camadas externas.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...frameworkImports, '**/infrastructure/**', '**/adapters/**'],
              message: 'Casos de uso dependem do domínio e de portas, sem adaptadores concretos.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'src/infrastructure/observability.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/infrastructure/persistence/migrations/*.ts'],
    // MikroORM's migration hooks collect SQL synchronously through an async framework contract.
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    files: ['tests/integration/financial.test.ts'],
    // Bun 1.4.2 types .rejects matchers as void; their runtime result still needs to be awaited.
    rules: { '@typescript-eslint/await-thenable': 'off' },
  },
  // Prettier owns formatting; ESLint owns correctness and layer boundaries.
  prettier,
]);
