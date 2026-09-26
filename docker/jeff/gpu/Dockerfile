FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1

ARG JEFF_REF=main

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Instala uv_build com pip (necessário para compilar jeff)
RUN pip install --no-cache-dir uv_build

# Instala torch + dependências com pip
RUN pip install --no-cache-dir \
    "torch --index-url https://download.pytorch.org/whl/cu121" \
    "gliner==0.1.11" \
    "jeff @ https://github.com/jarihu/jeff/archive/${JEFF_REF}.tar.gz"

COPY entrypoint.sh /usr/local/bin/jeff-entrypoint
RUN chmod +x /usr/local/bin/jeff-entrypoint

ENV JEFF_MODEL_REPO=knowledgator/gliformer-large-v1 \
    JEFF_MODEL=/models/gliformer-large-v1 \
    HF_HOME=/models/.hf \
    JEFF_DEVICE=cuda

EXPOSE 8000
ENTRYPOINT ["jeff-entrypoint"]