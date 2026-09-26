import { useEffect, useState } from 'react';
import {
  DEFAULT_JEFF_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TYPESAFE_BASE_URL,
  type Backend,
  type ConfigUpdate,
  type ConfigView,
} from '@jev/core';
import { JeffPanel } from '../../components/JeffPanel';
import { ErrorBox, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import type { JeffControl } from '../../lib/jeff';

interface Props {
  config: ConfigView | undefined;
  error: Error | null;
  onChange: (c: ConfigView) => void;
  jeff: JeffControl;
}

const OPTIONS: { id: Backend; title: string; desc: string }[] = [
  { id: 'typesafe', title: 'TypeSafe (oficial)', desc: 'api.typesafe.ai — o Jev de verdade, precisa de chave' },
  { id: 'jeff', title: 'jeff (local)', desc: 'reimplementação da comunidade, num container Docker na sua máquina' },
];

const DEFAULT_URL: Record<Backend, string> = { typesafe: DEFAULT_TYPESAFE_BASE_URL, jeff: DEFAULT_JEFF_BASE_URL };

export function Settings({ config, error, onChange, jeff }: Props) {
  const toast = useToast();
  const [failure, setFailure] = useState<Error | null>(null);

  async function update(input: ConfigUpdate, message: string) {
    try {
      setFailure(null);
      onChange(await api.updateConfig(input));
      toast(message);
      return true;
    } catch (err) {
      setFailure(err as Error);
      return false;
    }
  }

  const backend = config?.backend ?? 'typesafe';

  return (
    <div className="page narrow">
      <header className="page-header">
        <div>
          <h1>Configurações</h1>
          <p className="muted">As chaves ficam só no servidor local do Studio; o navegador nunca as recebe.</p>
        </div>
      </header>

      <ErrorBox error={error ?? failure} />

      <section className="panel">
        <h3 className="section-title">Backend</h3>
        <p className="muted small">
          Os dois falam o mesmo formato oficial (<code>POST /v1/systemone</code>), então todas as rotas funcionam nos dois.
          O jeff usa outro modelo (GLiFormer): serve para testar sem gastar cota, mas as respostas não valem como
          referência do Jev.
        </p>
        <div className="backend-options">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`backend-option${backend === opt.id ? ' is-active' : ''}`}
              onClick={async () => {
                if (opt.id === backend) return;
                if (await update({ backend: opt.id }, `Backend: ${opt.title}`)) setTimeout(() => void jeff.refresh(), 600);
              }}
            >
              <strong>{opt.title}</strong>
              <span className="muted small">{opt.desc}</span>
            </button>
          ))}
        </div>
      </section>

      {config && backend === 'jeff' && <JeffSection config={config} jeff={jeff} update={update} />}

      {config && <BackendPanel key={backend} backend={backend} config={config} update={update} />}

      {config && <ModelPanel config={config} update={update} />}

      {config && (
        <section className="panel">
          <h3 className="section-title">Dados locais</h3>
          <p className="muted small">
            Histórico, cenários e chaves salvas ficam em <code>{config.dataDir}</code> (fora do git).
          </p>
        </section>
      )}
    </div>
  );
}

