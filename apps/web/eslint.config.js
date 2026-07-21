// @ts-check
const { FlatCompat } = require('@eslint/eslintrc');
const prettier = require('eslint-config-prettier');

// `eslint-config-next` todavía se distribuye en formato eslintrc clásico
// (no flat-config nativo) — FlatCompat lo adapta para ESLint 9.
const compat = new FlatCompat({ baseDirectory: __dirname });

module.exports = [
  { ignores: ['.next/**', 'node_modules/**'] },
  ...compat.extends('next/core-web-vitals'),
  prettier,
];
