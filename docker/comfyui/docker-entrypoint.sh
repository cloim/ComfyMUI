#!/usr/bin/env bash
set -e

# Ensure persistence directories exist in the comfy-data named volume (/data)
mkdir -p /data/models/diffusion_models \
         /data/models/checkpoints \
         /data/models/loras \
         /data/models/vae \
         /data/models/clip \
         /data/models/text_encoders \
         /data/output \
         /data/input \
         /data/user \
         /data/temp \
         /data/config \
         /data/cache \
         /data/models-view

echo "[ComfyUI Entrypoint] Initialized persistence directories in /data"

# Custom nodes live in the volume so node settings, downloads and Manager installs survive image rebuilds.
# A fresh volume is seeded from the pinned tree built from docker/comfyui/custom-nodes.lock.json.
if [ ! -e /data/custom_nodes ]; then
  echo "[ComfyUI Entrypoint] Seeding /data/custom_nodes from /opt/comfyui/custom_nodes.seed"
  cp -a /opt/comfyui/custom_nodes.seed /data/custom_nodes.partial
  mv /data/custom_nodes.partial /data/custom_nodes
fi
if [ ! -L /app/ComfyUI/custom_nodes ]; then
  rm -rf /app/ComfyUI/custom_nodes
fi
ln -sfn /data/custom_nodes /app/ComfyUI/custom_nodes

# Models view: ComfyUI's models directory as seen by nodes that join folder_paths.models_dir directly
# (Florence2 LLM, ReActor, LivePortrait, LayerStyle, ...). Each entry links to the writable volume folder when it
# exists and otherwise to the read-only host folder. Folders created by nodes later stay in /data/models-view.
# /data/models itself (SFTP share) is left untouched.
for link in /data/models-view/*; do
  if [ -L "$link" ] && [ ! -e "$link" ]; then rm -f "$link"; fi
done
for src in /data/models/* /host-models/*; do
  [ -d "$src" ] || continue
  name="$(basename "$src")"
  view="/data/models-view/$name"
  if [ -d "/data/models/$name" ]; then target="/data/models/$name"; else target="/host-models/$name"; fi
  if [ -e "$view" ] && [ ! -L "$view" ]; then continue; fi
  if [ "$(readlink "$view" 2>/dev/null)" != "$target" ]; then ln -sfn "$target" "$view"; fi
done
# Bundled model configs (v1-inference.yaml etc.) used by config-based checkpoint loaders
if [ ! -e /data/models-view/configs ]; then ln -s /app/ComfyUI/models/configs /data/models-view/configs; fi

# Port and arguments
PORT="${COMFY_PORT:-8188}"
EXTRA_ARGS="${COMFY_EXTRA_ARGS:---lowvram --reserve-vram 1}"

echo "[ComfyUI Entrypoint] Starting ComfyUI on port ${PORT} with args: ${EXTRA_ARGS}"

exec python main.py \
  --listen 0.0.0.0 \
  --port "${PORT}" \
  --models-directory /data/models-view \
  --output-directory /data/output \
  --input-directory /data/input \
  --user-directory /data/user \
  --temp-directory /data/temp \
  --extra-model-paths-config /etc/comfyui/extra_model_paths.yaml \
  ${EXTRA_ARGS}
