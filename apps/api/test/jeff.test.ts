import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HistoryEntry, JeffStatus, Scenario } from '@jev/core';
import { cleanLog, DockerJeffRuntime, parsePs, type RunResult, type Runner } from '../src/adapters/docker-jeff-runtime';
import { MemoryRepository } from '../src/adapters/file-repository';
import { FileSettingsStore } from '../src/adapters/file-settings';
import { buildServer } from '../src/http/app';
import { ConfigService } from '../src/services/config-service';
import { DecisionService } from '../src/services/decision-service';
import { AppError } from '../src/services/errors';
import { JeffService } from '../src/services/jeff-service';
import { ScenarioService } from '../src/services/scenario-service';

/** Simulates the docker CLI: image store, one compose service, and a controllable `up`. */
class FakeDocker {
  problem: 'enoent' | 'perm' | 'daemon' | 'nocompose' | null = null;
  image = false;
  container: { State: string; Health: string } | null = null;
  logs = '';
  upResult: Partial<RunResult> = {};
  calls: { args: string[]; env?: Record<string, string> }[] = [];
  private release: (() => void) | null = null;
  holdUp = false;

  finishUp() {
    this.release?.();
  }

  run: Runner = async (args, opts = {}) => {
    this.calls.push({ args, env: opts.env });
    const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });
    if (this.problem === 'enoent') {
      return { code: -1, stdout: '', stderr: '', spawnError: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }) };
    }
    if (this.problem === 'perm') {
      return { code: 1, stdout: '', stderr: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock' };
    }
    if (this.problem === 'daemon') {
      return { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' };
    }
    if (args[0] === 'image') return { code: this.image ? 0 : 1, stdout: '', stderr: this.image ? '' : 'No such image' };
    if (this.problem === 'nocompose') return { code: 125, stdout: '', stderr: "unknown shorthand flag: 'f' in -f" };

    const cmd = args[3];
    if (cmd === 'ps') return ok(this.container ? JSON.stringify({ Name: 'jev-studio-jeff', ...this.container }) + '\n' : '');
    if (cmd === 'logs') return ok(this.logs);
    if (cmd === 'up') {
      opts.onOutput?.('#5 [2/4] RUN pip install uv\r#5 downloading 10%\r#5 downloading 100%\n');
      if (this.holdUp) await new Promise<void>((r) => (this.release = r));
      if (this.upResult.code) return { code: this.upResult.code, stdout: '', stderr: this.upResult.stderr ?? '' };
      this.image = true;
      this.container = { State: 'running', Health: 'starting' };
      return ok();
    }
    if (cmd === 'stop') {
      if (this.container) this.container.State = 'exited';
      return ok();
    }
    return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const target = { baseUrl: 'http://localhost:8000' };

function runtime(docker: FakeDocker, reachable = () => false) {
  return new DockerJeffRuntime('/studio/docker/jeff/compose.yml', docker.run, async () => reachable());
}

describe('DockerJeffRuntime', () => {
  it('reports missing Docker, permissions, stopped daemon and missing Compose with a fix', async () => {
    const docker = new FakeDocker();
    const rt = runtime(docker);
    const cases: [FakeDocker['problem'], RegExp][] = [
      ['enoent', /não está instalado/],
      ['perm', /usermod -aG docker/],
      ['daemon', /systemctl start docker/],
      ['nocompose', /docker-compose-v2/],
    ];
    for (const [problem, message] of cases) {
      docker.problem = problem;
      const s = await rt.status(target);
      assert.equal(s.phase, 'no-docker', problem!);
      assert.match(s.message, message);
    }
  });

  it('first start builds the image, then waits for the healthcheck', async () => {
    const docker = new FakeDocker();
    docker.holdUp = true;
    const rt = runtime(docker);

    assert.equal((await rt.status(target)).phase, 'stopped');
    const started = await rt.start(target);
    assert.equal(started.phase, 'building');
    const up = docker.calls.find((c) => c.args[3] === 'up')!;
    assert.deepEqual(up.args.slice(3), ['up', '-d', '--build', 'jeff']);
    assert.equal(up.env?.JEFF_HOST_PORT, '8000');
    assert.equal(up.env?.JEFF_API_KEYS, '');

    // Progress bars collapse to their last frame in the logs.
    assert.match(await rt.logs(), /downloading 100%/);
    assert.doesNotMatch(await rt.logs(), /downloading 10%/);

    docker.logs = '[jev-studio] Baixando o modelo knowledgator/gliformer-large-v1 ...\n';
    docker.finishUp();
    await tick();
    const s = await rt.status(target);
    assert.equal(s.phase, 'starting');
    assert.match(s.message, /Baixando o modelo/);

    docker.logs += '[jev-studio] Modelo baixado.\n[jev-studio] Carregando o modelo...\n';
    assert.match((await rt.status(target)).message, /Carregando/);

    docker.container!.Health = 'healthy';
    assert.equal((await rt.status(target)).phase, 'ready');
  });

  it('skips the build once the image exists, and passes port and key from the settings', async () => {
    const docker = new FakeDocker();
    docker.image = true;
    const rt = runtime(docker);
    const s = await rt.start({ baseUrl: 'http://127.0.0.1:8123', apiKey: 'devkey' });
    assert.equal(s.phase, 'starting');
    await tick();
    const up = docker.calls.find((c) => c.args[3] === 'up')!;
    assert.deepEqual(up.args.slice(3), ['up', '-d', 'jeff']);
    assert.equal(up.env?.JEFF_HOST_PORT, '8123');
    assert.equal(up.env?.JEFF_API_KEYS, 'devkey');
  });

  it('stop, and a failed start shows up as an error with a readable reason', async () => {
    const docker = new FakeDocker();
    docker.image = true;
    docker.container = { State: 'running', Health: 'healthy' };
    const rt = runtime(docker);
    await rt.stop(target);
    await tick();
    assert.equal((await rt.status(target)).phase, 'stopped');

    docker.upResult = { code: 1, stderr: 'Bind for 127.0.0.1:8000 failed: port is already allocated' };
    await rt.start(target);
    await tick();
    const s = await rt.status(target);
    assert.equal(s.phase, 'error');
    assert.match(s.message, /porta 8000 já está em uso/);
  });

  it('parses both `compose ps` JSON formats and cleans logs', () => {
    assert.equal(parsePs('[{"State":"running","Health":"healthy"}]')?.Health, 'healthy');
    assert.equal(parsePs('{"State":"exited","Health":""}\n')?.State, 'exited');
    assert.equal(parsePs(''), null);
    assert.equal(cleanLog('\x1b[32mok\x1b[0m\na\rb\r'), 'ok\nb');
  });
});

describe('JeffService', () => {
  function service(docker: FakeDocker, reachable = false, jeffUrl?: string) {
    const settings = new FileSettingsStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'jev-jeff-')), 'c.json'), {});
    if (jeffUrl) void settings.setBaseUrl('jeff', jeffUrl);
    return { settings, jeff: new JeffService(runtime(docker, () => reachable), settings) };
  }

  it('refuses to start without Docker, for a remote URL, or over a jeff started elsewhere', async () => {
    const noDocker = new FakeDocker();
    noDocker.problem = 'daemon';
    await assert.rejects(service(noDocker).jeff.start(), (e: AppError) => e.code === 'NO_DOCKER');

    const remote = service(new FakeDocker(), false, 'https://jeff.example.com');
    await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(remote.jeff.start(), (e: AppError) => e.code === 'NOT_LOCAL');

    await assert.rejects(service(new FakeDocker(), true).jeff.start(), (e: AppError) => e.code === 'PORT_IN_USE');
  });

  it('uses the jeff key saved in the Studio as JEFF_API_KEYS', async () => {
    const docker = new FakeDocker();
    docker.image = true;
    const { settings, jeff } = service(docker);
    await settings.saveKey('jeff', 'devkey');
    await jeff.start();
    await tick();
    assert.equal(docker.calls.find((c) => c.args[3] === 'up')?.env?.JEFF_API_KEYS, 'devkey');
  });

  it('stop is a no-op when nothing of ours is running', async () => {
    const docker = new FakeDocker();
    const s = await service(docker, true).jeff.stop();
    assert.equal(s.phase, 'stopped');
    assert.equal(docker.calls.some((c) => c.args[3] === 'stop'), false);
  });
});

