"""One-time migration of the Windows ComfyUI custom nodes and user state into the comfy-data volume.

Run inside a container that mounts comfy-data at /data while the comfyui service is stopped, e.g.

  docker compose stop comfyui
  docker run --rm -v comfy-data:/data -v ./scripts:/scripts:ro --entrypoint python comfymui-comfyui:latest \
      /scripts/migrate-legacy-custom-nodes.py --stamp 20261112

Sources are the preserved copies in /data/legacy-comfyui. Every overwritten Docker file is backed up to
/data/migration-backups/<stamp>-custom-nodes, and every Windows path replacement is written to report.json.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

DATA = Path("/data")
LEGACY = DATA / "legacy-comfyui"
OVERLAY = Path("/opt/comfyui/custom-nodes-overlay")

CONFLICT_FILES = [
    "comfyui_8188.log",
    "comfyui_8188.prev2.log",
    "comfyui_8188.prev.log",
    "__manager/config.ini",
    "__manager/channels.list",
    "__manager/cache/746607195_github-stats.json",
    "__manager/cache/4245046894_model-list.json",
    "__manager/cache/1742899825_extension-node-map.json",
    "__manager/cache/881334633_nodes.json",
    "__manager/cache/2259715867_alter-list.json",
    "__manager/cache/1514988643_custom-node-list.json",
]
# Node config files whose Windows paths are replaced; the translated copies come from the image overlay.
NODE_CONFIGS = ["comfyui-impact-pack/impact-pack.ini", "was-ns/was_suite_config.json"]
WIN_PATH = re.compile(r"[A-Za-z]:\\\\|[A-Za-z]:\\|[A-Za-z]:/")
MODEL_EXT = re.compile(r"\.(safetensors|gguf|ckpt|pt|pth|bin|onnx|sft)$", re.I)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def backup(src: Path, root: Path, rel: str) -> None:
    if src.exists():
        dst = root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, dst, symlinks=True)
        else:
            shutil.copy2(src, dst)


def apply_conflict_files(bk: Path, report: dict) -> None:
    rows = []
    for rel in CONFLICT_FILES:
        src, dst = LEGACY / "user" / rel, DATA / "user" / rel
        before = sha256(dst) if dst.exists() else None
        backup(dst, bk / "user-docker-before", rel)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        text = src.read_bytes().decode("utf-8", errors="replace")
        rows.append({"file": rel, "docker_before": before, "legacy": sha256(src), "after": sha256(dst),
                     "applied": sha256(src) == sha256(dst),
                     "windows_path_lines": sum(1 for line in text.splitlines() if WIN_PATH.search(line))})
    report["conflict_files"] = rows


def install_custom_nodes(bk: Path, report: dict) -> None:
    target = DATA / "custom_nodes"
    if target.exists():
        raise SystemExit(f"{target} already exists; refusing to overwrite")
    partial = DATA / "custom_nodes.partial"
    if partial.exists():
        shutil.rmtree(partial)
    shutil.copytree(LEGACY / "custom_nodes", partial, symlinks=True,
                    ignore=shutil.ignore_patterns("__pycache__"))
    changes = []
    for rel in NODE_CONFIGS:
        before = (partial / rel).read_text(encoding="utf-8")
        shutil.copy2(OVERLAY / rel, partial / rel)
        after = (partial / rel).read_text(encoding="utf-8")
        changes.append({"file": f"custom_nodes/{rel}", "original": f"legacy-comfyui/custom_nodes/{rel}",
                        "replaced": [[a, b] for a, b in zip(before.splitlines(), after.splitlines()) if a != b]})
    partial.rename(target)
    report["custom_node_config_replacements"] = changes


def translate_lora_manager(bk: Path, report: dict) -> None:
    src = LEGACY / "extra-root" / "appdata" / "ComfyUI-LoRA-Manager"
    dst = DATA / "config" / "ComfyUI-LoRA-Manager"
    backup(dst, bk / "config-before", "ComfyUI-LoRA-Manager")
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    settings_path = dst / "settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    replaced = []

    def linux(value: str) -> str:
        norm = value.replace("\\", "/")
        m = re.match(r"(?i)^e:/comfyui/models/(.+)$", norm)
        return f"/data/models-view/{m.group(1)}" if m else value

    def walk(node, path=""):
        if isinstance(node, dict):
            return {k: walk(v, f"{path}.{k}") for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v, f"{path}[{i}]") for i, v in enumerate(node)]
        if isinstance(node, str) and WIN_PATH.search(node) and "api_key" not in path:
            new = linux(node)
            if new != node:
                replaced.append([path, node, new])
            return new
        return node

    settings = walk(settings)
    for scope in [settings] + list(settings.get("libraries", {}).values()):
        loras = scope.get("folder_paths", {}).get("loras")
        if loras is not None and "/host-models/loras" not in loras:
            loras.append("/host-models/loras")
            replaced.append(["folder_paths.loras", None, "/host-models/loras (added)"])
    settings_path.write_text(json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
    report["lora_manager_settings_replacements"] = replaced


def translate_whitelist(bk: Path, report: dict) -> None:
    rel = "default/was-node-suite/whitelist-dirs.list"
    path = DATA / "user" / rel
    if not path.exists():
        report["was_whitelist"] = "missing"
        return
    backup(path, bk / "user-docker-before", rel)
    mapping = {r"E:\ComfyUI\input": "/data/input", r"E:\ComfyUI\temp": "/data/temp"}
    lines, replaced = [], []
    for line in path.read_text(encoding="utf-8").splitlines():
        new = mapping.get(line.strip(), line.strip())
        if new != line.strip():
            replaced.append([line.strip(), new])
        lines.append(new)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    report["was_whitelist_replacements"] = replaced
    report["was_whitelist_unmapped"] = [l for l in lines if WIN_PATH.search(l)]


def normalize_workflows(bk: Path, report: dict) -> None:
    root = DATA / "user" / "default" / "workflows"
    backup(root, bk / "user-docker-before", "default/workflows")
    rows = []
    for path in sorted(root.rglob("*.json")):
        raw = path.read_text(encoding="utf-8")
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        values = set()

        def collect(node):
            if isinstance(node, dict):
                for v in node.values():
                    collect(v)
            elif isinstance(node, list):
                for v in node:
                    collect(v)
            elif isinstance(node, str) and "\\" in node and MODEL_EXT.search(node) and not WIN_PATH.search(node):
                values.add(node)

        nodes = list(data.get("nodes", [])) if isinstance(data, dict) else []
        for sg in ((data.get("definitions") or {}).get("subgraphs") or []) if isinstance(data, dict) else []:
            nodes.extend(sg.get("nodes", []))
        for n in nodes:
            collect(n.get("widgets_values"))
        new_raw = raw
        for v in sorted(values):
            new_raw = new_raw.replace(json.dumps(v, ensure_ascii=False), json.dumps(v.replace("\\", "/"), ensure_ascii=False))
        if new_raw != raw:
            json.loads(new_raw)
            path.write_text(new_raw, encoding="utf-8")
            rows.append({"workflow": path.relative_to(root).as_posix(),
                         "replaced": sorted([v, v.replace("\\", "/")] for v in values)})
    report["workflow_model_separator_replacements"] = rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stamp", required=True)
    args = parser.parse_args()
    bk = DATA / "migration-backups" / f"{args.stamp}-custom-nodes"
    bk.mkdir(parents=True, exist_ok=False)
    report: dict = {"backup_dir": str(bk)}
    apply_conflict_files(bk, report)
    install_custom_nodes(bk, report)
    translate_lora_manager(bk, report)
    translate_whitelist(bk, report)
    normalize_workflows(bk, report)
    (bk / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
