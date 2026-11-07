# ComfyMUI

모바일에서 사용하는 ComfyUI 이미지 작업실입니다. React, TypeScript와 Tailwind CSS로 구현한 설치형 PWA입니다.

## 실행

Node.js 24 LTS를 사용합니다.

```sh
npm ci
npm run dev
```

개발 화면은 `http://localhost:5173`입니다. ComfyUI를 기본 포트 8188에서 실행한 후 앱의 연결 설정에서 `/comfy`로 연결하세요.

빌드 결과를 실행하려면 다음 명령을 사용합니다.

```sh
npm run build
npm start
```

실행 주소는 `http://localhost:4173`입니다. 앱 서버는 기본적으로 `0.0.0.0`에서 수신합니다. 같은 LAN의 모바일에서는 PC의 LAN IP와 4173 포트로 열 수 있습니다. 로컬 테스트용으로 신뢰할 수 있는 네트워크에서 사용하세요. 외부 공개와 인증 구성은 별도 배포 작업입니다.

서버 환경변수:

| 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `COMFY_URL` | `http://127.0.0.1:8188` | 고정 ComfyUI 백엔드 주소 |
| `PORT` | `4173` | 빌드 실행 서버 포트 |
| `HOST` | `0.0.0.0` | 수신 인터페이스 |

PowerShell 예: `$env:COMFY_URL='http://127.0.0.1:8188'; npm start`

## 사용 흐름

1. 연결 설정에서 서버 주소를 저장하고 연결을 확인합니다. 미리보기 모드는 샘플 일러스트로 UI만 체험합니다. 실제 GPU 작업을 요청하지 않습니다.
2. Flux1.d, krea2, moss, qwen 2.1 중 계열을 고르고 모델을 선택합니다. 계열에 맞는 인코더, VAE와 기본 생성 설정을 자동으로 준비합니다. 프롬프트와 비율을 정한 뒤 이미지 생성을 누르세요. JSON 파일을 가져올 필요가 없습니다. 해당 계열의 LoRA만 선택 목록에 표시하며 Flux1.d는 모델/CLIP 강도, 나머지 계열은 모델 강도를 조절합니다.
3. 고급 설정에서 해상도, Seed와 무작위 생성, steps, CFG, sampler, scheduler, denoise를 조절합니다. Flux.1 구성은 CLIP L, T5, VAE와 guidance를 지원합니다.
4. 이미지 생성 후 실시간 진행과 결과를 확인합니다. WebSocket 재접속 중에도 HTTP 폴링으로 기록과 큐를 확인합니다. 실행 중인 작업은 계속 추적하며, 대기 취소는 해당 prompt ID만 삭제합니다. 서버 전역 interrupt를 호출하지 않습니다.
5. 기록에서 상세 이미지, 배치 결과, 저장과 설정 재사용을 사용합니다. 앱에서 제출한 최근 500개 기록을 IndexedDB에 보관합니다. 서버의 전체 기록을 가져오거나 삭제하지 않습니다.
6. 상단 저장 버튼으로 현재 설정을 프리셋에 저장합니다. 프리셋에서 상세 보기, 적용, 이름과 설명 수정, 현재 설정으로 교체, 복제, 삭제와 JSON 가져오기/내보내기를 사용합니다. 가져오기는 항상 새 항목을 추가합니다. 최대 100개를 보관합니다.

## 모델과 API 워크플로

모델 목록은 `CheckpointLoaderSimple`, `UNETLoader`, `UnetLoaderGGUF`와 대체 GGUF 로더의 설치값을 합칩니다. 같은 GGUF 파일이 여러 로더에 나와도 한 번만 표시하며 원래 파일명과 로더를 함께 저장합니다. 설치 목록 새로고침으로 서버의 변경 사항을 다시 읽을 수 있습니다.

지원 계열은 **Flux1.d, krea2, moss, qwen 2.1 네 가지**입니다. 모델 목록에는 이 네 계열의 텍스트 이미지 생성 모델을 표시합니다. 참조 이미지가 필요한 Kontext/편집 모델, 영상 모델과 별도 Nunchaku 구성이 필요한 모델은 기본 목록에서 제외합니다. 기존의 다른 계열 설정은 프롬프트를 보존하며 지원 계열로 정리합니다.

