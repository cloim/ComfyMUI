import { SelectControl } from './ui';

export function orderDownloadRoots(roots: string[]): string[] {
  const rank = (root: string) => {
    const path = root.replaceAll('\\', '/');
    return (
      (/^\/data\/models(?:-view)?\//.test(path) ? 0 : path.startsWith('/host-models/') ? 2 : 1) *
        2 +
      (/\/diffusion_models\/?$/.test(path) ? 0 : 1)
    );
  };
  return [...new Set(roots)].sort((a, b) => rank(a) - rank(b));
}

function locationLabel(root: string) {
  const path = root.replaceAll('\\', '/');
  if (/^\/data\/models(?:-view)?\//.test(path))
    return `Docker 볼륨 / ${path.replace(/^\/data\/models(?:-view)?\//, '')}`;
  if (path.startsWith('/host-models/')) return `로컬 모델 폴더 / ${path.slice(13)}`;
  return root;
}

export function DownloadLocation({
  roots,
  value,
  onChange,
}: {
  roots: string[];
  value: string;
  onChange: (root: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold">
      저장 위치
      <SelectControl
        aria-label="다운로드 저장 위치"
        value={value || roots[0] || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={!roots.length}
      >
        {!roots.length && <option value="">저장 위치를 불러오는 중</option>}
        {roots.map((root) => (
          <option key={root} value={root}>
            {locationLabel(root)}
          </option>
        ))}
      </SelectControl>
    </label>
  );
}
