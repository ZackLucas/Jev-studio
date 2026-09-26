/**
 * JeffRuntime backed by Docker Compose (docker/jeff/compose.yml).
 * Every command is a fixed argv run with spawn (no shell); nothing from the request reaches it.
 */
import { spawn } from 'node:child_process';
import type { JeffPhase, JeffStatus } from '@jev/core';
import type { JeffRuntime, JeffTarget } from '../ports';

export const JEFF_IMAGE = 'jev-studio-jeff:latest';
const SERVICE = 'jeff';
const OP_LOG_CHARS = 200_000;
const OP_LOG_LINES = 300;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Set when the binary itself couldn't be started (e.g. ENOENT: docker not installed). */
  spawnError?: NodeJS.ErrnoException;
}

export type Runner = (
  args: string[],
  opts?: { env?: Record<string, string>; onOutput?: (text: string) => void; timeoutMs?: number },
) => Promise<RunResult>;

export const dockerRunner: Runner = (args, opts = {}) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('docker', args, { env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs) : undefined;
    child.stdout.on('data', (b: Buffer) => {
      stdout += b;
      opts.onOutput?.(b.toString());
    });
    child.stderr.on('data', (b: Buffer) => {
      stderr += b;
      opts.onOutput?.(b.toString());
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, spawnError: err });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });

export async function httpProbe(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/healthz`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function parseTarget(baseUrl: string): { local: boolean; port: number } {
  try {
    const u = new URL(baseUrl);
    return { local: LOCAL.has(u.hostname), port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) };
  } catch {
    return { local: false, port: 8000 };
  }
}

/** Turns Docker's error output into something a person can act on (null = not a known setup problem). */
export function diagnose(r: RunResult, port?: number): string | null {
  const text = `${r.stderr}\n${r.stdout}`;
  if (r.spawnError?.code === 'ENOENT') {
    return 'Docker não está instalado. No Ubuntu: https://docs.docker.com/engine/install/ubuntu/';
  }
  if (/permission denied.*docker\.sock|docker\.sock.*permission denied/i.test(text)) {
    return 'Seu usuário não tem permissão para usar o Docker. Rode "sudo usermod -aG docker $USER" e reinicie a sessão (logout/login).';
  }
  if (/cannot connect to the docker daemon|failed to connect to the docker api|is the docker daemon running/i.test(text)) {
    return 'O serviço do Docker está parado. Rode "sudo systemctl start docker".';
  }
  if (/'compose' is not a docker command|unknown command "compose"|unknown shorthand flag: 'f'/i.test(text)) {
    return 'Falta o Docker Compose v2. No Ubuntu: "sudo apt install docker-compose-v2" (ou docker-compose-plugin, se usa o repositório da Docker).';
  }
  if (/port is already allocated|address already in use/i.test(text)) {
    return `A porta ${port ?? ''} já está em uso por outro programa. Mude a base URL do jeff (ex.: http://localhost:8001) e ligue de novo.`.replace('  ', ' ');
  }
  return null;
}

interface PsRow {
  State?: string;
  Health?: string;
  Status?: string;
}

/** `docker compose ps --format json` prints a JSON array (older v2) or one object per line (newer). */
export function parsePs(stdout: string): PsRow | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const v = JSON.parse(text) as PsRow | PsRow[];
    return Array.isArray(v) ? (v[0] ?? null) : v;
  } catch {
    const first = text.split('\n').find((l) => l.trim().startsWith('{'));
    try {
      return first ? (JSON.parse(first) as PsRow) : null;
    } catch {
      return null;
    }
  }
}

/** Keeps only the last frame of progress bars (\r) and drops ANSI colors. */
export function cleanLog(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .split('\n')
    .map((line) => {
      const frames = line.split('\r').filter((f) => f.trim());
      return frames[frames.length - 1] ?? '';
    })
    .join('\n');
}

function lastLines(text: string, n: number): string {
  return text.trim().split('\n').slice(-n).join('\n');
}

type OpKind = Extract<JeffPhase, 'building' | 'starting' | 'stopping'>;

const OP_MESSAGE: Record<OpKind, string> = {
  building: 'Montando a imagem do jeff (só na primeira vez; alguns minutos).',
  starting: 'Iniciando o container…',
  stopping: 'Desligando…',
};

export class DockerJeffRuntime implements JeffRuntime {
  private op: OpKind | null = null;
  private opDone: Promise<void> = Promise.resolve();
  private lastError: string | null = null;
  private opLog = '';

  constructor(
    private readonly composeFile: string,
    private readonly run: Runner = dockerRunner,
    private readonly probe: (baseUrl: string) => Promise<boolean> = httpProbe,
  ) {}

