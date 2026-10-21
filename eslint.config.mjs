import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'unpackage/**', 'data/**', 'src/static/gen/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  eslintConfigPrettier,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        // uni-app 运行时全局 API（小程序端）
        uni: 'readonly',
        uniCloud: 'readonly',
        getCurrentPages: 'readonly',
        getApp: 'readonly',
        plus: 'readonly',
      },
    },
    rules: {
      // 规范：禁止 any 绕过检查，外部输入一律 unknown 先行验证
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      // uni-app 页面文件名按平台惯例（index.vue 等），不强制多词组件名
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaFeatures: { jsx: false },
      },
    },
  },
  {
    // uniCloud 云函数与公共模块为 CommonJS 运行时，require 是平台要求
    files: ['uniCloud/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