describe('automatic start/stop', () => {
  async function setup(auto: { autoStart: boolean; autoStop: boolean }, backend: 'jeff' | 'typesafe') {
    const docker = new FakeDocker();
    docker.image = true;
    const settings = new FileSettingsStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'jev-auto-')), 'c.json'), {});
    await settings.setJeffAuto(auto);
    await settings.setBackend(backend);
    return { docker, settings, jeff: new JeffService(runtime(docker), settings) };
  }
  const ups = (d: FakeDocker) => d.calls.filter((c) => c.args[3] === 'up').length;
  const stops = (d: FakeDocker) => d.calls.filter((c) => c.args[3] === 'stop').length;

  it('defaults: auto-start on, auto-stop off', async () => {
    const settings = new FileSettingsStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'jev-auto-')), 'c.json'), {});
    assert.deepEqual(await settings.getJeffAuto(), { autoStart: true, autoStop: false });
  });

  it('starts on open only when jeff is the backend and auto-start is on', async () => {
    const a = await setup({ autoStart: true, autoStop: false }, 'jeff');
    await a.jeff.onStudioStart();
    assert.equal(ups(a.docker), 1);

    const b = await setup({ autoStart: true, autoStop: false }, 'typesafe');
    await b.jeff.onStudioStart();
    assert.equal(ups(b.docker), 0);

    const c = await setup({ autoStart: false, autoStop: false }, 'jeff');
    await c.jeff.onStudioStart();
    assert.equal(ups(c.docker), 0);
  });

  it('switching backends starts and stops it; closing the Studio stops it and waits', async () => {
    const { docker, jeff } = await setup({ autoStart: true, autoStop: true }, 'typesafe');
    await jeff.onBackendChanged('typesafe', 'jeff');
    await tick();
    assert.equal(ups(docker), 1);
    docker.container!.Health = 'healthy';

    await jeff.onBackendChanged('jeff', 'typesafe');
    await tick();
    assert.equal(stops(docker), 1);

    docker.container = { State: 'running', Health: 'healthy' };
    await jeff.onStudioClose();
    assert.equal(stops(docker), 2);
    assert.equal(docker.container.State, 'exited');
  });

  it('never throws, e.g. without Docker', async () => {
    const { docker, jeff } = await setup({ autoStart: true, autoStop: true }, 'jeff');
    docker.problem = 'enoent';
    await jeff.onStudioStart();
    await jeff.onStudioClose();
    assert.equal(ups(docker), 0);
  });
});

