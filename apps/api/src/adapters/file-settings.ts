import { promises as fs } from 'node:fs';
import {
  DEFAULT_JEFF_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TYPESAFE_BASE_URL,
  JEFF_DEVICES,
  normalizeBaseUrl,
  type Backend,
  type JeffAuto,
  type JeffDevice,
} from '@jev/core';
import type { ResolvedKey, SettingsStore } from '../ports';
import { Mutex, readJson, writeJson } from './json-file';

interface BackendConfig {
  baseUrl?: string;
  apiKey?: string;
}

interface StudioConfig {
  backend?: Backend;
  model?: string;
  backends?: Partial<Record<Backend, BackendConfig>>;
  jeff?: Partial<JeffAuto>;
}

export const DEFAULT_JEFF_AUTO: JeffAuto = { autoStart: true, autoStop: false, device: 'auto' };

/** Env vars follow the official SDK (TYPESAFE_*); JEFF_* mirror them for the local server. */
export const BACKEND_ENV: Record<Backend, { key: string; baseUrl: string; defaultUrl: string }> = {
  typesafe: { key: 'TYPESAFE_API_KEY', baseUrl: 'TYPESAFE_BASE_URL', defaultUrl: DEFAULT_TYPESAFE_BASE_URL },
  jeff: { key: 'JEFF_API_KEY', baseUrl: 'JEFF_BASE_URL', defaultUrl: DEFAULT_JEFF_BASE_URL },
};

function validUrl(url: string): string {
  const parsed = new URL(url); // throws on garbage
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('A URL precisa ser http(s).');
  return normalizeBaseUrl(url);
}

function assertBackend(b: string): asserts b is Backend {
  if (b !== 'typesafe' && b !== 'jeff') throw new Error(`Backend desconhecido: ${b}`);
}

/**
 * Settings in data/config.json (mode 600). Environment variables win over saved values:
 *   TYPESAFE_API_KEY / TYPESAFE_BASE_URL / TYPESAFE_DEFAULT_MODEL, JEFF_API_KEY / JEFF_BASE_URL.
 */
export class FileSettingsStore implements SettingsStore {
  private readonly lock = new Mutex();

  constructor(
    private readonly file: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private read() {
    return readJson<StudioConfig>(this.file, {});
  }

  private update(fn: (c: StudioConfig) => void): Promise<void> {
    return this.lock.run(async () => {
      const current = await this.read();
      fn(current);
      await writeJson(this.file, current, 0o600);
      await fs.chmod(this.file, 0o600).catch(() => undefined);
    });
  }

  private updateBackend(backend: Backend, fn: (c: BackendConfig) => void) {
    return this.update((c) => {
      c.backends ??= {};
      const b = (c.backends[backend] ??= {});
      fn(b);
    });
  }

  async getBackend(): Promise<Backend> {
    return (await this.read()).backend === 'jeff' ? 'jeff' : 'typesafe';
  }

  setBackend(backend: Backend): Promise<void> {
    assertBackend(backend);
    return this.update((c) => {
      c.backend = backend;
    });
  }

  async getModel(): Promise<string> {
    return this.env.TYPESAFE_DEFAULT_MODEL?.trim() || (await this.read()).model || DEFAULT_MODEL;
  }

  setModel(model: string): Promise<void> {
    const m = model.trim();
    if (!m) throw new Error('O modelo não pode ser vazio.');
    return this.update((c) => {
      c.model = m;
    });
  }

  async getBaseUrl(backend: Backend): Promise<string> {
    const env = BACKEND_ENV[backend];
    return normalizeBaseUrl(this.env[env.baseUrl]?.trim() || (await this.read()).backends?.[backend]?.baseUrl || env.defaultUrl);
  }

  setBaseUrl(backend: Backend, url: string): Promise<void> {
    assertBackend(backend);
    const clean = validUrl(url);
    return this.updateBackend(backend, (b) => {
      b.baseUrl = clean;
    });
  }

  async resolveKey(backend: Backend): Promise<ResolvedKey | null> {
    const fromEnv = this.env[BACKEND_ENV[backend].key]?.trim();
    if (fromEnv) return { key: fromEnv, source: 'env' };
    const saved = (await this.read()).backends?.[backend]?.apiKey?.trim();
    return saved ? { key: saved, source: 'studio-config' } : null;
  }

  saveKey(backend: Backend, key: string): Promise<void> {
    assertBackend(backend);
    const k = key.trim();
    if (!k) throw new Error('A chave não pode ser vazia.');
    return this.updateBackend(backend, (b) => {
      b.apiKey = k;
    });
  }

  clearKey(backend: Backend): Promise<void> {
    assertBackend(backend);
    return this.updateBackend(backend, (b) => {
      delete b.apiKey;
    });
  }

  async getJeffAuto(): Promise<JeffAuto> {
    const saved = (await this.read()).jeff ?? {};
    return {
      autoStart: typeof saved.autoStart === 'boolean' ? saved.autoStart : DEFAULT_JEFF_AUTO.autoStart,
      autoStop: typeof saved.autoStop === 'boolean' ? saved.autoStop : DEFAULT_JEFF_AUTO.autoStop,
      device: JEFF_DEVICES.includes(saved.device as JeffDevice) ? (saved.device as JeffDevice) : DEFAULT_JEFF_AUTO.device,
    };
  }

  setJeffAuto(patch: Partial<JeffAuto>): Promise<void> {
    return this.update((c) => {
      c.jeff = { ...c.jeff };
      if (typeof patch.autoStart === 'boolean') c.jeff.autoStart = patch.autoStart;
      if (typeof patch.autoStop === 'boolean') c.jeff.autoStop = patch.autoStop;
      if (patch.device && JEFF_DEVICES.includes(patch.device)) c.jeff.device = patch.device;
      else if (patch.device) throw new Error(`Dispositivo do jeff desconhecido: ${patch.device}`);
    });
  }
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '•'.repeat(Math.max(key.length, 1));
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
