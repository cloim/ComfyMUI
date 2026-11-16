#!/usr/bin/env python3
"""ComfyMUI 현재 설정 기반 범용 어셈블 무작위 조합 이미지 생성 스크립트.

ComfyMUI 웹 앱(http://comfymui-app:8189/api/state)의 현재 설정(모델, LoRA, 강도, 해상도, 스텝,
어셈블 카테고리 등)을 실시간으로 가져와 지정한 개수만큼 무작위 어셈블 조합 이미지를 자동 생성합니다.

사용법:
  # 기본 64장 생성
  python3 /data/scripts/generate_assemble.py 64

  # 수량 지정 (예: 10장)
  python3 /data/scripts/generate_assemble.py 10

  # 옵션 지정 (예: 32장, 접두사 커스텀)
  python3 /data/scripts/generate_assemble.py --count 32 --prefix assemble_run
"""

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

COMFYUI_URL = "http://127.0.0.1:8188"
COMFYMUI_STATE_URL = "http://comfymui-app:8189/api/state"
DEFAULT_OUTPUT_BASE = "/data/output"


def fetch_comfymui_state() -> tuple[dict, list]:
    """Fetch current settings and assemble elements from ComfyMUI backend."""
    try:
        req = urllib.request.Request(COMFYMUI_STATE_URL)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            entries = data.get("entries", {})
            cm_settings = entries.get("cm-settings", {}).get("value", {})
            cm_assemble = entries.get("cm-prompt-assemble", {}).get("value", [])
            if cm_settings and cm_assemble:
                print(f"[정보] ComfyMUI 백엔드에서 현재 설정을 성공적으로 로드했습니다.")
                return cm_settings, cm_assemble
    except Exception as e:
        print(f"[경고] ComfyMUI 상태 API 로드 실패 ({e}), 기본 설정을 사용합니다.")

    # 기본 대체 설정
    fallback_settings = {
        "modelLoader": "UNETLoader",
        "architecture": "krea2",
        "clip1": "Qwen/qwen3vl_4b_fp8_scaled.safetensors",
        "vae": "Qwen/qwen_image_vae.safetensors",
        "model": "Krea2/Moody-Krea-Mix-v8_00001__clean-int8_convrot.safetensors",
        "positive": "sensual photo of a Korean woman",
        "negative": "blurry, low quality, watermark, text",
        "loras": [],
        "width": 896,
        "height": 1152,
        "steps": 8,
        "cfg": 1.0,
        "sampler": "euler",
        "scheduler": "simple",
        "denoise": 1.0,
    }

    fallback_assemble = [
        {"id": "wardrobe", "name": "의상", "attributes": ["completely topless", "bare breasts", "visible nipples", "ultra-sheer black lace teddy", "see-through white chiffon slip", "wet semi-transparent mesh slip", "unbuttoned oversized white shirt", "open silk satin robe", "loosely wrapped bath towel", "tight champagne silk slip dress", "strappy black leather corset", "tiny lace panties"]},
        {"id": "composition", "name": "구도", "attributes": ["close-up portrait", "sensual waist-up framing", "dramatic high-angle shot", "provocative low-angle perspective", "three-quarter medium shot", "rule-of-thirds off-center", "over-the-shoulder angle", "diagonal dutch-angle", "eye-level medium close-up", "wide-medium atmospheric framing"]},
        {"id": "style_pose", "name": "스타일/포즈", "attributes": ["sensual boudoir art photography", "provocative glamour editorial", "arched back on silk bedding", "leaning back on velvet chaise", "kneeling on satin pillows", "lying on stomach propped on elbows", "seductive standing pose by window", "seated on high stool legs crossed", "relaxing in steamy bathtub", "lounging on plush fur rug"]},
        {"id": "setting", "name": "배경/장소", "attributes": ["luxury hotel suite bedroom", "penthouse night skyline window", "steamy marble bathtub", "cozy fireplace study room", "sun-drenched minimalist bedroom", "industrial modern loft", "moody private cocktail bar", "vintage vanity dressing room", "rainy day window floor cushions", "historic Parisian apartment"]},
        {"id": "lighting", "name": "조명/분위기", "attributes": ["dramatic chiaroscuro lighting", "deep warm amber bedside lamps", "cinematic neon rim lighting", "golden hour sunset rays", "flickering candlelight", "diffused morning daylight", "warm fireplace glow", "cool blue midnight moonlight", "soft vanity bulb bokeh", "Venetian blinds shadow patterns"]},
        {"id": "expression", "name": "표정/시선", "attributes": ["heavy-lidded bedroom eyes", "biting lower lip softly", "moist parted lips with shallow breath", "intense passionate direct gaze", "languid teasing smile", "over-the-shoulder smoldering look", "dreamy tender bedroom eyes", "fierce hypnotic gaze", "tilting head back closed eyes", "playful seductive side-glance"]},
        {"id": "camera_texture", "name": "카메라/질감", "attributes": ["glistening dewy skin sheen", "fine beads of sweat moisture", "water droplets on bare skin", "visible skin pores micro-texture", "cinematic shallow depth of field", "creamy smooth background bokeh", "authentic 35mm film grain", "sculpted collarbones highlights", "wet dark hair clinging to skin", "photorealistic 8k raw photo", "50mm f/1.4 prime lens", "85mm f/1.2 portrait lens"]},
    ]
    return fallback_settings, fallback_assemble


