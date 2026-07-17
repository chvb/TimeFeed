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
        // Gemeinsamer Vendor-Chunk (langlebig cachebar) — bewusst KEIN feinerer
        // React-Split, der Init-Reihenfolge-Probleme verursacht (z. B. "Cannot read
        // properties of undefined (reading 'memo')", wenn eine React-abhängige Lib
        // vor React geladen wird).
        // Ausnahme Leaflet: reines Vanilla-JS (keine React-Init-Abhängigkeit) und nur
        // auf der lazy geladenen Terminals-Seite gebraucht → eigener Chunk, damit die
        // ~140 KB nicht bei jedem Start mitgeladen werden.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('leaflet')) return 'leaflet';
          return 'vendor';
        },
      }
    }
  },
  base: '/',
});