describe('/api/jeff routes', () => {
  it('status, start, logs and stop over HTTP', async () => {
    const docker = new FakeDocker();
    docker.image = true;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jev-jeff-http-'));
    const settings = new FileSettingsStore(path.join(dir, 'c.json'), {});
    const history = new MemoryRepository<HistoryEntry>();
    const server = buildServer({
      decisions: new DecisionService({ evaluate: async () => { throw new Error('unused'); } }, settings, history),
      scenarios: new ScenarioService(new MemoryRepository<Scenario>()),
      config: new ConfigService(settings, dir),
      history,
      jeff: new JeffService(runtime(docker), settings),
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    try {
      const get = async <T>(url: string, method = 'GET') => (await (await fetch(base + url, { method })).json()) as T;
      assert.equal((await get<JeffStatus>('/api/jeff')).phase, 'stopped');
      assert.equal((await get<JeffStatus>('/api/jeff/start', 'POST')).phase, 'starting');
      await tick();
      docker.logs = 'jeff ready: backend=torch model=gliformer-large-v1\n';
      assert.match((await get<{ logs: string }>('/api/jeff/logs?tail=50')).logs, /jeff ready/);
      assert.equal(docker.calls.find((c) => c.args[3] === 'logs' && c.args.includes('50')) !== undefined, true);
      docker.container!.Health = 'healthy';
      assert.equal((await get<JeffStatus>('/api/jeff')).phase, 'ready');
      await get('/api/jeff/stop', 'POST');
      await tick();
      assert.equal((await get<JeffStatus>('/api/jeff')).phase, 'stopped');
    } finally {
      server.close();
    }
  });
});