계열별 자동 구성:

| 계열 | 텍스트 인코더 | VAE | 기본 Steps / CFG |
| --- | --- | --- | --- |
| Flux1.d | CLIP L + T5 XXL | Flux AE | 24 / 1, guidance 3.5 |
| krea2 | Qwen3-VL 4B, krea2 타입 | Qwen Image VAE | 8 / 1 |
| moss | Qwen3.5 9B, moss_image 타입 | Flux2 VAE | 24 / 4 |
| qwen 2.1 | Qwen3-VL 8B, qwen_image 타입 | Qwen Image 2.1 VAE | 28 / 4 |

Krea2는 해상도에 맞는 Flux 샘플링 설정을 연결하고, MOSS와 Qwen 2.1은 공간 축소율 16의 잠재 이미지를 사용합니다. ComfyUI가 빈 잠재 이미지의 채널을 모델에 맞게 조정하며, 요청한 가로/세로와 배치 수를 유지합니다. Qwen 2.1은 전용 텍스트 인코딩 노드에서 긍정/부정 프롬프트를 함께 처리합니다. Flux1.d와 krea2의 해상도는 16의 배수, moss와 qwen 2.1은 32의 배수로 입력하세요.

LoRA도 네 계열에 맞게 분류합니다. 이전 Qwen Image의 LoRA는 Qwen 2.1 목록에 자동으로 섞지 않습니다. 모델 카드의 분류 버튼에서 호환성을 확인한 파일을 직접 지정할 수 있으며 분류 정보는 이 기기에 저장됩니다. 계열 변경 시 다른 계열 LoRA를 해제합니다. Krea2, MOSS와 Qwen 2.1은 모델 전용 LoRA 노드를 사용합니다. GGUF 인코더를 선택하면 GGUF 전용 CLIP 로더를 연결합니다.

GGUF를 사용하려면 서버에 ComfyUI-GGUF 등 호환 로더와 해당 파일이 있어야 합니다. 보통 diffusion GGUF는 `models/diffusion_models` 또는 `models/unet`, 텍스트 인코더 GGUF는 `models/text_encoders` 또는 `models/clip`에 둡니다. 앱은 설치나 모델 다운로드를 수행하지 않습니다. 서버가 반환하는 GGUF 파일이 없으면 목록에 0개와 설치 안내를 표시합니다. GGUF는 저장 형식이며 모든 계열에 공통으로 호환되는 모델 종류가 아닙니다.

일반 생성에서는 아래 고급 도구가 필요하지 않습니다. 생성 그래프를 별도로 점검하거나 수정할 때는 ComfyUI의 **API 형식 JSON**을 사용할 수 있습니다. 일반 편집기 JSON(`nodes`, `links`)은 지원하지 않습니다.

- 고급 설정의 API 워크플로 탭에서 JSON을 가져옵니다. 최대 2MB와 500개 노드를 허용합니다.
- 가져온 그래프의 연결을 유지하며 문자열, 숫자, 불리언과 서버 스키마의 선택 입력을 편집합니다.
- 가져온 그래프가 활성화되면 기본 생성 설정은 잠깁니다. Seed를 포함한 그래프 내 값만 실행합니다.
- 서버에 없는 노드와 설치값, 필수 입력과 숫자 범위를 확인합니다. 서버의 최종 검증 오류는 작업 상세에 표시합니다.
- 이미지 결과는 노드의 `images` 출력을 수집합니다. 파일 업로드, 마스크 편집과 영상/오디오 결과 재생은 현재 UI 범위에 포함되지 않습니다. 복합 입력은 원본 JSON을 수정한 뒤 다시 가져옵니다.
- 그래프를 내보낸 후 기본 생성으로 돌아갈 수 있습니다. 워크플로도 프리셋과 생성 기록에 함께 저장합니다.

## 연결 구조

