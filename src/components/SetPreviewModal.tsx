import { useEffect, useState } from 'react';
import { Check, Image as ImageIcon, Layers, LoaderCircle, Sparkles } from 'lucide-react';
import type { Job } from '../domain';
import { imageUrl, thumbnailUrl } from '../api';
import { useStudio } from '../studio';
import {
  fetchModelList,
  matchModelItem,
  modelPreviewUrl,
  type ModelManagerItem,
} from '../model-manager';
import {
  fetchLoraList,
  matchLoraItem,
  loraPreviewUrl,
  replacePreview,
  type LoraItem,
} from '../lora-manager';
import { Modal, Spinner } from './ui';

export function SetPreviewModal({
  open,
  onClose,
  job,
}: {
  open: boolean;
  onClose: () => void;
  job: Job | null;
}) {
  const { connection, notify, info } = useStudio();
  const [loading, setLoading] = useState(false);
  const [modelItem, setModelItem] = useState<ModelManagerItem | null>(null);
  const [loraMap, setLoraMap] = useState<Map<string, LoraItem>>(new Map());
  const [settingTarget, setSettingTarget] = useState<string | null>(null);
  const [doneTargets, setDoneTargets] = useState<Set<string>>(new Set());

  const imageRef = job?.images?.[0];
  const modelName = job?.settings?.model || '';
  const loras = job?.settings?.loras || [];

  useEffect(() => {
    if (!open || !job || !imageRef) {
      setModelItem(null);
      setLoraMap(new Map());
      setSettingTarget(null);
      setDoneTargets(new Set());
      return;
    }

    let alive = true;
    setLoading(true);

    Promise.all([
      fetchModelList(connection.base, { pageSize: 1000 }).catch(() => ({ items: [] })),
      loras.length > 0
        ? fetchLoraList(connection.base, { pageSize: 1000 }).catch(() => ({ items: [] }))
        : Promise.resolve({ items: [] }),
    ])
      .then(([modelsRes, lorasRes]) => {
        if (!alive) return;
        const matchedModel = matchModelItem(modelName, modelsRes.items, info);
        setModelItem(matchedModel);

        const map = new Map<string, LoraItem>();
        for (const lora of loras) {
          const matched = matchLoraItem(lora.name, lorasRes.items);
          if (matched) {
            map.set(lora.name, matched);
          }
        }
        setLoraMap(map);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [open, job?.id, modelName, connection.base, info]);

  async function handleSetModelPreview() {
    if (!job || !imageRef || !modelItem || settingTarget) return;
    setSettingTarget('model');
    try {
      const srcUrl = imageUrl(job.base, imageRef);
      const res = await fetch(srcUrl);
      if (!res.ok) throw new Error('생성된 이미지를 불러오지 못했어요');
      const blob = await res.blob();

      const updated = await replacePreview(
        connection.base,
        'checkpoints',
        modelItem.file_path,
        blob,
        imageRef.filename,
      );

      const bust = `${updated.preview_url}${updated.preview_url.includes('?') ? '&' : '?'}v=${Date.now()}`;
      setModelItem((prev) => (prev ? { ...prev, preview_url: bust } : null));
      setDoneTargets((prev) => new Set(prev).add('model'));
      notify(`'${modelItem.file_name}' 대표 이미지로 설정했어요`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSettingTarget(null);
    }
  }

  async function handleSetLoraPreview(loraName: string) {
    if (!job || !imageRef || settingTarget) return;
    const loraItem = loraMap.get(loraName);
    if (!loraItem) return;

    setSettingTarget(loraName);
    try {
      const srcUrl = imageUrl(job.base, imageRef);
      const res = await fetch(srcUrl);
      if (!res.ok) throw new Error('생성된 이미지를 불러오지 못했어요');
      const blob = await res.blob();

      const updated = await replacePreview(
        connection.base,
        'loras',
        loraItem.file_path,
        blob,
        imageRef.filename,
      );

      const bust = `${updated.preview_url}${updated.preview_url.includes('?') ? '&' : '?'}v=${Date.now()}`;
      setLoraMap((prev) => {
        const next = new Map(prev);
        next.set(loraName, { ...loraItem, preview_url: bust });
        return next;
      });
      setDoneTargets((prev) => new Set(prev).add(loraName));
      notify(`'${loraItem.file_name}' 대표 이미지로 설정했어요`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSettingTarget(null);
    }
  }

  if (!job || !imageRef) return null;

  return (
    <Modal title="대표 이미지 설정" open={open} onClose={onClose} size="md">
      <div className="flex flex-col gap-4 text-xs">
        {/* Selected Image Banner */}
        <div className="flex items-center gap-3 rounded-xl bg-paper p-3 border border-line">
          <div className="relative aspect-[3/4] w-14 shrink-0 overflow-hidden rounded-lg bg-stone">
            <img
              src={thumbnailUrl(job.base, imageRef)}
              alt="선택된 생성 이미지"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-ink">
              {job.settings.positive.slice(0, 60) || '생성된 이미지'}
            </p>
            <p className="mt-1 truncate text-2xs text-muted">
              {job.settings.width} × {job.settings.height} | {job.settings.architecture}
            </p>
            {loras.length > 0 && (
              <p className="mt-0.5 text-2xs text-olive font-medium">LoRA {loras.length}개 적용됨</p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex h-36 flex-col items-center justify-center gap-2 text-muted">
            <Spinner />
            <span className="text-2xs">모델과 LoRA 정보를 확인하는 중...</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Model Section */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-ink">
                <Sparkles size={14} className="text-olive" aria-hidden="true" />
                <span>체크포인트 모델</span>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {modelItem?.preview_url ? (
                    <img
                      src={modelPreviewUrl(connection.base, modelItem.preview_url)}
                      alt="현재 모델 대표 이미지"
                      className="h-10 w-10 shrink-0 rounded-lg object-cover bg-stone"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone text-muted">
                      <ImageIcon size={18} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">
                      {modelItem ? modelItem.model_name || modelItem.file_name : modelName}
                    </p>
                    <p className="truncate text-2xs text-muted">
                      {modelItem ? modelItem.file_path : '모델 매니저에서 파일을 찾을 수 없습니다'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!modelItem || settingTarget !== null}
                  onClick={handleSetModelPreview}
                  className={`btn-secondary shrink-0 text-xs ${
                    doneTargets.has('model')
                      ? 'border-olive text-olive font-semibold'
                      : 'btn-primary'
                  }`}
                >
                  {settingTarget === 'model' ? (
                    <>
                      <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                      설정 중
                    </>
                  ) : doneTargets.has('model') ? (
                    <>
                      <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                      설정 완료
                    </>
                  ) : (
                    '대표 이미지로 설정'
                  )}
                </button>
              </div>
            </div>

            {/* LoRA Section */}
            {loras.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-ink">
                  <Layers size={14} className="text-olive" aria-hidden="true" />
                  <span>적용된 LoRA ({loras.length})</span>
                </div>

                <div className="flex flex-col gap-2">
                  {loras.map((lora) => {
                    const item = loraMap.get(lora.name);
                    const isSetting = settingTarget === lora.name;
                    const isDone = doneTargets.has(lora.name);

                    return (
                      <div
                        key={lora.name}
                        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {item?.preview_url ? (
                            <img
                              src={loraPreviewUrl(connection.base, item.preview_url)}
                              alt="현재 LoRA 대표 이미지"
                              className="h-10 w-10 shrink-0 rounded-lg object-cover bg-stone"
                            />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone text-muted">
                              <ImageIcon size={18} />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-ink">
                              {item ? item.model_name || item.file_name : lora.name}
                            </p>
                            <p className="truncate text-2xs text-muted">
                              가중치: {lora.model} (CLIP: {lora.clip})
                              {item ? ` | ${item.folder || '루트'}` : ' | LoRA 목록에 없음'}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={!item || settingTarget !== null}
                          onClick={() => handleSetLoraPreview(lora.name)}
                          className={`btn-secondary shrink-0 text-xs ${
                            isDone ? 'border-olive text-olive font-semibold' : 'btn-primary'
                          }`}
                        >
                          {isSetting ? (
                            <>
                              <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                              설정 중
                            </>
                          ) : isDone ? (
                            <>
                              <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                              설정 완료
                            </>
                          ) : (
                            '대표 이미지로 설정'
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
