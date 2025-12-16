import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        student: fileURLToPath(new URL('./student.html', import.meta.url)),
        teacher: fileURLToPath(new URL('./teacherMonitor.html', import.meta.url)),
        check: fileURLToPath(new URL('./check_user.html', import.meta.url)),
        reset: fileURLToPath(new URL('./reset_data.html', import.meta.url))
      }
    },
    copyPublicDir: true
  },
  publicDir: 'public'
});

