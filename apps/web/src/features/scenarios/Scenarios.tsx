import { useMemo, useState } from 'react';
import { PRESETS, getPreset, type HistoryEntry, type Scenario } from '@jev/core';
import { DecisionBadge, Empty, ErrorBox, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { ms, pct, summaryLabel, timeAgo } from '../../lib/format';

interface Props {
  scenarios: Scenario[] | undefined;
  error: Error | null;
  hasKey: boolean;
  reload: () => void;
  onOpen: (s: Scenario) => void;
  onRan: () => void;
}

type RunState = Record<string, { running?: boolean; entry?: HistoryEntry; error?: string }>;

export function Scenarios({ scenarios, error, hasKey, reload, onOpen, onRan }: Props) {
  const toast = useToast();
  const [runs, setRuns] = useState<RunState>({});
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const groups = useMemo(
    () =>
      PRESETS.map((p) => ({ preset: p, items: (scenarios ?? []).filter((s) => s.presetId === p.id) })).filter(
        (g) => g.items.length,
      ),
    [scenarios],
  );

  async function run(s: Scenario) {
    setRuns((r) => ({ ...r, [s.id]: { running: true } }));
    try {
      const entry = await api.run(s.presetId, { body: s.body, raw: s.raw, retry: 1, scenarioId: s.id });
      setRuns((r) => ({ ...r, [s.id]: { entry } }));
    } catch (err) {
      setRuns((r) => ({ ...r, [s.id]: { error: (err as Error).message } }));
    }
  }

  /** Run a group sequentially (gentle on rate limits) — a quick regression check. */
  async function runAll(items: Scenario[]) {
    for (const s of items) await run(s);
    onRan();
  }

  async function remove(s: Scenario) {
    if (!confirm(`Excluir o cenário "${s.name}"?`)) return;
    await api.deleteScenario(s.id);
    reload();
  }

  async function rename() {
    if (!renaming) return;
    const s = scenarios?.find((x) => x.id === renaming.id);
    if (!s || !renaming.name.trim()) return;
    try {
      await api.updateScenario(s.id, { name: renaming.name.trim(), presetId: s.presetId, body: s.body, raw: s.raw, notes: s.notes });
      setRenaming(null);
      reload();
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Cenários</h1>
          <p className="muted">
            Entradas salvas para repetir testes. "Executar todos" roda o grupo em sequência e mostra a decisão de cada um.
          </p>
        </div>
      </header>

      <ErrorBox error={error} />

      {!groups.length && <Empty title="Nenhum cenário salvo">No Playground, preencha uma rota e clique em "Salvar cenário".</Empty>}

      {groups.map(({ preset, items }) => (
        <section key={preset.id} className="panel scenario-group">
          <div className="toolbar">
            <h3 className="section-title">{preset.title}</h3>
            <span className="muted small">{items.length} cenário(s)</span>
            <span className="spacer" />
            <button type="button" className="btn btn-sm" disabled={!hasKey} onClick={() => runAll(items)}>
              Executar todos
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Última decisão</th>
                <th>Confiança</th>
                <th>Latência</th>
                <th>Atualizado</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const r = runs[s.id];
                return (
                  <tr key={s.id}>
                    <td>
                      {renaming?.id === s.id ? (
                        <form
                          className="inline-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void rename();
                          }}
                        >
                          <input autoFocus className="input input-sm" value={renaming.name} onChange={(e) => setRenaming({ id: s.id, name: e.target.value })} onBlur={() => setRenaming(null)} />
                        </form>
                      ) : (
                        <button type="button" className="link" onClick={() => onOpen(s)}>
                          {s.name}
                        </button>
                      )}
                    </td>
                    <td>
                      {r?.running ? (
                        <span className="muted">rodando…</span>
                      ) : r?.error ? (
                        <span className="badge tone-bad" title={r.error}>erro</span>
                      ) : r?.entry ? (
                        r.entry.ok ? (
                          r.entry.summary.type === 'choice' ? (
                            <DecisionBadge value={r.entry.summary.decision} />
                          ) : (
                            <span className="muted">{summaryLabel(r.entry.summary) ?? '—'}</span>
                          )
                        ) : (
                          <span className="badge tone-bad" title={r.entry.error?.message}>{r.entry.error?.type ?? 'erro'}</span>
                        )
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{pct(r?.entry?.summary.confidence)}</td>
                    <td>{ms(r?.entry?.elapsedMs)}</td>
                    <td className="muted">{timeAgo(s.updatedAt)}</td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!hasKey || r?.running} onClick={() => run(s).then(onRan)}>
                        Executar
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(s)}>
                        Abrir
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming({ id: s.id, name: s.name })}>
                        Renomear
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(s)}>
                        Excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
      {scenarios && scenarios.some((s) => !getPreset(s.presetId)) && (
        <div className="alert alert-warn">Alguns cenários usam rotas que não existem mais.</div>
      )}
    </div>
  );
}
