import { useMemo, useState } from 'react';
import { PRESETS, getPreset, type HistoryEntry } from '@jev/core';
import { ResultView } from '../../components/ResultView';
import { DecisionBadge, Empty, ErrorBox, JsonView, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { BACKEND_LABEL, changedKeys, ms, pct, summaryLabel, timeAgo } from '../../lib/format';

interface Props {
  entries: HistoryEntry[] | undefined;
  error: Error | null;
  reload: () => void;
  onOpen: (entry: HistoryEntry) => void;
}

export function History({ entries, error, reload, onOpen }: Props) {
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);

  const list = useMemo(() => (entries ?? []).filter((e) => filter === 'all' || e.presetId === filter), [entries, filter]);
  const current = list.find((e) => e.id === selected) ?? null;
  const pair = compare.map((id) => entries?.find((e) => e.id === id)).filter(Boolean) as HistoryEntry[];

  const toggleCompare = (id: string) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id]));

  async function remove(id: string) {
    await api.deleteHistory(id);
    if (selected === id) setSelected(null);
    setCompare((c) => c.filter((x) => x !== id));
    reload();
  }

  async function clearAll() {
    if (!confirm('Apagar todo o histórico?')) return;
    await api.clearHistory();
    setSelected(null);
    setCompare([]);
    reload();
    toast('Histórico apagado');
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Histórico</h1>
          <p className="muted">Toda chamada feita pelo Studio fica aqui. Marque duas para comparar.</p>
        </div>
        <div className="toolbar">
          <select className="input input-sm" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar por rota">
            <option value="all">Todas as rotas</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll} disabled={!entries?.length}>
            Limpar tudo
          </button>
        </div>
      </header>

      <ErrorBox error={error} />

      {pair.length === 2 && <Compare a={pair[0]!} b={pair[1]!} onClose={() => setCompare([])} />}

      {!list.length ? (
        <Empty title="Nenhuma chamada ainda">Envie uma requisição no Playground.</Empty>
      ) : (
        <div className="split split-wide">
          <div className="panel table-panel">
            <table className="table">
              <thead>
                <tr>
                  <th aria-label="Comparar" />
                  <th>Rota</th>
                  <th>Backend</th>
                  <th>Decisão</th>
                  <th>Confiança</th>
                  <th>Latência</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} className={e.id === selected ? 'is-selected' : ''} onClick={() => setSelected(e.id)}>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox" checked={compare.includes(e.id)} onChange={() => toggleCompare(e.id)} aria-label="Comparar" />
                    </td>
                    <td>{getPreset(e.presetId)?.title ?? e.presetId}</td>
                    <td className="muted">{BACKEND_LABEL[e.backend] ?? e.backend}</td>
                    <td>
                      {e.ok ? (
                        e.summary.type === 'choice' ? <DecisionBadge value={e.summary.decision} /> : <span className="muted">{summaryLabel(e.summary) ?? '—'}</span>
                      ) : (
                        <span className="badge tone-bad" title={e.error?.message}>{e.error?.type ?? 'erro'}</span>
                      )}
                    </td>
                    <td>{pct(e.summary.confidence)}</td>
                    <td>{ms(e.elapsedMs)}</td>
                    <td className="muted">{timeAgo(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            {current ? (
              <>
                <div className="toolbar">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpen(current)}>
                    Abrir no Playground
                  </button>
                  <span className="spacer" />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(current.id)}>
                    Excluir
                  </button>
                </div>
                <ResultView entry={current} />
                <h3 className="section-title">Requisição enviada</h3>
                <JsonView value={current.request} maxHeight={320} />
              </>
            ) : (
              <div className="muted">Selecione uma chamada para ver os detalhes.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Compare({ a, b, onClose }: { a: HistoryEntry; b: HistoryEntry; onClose: () => void }) {
  const diff = changedKeys(a.input, b.input);
  return (
    <section className="panel compare">
      <div className="toolbar">
        <h3 className="section-title">Comparação</h3>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Fechar
        </button>
      </div>
      <p className="muted">
        {diff.length ? (
          <>
            Campos diferentes: {diff.map((k) => <code key={k}>{k}</code>)}
          </>
        ) : (
          'Os corpos das requisições são idênticos.'
        )}
      </p>
      <div className="compare-grid">
        {[a, b].map((e) => (
          <div key={e.id}>
            <div className="muted small">
              {getPreset(e.presetId)?.title} · {timeAgo(e.createdAt)}
            </div>
            <ResultView entry={e} />
            {diff.length > 0 && <JsonView value={Object.fromEntries(diff.map((k) => [k, e.input[k]]))} maxHeight={220} />}
          </div>
        ))}
      </div>
    </section>
  );
}
