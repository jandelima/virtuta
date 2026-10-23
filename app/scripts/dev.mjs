// Sobe servidor e cliente juntos em desenvolvimento; Ctrl+C encerra os dois.
import { spawn } from 'node:child_process';

const bin = (name) => new URL(`../node_modules/.bin/${name}`, import.meta.url).pathname;
const procs = [
  spawn(bin('tsx'), ['watch', 'server/src/index.ts'], { stdio: 'inherit' }),
  spawn(bin('vite'), ['--config', 'client/vite.config.ts'], { stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  setTimeout(() => process.exit(0), 300);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
