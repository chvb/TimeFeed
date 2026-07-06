import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

// App-Version aus package.json (wird vom Changelog-Bot / beim Pull gebumpt) zur
// Build-Zeit injizieren — im Footer als v{__APP_VERSION__} sichtbar.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 3031,
    proxy: {
      '/api': {
        target: 'http://localhost:3030',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://localhost:3030',
        changeOrigin: true,
        secure: false,
      },
      '/ping': {
        target: 'http://localhost:3030',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Ein einziger Vendor-Chunk: trennt Abhängigkeiten vom App-Code (langlebig
        // cachebar), vermeidet aber die Init-Reihenfolge-Probleme eines feineren
        // React-Splits (z. B. "Cannot read properties of undefined (reading 'memo')",
        // wenn eine React-abhängige Lib vor React geladen wird).
        manualChunks(id: string) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      }
    }
  },
  base: '/',
});
