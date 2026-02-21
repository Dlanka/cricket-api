module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    'no-console': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  },
  overrides: [
    {
      files: ['src/seed.ts', 'src/scripts/**/*.ts'],
      rules: {
        'no-console': 'off'
      }
    }
  ]
};