기본 `/comfy` 경로는 앱 서버가 고정 백엔드로 전달합니다. 개발 서버와 빌드 서버 모두 HTTP와 WebSocket을 프록시합니다. 외부 Origin을 거부한 후 ComfyUI의 Host/Origin 검사에 맞게 전달하므로, ComfyUI에서 CORS를 전체 허용할 필요가 없습니다. 임의의 URL을 받는 범용 프록시는 제공하지 않습니다.

직접 주소를 연결할 때는 ComfyUI에서 앱 Origin의 CORS를 허용해야 합니다. HTTPS 프런트엔드에서 HTTP 백엔드에 직접 연결하면 혼합 콘텐츠 제한이 있으므로 `/comfy` 또는 HTTPS 백엔드를 사용하세요. 모바일에서 `localhost`는 모바일 기기 자신을 가리킵니다. PC 백엔드에는 `/comfy` 연결을 권장합니다.

## PWA와 로컬 데이터

홈 화면 설치와 서비스워커는 HTTPS 또는 `localhost`에서 동작합니다. LAN의 일반 HTTP 주소에서는 화면과 생성 기능을 사용할 수 있으며 설치와 오프라인 기능에는 HTTPS가 필요합니다. Safari는 공유 메뉴의 홈 화면에 추가를 사용합니다. 새 서비스워커가 대기하면 업데이트 버튼을 제공합니다.

서비스워커는 번들, 폰트, 아이콘과 명시된 샘플만 캐시합니다. ComfyUI API와 생성 이미지 원본은 캐시하지 않습니다. 프롬프트, 서버 주소, 프리셋과 작업 스냅샷은 브라우저 localStorage에 저장하므로 공유 기기에서는 확인하세요. 브라우저 데이터를 삭제하면 함께 삭제됩니다. 중요한 설정은 프리셋 JSON으로 내보내세요. 오프라인에서도 저장된 설정과 프리셋을 편집할 수 있습니다. 실제 이미지 생성에는 연결이 필요합니다.

## 검증

```sh
npm test
npm run build
npm run test:e2e
```

실제 GPU의 네 계열 검사는 기본 테스트와 분리했습니다. 서버가 대기 중일 때만 실행하며 각 계열의 설치 모델로 256×256, 4 steps 이미지를 한 장씩 요청합니다. PNG 크기까지 확인하고 `docs/real-four/`에 요청/결과를 보관합니다.

```sh
npm run test:real
```

단위 테스트는 그래프와 LoRA 연결, Flux 구성, 잘못된 입력과 프리셋 스냅샷을 검증합니다. 통합 테스트는 4174와 8799 포트의 격리된 프로토콜 서버를 자동 실행하고 종료합니다. 실제 GPU 서버와 분리되며 생성, 배치, 오류와 취소, 프리셋, 워크플로, 오프라인 PWA와 325/390/1440px 화면을 확인합니다. Windows Chrome 경로는 `playwright.config.ts`에서 설정합니다.

실제 서버가 대기 중이고 이 프로젝트 앱 서버가 실행 중일 때만 다음 검사를 실행합니다. 검증 스크립트는 지정된 Flux.1 diffusion 모델이 설치된 로컬 환경 전용입니다. 작은 풍경 한 장을 실제로 요청하며 요청, 결과와 화면 증거를 무시 경로 `docs/`에 저장합니다.

```sh
node scripts/verify-real.mjs
```

아이콘을 수정할 때 SVG와 `scripts/build-icons.py`의 도형을 함께 갱신한 뒤 실행합니다.

```sh
uv run --with pillow python scripts/build-icons.py
```

공용 Modal과 SelectControl의 프로젝트 적용은 기존 공용 컴포넌트 규격을 따릅니다. 화면은 독립적으로 설계했으며 외부 브랜드 디자인 토큰을 복사하지 않았습니다.

API 근거: [ComfyUI 서버 라우트](https://docs.comfy.org/development/comfyui-server/comms_routes), [공식 서버 구현](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py), [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF), [Vite 프록시](https://vite.dev/config/server-options#server-proxy).
