import { spawn } from 'node:child_process';

const processes = [
  spawn(process.execPath, ['--use-env-proxy', '--watch', 'server/index.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' }),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  processes.forEach(child => { if (child.exitCode === null) child.kill(); });
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
processes.forEach(child => child.on('exit', code => stop(code || 0)));
