import { useState } from 'react';
import { PRESETS, getPreset } from '@jev/core';
import { ToastProvider } from './components/ui';
import { History } from './features/history/History';
import { Playground, type Draft } from './features/playground/Playground';
import { Scenarios } from './features/scenarios/Scenarios';
import { Settings } from './features/settings/Settings';
import { api } from './lib/api';
import { BACKEND_LABEL } from './lib/format';
import { jeffDot, jeffLabel, useJeff } from './lib/jeff';
import { useHashRoute, useLoader } from './lib/hooks';

export function App() {
  const [[section = 'playground', sub], go] = useHashRoute();
  const config = useLoader(api.config);
  const history = useLoader(api.history);
  const scenarios = useLoader(api.scenarios);
  const [draft, setDraft] = useState<Draft | null>(null);

  const presetId = section === 'playground' && sub && getPreset(sub) ? sub : PRESETS[0]!.id;
  const openDraft = (d: Omit<Draft, 'nonce'>) => {
    setDraft({ ...d, nonce: Date.now() });
    go(`playground/${d.presetId}`);
  };

  const nav = [
    { id: 'playground', label: 'Playground', href: `#/playground/${presetId}` },
    { id: 'history', label: 'Histórico', href: '#/history', count: history.data?.length },
    { id: 'scenarios', label: 'Cenários', href: '#/scenarios', count: scenarios.data?.length },
    { id: 'settings', label: 'Configurações', href: '#/settings' },
  ];

  const backend = config.data?.backend ?? 'typesafe';
  const target = config.data?.backends[backend];
  // A local jeff may run without keys; the official API always needs one.
  const ready = Boolean(config.data) && (backend === 'jeff' || Boolean(target?.hasKey));
  // Follow the local jeff while it's the backend or the settings are open.
  const jeff = useJeff(Boolean(config.data) && (backend === 'jeff' || section === 'settings'));

  return (
    <ToastProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <span className="logo">J</span>
            <span>
              JEV <strong>Studio</strong>
            </span>
          </div>
          <nav className="nav">
            {nav.map((n) => (
              <a key={n.id} href={n.href} className={`nav-item${section === n.id ? ' is-active' : ''}`}>
                {n.label}
                {typeof n.count === 'number' && n.count > 0 && <span className="count">{n.count}</span>}
              </a>
            ))}
          </nav>
          <a href="#/settings" className={`key-status ${ready ? 'ok' : 'missing'}`}>
            <span className={`dot ${backend === 'jeff' && !config.error ? jeffDot(jeff.status) : ready ? 'dot-good' : 'dot-warn'}`} />
            <span>
              {config.error ? (
                'Servidor offline'
              ) : backend === 'jeff' ? (
                <>
                  {BACKEND_LABEL.jeff}
                  <span className="muted"> · {jeffLabel(jeff.status).toLowerCase()}</span>
                </>
              ) : (
                <>
                  {BACKEND_LABEL[backend]}
                  <span className="muted">
                    {' · '}
                    {target?.hasKey ? `chave ${target.maskedKey}` : 'sem API key'}
                  </span>
                </>
              )}
            </span>
          </a>
        </aside>

        <main className="main">
          {section === 'history' ? (
            <History
              entries={history.data}
              error={history.error}
              reload={history.reload}
              onOpen={(e) => openDraft({ presetId: e.presetId, body: e.input, raw: e.raw })}
            />
          ) : section === 'scenarios' ? (
            <Scenarios
              scenarios={scenarios.data}
              error={scenarios.error}
              hasKey={ready}
              reload={scenarios.reload}
              onRan={history.reload}
              onOpen={(s) => openDraft({ presetId: s.presetId, body: s.body, raw: s.raw, scenarioId: s.id, scenarioName: s.name })}
            />
          ) : section === 'settings' ? (
            <Settings config={config.data} error={config.error} onChange={config.setData} jeff={jeff} />
          ) : (
            <Playground
              presetId={presetId}
              draft={draft}
              config={config.data}
              jeff={jeff}
              onSelectPreset={(id) => go(`playground/${id}`)}
              onRan={history.reload}
              onScenarioSaved={scenarios.reload}
            />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
