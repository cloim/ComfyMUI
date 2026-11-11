// Cards contain a 3:4 image, a 76px footer, two borders and a 12px row gap.
export function galleryRowHeight(width: number, columns: number) {
  const imageWidth = Math.max(1, (width - (columns - 1) * 12) / columns - 2);
  return (imageWidth * 4) / 3 + 90;
}

export function galleryWindow(
  count: number,
  columns: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
) {
  const rows = Math.ceil(count / columns);
  if (count <= 80) return { start: 0, end: count, top: 0, bottom: 0 };
  const first = Math.min(Math.max(0, rows - 1), Math.max(0, Math.floor(scrollTop / rowHeight) - 2));
  const last = Math.min(rows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 2);
  return {
    start: first * columns,
    end: Math.min(count, Math.max(first + 1, last) * columns),
    top: first * rowHeight,
    bottom: Math.max(0, rows - Math.max(first + 1, last)) * rowHeight,
  };
}

export type GalleryView = {
  search: string;
  family: string;
  lora: string;
  experiment: string;
  scrollTop: number;
};

export const GALLERY_VIEW_KEY = 'cm-gallery-view';

export function readGalleryView(): GalleryView {
  const empty = { search: '', family: 'all', lora: 'all', experiment: 'all', scrollTop: 0 };
  try {
    const raw = JSON.parse(sessionStorage.getItem(GALLERY_VIEW_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return empty;
    return {
      search: typeof raw.search === 'string' ? raw.search : '',
      family: ['all', 'flux', 'krea2', 'moss', 'qwen21'].includes(raw.family) ? raw.family : 'all',
      lora: ['all', 'with_lora', 'without_lora'].includes(raw.lora) ? raw.lora : 'all',
      experiment: typeof raw.experiment === 'string' ? raw.experiment : 'all',
      scrollTop:
        typeof raw.scrollTop === 'number' && Number.isFinite(raw.scrollTop)
          ? Math.max(0, raw.scrollTop)
          : 0,
    };
  } catch {
    return empty;
  }
}
