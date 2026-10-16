import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  server: { fs: { strict: true, allow: [path.resolve('src/client'), path.resolve('src/shared'), path.resolve('node_modules')], deny: ['**/data/**', '**/.env*', '**/.git/**', '**/*.pem', '**/*.crt'] } },
  build: { outDir: '../../dist/client', emptyOutDir: true },
});
