import json
import time
import urllib.request
import urllib.parse
from PIL import Image
import os

SERVER = "http://127.0.0.1:8188"

def queue_prompt(prompt_workflow):
    data = json.dumps({"prompt": prompt_workflow}).encode('utf-8')
    req = urllib.request.Request(f"{SERVER}/prompt", data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode('utf-8'))

def wait_for_completion(prompt_id, timeout=120):
    start = time.time()
    while time.time() - start < timeout:
        req = urllib.request.Request(f"{SERVER}/history/{prompt_id}")
        with urllib.request.urlopen(req) as res:
            history = json.loads(res.read().decode('utf-8'))
            if prompt_id in history:
                return history[prompt_id]
        time.sleep(1)
    raise TimeoutError("Prompt execution timed out")

def get_latest_image_filename():
    files = [f for f in os.listdir("E:/ComfyUI/output") if f.startswith("ComfyMUI_") and f.endswith(".png")]
    files.sort(key=lambda x: os.path.getmtime(os.path.join("E:/ComfyUI/output", x)), reverse=True)
    return files[0] if files else None

def test_variant(name, model_name, latent_type, use_flux_sampling, width=576, height=1024):
    print(f"\n--- Testing variant: {name} ---")
    print(f"Model: {model_name}, Latent: {latent_type}, FluxSampling: {use_flux_sampling}, Res: {width}x{height}")
    
    wf = {
        '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': model_name, 'weight_dtype': 'default'}},
        '8': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'Qwen\\qwen3vl_4b_fp8_scaled.safetensors', 'type': 'krea2'}},
        '9': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'Qwen\\qwen_image_vae.safetensors'}},
        '2': {'class_type': 'CLIPTextEncode', 'inputs': {'text': 'A portrait of an Korean woman, natural soft lighting, delicate facial features, detailed skin texture, expressive eyes, gentle gaze, shallow depth of field, photorealistic, cinematic composition, analog film, chest shot', 'clip': ['8', 0]}},
        '3': {'class_type': 'ConditioningZeroOut', 'inputs': {'conditioning': ['2', 0]}},
        '4': {'class_type': latent_type, 'inputs': {'width': width, 'height': height, 'batch_size': 1}},
        '5': {
            'class_type': 'KSampler',
            'inputs': {
                'model': ['20', 0] if use_flux_sampling else ['1', 0],
                'positive': ['2', 0],
                'negative': ['3', 0],
                'latent_image': ['4', 0],
                'seed': 123916916596608,
                'steps': 8,
                'cfg': 1.0,
                'sampler_name': 'euler',
                'scheduler': 'simple',
                'denoise': 1.0,
            }
        },
        '6': {'class_type': 'VAEDecode', 'inputs': {'samples': ['5', 0], 'vae': ['9', 0]}},
        '7': {'class_type': 'SaveImage', 'inputs': {'images': ['6', 0], 'filename_prefix': f'Test_{name}'}}
    }
    if use_flux_sampling:
        wf['20'] = {
            'class_type': 'ModelSamplingFlux',
            'inputs': {'model': ['1', 0], 'max_shift': 1.15, 'base_shift': 0.5, 'width': width, 'height': height}
        }
    
    res = queue_prompt(wf)
    pid = res['prompt_id']
    print(f"Queued {pid}, waiting...")
    h = wait_for_completion(pid)
    outputs = h.get('outputs', {})
    images = outputs.get('7', {}).get('images', [])
    if images:
        fn = images[0]['filename']
        print(f"Completed! Output: E:/ComfyUI/output/{fn}")
        return f"E:/ComfyUI/output/{fn}"
    return None

if __name__ == '__main__':
    # Test 1: No ModelSamplingFlux (EmptySD3LatentImage, Krea2RedMix3.0)
    out1 = test_variant("no_flux_sampling", "Krea2\\Krea2RedMix3.0-ComfyUI-int4_convrot.safetensors", "EmptySD3LatentImage", False)
