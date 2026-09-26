import { useCallback, useEffect, useRef, useState } from 'react';
import type { JeffPhase, JeffStatus } from '@jev/core';
import { api } from './api';

export const JEFF_BUSY: readonly JeffPhase[] = ['building', 'starting', 'stopping'];

export const JEFF_PHASE_LABEL: Record<JeffPhase, string> = {
  'no-docker': 'Docker indisponível',
  stopped: 'Desligado',
  building: 'Montando a imagem',
  starting: 'Iniciando',
  ready: 'Ligado',
  unhealthy: 'Sem resposta',
  stopping: 'Desligando',
  error: 'Falhou',
};

export function jeffDot(s: JeffStatus | undefined): string {
  if (!s) return 'dot-off';
  if (s.phase === 'ready' || (s.phase === 'stopped' && s.reachable)) return 'dot-good';
  if (JEFF_BUSY.includes(s.phase)) return 'dot-warn dot-pulse';
  if (s.phase === 'error' || s.phase === 'unhealthy') return 'dot-bad';
  return 'dot-off';
}

/** Short label; a jeff started outside the Studio counts as "on". */
export function jeffLabel(s: JeffStatus | undefined): string {
  if (!s) return '…';
  if (s.phase === 'stopped' && s.reachable) return 'Ligado (fora do Studio)';
  return JEFF_PHASE_LABEL[s.phase];
}

export type JeffControl = ReturnType<typeof useJeff>;

/** Polls the local jeff while `active`: every 2 s during start/stop, every 10 s otherwise. */
export function useJeff(active: boolean) {
  const [status, setStatus] = useState<JeffStatus>();
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState<'start' | 'stop' | null>(null);
  const [since, setSince] = useState(() => Date.now());
  const lastPhase = useRef<JeffPhase | null>(null);

  const apply = useCallback((s: JeffStatus) => {
    if (s.phase !== lastPhase.current) {
      lastPhase.current = s.phase;
      setSince(Date.now());
    }
    setStatus(s);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.jeffStatus());
    } catch (err) {
      setError(err as Error);
    }
  }, [apply]);

  const busy = status ? JEFF_BUSY.includes(status.phase) : false;
  useEffect(() => {
    if (!active) return;
    void refresh();
    const id = setInterval(refresh, busy ? 2000 : 10_000);
    return () => clearInterval(id);
  }, [active, busy, refresh]);

  const act = useCallback(
    async (kind: 'start' | 'stop') => {
      setPending(kind);
      try {
        apply(await (kind === 'start' ? api.jeffStart() : api.jeffStop()));
        return true;
      } catch (err) {
        setError(err as Error);
        return false;
      } finally {
        setPending(null);
      }
    },
    [apply],
  );

  return {
    status,
    error,
    pending,
    busy,
    /** When the current phase began (for "há 2 min"). */
    since,
    refresh,
    start: () => act('start'),
    stop: () => act('stop'),
  };
}
