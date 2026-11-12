# syntax=docker/dockerfile:1
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install system dependencies (build-essential/gcc for Triton JIT and source builds such as insightface,
# git, ffmpeg, OpenGL/GLib libraries, libzbar for pyzbar, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libzbar0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Clone ComfyUI at fixed version (v0.44.2 matching the existing Windows host environment)
ARG COMFYUI_VERSION=v0.44.2
ARG COMFYUI_COMMIT=e6515b16ed360b01bd6548bffaca193f88f181fb
RUN git clone --depth 1 --branch ${COMFYUI_VERSION} https://github.com/comfyanonymous/ComfyUI.git /app/ComfyUI \
    && test "$(git -C /app/ComfyUI rev-parse HEAD)" = "${COMFYUI_COMMIT}"

WORKDIR /app/ComfyUI

# Install the locked Python environment for ComfyUI core and every custom node.
# The lock was resolved for Linux/Python 3.11 with the original Windows .venv versions as constraints
# (docker/comfyui/constraints-windows-venv.txt), including torch 2.9.1+cu130 as on the original install.
# The base image's CUDA 12 wheels share directories (nvidia/cudnn, nvidia/nccl, ...) with the CUDA 13
# wheels, so they are removed first; mixed files break cuDNN attention.
# onnxruntime-gpu on PyPI targets CUDA 12, so the same version is taken from the official CUDA 13 feed.
COPY docker/comfyui/python-requirements.lock.txt docker/comfyui/onnxruntime-cuda13.txt /tmp/
RUN pip uninstall -y $(pip list --format=freeze | grep -E '^nvidia-.*-cu12==' | cut -d= -f1) \
    && pip install --no-cache-dir cython==3.2.5 numpy==1.26.4 setuptools==75.8.0 wheel==0.45.1 \
    && SAM2_BUILD_CUDA=0 pip install --no-cache-dir --no-deps --no-build-isolation \
       -r /tmp/python-requirements.lock.txt --extra-index-url https://download.pytorch.org/whl/cu130 \
    && pip install --no-cache-dir --no-deps --force-reinstall --require-hashes -r /tmp/onnxruntime-cuda13.txt \
       --index-url https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-13/pypi/simple/ \
    && pip install --no-cache-dir --no-deps --force-reinstall opencv-contrib-python==4.10.0.84 \
    && rm /tmp/python-requirements.lock.txt /tmp/onnxruntime-cuda13.txt

# Fail the build on dependency conflicts. zhipuai declares the Python 3.6 dataclasses backport, which is stdlib on 3.11.
RUN pip check > /tmp/pip-check.txt 2>&1 || true; \
    grep -v -x -F "zhipuai 1.0.7 requires dataclasses, which is not installed." /tmp/pip-check.txt \
      | grep -v -x -F "No broken requirements found." > /tmp/pip-check-bad.txt || true; \
    if [ -s /tmp/pip-check-bad.txt ]; then cat /tmp/pip-check-bad.txt; exit 1; fi; \
    rm -f /tmp/pip-check.txt /tmp/pip-check-bad.txt

# Build the pinned custom node seed (ComfyUI Registry versions with SHA-256, Git commits and the local overlay).
# The running tree lives in the comfy-data volume (/data/custom_nodes); the entrypoint seeds it from here when absent.
COPY docker/comfyui/custom-nodes.lock.json docker/comfyui/install_custom_nodes.py /opt/comfyui/
COPY docker/comfyui/custom-nodes-overlay /opt/comfyui/custom-nodes-overlay
RUN python /opt/comfyui/install_custom_nodes.py \
      --lock /opt/comfyui/custom-nodes.lock.json \
      --overlay /opt/comfyui/custom-nodes-overlay \
      --comfyui /app/ComfyUI \
      --dest /opt/comfyui/custom_nodes.seed \
      --manifest /opt/comfyui/custom_nodes.seed.manifest.json \
    && rm -rf /app/ComfyUI/custom_nodes

# System fonts for text nodes (Comfyroll CR Select Font lists *.ttf directly under /usr/share/fonts/truetype)
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-liberation fonts-nanum \
    && rm -rf /var/lib/apt/lists/* \
    && find /usr/share/fonts/truetype -mindepth 2 -name '*.ttf' -exec ln -sf {} /usr/share/fonts/truetype/ \;

# Keep node and library state (LoRA Manager settings, Ultralytics, Hugging Face and torch hub caches) in the volume
ENV XDG_CONFIG_HOME=/data/config \
    HF_HOME=/data/cache/huggingface \
    TORCH_HOME=/data/cache/torch

# Copy entrypoint and configurations
COPY docker/comfyui/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY docker/comfyui/extra_model_paths.yaml /etc/comfyui/extra_model_paths.yaml
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8188

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
