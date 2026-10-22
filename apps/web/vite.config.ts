import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.ALONGSIDE_BACKEND ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Same-origin proxy so bearer tokens, SSE and <img> media all just work.
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/media': { target: backend, changeOrigin: true },
      '/mcp': { target: backend, changeOrigin: true },
    },
  },
  preview: { port: 5173, host: true },
});
