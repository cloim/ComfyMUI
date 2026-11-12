"""Hide deleted local media files from ComfyUI's generated-assets history.

The frontend builds the Generated assets list from /api/jobs rather than by
scanning the output directory. ComfyUI keeps completed job output descriptors
in memory after files are deleted outside the UI, which otherwise creates
broken/ghost asset cards.
"""

from __future__ import annotations

import os
from typing import Any

import folder_paths
from comfy_execution import jobs


_LOCAL_FILE_TYPES = frozenset({"input", "output", "temp"})


def _local_file_path(item: Any) -> str | None:
    """Return the safe local path represented by an output item, if any."""
    if not isinstance(item, dict):
        return None

    filename = item.get("filename")
    type_name = item.get("type")
    if (
        not isinstance(filename, str)
        or not filename
        or type_name not in _LOCAL_FILE_TYPES
    ):
        return None

    filename, annotated_dir = folder_paths.annotated_filepath(filename)
    base_dir = annotated_dir or folder_paths.get_directory_by_type(type_name)
    subfolder = item.get("subfolder", "")
    if not base_dir or not isinstance(subfolder, str):
        return None

    base_real = os.path.realpath(base_dir)
    candidate = os.path.realpath(os.path.join(base_real, subfolder, filename))
    try:
        if os.path.normcase(os.path.commonpath((base_real, candidate))) != os.path.normcase(base_real):
            return None
    except ValueError:
        return None
    return candidate


def _is_missing_local_file(item: Any) -> bool:
    path = _local_file_path(item)
    return path is not None and not os.path.isfile(path)


def _filter_missing_files(outputs: dict) -> dict:
    """Copy an outputs mapping while dropping descriptors for deleted files."""
    if not isinstance(outputs, dict):
        return outputs

    filtered: dict = {}
    for node_id, node_outputs in outputs.items():
        if not isinstance(node_outputs, dict):
            filtered[node_id] = node_outputs
            continue

        filtered_node: dict = {}
        for media_type, items in node_outputs.items():
            if not isinstance(items, list):
                filtered_node[media_type] = items
                continue

            kept = []
            for item in items:
                candidate = jobs.normalize_output_item(item)
                check_item = candidate if candidate is not None else item
                if _is_missing_local_file(check_item):
                    continue
                kept.append(item)
            filtered_node[media_type] = kept
        filtered[node_id] = filtered_node
    return filtered


def _install_patch() -> None:
    current = jobs.get_outputs_summary
    if getattr(current, "_ghost_asset_cleanup_patch", False):
        return

    original_get_outputs_summary = current
    original_normalize_outputs = jobs.normalize_outputs

    def get_outputs_summary_without_missing_files(outputs: dict):
        return original_get_outputs_summary(_filter_missing_files(outputs))

    def normalize_outputs_without_missing_files(outputs: dict):
        return original_normalize_outputs(_filter_missing_files(outputs))

    get_outputs_summary_without_missing_files._ghost_asset_cleanup_patch = True
    normalize_outputs_without_missing_files._ghost_asset_cleanup_patch = True
    jobs.get_outputs_summary = get_outputs_summary_without_missing_files
    jobs.normalize_outputs = normalize_outputs_without_missing_files


_install_patch()

# This package patches the jobs API and intentionally provides no nodes.
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