def extract_base_trigger(positive_text: str) -> str:
    """Extract primary trigger or subject from current positive prompt."""
    if not positive_text:
        return "sensual photo of a Korean woman"
    # 첫 쉼표 앞의 단어나 트리거 추출
    parts = [p.strip() for p in positive_text.split(",") if p.strip()]
    if parts:
        first = parts[0]
        # 만약 첫 부분이 트리거(단어 1~3개)라면 그것을 기본 트리거로 사용
        if len(first.split()) <= 4:
            return first
    return "sensual photo of a Korean woman"


def build_random_prompt(base_trigger: str, assemble_elements: list) -> str:
    """Combine base trigger with randomly selected attributes from each category."""
    picked = []
    for elem in assemble_elements:
        attrs = elem.get("attributes", [])
        if attrs:
            picked.append(random.choice(attrs))
    random.shuffle(picked)
    return f"{base_trigger}, {', '.join(picked)}"


def build_workflow(s: dict, prompt_text: str, seed: int, filename_prefix: str) -> dict:
    """Construct workflow node graph matching ComfyMUI's exact buildWorkflow logic."""
    loader_type = s.get("modelLoader", "UNETLoader")
    model_name = s.get("model", "")
    arch = s.get("architecture", "krea2")
    clip_name = s.get("clip1", "")
    vae_name = s.get("vae", "")
    width = int(s.get("width", 896))
    height = int(s.get("height", 1152))
    batch_size = int(s.get("batch", 1))
    steps = int(s.get("steps", 8))
    cfg = float(s.get("cfg", 1.0))
    sampler = s.get("sampler", "euler")
    scheduler = s.get("scheduler", "simple")
    denoise = float(s.get("denoise", 1.0))
    loras = s.get("loras", [])

    # 1. Model Loader Node
    if loader_type == "UNETLoader":
        model_node = {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": model_name, "weight_dtype": "default"}
        }
    elif loader_type == "UnetLoaderGGUF":
        model_node = {
            "class_type": "UnetLoaderGGUF",
            "inputs": {"unet_name": model_name}
        }
    else:
        model_node = {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": model_name}
        }

    # 2. Text Encoder (CLIP) Loader Node
    clip_node = {
        "class_type": "CLIPLoader",
        "inputs": {"clip_name": clip_name, "type": arch}
    }

    # 3. VAE Loader Node
    vae_node = {
        "class_type": "VAELoader",
        "inputs": {"vae_name": vae_name}
    }

    # 4. Latent Node
    latent_node = {
        "class_type": "EmptySD3LatentImage",
        "inputs": {"width": width, "height": height, "batch_size": batch_size}
    }

    workflow = {
        "1": model_node,
        "8": clip_node,
        "9": vae_node,
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt_text, "clip": ["8", 0]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": s.get("negative", "blurry, low quality"), "clip": ["8", 0]}},
        "4": latent_node,
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": scheduler,
                "denoise": denoise,
            }
        },
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["9", 0]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": filename_prefix}},
    }

    # LoRA 체이닝
    model_source = "1"
    for idx, lora in enumerate(loras):
        node_id = str(100 + idx)
        workflow[node_id] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": [model_source, 0],
                "lora_name": lora.get("name", ""),
                "strength_model": float(lora.get("model", 1.0)),
            }
        }
        model_source = node_id

    # KSampler에 최종 연결
    workflow["5"]["inputs"]["model"] = [model_source, 0]

    # CFG 1.0 Krea 2 특화 ConditioningZeroOut
    if arch == "krea2" and cfg == 1.0:
        workflow["3"] = {
            "class_type": "ConditioningZeroOut",
            "inputs": {"conditioning": ["2", 0]}
        }

    return workflow


def queue_prompt(prompt_workflow: dict) -> str:
    """Queue prompt in ComfyUI."""
    data = json.dumps({"prompt": prompt_workflow}).encode("utf-8")
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=data,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        return res.get("prompt_id")


