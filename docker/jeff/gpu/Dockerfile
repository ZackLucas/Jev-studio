# jeff (https://github.com/jarihu/jeff) with CUDA PyTorch, so it runs on the GPU.
# cu128 is the first line with Blackwell kernels (RTX 50-series, sm_120); cu121 has none.
# Built and managed by JEV Studio.
FROM python:3.12-slim

ENV UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1 \
    PYTHONUNBUFFERED=1

# CUDA 12.8 wheels (PyPI's default torch bundles a different CUDA), then jeff from its
# GitHub tarball (no git needed). JEFF_REF = branch, tag or commit.
#
# gliformer 0.1.2 imports `build_all_entity_pairs`, which only exists in gliner >= 0.2.26 —
# and those gliner releases cap `transformers` (< 5.17). Without the constraint uv picks an
# older gliner and jeff crashes on startup. Versions mirror jeff's own uv.lock.
ARG JEFF_REF=main
RUN pip install --no-cache-dir uv \
 && printf 'gliner==0.2.29\ntransformers==5.16.1\n' > /tmp/jeff-constraints.txt \
 && uv pip install torch --index-url https://download.pytorch.org/whl/cu128 \
 && uv pip install --constraints /tmp/jeff-constraints.txt "jeff @ https://github.com/jarihu/jeff/archive/${JEFF_REF}.tar.gz" \
 && rm /tmp/jeff-constraints.txt

COPY entrypoint.sh /usr/local/bin/jeff-entrypoint
RUN chmod +x /usr/local/bin/jeff-entrypoint

ENV JEFF_MODEL_REPO=knowledgator/gliformer-large-v1 \
    JEFF_MODEL=/models/gliformer-large-v1 \
    HF_HOME=/models/.hf \
    JEFF_DEVICE=cuda

EXPOSE 8000
ENTRYPOINT ["jeff-entrypoint"]
