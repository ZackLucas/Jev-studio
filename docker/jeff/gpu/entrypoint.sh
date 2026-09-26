#!/bin/sh
# Downloads the model into the /models volume on first start, then runs jeff.
set -e

if [ ! -f "$JEFF_MODEL/gliner_config.json" ]; then
  echo "[jev-studio] Baixando o modelo $JEFF_MODEL_REPO (so na primeira vez, cerca de 1,7 GB)..."
  python - <<'EOF'
import os
from huggingface_hub import snapshot_download

snapshot_download(
    os.environ["JEFF_MODEL_REPO"],
    local_dir=os.environ["JEFF_MODEL"],
    ignore_patterns=["*.gif", "*.md"],
)
EOF
  echo "[jev-studio] Modelo baixado."
fi

echo "[jev-studio] Carregando o modelo..."
exec jeff
