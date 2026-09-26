#!/usr/bin/env bash
#
# Instala o NVIDIA Container Toolkit, para o Docker conseguir rodar o jeff na GPU.
# Rode UMA vez, como root:
#
#   sudo bash scripts/setup-nvidia-docker.sh
#
# Depois, no Studio: Configurações → jeff → Dispositivo = "Automático" (ou "GPU").
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode com sudo:  sudo bash $0" >&2
  exit 1
fi

echo "== 1/5 · Repositório do nvidia-container-toolkit =="
install -d -m 0755 /usr/share/keyrings
if [ ! -s /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg ]; then
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
fi

# Repositório sem codename de distro: funciona também em versões que a NVIDIA ainda não
# lista (ex.: Ubuntu 26.04). O instalador oficial falha nesses casos.
cat > /etc/apt/sources.list.d/nvidia-container-toolkit.list <<'EOF'
deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://nvidia.github.io/libnvidia-container/stable/deb/$(ARCH) /
EOF

# Sobra do instalador oficial em distro não suportada.
rm -f /etc/apt/sources.list.d/nvidia-docker.list

echo "== 2/5 · Instalando o nvidia-container-toolkit =="
apt-get update
apt-get install -y nvidia-container-toolkit

echo "== 3/5 · Configurando o Docker =="
# Runtime `nvidia` (caminho antigo) e, principalmente, o CDI que o Docker 25+ usa.
nvidia-ctk runtime configure --runtime=docker
install -d -m 0755 /etc/cdi
# Reinicia o serviço do toolkit para ele gerar/atualizar /etc/cdi/nvidia.yaml.
systemctl restart nvidia-cdi-refresh.path 2>/dev/null || true
nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml

echo "== 4/5 · Reiniciando o Docker =="
systemctl restart docker || service docker restart

echo "== 5/5 · Testando a GPU no Docker =="
if docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi; then
  echo
  echo "Pronto! O Docker já enxerga a GPU."
  echo "No Studio: Configurações → jeff → Dispositivo = Automático, e clique em Ligar jeff."
else
  echo
  echo "A GPU ainda não apareceu no Docker. Confira se o driver NVIDIA está carregado" >&2
  echo "(nvidia-smi funciona nesta máquina?) e rode este script de novo." >&2
  exit 1
fi
