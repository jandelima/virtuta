// Empacota o servidor em um único arquivo; better-sqlite3 fica de fora por ser nativo.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/src/index.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['better-sqlite3'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
