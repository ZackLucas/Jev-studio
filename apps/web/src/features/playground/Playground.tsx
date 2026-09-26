import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_MODEL,
  PRESETS,
  SYSTEMONE_PATH,
  bodyToValues,
  buildBody,
  compileRequest,
  emptyValues,
  getPreset,
  type ConfigView,
  type FormValues,
  type HistoryEntry,
  type Preset,
  type SystemOneRequest,
} from '@jev/core';
import { JeffBanner } from '../../components/JeffPanel';
import { ResultView } from '../../components/ResultView';
import { CopyButton, ErrorBox, JsonView, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { BACKEND_LABEL, curlFor } from '../../lib/format';
import { useLocalState } from '../../lib/hooks';
import type { JeffControl } from '../../lib/jeff';
import { FieldInput } from './FieldInput';

export interface Draft {
  presetId: string;
  body: Record<string, unknown>;
  raw?: boolean;
  scenarioId?: string;
  scenarioName?: string;
  nonce: number;
}

interface Props {
  presetId: string;
  draft: Draft | null;
  config: ConfigView | undefined;
  jeff: JeffControl;
  onSelectPreset: (id: string) => void;
  onRan: () => void;
  onScenarioSaved: () => void;
}

type Drafts = Record<string, FormValues>;

function tryCompile(preset: Preset, body: Record<string, unknown>, model: string): SystemOneRequest | null {
  try {
    return compileRequest(preset, body, model);
  } catch {
    return null;
  }
}

export function Playground({ presetId, draft, config, jeff, onSelectPreset, onRan, onScenarioSaved }: Props) {
  const preset = getPreset(presetId) ?? PRESETS[0]!;
  const toast = useToast();
  const backend = config?.backend ?? 'typesafe';
  const target = config?.backends[backend];
  const model = config?.model ?? DEFAULT_MODEL;

  const [drafts, setDrafts] = useLocalState<Drafts>('jev.drafts.v2', {});
  const values = drafts[preset.id] ?? preset.example;
  const setValues = (v: FormValues) => setDrafts({ ...drafts, [preset.id]: v });

  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [retry, setRetry] = useLocalState('jev.retry', 1);
  const [scenario, setScenario] = useState<{ id?: string; name?: string }>({});
  const [saving, setSaving] = useState(false);
  const [scenarioName, setScenarioName] = useState('');

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HistoryEntry | null>(null);
  const [requestError, setRequestError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<'request' | 'response'>('request');

  // Load a body sent from History / Scenarios.
  useEffect(() => {
    if (!draft) return;
    const p = getPreset(draft.presetId);
    if (!p) return;
    if (draft.raw) {
      setRawText(JSON.stringify(draft.body, null, 2));
      setRawMode(true);
    } else {
      setDrafts({ ...drafts, [p.id]: bodyToValues(p, draft.body) });
      setRawMode(false);
    }
    setScenario({ id: draft.scenarioId, name: draft.scenarioName });
    setResult(null);
    setTab('request');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.nonce]);

  // Reset per-preset UI when switching route.
  useEffect(() => {
    setResult(null);
    setRequestError(null);
    if (draft?.presetId !== preset.id) {
      setRawMode(false);
      setScenario({});
    }
    setTab('request');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.id]);

  const built = useMemo(() => buildBody(preset, values), [preset, values]);
  const rawParsed = useMemo(() => {
    if (!rawMode) return null;
    try {
      const v = JSON.parse(rawText);
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'A requisição precisa ser um objeto JSON.' };
      return { body: v as Record<string, unknown> };
    } catch (e) {
      return { error: `JSON inválido: ${(e as Error).message}` };
    }
  }, [rawMode, rawText]);

  /** Exactly what will be POSTed to /v1/systemone. */
  const request: SystemOneRequest | Record<string, unknown> | null = rawMode
    ? rawParsed?.body
      ? { ...rawParsed.body, model: typeof rawParsed.body.model === 'string' && rawParsed.body.model ? rawParsed.body.model : model }
      : null
    : tryCompile(preset, built.body, model);

  const sendBody = rawMode ? (rawParsed?.body ?? null) : built.body;
  const bytes = request ? new TextEncoder().encode(JSON.stringify(request)).byteLength : 0;
  const needsKey = backend === 'typesafe' && !target?.hasKey;
  const canSend = Boolean(config) && !needsKey && !running && sendBody !== null && (rawMode || built.ok);
  const endpoint = `${target?.baseUrl ?? ''}${SYSTEMONE_PATH}`;

  function enterRaw() {
    setRawText(JSON.stringify(request ?? { state: '', questions: {} }, null, 2));
    setRawMode(true);
  }

  function leaveRaw() {
    // The native preset maps 1:1 back to its form; recipes can't be un-compiled.
    if (preset.id === 'decide' && rawParsed?.body) setValues(bodyToValues(preset, rawParsed.body));
    setRawMode(false);
  }

  async function send() {
    if (!canSend || !sendBody) return;
    setRunning(true);
    setRequestError(null);
    try {
      const entry = await api.run(preset.id, { body: sendBody, raw: rawMode, retry, scenarioId: scenario.id });
      setResult(entry);
      setTab('response');
      onRan();
    } catch (err) {
      setRequestError(err as ApiError);
      setTab('response');
    } finally {
      setRunning(false);
    }
  }

  async function saveScenario(asNew: boolean) {
    if (!sendBody) return;
    const name = scenarioName.trim() || scenario.name || '';
    if (!name) return;
    try {
      const input = { name, presetId: preset.id, body: sendBody, raw: rawMode };
      const saved = !asNew && scenario.id ? await api.updateScenario(scenario.id, input) : await api.createScenario(input);
      setScenario({ id: saved.id, name: saved.name });
      setSaving(false);
      setScenarioName('');
      toast(`Cenário "${saved.name}" salvo`);
      onScenarioSaved();
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  }

  return (
    <div className="playground" onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}>
      <nav className="preset-tabs" aria-label="Rotas">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className={`preset-tab${p.id === preset.id ? ' is-active' : ''}`} onClick={() => onSelectPreset(p.id)}>
            {p.title}
          </button>
        ))}
      </nav>

      <div className="split">
        <section className="panel form-panel">
          <PresetHeader preset={preset} />

          {scenario.id && (
            <div className="scenario-pill">
              Cenário: <strong>{scenario.name}</strong>
              <button type="button" className="link" onClick={() => setScenario({})}>
                desvincular
              </button>
            </div>
          )}

          <div className="toolbar">
            {!rawMode && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValues(preset.example)}>
                  Exemplo
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValues(emptyValues(preset))}>
                  Limpar
                </button>
              </>
            )}
            <button
              type="button"
              className={`btn btn-ghost btn-sm${rawMode ? ' is-on' : ''}`}
              onClick={rawMode ? leaveRaw : enterRaw}
              title={rawMode ? undefined : 'Edita a requisição oficial completa (state, questions, model)'}
            >
              {rawMode ? 'Voltar ao formulário' : 'Editar requisição (JSON)'}
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaving((s) => !s)} disabled={!sendBody}>
              Salvar cenário
            </button>
          </div>

          {saving && (
            <form
              className="save-row"
              onSubmit={(e) => {
                e.preventDefault();
                void saveScenario(!scenario.id);
              }}
            >
              <input autoFocus className="input" placeholder={scenario.name ?? 'Nome do cenário, ex: Reembolso > 500'} value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} />
              {scenario.id && (
                <button type="button" className="btn btn-sm" onClick={() => saveScenario(false)}>
                  Atualizar
                </button>
              )}
              <button type="submit" className="btn btn-sm btn-primary" disabled={!scenarioName.trim() && !scenario.id}>
                {scenario.id ? 'Salvar como novo' : 'Salvar'}
              </button>
            </form>
          )}

          {rawMode ? (
            <div className="field">
              <label className="field-label" htmlFor="raw-body">
                Requisição para {SYSTEMONE_PATH} (state, questions, model)
              </label>
              <textarea id="raw-body" className="input mono" rows={22} spellCheck={false} value={rawText} onChange={(e) => setRawText(e.target.value)} />
              {rawParsed?.error && <div className="field-error">{rawParsed.error}</div>}
              {preset.kind === 'recipe' && (
                <div className="field-help">Voltar ao formulário descarta estas edições (a receita não pode ser desmontada).</div>
              )}
            </div>
          ) : (
            <div className="fields">
              {preset.fields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={values[f.key]}
                  error={!built.ok ? built.errors[f.key] : undefined}
                  onChange={(v) => setValues({ ...values, [f.key]: v })}
                />
              ))}
            </div>
          )}

          <div className="send-row">
            <label className="retry">
              Tentativas extras
              <select className="input input-sm" value={retry} onChange={(e) => setRetry(Number(e.target.value))}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span className="bytes">{(bytes / 1024).toFixed(1)} KiB</span>
            <button type="button" className="btn btn-primary" disabled={!canSend} onClick={send} title="Ctrl/⌘ + Enter">
              {running ? 'Enviando…' : `Enviar para ${BACKEND_LABEL[backend]}`}
            </button>
          </div>
          {backend === 'jeff' && <JeffBanner jeff={jeff} />}
          {needsKey && (
            <div className="alert alert-warn">
              Configure sua API key da TypeSafe em <a href="#/settings">Configurações</a>, ou mude para o jeff local.
            </div>
          )}
        </section>

        <section className="panel output-panel">
          <div className="tabs">
            <button type="button" className={`tab${tab === 'request' ? ' is-active' : ''}`} onClick={() => setTab('request')}>
              Requisição
            </button>
            <button type="button" className={`tab${tab === 'response' ? ' is-active' : ''}`} onClick={() => setTab('response')}>
              Resposta {result && <span className={`dot ${result.ok ? 'dot-good' : 'dot-bad'}`} />}
            </button>
          </div>

          {tab === 'request' ? (
            <div className="request-view">
              <div className="endpoint">
                <span className="method">POST</span>
                <code>{endpoint}</code>
              </div>
              {preset.kind === 'recipe' && !rawMode && (
                <p className="muted small">
                  Receita do Studio: o formulário vira o <code>state</code> e estas <code>questions</code>. É exatamente isto
                  que vai para a API.
                </p>
              )}
              {request ? <JsonView value={request} /> : <div className="muted">Corrija os campos para ver a requisição.</div>}
              {request && (
                <div className="toolbar">
                  <CopyButton text={JSON.stringify(request, null, 2)} label="Copiar JSON" />
                  <CopyButton text={curlFor(endpoint, request, backend === 'typesafe' ? 'TYPESAFE_API_KEY' : target?.hasKey ? 'JEFF_API_KEY' : null)} label="Copiar cURL" />
                </div>
              )}
            </div>
          ) : running ? (
            <div className="loading">Consultando {BACKEND_LABEL[backend]}…</div>
          ) : requestError ? (
            <ErrorBox error={requestError} />
          ) : result ? (
            <ResultView entry={result} />
          ) : (
            <div className="muted">Envie a requisição para ver as respostas aqui.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function PresetHeader({ preset }: { preset: Preset }) {
  return (
    <header className="preset-header">
      <div className="preset-kind">{preset.kind === 'recipe' ? 'Receita' : 'API oficial'}</div>
      <h2>{preset.question}</h2>
      <p className="muted">{preset.summary}</p>
      {preset.decisions.length > 0 && (
        <div className="decisions-hint">
          {preset.decisions.map((d) => (
            <code key={d}>{d}</code>
          ))}
        </div>
      )}
    </header>
  );
}