  private compose(args: string[], target?: JeffTarget, extra: Parameters<Runner>[1] = {}) {
    const env: Record<string, string> = { BUILDKIT_PROGRESS: 'plain' };
    if (target) {
      env.JEFF_HOST_PORT = String(parseTarget(target.baseUrl).port);
      env.JEFF_API_KEYS = target.apiKey ?? '';
    }
    return this.run(['compose', '-f', this.composeFile, ...args], { ...extra, env: { ...env, ...extra.env } });
  }

  private appendOpLog(text: string) {
    this.opLog = (this.opLog + text).slice(-OP_LOG_CHARS);
  }

  private background(kind: OpKind, args: string[], target: JeffTarget, timeoutMs: number) {
    this.op = kind;
    this.lastError = null;
    this.opLog = `$ docker compose ${args.join(' ')}\n`;
    const port = parseTarget(target.baseUrl).port;
    this.opDone = this.compose(args, target, { onOutput: (t) => this.appendOpLog(t), timeoutMs })
      .then((r) => {
        if (r.code !== 0) this.lastError = diagnose(r, port) ?? `Falhou: ${lastLines(cleanLog(r.stderr || r.stdout), 3) || `código ${r.code}`}`;
      })
      .finally(() => {
        this.op = null;
      });
  }

  async status(target: JeffTarget): Promise<JeffStatus> {
    const { local, port } = parseTarget(target.baseUrl);
    const reachable = await this.probe(target.baseUrl);
    const base = { reachable, baseUrl: target.baseUrl, local, port };
    const make = (phase: JeffPhase, message: string): JeffStatus => ({ ...base, phase, message });

    if (this.op) return make(this.op, OP_MESSAGE[this.op]);

    const ps = await this.compose(['ps', '--all', '--format', 'json', SERVICE], undefined, { timeoutMs: 15_000 });
    if (ps.spawnError || ps.code !== 0) {
      const problem = diagnose(ps);
      return problem ? make('no-docker', problem) : make('error', lastLines(cleanLog(ps.stderr), 3) || 'Falha ao consultar o Docker.');
    }

    const row = parsePs(ps.stdout);
    const running = row?.State === 'running';
    if (!running) {
      if (this.lastError) return make('error', this.lastError);
      return make(
        'stopped',
        reachable ? 'Há um jeff respondendo nesse endereço, iniciado fora do Studio.' : 'Desligado.',
      );
    }

    switch (row.Health) {
      case 'healthy':
        return make('ready', 'Pronto.');
      case 'unhealthy':
        return make('unhealthy', 'O container está rodando, mas o jeff não responde. Veja os logs.');
      case 'starting':
        return make('starting', await this.startingMessage());
      default:
        return reachable ? make('ready', 'Pronto.') : make('starting', await this.startingMessage());
    }
  }

  /** Tells "downloading the model" apart from "loading it", from our entrypoint's markers. */
  private async startingMessage(): Promise<string> {
    const r = await this.compose(['logs', '--no-color', '--tail', '80', SERVICE], undefined, { timeoutMs: 10_000 });
    const text = r.stdout + r.stderr;
    const downloading = text.lastIndexOf('Baixando o modelo');
    if (downloading >= 0 && text.lastIndexOf('Modelo baixado') < downloading) {
      return 'Baixando o modelo (cerca de 1,7 GB, só na primeira vez)…';
    }
    return 'Carregando o modelo…';
  }

  async start(target: JeffTarget): Promise<JeffStatus> {
    if (!this.op) {
      const hasImage = (await this.run(['image', 'inspect', JEFF_IMAGE], { timeoutMs: 15_000 })).code === 0;
      const args = ['up', '-d', ...(hasImage ? [] : ['--build']), SERVICE];
      // Building downloads Python + PyTorch; give it room on slow connections.
      this.background(hasImage ? 'starting' : 'building', args, target, 60 * 60_000);
    }
    return this.status(target);
  }

  async stop(target: JeffTarget, opts: { wait?: boolean } = {}): Promise<JeffStatus> {
    if (!this.op) this.background('stopping', ['stop', '-t', '10', SERVICE], target, 60_000);
    if (opts.wait) await this.opDone;
    return this.status(target);
  }

  async logs(tail = 200): Promise<string> {
    const r = await this.compose(['logs', '--no-color', '--tail', String(tail), SERVICE], undefined, { timeoutMs: 10_000 });
    const container = r.code === 0 ? cleanLog(r.stdout + r.stderr).trim() : '';
    const op = this.op || this.lastError ? lastLines(cleanLog(this.opLog), OP_LOG_LINES) : '';
    return [op, container].filter(Boolean).join('\n\n') || '(sem logs ainda)';
  }
}
