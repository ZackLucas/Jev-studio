#!/usr/bin/env node
// JEV Studio command line — works from any folder once installed (`node bin/jev-studio.mjs install`).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, unlinkSync, lstatSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const SELF = realpathSync(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.dirname(SELF), '..');
const COMPOSE = path.join(ROOT, 'docker/jeff/compose.yml');
const DATA_DIR = process.env.JEV_STUDIO_DATA ?? path.join(ROOT, 'data');
const IMAGE = 'jev-studio-jeff:latest';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c(1), dim = c(2), green = c(32), yellow = c(33), red = c(31), blue = c(34);

const HELP = `
${bold('jev-studio')} — JEV Studio de qualquer pasta

  ${bold('jev-studio')} [start] [--open] [--port N]   abre o Studio (instala e compila na 1ª vez)
  ${bold('jev-studio dev')}                          modo desenvolvimento (hot reload, porta 5173)
  ${bold('jev-studio test')}                         roda os testes

  ${bold('jev-studio jeff start')}                   liga o jeff no Docker e espera ficar pronto
  ${bold('jev-studio jeff stop')}                    desliga
  ${bold('jev-studio jeff status')}                  mostra o estado
  ${bold('jev-studio jeff logs')} [-f]               logs do container (-f acompanha)
  ${bold('jev-studio jeff update')}                  reconstrói a imagem com a versão mais nova do jeff
  ${bold('jev-studio jeff remove')}                  apaga container, imagem e modelo baixado (~5 GB)

  ${bold('jev-studio install')}                      cria o atalho em ~/.local/bin
  ${bold('jev-studio uninstall')}                    remove o atalho

  Studio em: ${dim(ROOT)}
`;

function die(msg, code = 1) {
  console.error(red(`✗ ${msg}`));
  process.exit(code);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.error?.code === 'ENOENT') die(`"${cmd}" não encontrado.`);
  return r.status ?? 1;
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('-') ? v : true;
}

function checkNode() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 18 || (maj === 18 && min < 17)) die(`Node ${process.versions.node} é antigo demais; precisa do 18.17 ou mais novo.`);
}

// ---- Studio ------------------------------------------------------------

