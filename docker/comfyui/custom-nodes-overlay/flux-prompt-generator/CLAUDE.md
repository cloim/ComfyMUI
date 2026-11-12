# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a ComfyUI custom node called **Flux-Prompt-Generator** that generates detailed and creative prompts for image generation models. It's based on work by Aitrepreneur and modified for ComfyUI integration.

## Architecture

### Core Components

- **`flux_prompt_generator.py`**: Main module containing the `FluxPromptGenerator` class and `PromptGenerator` class
- **`__init__.py`**: ComfyUI node registration defining `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS`
- **`data/`**: Directory containing 30+ JSON files with prompt categories (artform, clothing, lighting, etc.)

### Key Classes

- **`FluxPromptGenerator`**: ComfyUI node class with input parameters and prompt generation logic
- **`PromptGenerator`**: Core generator class that handles random selection and prompt composition
- **`load_json_file()`**: Utility function for loading JSON data files with error handling

### Data Structure

The generator uses JSON files in the `data/` directory for different prompt categories:
- Subject-related: `default_tags.json`, `age_group.json`, `ethnicity.json`
- Appearance: `clothing.json`, `hairstyles.json`, `makeup_styles.json`, `body_types.json`
- Art style: `artform.json`, `photography_styles.json`, `digital_artform.json`
- Scene: `lighting.json`, `place.json`, `background.json`, `composition.json`

## Development Commands

Since this is a ComfyUI custom node, there are no traditional build/test commands. Development workflow:

1. **Installation**: Clone to ComfyUI's `custom_nodes` directory
2. **Testing**: Run within ComfyUI interface
3. **Publishing**: Uses GitHub Actions workflow in `.github/workflows/publish.yml` to publish to ComfyUI registry when `pyproject.toml` is updated

## Project Configuration

- **`pyproject.toml`**: Project metadata and ComfyUI registry configuration
- **`LICENSE`**: MIT license
- **GitHub Actions**: Automated publishing to ComfyUI registry on changes to `pyproject.toml`

## Important Implementation Notes

- All JSON data files use UTF-8 encoding
- The generator handles "random", "disabled", and specific selections for each category
- Error handling is implemented for missing JSON files (returns empty lists)
- Uses Python's `random.Random` with seed support for reproducible outputs
- Node integrates with ComfyUI's workflow system via standard input/output connections