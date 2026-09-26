import { BACKENDS, type Backend, type BackendView, type ConfigUpdate, type ConfigView } from '@jev/core';
import { BACKEND_ENV, maskKey } from '../adapters/file-settings';
import type { SettingsStore } from '../ports';
import { AppError } from './errors';

export class ConfigService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly dataDir: string,
  ) {}

  private async backendView(backend: Backend): Promise<BackendView> {
    const key = await this.settings.resolveKey(backend);
    return {
      baseUrl: await this.settings.getBaseUrl(backend),
      hasKey: Boolean(key),
      maskedKey: key ? maskKey(key.key) : null,
      keySource: key?.source ?? null,
      keyEnv: BACKEND_ENV[backend].key,
    };
  }

  async view(): Promise<ConfigView> {
    return {
      backend: await this.settings.getBackend(),
      model: await this.settings.getModel(),
      backends: {
        typesafe: await this.backendView('typesafe'),
        jeff: await this.backendView('jeff'),
      },
      jeff: await this.settings.getJeffAuto(),
      dataDir: this.dataDir,
    };
  }

  async update(input: ConfigUpdate): Promise<ConfigView> {
    try {
      for (const b of BACKENDS) {
        const patch = input.backends?.[b];
        if (!patch) continue;
        if (typeof patch.baseUrl === 'string') await this.settings.setBaseUrl(b, patch.baseUrl);
        if (patch.apiKey === null) await this.settings.clearKey(b);
        else if (typeof patch.apiKey === 'string') await this.settings.saveKey(b, patch.apiKey);
      }
      if (input.jeff) await this.settings.setJeffAuto(input.jeff);
      if (typeof input.model === 'string') await this.settings.setModel(input.model);
      if (typeof input.backend === 'string') await this.settings.setBackend(input.backend);
    } catch (err) {
      throw new AppError(400, 'INVALID_CONFIG', (err as Error).message);
    }
    return this.view();
  }
}
