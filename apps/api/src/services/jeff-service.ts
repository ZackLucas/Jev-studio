import type { Backend, JeffStatus } from '@jev/core';
import type { JeffRuntime, JeffTarget, SettingsStore } from '../ports';
import { AppError } from './errors';

/** Use case: turn the local jeff on and off from the UI, using the jeff settings (base URL, key). */
export class JeffService {
  constructor(
    private readonly runtime: JeffRuntime,
    private readonly settings: SettingsStore,
  ) {}

  private async target(): Promise<JeffTarget> {
    const key = await this.settings.resolveKey('jeff');
    return { baseUrl: await this.settings.getBaseUrl('jeff'), apiKey: key?.key };
  }

  async status(): Promise<JeffStatus> {
    return this.runtime.status(await this.target());
  }

  async start(): Promise<JeffStatus> {
    const target = await this.target();
    const s = await this.runtime.status(target);
    if (!s.local) {
      throw new AppError(400, 'NOT_LOCAL', `O Studio só liga um jeff neste computador, e a base URL do jeff é ${s.baseUrl}.`);
    }
    if (s.phase === 'no-docker') throw new AppError(409, 'NO_DOCKER', s.message);
    if (s.phase === 'stopping') throw new AppError(409, 'BUSY', 'O jeff ainda está desligando; tente de novo em instantes.');
    if (s.phase === 'ready' || s.phase === 'building' || s.phase === 'starting') return s;
    if (s.reachable) {
      throw new AppError(
        409,
        'PORT_IN_USE',
        `Já existe um jeff respondendo em ${s.baseUrl}, iniciado fora do Studio. Desligue-o ou mude a base URL do jeff.`,
      );
    }
    return this.runtime.start(target);
  }

  async stop(): Promise<JeffStatus> {
    const target = await this.target();
    const s = await this.runtime.status(target);
    if (s.phase === 'no-docker' || s.phase === 'stopping') return s;
    if (s.phase === 'stopped' || s.phase === 'error') {
      // Nothing of ours is running (an external jeff is not ours to stop).
      return s;
    }
    return this.runtime.stop(target);
  }

  logs(tail?: number): Promise<string> {
    return this.runtime.logs(tail);
  }

  // ---- Automatic control (Configurações → jeff → "automático") -------------

  /** Studio opened: start jeff if it is the backend and auto-start is on. Never throws. */
  async onStudioStart(log: (msg: string) => void = () => {}): Promise<void> {
    if ((await this.settings.getBackend()) !== 'jeff') return;
    if (!(await this.settings.getJeffAuto()).autoStart) return;
    await this.autoStart(log);
  }

  /** Backend switched in the UI. Never throws; the UI follows progress via status(). */
  async onBackendChanged(from: Backend, to: Backend, log: (msg: string) => void = () => {}): Promise<void> {
    const auto = await this.settings.getJeffAuto();
    if (to === 'jeff' && auto.autoStart) await this.autoStart(log);
    if (from === 'jeff' && to !== 'jeff' && auto.autoStop) await this.autoStop(log, false);
  }

  /** Studio closing: stop our container (and wait for it) if auto-stop is on. Never throws. */
  async onStudioClose(log: (msg: string) => void = () => {}): Promise<void> {
    if (!(await this.settings.getJeffAuto()).autoStop) return;
    await this.autoStop(log, true);
  }

  private async autoStart(log: (msg: string) => void) {
    try {
      const s = await this.status();
      // Only when it's ours to start: local, Docker ok, nothing already answering.
      if (!s.local || s.reachable || (s.phase !== 'stopped' && s.phase !== 'error')) return;
      await this.runtime.start(await this.target());
      log('jeff: ligando o container automaticamente (acompanhe em Configurações → jeff).');
    } catch (err) {
      log(`jeff: não consegui ligar automaticamente — ${(err as Error).message}`);
    }
  }

  private async autoStop(log: (msg: string) => void, wait: boolean) {
    try {
      const target = await this.target();
      const s = await this.runtime.status(target);
      if (s.phase !== 'ready' && s.phase !== 'starting' && s.phase !== 'unhealthy') return;
      log('jeff: desligando o container…');
      await this.runtime.stop(target, { wait });
    } catch (err) {
      log(`jeff: não consegui desligar — ${(err as Error).message}`);
    }
  }
}
