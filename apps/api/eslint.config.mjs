import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'src/generated'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Nest resolves constructor dependencies from runtime metadata, so these imports must stay values.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
