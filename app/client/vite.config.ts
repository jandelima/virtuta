import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
// porta do servidor da API (permite subir uma segunda cópia para testes)
const api = process.env.API_PORT ?? '8787';

// Em desenvolvimento, a API e o WebSocket ficam no servidor Node (porta 8787).
export default defineConfig({
  root,
  base: '/',
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${api}`,
      '/ws': { target: `ws://localhost:${api}`, ws: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/public', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