def wait_for_prompt(prompt_id: str, timeout: int = 180) -> tuple[bool, list]:
    """Poll ComfyUI history until prompt finishes."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}", timeout=5) as resp:
                hist = json.loads(resp.read().decode("utf-8"))
                if prompt_id in hist:
                    entry = hist[prompt_id]
                    status = entry.get("status", {})
                    if status.get("completed", False):
                        outputs = entry.get("outputs", {})
                        images = outputs.get("7", {}).get("images", [])
                        return True, images
        except Exception:
            pass
        time.sleep(1.5)
    return False, []


def main():
    parser = argparse.ArgumentParser(description="ComfyMUI 현재 설정 기반 어셈블 무작위 배치 생성기")
    parser.add_argument("count_pos", nargs="?", type=int, default=None, help="생성할 이미지 수량 (예: 64)")
    parser.add_argument("--count", "-n", type=int, default=64, help="생성할 이미지 수량 (기본값: 64)")
    parser.add_argument("--prefix", type=str, default="", help="저장 폴더 및 파일명 접두사 (미지정 시 자동 생성)")
    parser.add_argument("--trigger", type=str, default="", help="트리거 단어 직접 지정 (미지정 시 현재 설정에서 추출)")
    args = parser.parse_args()

    count = args.count_pos if args.count_pos is not None else args.count

    print(f"\n========================================================")
    print(f" [ComfyMUI] 현재 설정 기반 어셈블 무작위 배치 생성기")
    print(f" 목표 수량: {count}장")
    print(f"========================================================")

    settings, assemble = fetch_comfymui_state()

    # 트리거 및 접두사 결정
    current_positive = settings.get("positive", "")
    trigger = args.trigger if args.trigger else extract_base_trigger(current_positive)
    
    clean_trigger = re.sub(r"[^a-zA-Z0-9_-]", "_", trigger).strip("_") or "assemble"
    prefix = args.prefix if args.prefix else f"{clean_trigger}/img"

    # 설정 요약 출력
    model_name = settings.get("model", "")
    loras = settings.get("loras", [])
    lora_desc = ", ".join([f"{l.get('name')} (강도 {l.get('model')})" for l in loras]) if loras else "없음"
    width = settings.get("width", 896)
    height = settings.get("height", 1152)
    steps = settings.get("steps", 8)
    cfg = settings.get("cfg", 1.0)
    sampler = settings.get("sampler", "euler")

    print(f"  * 모델: {model_name}")
    print(f"  * LoRA: {lora_desc}")
    print(f"  * 트리거: '{trigger}'")
    print(f"  * 해상도: {width}x{height} | {steps}스텝 (CFG {cfg}, {sampler})")
    print(f"  * 어셈블 카테고리: {len(assemble)}개 로드됨")
    print(f"  * 컨테이너 저장 경로: {DEFAULT_OUTPUT_BASE}/{prefix}_XXXXX_.png")
    print(f"========================================================\n")

    out_dir = os.path.join(DEFAULT_OUTPUT_BASE, clean_trigger)
    os.makedirs(out_dir, exist_ok=True)
    status_file = os.path.join(out_dir, "batch_status.json")
    log_file = os.path.join(out_dir, "assembled_prompts_log.json")

    log_records = []
    success_count = 0

    try:
        for idx in range(1, count + 1):
            prompt_text = build_random_prompt(trigger, assemble)
            seed = random.randint(100000000000, 999999999999)
            workflow = build_workflow(settings, prompt_text, seed, prefix)

            print(f"[{idx}/{count}] 큐 등록 중 (시드: {seed})...")
            print(f"  프롬프트: {prompt_text[:90]}...")

            t0 = time.time()
            prompt_id = queue_prompt(workflow)
            if not prompt_id:
                print(f"  [오류] #{idx} 큐 등록에 실패했습니다.")
                continue

            ok, images = wait_for_prompt(prompt_id)
            elapsed = time.time() - t0

            if ok:
                success_count += 1
                img_names = [img.get("filename") for img in images]
                print(f"  [성공] 소요 시간: {elapsed:.1f}초 -> {img_names}")

                record = {
                    "index": idx,
                    "prompt_id": prompt_id,
                    "seed": seed,
                    "prompt": prompt_text,
                    "images": img_names,
                    "elapsed": round(elapsed, 1),
                }
                log_records.append(record)

                # 실시간 진행 상황 파일 저장
                try:
                    with open(status_file, "w", encoding="utf-8") as sf:
                        json.dump({
                            "current": idx,
                            "total": count,
                            "success": success_count,
                            "percent": round(success_count / count * 100, 1),
                            "latest_image": img_names,
                            "latest_prompt": prompt_text,
                        }, sf, indent=2, ensure_ascii=False)
                except Exception:
                    pass
            else:
                print(f"  [경고] #{idx} 생성 시간 초과 또는 실패")

    except KeyboardInterrupt:
        print("\n[알림] 사용자에 의해 생성이 중단되었습니다.")

    # 최종 프롬프트 로그 저장
    try:
        with open(log_file, "w", encoding="utf-8") as lf:
            json.dump(log_records, lf, indent=2, ensure_ascii=False)
    except Exception:
        pass

    print(f"\n========================================================")
    print(f" [완료] 총 {success_count}/{count}장 생성 성공!")
    print(f" 저장 위치: {out_dir}")
    print(f" 상세 로그: {log_file}")
    print(f"========================================================\n")


if __name__ == "__main__":
    main()
