# JEV Studio

Interface gráfica para montar, testar e comparar chamadas ao **Jev**, o modelo System One da
TypeSafe, pela **API oficial** (`POST https://api.typesafe.ai/v1/systemone`). Também funciona com o
[jeff](https://github.com/jarihu/jeff), uma reimplementação local que fala o mesmo formato.

- **Playground**: 5 receitas prontas (tool-guard, route, model-route, research, completion) e a
  API nativa crua. A requisição exata aparece ao lado e pode ser editada como JSON.
- **Histórico** de todas as chamadas, com o backend usado: reabrir no Playground e comparar duas lado a lado
- **Cenários** salvos: rodar um ou "Executar todos", como teste de regressão rápido
- **Configurações**: backend (TypeSafe ou jeff), base URL e chave de cada um, modelo
- **jeff no Docker**: ligar/desligar pela interface (ou automaticamente), com status e logs ao vivo

## Rodar

Requer Node 18.17+. Uma vez, dentro da pasta `studio`, instale o comando `jev-studio`:

```bash
node bin/jev-studio.mjs install    # cria ~/.local/bin/jev-studio
```

Depois, de **qualquer pasta**:

```bash
jev-studio            # instala e compila na 1ª vez, abre em http://localhost:5174
jev-studio --open     # idem, e abre o navegador
jev-studio dev        # desenvolvimento com hot reload (http://localhost:5173)
jev-studio help       # todos os comandos
```

Se `~/.local/bin` não estiver no PATH, o `install` mostra a linha para adicionar. Alternativa: `npm link`
(usa o campo `bin` do package.json; pode pedir sudo, dependendo de onde o Node foi instalado).

Sem o atalho, dentro da pasta: `npm install`, depois `npm run dev`, ou `npm run build && npm start`.

## Backends

Os dois falam o formato oficial, então **todas as rotas funcionam nos dois**:

| | TypeSafe (oficial) | jeff (local) |
|---|---|---|
| Endereço | `https://api.typesafe.ai` | `http://localhost:8000` |
| Modelo | o Jev (`jev-latest`) | GLiFormer, da comunidade |
| Chave | obrigatória (`TYPESAFE_API_KEY`) | opcional (`JEFF_API_KEY`) |
| Roda | na nuvem da TypeSafe | num container Docker que o Studio liga e desliga |
| Serve para | ver o que o Jev realmente responde | testar sem gastar cota |

As respostas do jeff **não valem como referência do Jev**: é outro modelo, mais fraco em tarefas que
exigem raciocínio (veja os benchmarks no README do jeff).

A chave e a URL podem vir da tela **Configurações** (salvas em `studio/data/config.v2.json`, permissão 600)
ou de variáveis de ambiente, que têm prioridade. Os nomes seguem o SDK oficial:

| Variável | Padrão |
|---|---|
| `TYPESAFE_API_KEY` | — |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` |
| `JEFF_API_KEY` / `JEFF_BASE_URL` | — / `http://localhost:8000` |

> A chave do **jevai.org** (Jev AI Community) é de um site da comunidade, não da TypeSafe, e não
> deve funcionar na API oficial.

### jeff no Docker

O jeff exige Python 3.12 (não roda no 3.13+), então o Studio o coloca num container: não importa qual Python
você tem. Precisa só do Docker com o Compose v2:

```bash
# Ubuntu: https://docs.docker.com/engine/install/ubuntu/  — depois, para usar sem sudo:
sudo usermod -aG docker $USER      # e faça logout/login
docker compose version             # precisa responder v2.x; senão: sudo apt install docker-compose-v2
```

**Pela interface:** Configurações → Backend → **jeff (local)** → **Ligar jeff**. O painel mostra o que está
acontecendo e os logs ao vivo; no Playground, se o jeff estiver desligado, aparece um botão para ligá-lo.

- **Primeira vez:** monta a imagem (Python 3.12, PyTorch versão CPU e o jeff — alguns minutos) e baixa o modelo
  (~1,7 GB, fica num volume do Docker). Depois liga em segundos.
- **Ligar automaticamente** (padrão: ativado): ao abrir o Studio com o jeff como backend e ao trocar para o jeff.
- **Desligar automaticamente** (padrão: desativado): ao fechar o Studio (Ctrl+C) e ao trocar para a TypeSafe.
  O jeff ocupa ~2 GB de memória enquanto está ligado.
- Se você salvar uma chave do jeff no Studio, o container passa a exigi-la (`JEFF_API_KEYS`). Sem chave, fica sem
  autenticação — ele só escuta em `127.0.0.1`.
- A porta vem da base URL do jeff (`http://localhost:8001` → porta 8001).

**Pelo terminal** (mesmo container, mesma configuração):

```bash
jev-studio jeff start     # liga e espera ficar pronto
jev-studio jeff status
jev-studio jeff logs -f
jev-studio jeff stop
jev-studio jeff update    # reconstrói com a versão mais nova do jeff
jev-studio jeff remove    # apaga container, imagem e modelo (~5 GB)
```

Os arquivos estão em `docker/jeff/` (`Dockerfile`, `compose.yml`, `entrypoint.sh`). Um jeff que você suba por
conta própria no mesmo endereço também funciona: o Studio detecta que ele responde e só não o liga/desliga.

## Receitas

A API oficial tem um único endpoint: você manda um `state` (texto ou JSON) e `questions` de três
tipos — `choice` (escolher uma opção), `score` (nota numa escala de 2 a 10 níveis) e `noul`
(probabilidade de "sim"). As rotas prontas do Studio são **receitas**: cada uma transforma um
formulário simples em `state` + `questions`. Por exemplo, o tool-guard vira:

- `decision` — choice: `allow | confirm | review | deny`
- `needs_confirmation` — noul
- `risk` — score em 4 níveis

A ideia veio das receitas da comunidade (jevai.org), mas os prompts são do Studio e ficam à vista: a
aba **Requisição** mostra exatamente o que vai para a API, e "Editar requisição (JSON)" permite
mudar qualquer pergunta antes de enviar. Para criar ou ajustar uma receita, edite
`packages/core/src/presets/catalog.ts`.

## Arquitetura

Monorepo com **npm workspaces**. Backend hexagonal (ports & adapters), front dirigido por schema.

```
studio/
  packages/core/              # fonte única da verdade, sem dependência de framework
    src/systemone/types.ts    #   tipos oficiais: request, questions, answers
    src/systemone/client.ts   #   cliente de /v1/systemone (retry, Retry-After, erros)
    src/systemone/summary.ts  #   resposta -> resumo (histórico, badges)
    src/presets/catalog.ts    #   as receitas + a API nativa
    src/presets/body.ts       #   formulário -> body -> requisição oficial, validação
    src/api-contract.ts       #   tipos compartilhados entre api e web
  apps/api/                   # servidor local (node:http, sem framework)
    src/ports/                #   interfaces: SystemOneGateway, JeffRuntime, SettingsStore, Repository
    src/services/             #   casos de uso: DecisionService, JeffService, ScenarioService, ConfigService
    src/adapters/             #   HttpSystemOneGateway (TypeSafe e jeff), DockerJeffRuntime, arquivos JSON
    src/http/                 #   router + rotas REST + arquivos estáticos
    src/server.ts             #   composition root
  apps/web/                   # React + Vite
  docker/jeff/                # imagem e compose do jeff (Python 3.12, PyTorch CPU)
  bin/jev-studio.mjs          # o comando jev-studio
```

**Por que assim**

- **Um único adapter de saída.** TypeSafe e jeff têm o mesmo formato; trocar de backend é trocar URL e chave.
- **Receitas são dados + uma função `compile`.** Formulário, validação, tipos e perguntas saem da mesma definição.
- **As chaves ficam no servidor local.** O navegador só vê a versão mascarada, e a API só responde a `localhost`.
- **O Docker é só mais um adapter.** `JeffRuntime` é a porta; `DockerJeffRuntime` roda comandos fixos do
  `docker compose` (sem shell, nada da requisição entra neles).

### API local

| Método | Rota | |
|---|---|---|
| POST | `/api/decisions/:preset` | `{ body, raw?, retry?, timeoutMs?, scenarioId? }` → registro do histórico |
| POST | `/api/decisions/:preset/preview` | mesma entrada → a requisição oficial, sem enviar |
| GET/DELETE | `/api/history[/:id]` | listar, ver, apagar |
| GET/POST/PUT/DELETE | `/api/scenarios[/:id]` | CRUD de cenários |
| GET/PUT | `/api/config` | `{ backend?, model?, backends?: { typesafe?: {baseUrl?, apiKey?}, jeff?: {...} }, jeff?: { autoStart?, autoStop? } }` |
| GET | `/api/jeff` | estado do container: `phase` (`no-docker`, `stopped`, `building`, `starting`, `ready`, …), `message`, `reachable` |
| POST | `/api/jeff/start` · `/api/jeff/stop` | liga/desliga (responde na hora; acompanhe pelo GET) |
| GET | `/api/jeff/logs?tail=200` | logs da montagem e do container |

Com `raw: true`, `body` é a requisição oficial completa (`state`, `questions`, `model` opcional).

## Scripts

| Comando | |
|---|---|
| `npm run dev` | API + Vite com reload |
| `npm run build` / `npm start` | produção local |
| `npm test` | testes (core + api + jeff/Docker simulado) com `node:test` |
| `npm run jeff -- start` | o mesmo que `jev-studio jeff start` |
| `npm run typecheck` | `tsc` em todos os pacotes |

Outras variáveis: `PORT` (5174), `JEV_STUDIO_DATA` (pasta de dados), `JEV_HISTORY_LIMIT` (300).
