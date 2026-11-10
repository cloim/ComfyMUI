import { CloudDownload, X } from 'lucide-react';
import type { TrackedDownload } from '../downloads';
import { formatBytes } from '../lora-manager';
import { IconButton } from './ui';

// Active server-side downloads. They keep running when the app is closed.
export function DownloadTray({
  downloads,
  onCancel,
}: {
  downloads: TrackedDownload[];
  onCancel: (id: string) => void;
}) {
  if (downloads.length === 0) return null;
  return (
    <section
      aria-label="진행 중인 다운로드"
      className="flex flex-none flex-col gap-1.5 border-b border-line bg-paper px-4 py-2.5 sm:px-5 lg:px-6"
    >
      {downloads.map((d) => {
        const percent = Math.round(d.progress);
        return (
          <div
            key={d.id}
            className="flex items-center gap-2.5 rounded-lg border border-line bg-white py-1.5 pl-3 pr-1"
          >
            <CloudDownload size={15} aria-hidden="true" className="shrink-0 text-olive" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-semibold text-ink">{d.name}</span>
                <span className="flex shrink-0 gap-2 font-mono text-2xs text-muted">
                  {d.bytesPerSecond ? <span>{formatBytes(d.bytesPerSecond)}/s</span> : null}
                  <span>{percent}%</span>
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${d.name} 다운로드 진행률`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-1.5 w-full overflow-hidden rounded-full bg-stone"
              >
                <div
                  className="h-full rounded-full bg-olive transition-[width] duration-300"
                  style={{ width: `${Math.max(3, percent)}%` }}
                />
              </div>
            </div>
            <IconButton icon={X} label={`${d.name} 다운로드 취소`} onClick={() => onCancel(d.id)} />
          </div>
        );
      })}
    </section>
  );
}
