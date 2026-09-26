/**
 * Types shared by apps/api and apps/web — the contract of the local Studio API.
 */
import type { SystemOneError } from './systemone/client';
import type { DecisionSummary } from './systemone/summary';
import type { SystemOneRequest, SystemOneResponse } from './systemone/types';

/** 'typesafe' = official API (api.typesafe.ai). 'jeff' = self-hosted github.com/jarihu/jeff. Same wire format. */
export type Backend = 'typesafe' | 'jeff';
export const BACKENDS: readonly Backend[] = ['typesafe', 'jeff'];

export interface RunRequest {
  /**
   * Normally the preset's form body. With `raw: true`, a full official request
   * ({ state, questions, model? }) sent as-is, bypassing the recipe.
   */
  body: Record<string, unknown>;
  raw?: boolean;
  retry?: number;
  timeoutMs?: number;
  scenarioId?: string;
}

export interface HistoryEntry {
  id: string;
  presetId: string;
  backend: Backend;
  createdAt: string;
  /** What the user filled in (form body, or the raw request). */
  input: Record<string, unknown>;
  raw: boolean;
  /** Exactly what was sent to /v1/systemone. */
  request: SystemOneRequest;
  ok: boolean;
  status: number | null;
  elapsedMs: number | null;
  attempts: number | null;
  response: SystemOneResponse | null;
  summary: DecisionSummary;
  error?: SystemOneError;
  scenarioId?: string;
}

export type RunResponse = HistoryEntry;

export interface Scenario {
  id: string;
  name: string;
  presetId: string;
  body: Record<string, unknown>;
  /** When true, `body` is a raw official request rather than the preset's form body. */
  raw?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioInput {
  name: string;
  presetId: string;
  body: Record<string, unknown>;
  raw?: boolean;
  notes?: string;
}

export type KeySource = 'env' | 'studio-config';

export interface BackendView {
  baseUrl: string;
  hasKey: boolean;
  maskedKey: string | null;
  keySource: KeySource | null;
  /** Env var that overrides the key saved in the Studio. */
  keyEnv: string;
}

/** Which jeff image to run: CPU (works anywhere) or GPU (needs NVIDIA + nvidia-container-toolkit). */
export type JeffVariant = 'cpu' | 'gpu';
export const JEFF_VARIANTS: readonly JeffVariant[] = ['cpu', 'gpu'];

/** 'auto' picks GPU when Docker can use one, otherwise CPU. */
export type JeffDevice = JeffVariant | 'auto';
export const JEFF_DEVICES: readonly JeffDevice[] = ['auto', 'cpu', 'gpu'];

/** Runtime settings for the local jeff container. */
export interface JeffAuto {
  /** Start it when jeff is the backend: when the Studio opens and when switching to jeff. */
  autoStart: boolean;
  /** Stop it when the Studio closes and when switching to TypeSafe. */
  autoStop: boolean;
  /** Which image to run. 'auto' = GPU when available, else CPU. */
  device: JeffDevice;
}

export interface ConfigView {
  backend: Backend;
  model: string;
  backends: Record<Backend, BackendView>;
  jeff: JeffAuto;
  dataDir: string;
}

/**
 * State of the jeff container the Studio manages with Docker (docker/jeff/<cpu|gpu>/compose.yml).
 * - no-docker: Docker or Compose missing, daemon stopped or no permission (see `message`)
 * - stopped:   no container, or it exited
 * - building:  first start — building the image (a few minutes)
 * - starting:  container up, downloading the model (first time) or loading it
 * - ready:     answering /healthz
 * - unhealthy: container up but not answering
 * - stopping:  shutting down
 * - error:     the last start/stop failed (see `message` and the logs)
 */
export type JeffPhase = 'no-docker' | 'stopped' | 'building' | 'starting' | 'ready' | 'unhealthy' | 'stopping' | 'error';

export interface JeffStatus {
  phase: JeffPhase;
  message: string;
  /** The configured jeff base URL answered GET /healthz (managed container or a jeff you started yourself). */
  reachable: boolean;
  baseUrl: string;
  /** False when the base URL isn't on this computer — the Studio can only manage a local container. */
  local: boolean;
  /** Host port the container publishes (taken from the base URL). */
  port: number;
  /** Variant that is running — or that would be started — with 'auto' already resolved. */
  device: JeffVariant;
}

export interface ConfigUpdate {
  backend?: Backend;
  model?: string;
  /** Per-backend settings. `apiKey: null` removes the key saved by the Studio. */
  backends?: Partial<Record<Backend, { baseUrl?: string; apiKey?: string | null }>>;
  jeff?: Partial<JeffAuto>;
}
