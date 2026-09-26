import type { SystemOneRequest, SystemOneResponse } from './types';

export const SYSTEMONE_PATH = '/v1/systemone';
export const DEFAULT_TYPESAFE_BASE_URL = 'https://api.typesafe.ai';
export const DEFAULT_JEFF_BASE_URL = 'http://localhost:8000';
/** TypeSafe's flagship model; jeff accepts it as an alias by default. */
export const DEFAULT_MODEL = 'jev-latest';

/** Longest we will wait between two attempts, whatever the server asks. */
export const MAX_RETRY_WAIT_MS = 30_000;

export type SystemOneErrorType =
  | 'authentication_error' // 401
  | 'validation_error' // 422
  | 'rate_limit_error' // 429
  | 'overloaded_error' // 529
  | 'server_error' // other 5xx
  | 'http_error' // other non-2xx
  | 'timeout'
  | 'network_error'
  | 'bad_response';

export interface SystemOneError {
  type: SystemOneErrorType;
  message: string;
}

export interface SystemOneResult {
  ok: boolean;
  status: number | null;
  url: string;
  elapsedMs: number;
  attempts: number;
  response: SystemOneResponse | null;
  error?: SystemOneError;
}

export interface SystemOneClientOptions {
  baseUrl: string;
  /** Optional: a local jeff without JEFF_API_KEYS accepts requests with no Authorization. */
  apiKey?: string;
  timeoutMs?: number;
  /** Extra attempts on transient failures (network, timeout, 429, 529, 5xx). */
  retry?: number;
  fetch?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function normalizeBaseUrl(raw: string): string {
  return String(raw).trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

/**
 * Delay before the next attempt. Honors `retry-after-ms` (jeff) and `retry-after` (seconds),
 * otherwise backs off exponentially — harder on rate limits, as TypeSafe recommends.
 */
export function retryDelayMs(
  attempt: number,
  rateLimited: boolean,
  headers?: { retryAfter?: string | null; retryAfterMs?: string | null },
): number {
  const ms = Number(headers?.retryAfterMs);
  if (headers?.retryAfterMs && Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_RETRY_WAIT_MS);
  const s = Number(headers?.retryAfter);
  if (headers?.retryAfter && Number.isFinite(s) && s >= 0) return Math.min(s * 1000, MAX_RETRY_WAIT_MS);
  if (rateLimited) return Math.min(2000 * 2 ** (attempt - 1), MAX_RETRY_WAIT_MS); // 2s, 4s, 8s…
  return Math.min(700 * attempt, MAX_RETRY_WAIT_MS); // 0.7s, 1.4s…
}

export function errorTypeFor(status: number): SystemOneErrorType {
  if (status === 401 || status === 403) return 'authentication_error';
  if (status === 422 || status === 400) return 'validation_error';
  if (status === 429) return 'rate_limit_error';
  if (status === 529) return 'overloaded_error';
  if (status >= 500) return 'server_error';
  return 'http_error';
}

/** Readable message from `{error:{message}}`, FastAPI's `{detail:[...]}`, `{message}` or `{detail:"..."}`. */
export function errorMessage(status: number, body: unknown): string {
  const b = (body ?? {}) as { error?: { message?: string } | string; detail?: unknown; message?: string };
  if (typeof b.error === 'object' && b.error?.message) return b.error.message;
  if (typeof b.error === 'string') return b.error;
  if (typeof b.message === 'string' && b.message) return b.message;
  if (typeof b.detail === 'string') return b.detail;
  if (Array.isArray(b.detail)) {
    const parts = b.detail
      .filter((d): d is { loc?: unknown[]; msg?: string } => Boolean(d) && typeof d === 'object')
      .map((d) => `${(d.loc ?? []).filter((x) => x !== 'body').join('.')}: ${d.msg ?? ''}`.replace(/^: /, ''));
    if (parts.length) return parts.join('; ');
  }
  return `HTTP ${status}`;
}

const TRANSIENT: SystemOneErrorType[] = ['rate_limit_error', 'overloaded_error', 'server_error', 'timeout', 'network_error'];

/** Minimal client for the official endpoint. Never throws: failures come back in `error`. */
export class SystemOneClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly retry: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: SystemOneClientOptions) {
    this.url = normalizeBaseUrl(opts.baseUrl) + SYSTEMONE_PATH;
    this.timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 30_000;
    this.retry = Math.max(0, Math.min(opts.retry ?? 0, 5));
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async evaluate(request: SystemOneRequest): Promise<SystemOneResult> {
    const started = Date.now();
    const body = JSON.stringify(request);
    const attempts = this.retry + 1;
    let waitMs = 0;
    let last: SystemOneResult | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(waitMs);
      const done = (r: Omit<SystemOneResult, 'url' | 'elapsedMs' | 'attempts'>): SystemOneResult => ({
        ...r,
        url: this.url,
        elapsedMs: Date.now() - started,
        attempts: attempt,
      });

      let res: Response;
      try {
        res = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const e = err as Error;
        const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
        last = done({
          ok: false,
          status: null,
          response: null,
          error: timedOut
            ? { type: 'timeout', message: `Tempo esgotado após ${this.timeoutMs} ms chamando ${this.url}.` }
            : { type: 'network_error', message: `Falha de rede chamando ${this.url}: ${e.message}` },
        });
        waitMs = retryDelayMs(attempt, false);
        continue;
      }

      const text = await res.text();
      let json: unknown = null;
      let parsed = true;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        parsed = false;
      }

      if (res.ok) {
        const r = json as SystemOneResponse | null;
        if (!parsed || !r || typeof r !== 'object' || typeof r.answers !== 'object') {
          return done({
            ok: false,
            status: res.status,
            response: null,
            error: { type: 'bad_response', message: `Resposta inesperada (HTTP ${res.status}): ${text.slice(0, 300)}` },
          });
        }
        return done({ ok: true, status: res.status, response: r });
      }

      const type = errorTypeFor(res.status);
      last = done({
        ok: false,
        status: res.status,
        response: null,
        error: { type, message: parsed ? errorMessage(res.status, json) : `HTTP ${res.status}: ${text.slice(0, 300)}` },
      });
      if (!TRANSIENT.includes(type)) return last;
      waitMs = retryDelayMs(attempt, type === 'rate_limit_error' || type === 'overloaded_error', {
        retryAfter: res.headers.get('retry-after'),
        retryAfterMs: res.headers.get('retry-after-ms'),
      });
    }

    return last!;
  }
}