function BackendPanel({
  backend,
  config,
  update,
}: {
  backend: Backend;
  config: ConfigView;
  update: (input: ConfigUpdate, message: string) => Promise<boolean>;
}) {
  const view = config.backends[backend];
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  useEffect(() => setBaseUrl(view.baseUrl), [view.baseUrl]);

  const name = backend === 'typesafe' ? 'TypeSafe' : 'jeff';

  return (
    <section className="panel">
      <h3 className="section-title">{name}</h3>

      <label className="field-label" htmlFor="base-url">
        Base URL
      </label>
      <form
        className="save-row"
        onSubmit={(e) => {
          e.preventDefault();
          void update({ backends: { [backend]: { baseUrl } } }, 'Base URL atualizada');
        }}
      >
        <input id="base-url" className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBaseUrl(DEFAULT_URL[backend])}>
          Padrão
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!baseUrl || baseUrl === view.baseUrl}>
          Salvar
        </button>
      </form>

      <label className="field-label" htmlFor="api-key">
        API key{' '}
        {backend === 'jeff' && (
          <span className="muted small">(opcional — se definir, o container do Studio passa a exigir essa chave)</span>
        )}
      </label>
      {view.hasKey ? (
        <p className="small">
          <code className="key">{view.maskedKey}</code>{' '}
          <span className="muted">— {view.keySource === 'env' ? `variável de ambiente ${view.keyEnv}` : 'salva pelo Studio'}</span>
        </p>
      ) : backend === 'typesafe' ? (
        <p className="alert alert-warn">Nenhuma chave da TypeSafe configurada.</p>
      ) : null}
      {view.keySource === 'env' && <p className="muted small">A variável de ambiente tem prioridade sobre a chave salva aqui.</p>}

      <form
        className="save-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await update({ backends: { [backend]: { apiKey: key } } }, 'Chave salva')) setKey('');
        }}
      >
        <input
          id="api-key"
          className="input"
          type={showKey ? 'text' : 'password'}
          placeholder={backend === 'typesafe' ? 'Cole sua chave da TypeSafe' : 'Ex: devkey'}
          value={key}
          autoComplete="off"
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowKey((s) => !s)}>
          {showKey ? 'Ocultar' : 'Mostrar'}
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!key.trim()}>
          Salvar chave
        </button>
      </form>

      <div className="toolbar">
        {backend === 'typesafe' ? (
          <a className="link small" href="https://docs.typesafe.ai/api" target="_blank" rel="noreferrer">
            Documentação oficial da API ↗
          </a>
        ) : (
          <a className="link small" href="https://github.com/jarihu/jeff" target="_blank" rel="noreferrer">
            Repositório do jeff ↗
          </a>
        )}
        <span className="spacer" />
        {view.keySource === 'studio-config' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => update({ backends: { [backend]: { apiKey: null } } }, 'Chave removida')}>
            Remover chave salva
          </button>
        )}
      </div>
    </section>
  );
}

function JeffSection({
  config,
  jeff,
  update,
}: {
  config: ConfigView;
  jeff: JeffControl;
  update: (input: ConfigUpdate, message: string) => Promise<boolean>;
}) {
  const auto = config.jeff;
  return (
    <section className="panel">
      <h3 className="section-title">jeff local</h3>
      <JeffPanel jeff={jeff} />
      <div className="checks">
        <label className="check">
          <input
            type="checkbox"
            checked={auto.autoStart}
            onChange={(e) => void update({ jeff: { autoStart: e.target.checked } }, e.target.checked ? 'Ligar automático: ativado' : 'Ligar automático: desativado')}
          />
          <span>
            <strong>Ligar automaticamente</strong>
            <span className="muted small"> — ao abrir o Studio com o jeff como backend, e ao trocar para o jeff</span>
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={auto.autoStop}
            onChange={(e) => void update({ jeff: { autoStop: e.target.checked } }, e.target.checked ? 'Desligar automático: ativado' : 'Desligar automático: desativado')}
          />
          <span>
            <strong>Desligar automaticamente</strong>
            <span className="muted small"> — ao fechar o Studio e ao trocar para a TypeSafe (libera ~2 GB de memória)</span>
          </span>
        </label>
      </div>
    </section>
  );
}

function ModelPanel({ config, update }: { config: ConfigView; update: (input: ConfigUpdate, message: string) => Promise<boolean> }) {
  const [model, setModel] = useState(config.model);
  useEffect(() => setModel(config.model), [config.model]);
  return (
    <section className="panel">
      <h3 className="section-title">Modelo</h3>
      <form
        className="save-row"
        onSubmit={(e) => {
          e.preventDefault();
          void update({ model }, 'Modelo atualizado');
        }}
      >
        <input className="input mono" value={model} onChange={(e) => setModel(e.target.value)} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModel(DEFAULT_MODEL)}>
          Padrão
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!model.trim() || model === config.model}>
          Salvar
        </button>
      </form>
      <p className="muted small">
        Vai no campo <code>model</code> de toda requisição. <code>jev-latest</code> é o modelo principal da TypeSafe e também é
        aceito pelo jeff. Numa requisição em JSON cru, um <code>model</code> próprio tem prioridade.
      </p>
    </section>
  );
}
