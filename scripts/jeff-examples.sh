#!/usr/bin/env bash
#
# Exemplos de uso do jeff por HTTP — sem o Studio.
#
# Suba o container antes (uma vez):
#   docker compose -f docker/jeff/gpu/compose.yml up -d      # ou cpu/
#
# Uso:
#   bash scripts/jeff-examples.sh                 # roda todos os exemplos
#   bash scripts/jeff-examples.sh score choice    # só alguns
#   JEFF_URL=http://localhost:8001 JEFF_API_KEY=devkey bash scripts/jeff-examples.sh
#
# Comandos: health models stats score choice noul mixed
#
# Lembrete dos `criteria` (o erro 422 mais comum):
#   score  -> LISTA:  ["cosmetic", "degraded", "blocking"]
#   choice -> OBJETO: {"frontend": "UI/UX code", "backend": null}
#   noul   -> OBJETO: {"true": "needs a fix", "false": "works fine"}
set -euo pipefail

BASE="${JEFF_URL:-http://localhost:8000}"
KEY="${JEFF_API_KEY:-}"
AUTH=()
[ -n "$KEY" ] && AUTH=(-H "Authorization: Bearer $KEY")

command -v curl >/dev/null || { echo "precisa do curl instalado" >&2; exit 1; }

pretty() {
  if command -v python3 >/dev/null; then python3 -m json.tool; else cat; fi
}

api() { # api METHOD PATH [JSON_BODY]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "$BASE$path" "${AUTH[@]}" -H 'Content-Type: application/json' -d "$body"
  else
    curl -sS -X "$method" "$BASE$path" "${AUTH[@]}"
  fi
}

hr() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

health() { hr "GET /healthz"; api GET /healthz; echo; }

models() { hr "GET /v1/models"; api GET /v1/models | pretty; }

stats() { hr "GET /stats — confirme \"device\": \"cuda\" quando usar a imagem de GPU"; api GET /stats | pretty; }

score() {
  hr "score — criteria é uma LISTA de níveis"
  api POST /v1/systemone '{
    "state": "The export button crashes in Safari.",
    "model": "jev-latest",
    "questions": {
      "severity": { "type": "score", "instructions": "How severe?",
                    "criteria": ["cosmetic", "degraded", "blocking"] }
    }
  }' | pretty
}

choice() {
  hr "choice — criteria é um OBJETO {opção: descrição|null}"
  api POST /v1/systemone '{
    "state": {"ticket": "Export button crashes in Safari", "browser": "Safari 18"},
    "model": "jev-latest",
    "questions": {
      "owner": { "type": "choice", "instructions": "Who should handle it?",
                 "criteria": { "frontend": "UI/UX code", "backend": "servers and APIs", "infra": null } }
    }
  }' | pretty
}

noul() {
  hr "noul — criteria opcional {true, false}"
  api POST /v1/systemone '{
    "state": {"ticket": "Export button crashes in Safari", "browser": "Safari 18"},
    "model": "jev-latest",
    "questions": {
      "needs_fix": { "type": "noul", "instructions": "Does it need a fix?",
                     "criteria": {"true": "needs a fix", "false": "works fine"} }
    }
  }' | pretty
}

mixed() {
  hr "mixed — state JSON + score + noul + choice numa só chamada"
  api POST /v1/systemone '{
    "state": {"ticket": "Export button crashes in Safari", "browser": "Safari 18"},
    "model": "jev-latest",
    "questions": {
      "severity":  { "type": "score",  "instructions": "How severe?", "criteria": ["cosmetic", "degraded", "blocking"] },
      "needs_fix": { "type": "noul",   "instructions": "Does it need a fix?",
                     "criteria": {"true": "needs a fix", "false": "works fine"} },
      "owner":     { "type": "choice", "instructions": "Who should handle it?",
                     "criteria": {"frontend": "UI/UX code", "backend": "servers and APIs", "infra": null} }
    }
  }' | pretty
}

usage() {
  sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "$#" -eq 0 ]; then
  set -- health models stats score choice noul mixed
fi

for c in "$@"; do
  case "$c" in
    health | models | stats | score | choice | noul | mixed) "$c" ;;
    all) health; models; stats; score; choice; noul; mixed ;;
    -h | --help | help) usage; exit 0 ;;
    *) echo "comando desconhecido: $c (use: health models stats score choice noul mixed)" >&2; exit 1 ;;
  esac
done
echo
