// ESLint Flat-Config (ESLint v9+/typescript-eslint v8).
// Pragmatisch: echte Fehlerquellen als Warnung sichtbar machen, ohne den
// Bestandscode (viele bewusste `any`/`!`) hart zu blockieren.
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.js', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Express Request-Augmentation nutzt `declare global { namespace Express }`.
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
    },
  },
);
