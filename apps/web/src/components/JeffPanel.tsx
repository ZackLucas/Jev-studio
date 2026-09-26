import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { jeffDot, jeffLabel, type JeffControl } from '../lib/jeff';
import { ErrorBox } from './ui';

function elapsed(since: number, now: number): string {
  const s = Math.max(0, Math.round((now - since) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}s`;
}

function useNow(enabled: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/** Full control, shown in Configurações → jeff. */
export function JeffPanel({ jeff }: { jeff: JeffControl }) {
  const { status: s, busy, pending } = jeff;
  const [showLogs, setShowLogs] = useState(false);
  const now = useNow(busy);

  useEffect(() => {
    // Open the logs automatically on failure, so the reason is visible.
    if (s?.phase === 'error' || s?.phase === 'unhealthy') setShowLogs(true);
  }, [s?.phase]);

  const external = s?.phase === 'stopped' && s.reachable;
  const canStart = s && s.local && (s.phase === 'stopped' || s.phase === 'error') && !external;
  const canStop = s && (s.phase === 'ready' || s.phase === 'starting' || s.phase === 'unhealthy');

  return (
    <div className="jeff-box">
      <div className="jeff-head">
        <span className={`dot ${jeffDot(s)}`} />
        <div className="jeff-state">
          <strong>jeff no Docker: {jeffLabel(s)}</strong>
          <span className="muted small">
            {s ? (external ? `Já há um jeff respondendo em ${s.baseUrl}; o Studio não o controla.` : s.message) : 'Consultando…'}
            {busy && ` · ${elapsed(jeff.since, now)}`}
          </span>
        </div>
        <span className="spacer" />
        {canStop && (
          <button type="button" className="btn btn-sm" disabled={pending !== null} onClick={() => void jeff.stop()}>
            {pending === 'stop' ? 'Desligando…' : 'Desligar'}
          </button>
        )}
        {!canStop && (
          <button type="button" className="btn btn-primary btn-sm" disabled={!canStart || pending !== null} onClick={() => void jeff.start()}>
            {pending === 'start' || s?.phase === 'building' ? 'Ligando…' : 'Ligar jeff'}
          </button>
        )}
      </div>

      {busy && <div className="progress" aria-hidden />}

      {s && !s.local && (
        <p className="muted small">
          A base URL do jeff não é deste computador, então o Studio não liga nem desliga esse jeff. Para usar o container
          local, volte a base URL para <code>http://localhost:8000</code>.
        </p>
      )}
      {s?.phase === 'no-docker' && (
        <p className="muted small">
          Sem Docker, dá para subir o jeff à mão (Python 3.12 + uv) — veja o README. O Studio detecta um jeff rodando no
          endereço configurado.
        </p>
      )}
      {s?.phase === 'building' && (
        <p className="muted small">
          A primeira vez baixa Python, PyTorch (versão CPU) e o jeff; depois o modelo (~1,7 GB). As próximas vezes ligam em
          segundos.
        </p>
      )}

      <ErrorBox error={jeff.error} />

      {s && s.phase !== 'no-docker' && (
        <div className="toolbar">
          <button type="button" className={`btn btn-ghost btn-sm${showLogs ? ' is-on' : ''}`} onClick={() => setShowLogs((v) => !v)}>
            {showLogs ? 'Ocultar logs' : 'Ver logs'}
          </button>
          <span className="muted small">
            Container <code>jev-studio-jeff</code> · porta {s.port}
          </span>
        </div>
      )}
      {showLogs && <JeffLogs live={busy || s?.phase === 'ready'} />}
    </div>
  );
}

function JeffLogs({ live }: { live: boolean }) {
  const [text, setText] = useState('Carregando…');
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { logs } = await api.jeffLogs();
        if (!cancelled) setText(logs);
      } catch (err) {
        if (!cancelled) setText((err as Error).message);
      }
    };
    void load();
    if (!live) return () => void (cancelled = true);
    const id = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [live]);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <pre
      ref={ref}
      className="json jeff-logs"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {text}
    </pre>
  );
}

/** One-line prompt in the Playground when the jeff backend is selected but not answering. */
export function JeffBanner({ jeff }: { jeff: JeffControl }) {
  const s = jeff.status;
  const now = useNow(jeff.busy);
  if (!s || s.reachable) return null;
  const canStart = s.local && (s.phase === 'stopped' || s.phase === 'error');
  return (
    <div className="alert alert-warn jeff-banner">
      <span className={`dot ${jeffDot(s)}`} />
      <span>
        {jeff.busy ? (
          <>
            jeff: {s.message} <span className="muted">({elapsed(jeff.since, now)})</span>
          </>
        ) : s.phase === 'no-docker' || !s.local ? (
          <>
            O jeff não está respondendo em <code>{s.baseUrl}</code>. <a href="#/settings">Configurações</a>
          </>
        ) : (
          <>O jeff está desligado{s.phase === 'error' ? ` (${s.message})` : ''}.</>
        )}
      </span>
      <span className="spacer" />
      {canStart && (
        <button type="button" className="btn btn-primary btn-sm" disabled={jeff.pending !== null} onClick={() => void jeff.start()}>
          {jeff.pending === 'start' ? 'Ligando…' : 'Ligar jeff'}
        </button>
      )}
    </div>
  );
}
