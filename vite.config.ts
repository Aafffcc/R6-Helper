import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Vite 5.2 仍走 sass legacy JS API，显式静默弃用告警；升级 Vite >= 5.4 后改用 modern-compiler
        silenceDeprecations: ['legacy-js-api'],
      },
    },
  },
  plugins: [uni()],
});
