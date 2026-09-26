// Runs the API (with NODE_ENV=development) and the Vite dev server together.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  ['api', ['run', 'dev', '-w', '@jev/api'], { NODE_ENV: 'development' }, '\x1b[34m'],
  ['web', ['run', 'dev', '-w', '@jev/web'], {}, '\x1b[35m'],
].map(([name, args, env, color]) => {
  const child = spawn(npm, args, { env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (buf) => out.write(buf.toString().replace(/^(?=.)/gm, prefix)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}saiu (${code ?? 0})`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
