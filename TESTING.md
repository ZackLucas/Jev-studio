# Como testar o JEV Studio

## 1. Testes automáticos

```bash
jev-studio test        # ou, dentro da pasta: npm test
npm run typecheck      # tipos de core, api e web
```

São 43 testes com `node:test`: receitas e cliente da API oficial (core), rotas e serviços da API local, e o
controle do jeff com um Docker simulado (estados, erros de instalação/permissão, liga/desliga automático).
Nenhum deles chama a TypeSafe nem precisa de Docker.

## 2. Pela interface, com o jeff (sem gastar cota)

1. `jev-studio` e abra http://localhost:5174
2. **Configurações → Backend → jeff (local)**. Com "Ligar automaticamente" ativado (padrão), ele já começa a
   ligar; senão, clique em **Ligar jeff**. Na primeira vez leva alguns minutos (imagem + modelo de ~1,7 GB) —
   clique em **Ver logs** para acompanhar. Em **Dispositivo** você escolhe CPU (padrão em máquina sem NVIDIA) ou
   GPU; o automático usa a GPU quando o Docker enxerga uma (`sudo bash scripts/setup-nvidia-docker.sh` uma vez).
3. Quando aparecer **Ligado**, vá ao **Playground**, escolha uma receita, clique em **Exemplo** e em
   **Enviar para jeff**.
4. Confira:
   - a aba **Requisição** mostra o JSON exato enviado para `/v1/systemone`;
   - a aba **Resposta** mostra um cartão por pergunta: `choice` com barras de probabilidade, `score` com os
     níveis, `noul` com o medidor;
   - **Editar requisição (JSON)** permite mudar qualquer pergunta antes de enviar;
   - **Salvar cenário** e depois **Cenários → Executar todos** repete as chamadas;
   - **Histórico** registra cada chamada com o backend usado.
5. Desligue o jeff em Configurações e volte ao Playground: aparece o aviso "O jeff está desligado" com o botão
   **Ligar jeff**.

Pelo terminal: `jev-studio jeff start`, `jev-studio jeff status`, `jev-studio jeff logs -f`, `jev-studio jeff stop`.

Teste direto no jeff (sem o Studio), com o container ligado:

```bash
curl http://localhost:8000/healthz
curl http://localhost:8000/v1/systemone -H 'Content-Type: application/json' -d '{
  "state": "O botão de exportar trava no Safari.", "model": "jev-latest",
  "questions": { "severidade": { "type": "score", "instructions": "Quão grave?",
                                 "criteria": ["cosmético", "atrapalha", "bloqueia"] } } }'
```

(Se você salvou uma chave do jeff no Studio, acrescente `-H 'Authorization: Bearer SUA_CHAVE'`.)

Há um script pronto com esses exemplos (health, modelos, stats e cada tipo de pergunta):

```bash
bash scripts/jeff-examples.sh          # tudo; ou: bash scripts/jeff-examples.sh score choice
JEFF_URL=http://localhost:8001 JEFF_API_KEY=devkey bash scripts/jeff-examples.sh
```

## 3. Com a API oficial da TypeSafe

1. Use uma chave da TypeSafe (veja https://docs.typesafe.ai). A chave do jevai.org é de um site da comunidade e não serve aqui.
2. **Configurações → Backend → TypeSafe (oficial)**, cole a chave e salve — ou rode com
   `TYPESAFE_API_KEY=... jev-studio`.
3. Repita o passo 4 acima. Compare no **Histórico** a mesma receita respondida pelos dois backends.

## Pela API local (curl)

```bash
curl localhost:5174/api/jeff                                   # estado do jeff
curl -X POST localhost:5174/api/jeff/start
curl -X POST localhost:5174/api/decisions/tool-guard/preview \
  -H 'Content-Type: application/json' \
  -d '{"body":{"tool":"delete_user","action":"Apagar a conta do usuário 42"}}'   # requisição, sem enviar
curl -X POST localhost:5174/api/decisions/tool-guard \
  -H 'Content-Type: application/json' \
  -d '{"body":{"tool":"delete_user","action":"Apagar a conta do usuário 42"}}'   # envia ao backend ativo
```

Os campos de cada receita estão em `GET /api/presets` (ou no formulário do Playground).

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| Docker não está instalado | https://docs.docker.com/engine/install/ubuntu/ |
| Sem permissão para usar o Docker | `sudo usermod -aG docker $USER` e logout/login |
| O serviço do Docker está parado | `sudo systemctl start docker` |
| Falta o Docker Compose v2 | `sudo apt install docker-compose-v2` |
| A porta 8000 já está em uso | mude a base URL do jeff para `http://localhost:8001` e ligue de novo |
| Docker não usa a GPU | rode `sudo bash scripts/setup-nvidia-docker.sh` e reinicie o Docker; ou mude o Dispositivo do jeff para CPU |
| `jev-studio: command not found` | rode `node bin/jev-studio.mjs install` na pasta `studio` e siga a dica do PATH |
