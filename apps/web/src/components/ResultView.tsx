import { useState } from 'react';
import { getPreset, type Answer, type HistoryEntry, type Question } from '@jev/core';
import { BACKEND_LABEL, ms, pct } from '../lib/format';
import { DecisionBadge, ErrorBox, JsonView } from './ui';

function text(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'what' in v) return text((v as { what: unknown }).what);
  return JSON.stringify(v);
}

function Bars({ probs, chosen, order, labels }: { probs: Record<string, number>; chosen?: string; order: string[]; labels?: Record<string, string> }) {
  const keys = Object.keys(probs).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return probs[b]! - probs[a]!;
  });
  return (
    <div className="bars">
      {keys.map((k) => (
        <div key={k} className={`bar-row${k === chosen ? ' is-chosen' : ''}`} title={labels?.[k]}>
          <span className="bar-label">{labels?.[k] ?? k}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(0, Math.min(1, probs[k]!)) * 100}%` }} />
          </span>
          <span className="bar-value">{pct(probs[k])}</span>
        </div>
      ))}
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <span className="meter">
      <span className="meter-track">
        <span className="meter-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </span>
      {pct(value)}
    </span>
  );
}

/** One answer, rendered by type. `question` is what was asked (from the request), when known. */
function AnswerCard({ id, answer, question, primary }: { id: string; answer: Answer; question?: Question; primary: boolean }) {
  const instructions = question ? text(question.instructions) : undefined;
  return (
    <div className={`answer${primary ? ' is-primary' : ''}`}>
      <div className="answer-head">
        <code className="answer-id">{id}</code>
        <span className="answer-type">{answer.type}</span>
      </div>
      {instructions && <div className="answer-q">{instructions}</div>}

      {answer.type === 'choice' && (
        <>
          <div className="result-headline">
            <DecisionBadge value={answer.choice} large={primary} />
            <span className="confidence">
              confiança <strong>{pct(answer.confidence)}</strong>
            </span>
          </div>
          <Bars
            probs={answer.probabilities ?? {}}
            chosen={answer.choice}
            order={question?.type === 'choice' ? Object.keys(question.criteria) : []}
          />
        </>
      )}

      {answer.type === 'score' &&
        (() => {
          const levels = Object.keys(answer.legend ?? {});
          const labels = Object.fromEntries(levels.map((k) => [k, `${k} · ${text(answer.legend[k])}`]));
          const nearest = String(Math.round(answer.score));
          return (
            <>
              <div className="result-headline">
                <span className="score-value">
                  {answer.score.toFixed(2)}
                  <span className="muted"> / {Math.max(levels.length - 1, 0)}</span>
                </span>
                {answer.legend?.[nearest] !== undefined && <span className="muted">≈ {text(answer.legend[nearest])}</span>}
                <span className="confidence">
                  confiança <strong>{pct(answer.confidence)}</strong>
                </span>
              </div>
              <Bars probs={answer.probabilities ?? {}} chosen={nearest} order={levels} labels={labels} />
            </>
          );
        })()}

      {answer.type === 'noul' && (
        <div className="result-headline">
          <span className="muted">sim</span>
          <Meter value={answer.noul} />
        </div>
      )}
    </div>
  );
}

export function ResultView({ entry }: { entry: HistoryEntry }) {
  const [showRaw, setShowRaw] = useState(false);
  const preset = getPreset(entry.presetId);
  const answers = Object.entries(entry.response?.answers ?? {});
  const primaryKey = entry.summary.question ?? preset?.primary;
  answers.sort(([a], [b]) => (a === primaryKey ? -1 : b === primaryKey ? 1 : 0));

  return (
    <div className="result">
      <div className="result-meta">
        <span className={`dot ${entry.ok ? 'dot-good' : 'dot-bad'}`} />
        <span>{BACKEND_LABEL[entry.backend] ?? entry.backend}</span>
        {entry.status !== null && <span className="muted">HTTP {entry.status}</span>}
        <span className="muted">{ms(entry.elapsedMs)}</span>
        {entry.attempts && entry.attempts > 1 && <span className="muted">{entry.attempts} tentativas</span>}
        {entry.response?.model && <span className="muted">{entry.response.model}</span>}
        {entry.response?.usage && (
          <span className="muted">
            {entry.response.usage.input_tokens}+{entry.response.usage.output_tokens} tokens
          </span>
        )}
      </div>

      <ErrorBox error={entry.error ? { code: entry.error.type, message: entry.error.message } : null} />

      {entry.ok && (
        <div className="answers">
          {answers.map(([id, a]) => (
            <AnswerCard key={id} id={id} answer={a} question={entry.request?.questions?.[id]} primary={id === primaryKey} />
          ))}
        </div>
      )}

      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowRaw((s) => !s)}>
        {showRaw ? 'Ocultar JSON da resposta' : 'Ver JSON da resposta'}
      </button>
      {showRaw && <JsonView value={entry.response ?? entry.error} maxHeight={420} />}
    </div>
  );
}
