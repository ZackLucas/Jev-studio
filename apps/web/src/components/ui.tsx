import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { decisionTone } from '../lib/format';

export function DecisionBadge({ value, large }: { value?: string; large?: boolean }) {
  if (!value) return <span className="badge tone-neutral">—</span>;
  return <span className={`badge tone-${decisionTone(value)}${large ? ' badge-lg' : ''}`}>{value}</span>;
}

export function JsonView({ value, maxHeight }: { value: unknown; maxHeight?: number }) {
  return (
    <pre className="json" style={maxHeight ? { maxHeight } : undefined}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? 'Copiado ✓' : label}
    </button>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: { code?: string; message: string } | null | undefined }) {
  if (!error) return null;
  return (
    <div className="alert alert-bad" role="alert">
      {error.code && <code>{error.code}</code>} {error.message}
    </div>
  );
}

// ---- Toasts -------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'bad';
}
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
