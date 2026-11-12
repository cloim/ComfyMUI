"""Build the pinned ComfyUI custom node tree from custom-nodes.lock.json.

Registry packages are downloaded by exact version and checked by SHA-256, Git
nodes are fetched at the locked commit, and the overlay restores files that
were modified or added locally on the original Windows install.
"""
import argparse
import hashlib
import io
import json
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch_registry(node: dict, target: Path) -> None:
    with urllib.request.urlopen(node["url"], timeout=300) as response:
        data = response.read()
    digest = sha256_bytes(data)
    if digest != node["sha256"]:
        raise SystemExit(f"{node['dir']}: sha256 mismatch {digest} != {node['sha256']}")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        archive.extractall(target)


def fetch_git(node: dict, target: Path) -> None:
    def git(*args: str) -> None:
        subprocess.run(["git", "-C", str(target), *args], check=True)

    target.mkdir(parents=True)
    git("init", "-q")
    git("remote", "add", "origin", node["url"])
    git("fetch", "-q", "--depth", "1", "origin", node["commit"])
    git("checkout", "-q", "-B", node.get("branch") or "main", "FETCH_HEAD")
    head = subprocess.run(["git", "-C", str(target), "rev-parse", "HEAD"], check=True,
                          capture_output=True, text=True).stdout.strip()
    if head != node["commit"]:
        raise SystemExit(f"{node['dir']}: HEAD {head} != {node['commit']}")


def tree_manifest(root: Path) -> dict:
    manifest = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if path.is_file() and ".git" not in rel.parts and "__pycache__" not in rel.parts:
            manifest[rel.as_posix()] = sha256_bytes(path.read_bytes())
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", required=True, type=Path)
    parser.add_argument("--overlay", required=True, type=Path)
    parser.add_argument("--comfyui", required=True, type=Path, help="ComfyUI checkout providing root example files")
    parser.add_argument("--dest", required=True, type=Path)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()

    lock = json.loads(args.lock.read_text(encoding="utf-8"))
    if args.dest.exists():
        raise SystemExit(f"destination already exists: {args.dest}")
    args.dest.mkdir(parents=True)

    for name in lock["root_files_from_comfyui"]:
        shutil.copy2(args.comfyui / "custom_nodes" / name, args.dest / name)

    for node in lock["nodes"]:
        target = args.dest / node["dir"]
        print(f"[custom-nodes] {node['dir']} ({node['source']})", flush=True)
        if node["source"] == "registry":
            fetch_registry(node, target)
        elif node["source"] == "git":
            fetch_git(node, target)
        elif node["source"] == "overlay":
            target.mkdir(parents=True)
        else:
            raise SystemExit(f"unknown source: {node['source']}")
        for rel in node.get("delete", []):
            (target / rel).unlink(missing_ok=True)
        for rel in node.get("overlay", []):
            src = args.overlay / node["dir"] / rel
            if not src.is_file():
                raise SystemExit(f"{node['dir']}: overlay file missing: {rel}")
            dst = target / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    if args.manifest:
        args.manifest.write_text(json.dumps(tree_manifest(args.dest), indent=0), encoding="utf-8")
    print(f"[custom-nodes] installed {len(lock['nodes'])} nodes into {args.dest}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
