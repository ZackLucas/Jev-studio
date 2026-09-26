/**
 * Ports: what the application needs from the outside world.
 * Services depend only on these interfaces; adapters implement them.
 */
import type { Backend, HistoryEntry, JeffAuto, JeffDevice, JeffStatus, KeySource, Scenario, SystemOneRequest, SystemOneResult } from '@jev/core';

/** Anything that answers the official `POST /v1/systemone` — TypeSafe itself or a jeff instance. */
export interface SystemOneGateway {
  evaluate(
    request: SystemOneRequest,
    opts: { baseUrl: string; apiKey?: string; retry?: number; timeoutMs?: number },
  ): Promise<SystemOneResult>;
}

/** Where the managed jeff should listen and which key it should require. */
export interface JeffTarget {
  baseUrl: string;
  /** Becomes JEFF_API_KEYS in the container; empty = no auth. */
  apiKey?: string;
  /** Which image to run; 'auto' (default) = GPU when Docker can use one, else CPU. */
  device?: JeffDevice;
}

/** Starts/stops a local jeff (today: a Docker Compose service). */
export interface JeffRuntime {
  status(target: JeffTarget): Promise<JeffStatus>;
  /** Returns right away; progress shows up in status() and logs(). */
  start(target: JeffTarget): Promise<JeffStatus>;
  /** With `wait`, resolves only after the container stopped (used when the Studio exits). */
  stop(target: JeffTarget, opts?: { wait?: boolean }): Promise<JeffStatus>;
  logs(tail?: number): Promise<string>;
}

export interface ResolvedKey {
  key: string;
  source: KeySource;
}

export interface SettingsStore {
  getBackend(): Promise<Backend>;
  setBackend(backend: Backend): Promise<void>;
  getModel(): Promise<string>;
  setModel(model: string): Promise<void>;
  getBaseUrl(backend: Backend): Promise<string>;
  setBaseUrl(backend: Backend, url: string): Promise<void>;
  resolveKey(backend: Backend): Promise<ResolvedKey | null>;
  saveKey(backend: Backend, key: string): Promise<void>;
  clearKey(backend: Backend): Promise<void>;
  getJeffAuto(): Promise<JeffAuto>;
  setJeffAuto(patch: Partial<JeffAuto>): Promise<void>;
}

export interface Repository<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  upsert(item: T): Promise<void>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export type HistoryRepo = Repository<HistoryEntry>;
export type ScenarioRepo = Repository<Scenario>;