function ensureInstalled() {
  if (existsSync(path.join(ROOT, 'node_modules/tsx'))) return;
  console.log(blue('→ Instalando dependências (só na primeira vez)…'));
  if (run(npm, ['install']) !== 0) die('npm install falhou.');
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

function ensureBuilt() {
  const index = path.join(ROOT, 'apps/web/dist/index.html');
  const sources = [path.join(ROOT, 'apps/web/src'), path.join(ROOT, 'packages/core/src'), path.join(ROOT, 'apps/web/index.html')];
  const newest = Math.max(...sources.map((s) => (statSync(s).isDirectory() ? newestMtime(s) : statSync(s).mtimeMs)));
  if (existsSync(index) && statSync(index).mtimeMs >= newest) return;
  console.log(blue('→ Compilando a interface…'));
  if (run(npm, ['run', 'build']) !== 0) die('A compilação falhou.');
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function start(args) {
  checkNode();
  ensureInstalled();
  ensureBuilt();
  const port = flag(args, '--port');
  const env = { ...process.env, ...(typeof port === 'string' ? { PORT: port } : {}) };
  const tsx = createRequire(path.join(ROOT, 'package.json')).resolve('tsx/cli');
  const child = spawn(process.execPath, [tsx, 'apps/api/src/server.ts'], { cwd: ROOT, stdio: 'inherit', env });
  // Ctrl+C reaches the server too; wait for it so it can stop jeff (if "desligar automaticamente" is on).
  const ignore = () => {};
  process.on('SIGINT', ignore);
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  if (flag(args, '--open')) {
    const url = `http://localhost:${env.PORT ?? 5174}`;
    if (await waitFor(`${url}/api/health`, 20_000)) openBrowser(url);
  }
  child.on('exit', (code) => process.exit(code ?? 0));
}

// ---- jeff (Docker) -----------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Same port and key the UI uses, so both manage the very same container. */
function jeffTarget() {
  const saved = readJson(path.join(DATA_DIR, 'config.v2.json')).backends?.jeff ?? {};
  const baseUrl = (process.env.JEFF_BASE_URL?.trim() || saved.baseUrl || 'http://localhost:8000').replace(/\/+$/, '');
  const key = process.env.JEFF_API_KEY?.trim() || saved.apiKey || '';
  let port = 8000;
  let local = true;
  try {
    const u = new URL(baseUrl);
    port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    local = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'].includes(u.hostname);
  } catch {}
  return { baseUrl, key, port, local };
}

function compose(args, { capture = false } = {}) {
  const t = jeffTarget();
  const env = { ...process.env, JEFF_HOST_PORT: String(t.port), JEFF_API_KEYS: t.key, BUILDKIT_PROGRESS: 'plain' };
  const r = spawnSync('docker', ['compose', '-f', COMPOSE, ...args], {
    cwd: ROOT,
    env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (r.error?.code === 'ENOENT') die('Docker não está instalado. No Ubuntu: https://docs.docker.com/engine/install/ubuntu/');
  const text = `${r.stderr ?? ''}${r.stdout ?? ''}`;
  if (/permission denied.*docker\.sock/i.test(text)) die('Sem permissão para usar o Docker. Rode: sudo usermod -aG docker $USER  (e faça logout/login)');
  if (/cannot connect to the docker daemon|failed to connect to the docker api/i.test(text)) die('O Docker está parado. Rode: sudo systemctl start docker');
  if (/unknown shorthand flag: 'f'|'compose' is not a docker command/i.test(text)) die('Falta o Docker Compose v2. No Ubuntu: sudo apt install docker-compose-v2');
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function jeffState() {
  const r = compose(['ps', '--all', '--format', 'json', 'jeff'], { capture: true });
  const line = r.stdout.trim().split('\n').find((l) => l.trim().startsWith('{') || l.trim().startsWith('['));
  if (!line) return null;
  try {
    const v = JSON.parse(line);
    return Array.isArray(v) ? v[0] ?? null : v;
  } catch {
    return null;
  }
}

async function healthy(baseUrl) {
  try {
    return (await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function jeff(args) {
  const [sub = 'status', ...rest] = args;
  const t = jeffTarget();

  if (sub === 'start') {
    if (!t.local) die(`A base URL do jeff (${t.baseUrl}) não é deste computador.`);
    const s = jeffState();
    if (s?.State === 'running' && s.Health === 'healthy') return console.log(green(`✓ jeff já está ligado em ${t.baseUrl}`));
    if (s?.State !== 'running' && (await healthy(t.baseUrl))) die(`Já há um jeff respondendo em ${t.baseUrl}, iniciado fora do Studio.`);
    const hasImage = spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status === 0;
    if (!hasImage) console.log(blue('→ Primeira vez: montando a imagem (Python 3.12 + PyTorch CPU + jeff). Leva alguns minutos.'));
    if (compose(['up', '-d', ...(hasImage ? [] : ['--build']), 'jeff']).code !== 0) die('Não consegui ligar o jeff (veja acima).');
    console.log(blue('→ Esperando o jeff ficar pronto (a primeira vez baixa o modelo, ~1,7 GB). Ctrl+C para de esperar; o jeff continua ligando.'));
    const started = Date.now();
    let last = '';
    while (Date.now() - started < 40 * 60_000) {
      const st = jeffState();
      if (st?.Health === 'healthy' || (await healthy(t.baseUrl))) {
        return console.log(green(`✓ jeff pronto em ${t.baseUrl} (${Math.round((Date.now() - started) / 1000)}s)`));
      }
      if (!st || st.State !== 'running') die('O container parou. Veja: jev-studio jeff logs');
      const logs = compose(['logs', '--no-color', '--tail', '30', 'jeff'], { capture: true }).stdout;
      const downloading = logs.lastIndexOf('Baixando o modelo') > logs.lastIndexOf('Modelo baixado');
      const msg = downloading ? 'baixando o modelo…' : 'carregando o modelo…';
      if (msg !== last) console.log(dim(`  ${msg}`));
      last = msg;
      await new Promise((r) => setTimeout(r, 2000));
    }
    die('Demorou demais. Veja: jev-studio jeff logs');
  }

  if (sub === 'stop') {
    process.exit(compose(['stop', '-t', '10', 'jeff']).code);
  }

  if (sub === 'status') {
    const s = jeffState();
    const ok = await healthy(t.baseUrl);
    const state = !s ? 'sem container' : s.State === 'running' ? `rodando${s.Health ? ` (${s.Health})` : ''}` : s.State;
    console.log(`jeff no Docker: ${bold(state)}`);
    console.log(`${t.baseUrl}: ${ok ? green('respondendo') : yellow('sem resposta')}`);
    return;
  }

  if (sub === 'logs') {
    process.exit(compose(['logs', '--tail', '200', ...(rest.includes('-f') ? ['-f'] : []), 'jeff']).code);
  }

  if (sub === 'update') {
    console.log(blue('→ Reconstruindo a imagem com a versão mais nova do jeff…'));
    if (compose(['build', '--pull', '--no-cache', 'jeff']).code !== 0) die('Falhou.');
    if (jeffState()?.State === 'running') compose(['up', '-d', 'jeff']);
    return console.log(green('✓ Imagem atualizada.'));
  }

  if (sub === 'remove') {
    if (!rest.includes('--yes')) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const a = await rl.question('Apagar container, imagem e o modelo baixado? Vai precisar baixar tudo de novo. [s/N] ');
      rl.close();
      if (!/^s(im)?$/i.test(a.trim())) return console.log('Nada foi apagado.');
    }
    process.exit(compose(['down', '--volumes', '--rmi', 'all']).code);
  }

  die(`Comando desconhecido: jeff ${sub}\n${HELP}`);
}

// ---- install -----------------------------------------------------------

function install() {
  const binDir = path.join(os.homedir(), '.local/bin');
  const link = path.join(binDir, 'jev-studio');
  mkdirSync(binDir, { recursive: true });
  chmodSync(SELF, 0o755);
  try {
    if (lstatSync(link)) unlinkSync(link);
  } catch {}
  symlinkSync(SELF, link);
  console.log(green(`✓ Atalho criado: ${link} → ${SELF}`));
  const onPath = (process.env.PATH ?? '').split(path.delimiter).some((p) => path.resolve(p) === binDir);
  if (onPath) {
    console.log('  Agora é só rodar "jev-studio" de qualquer pasta.');
  } else {
    console.log(yellow(`  ${binDir} ainda não está no seu PATH. Rode uma vez:`));
    console.log(`    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc`);
  }
}

function uninstall() {
  const link = path.join(os.homedir(), '.local/bin/jev-studio');
  try {
    unlinkSync(link);
    console.log(green(`✓ Removido: ${link}`));
  } catch {
    console.log('Nenhum atalho encontrado.');
  }
}

// ---- main --------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case undefined:
  case 'start':
    await start(args);
    break;
  case '--open':
  case '--port':
    await start([cmd, ...args]);
    break;
  case 'dev':
    checkNode();
    ensureInstalled();
    process.exit(run(process.execPath, ['scripts/dev.mjs']));
  case 'test':
    ensureInstalled();
    process.exit(run(npm, ['test']));
  case 'jeff':
    await jeff(args);
    break;
  case 'install':
    install();
    break;
  case 'uninstall':
    uninstall();
    break;
  case 'help':
  case '-h':
  case '--help':
    console.log(HELP);
    break;
  default:
    die(`Comando desconhecido: ${cmd}\n${HELP}`);
}
