# jeff (https://github.com/jarihu/jeff) with Python 3.12 and CPU-only PyTorch,
# so it runs regardless of the host's Python version. Built and managed by JEV Studio.
FROM python:3.12-slim

ENV UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1 \
    PYTHONUNBUFFERED=1

# CPU wheels first (PyPI's default torch bundles ~4 GB of CUDA libraries), then jeff from its
# GitHub tarball (no git needed). JEFF_REF = branch, tag or commit.
ARG JEFF_REF=main
RUN pip install --no-cache-dir uv \
 && uv pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && uv pip install "gliner==0.1.11" \
 && uv pip install "jeff @ https://github.com/jarihu/jeff/archive/${JEFF_REF}.tar.gz"

COPY entrypoint.sh /usr/local/bin/jeff-entrypoint
RUN chmod +x /usr/local/bin/jeff-entrypoint

ENV JEFF_MODEL_REPO=knowledgator/gliformer-large-v1 \
    JEFF_MODEL=/models/gliformer-large-v1 \
    HF_HOME=/models/.hf

EXPOSE 8000
ENTRYPOINT ["jeff-entrypoint"]