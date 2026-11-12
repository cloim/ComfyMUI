import { useEffect, useState } from 'react';
import { useStudio } from './studio';
import {
  fetchExampleImages,
  setPreviewFromUrl,
  type CivitaiImage,
  type ExampleKind,
} from './lora-manager';

type Target = { file_path: string; sha256?: string };
// The hash keeps the record valid after a rename or move and matches across devices.
const keyOf = (t: Target) => t.sha256 || t.file_path;

export function canBecomeDefault(image: CivitaiImage): boolean {
  return /^https?:\/\//i.test(image.url);
}

export function useExampleImages(
  kind: ExampleKind,
  target: Target | null,
  onPreviewChanged: (filePath: string, previewUrl: string, nsfwLevel: number) => void,
  // Bump after a metadata sync or relink to read the examples again.
  revision = 0,
) {
  const { connection, notify, exampleDefaults, setExampleDefaults } = useStudio();
  const [images, setImages] = useState<CivitaiImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settingUrl, setSettingUrl] = useState('');
  const path = target?.file_path || '';

  useEffect(() => {
    setImages([]);
    setError('');
    if (!path) return;
    let alive = true;
    setLoading(true);
    fetchExampleImages(connection.base, kind, path)
      .then((list) => alive && setImages(list))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      setLoading(false);
    };
  }, [kind, path, revision, connection.base]);

  async function setDefault(image: CivitaiImage) {
    if (!target || settingUrl) return;
    const key = keyOf(target);
    if (exampleDefaults[key] === image.url) return;
    setSettingUrl(image.url);
    try {
      const res = await setPreviewFromUrl(connection.base, kind, target.file_path, image);
      // Same file name as before, so bust the browser cache for the card image.
      const bust = `${res.preview_url}${res.preview_url.includes('?') ? '&' : '?'}v=${Date.now()}`;
      onPreviewChanged(target.file_path, bust, res.preview_nsfw_level);
      setExampleDefaults((prev) => ({ ...prev, [key]: image.url }));
      notify('기본 이미지로 설정했어요');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSettingUrl('');
    }
  }

  return {
    images,
    loading,
    error,
    defaultUrl: target ? exampleDefaults[keyOf(target)] || '' : '',
    settingUrl,
    setDefault,
  };
}
