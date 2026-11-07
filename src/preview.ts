export function parseBinaryPreview(buffer: ArrayBuffer): { mime: string; blob: Blob } | null {
  if (buffer.byteLength <= 8) return null;
  const view = new DataView(buffer);
  const eventType = view.getUint32(0, false);
  if (eventType !== 1) return null; // 1 is PREVIEW_IMAGE in ComfyUI BinaryEventTypes
  const imageFormat = view.getUint32(4, false);
  const mime = imageFormat === 2 ? 'image/png' : 'image/jpeg';
  const imageBytes = buffer.slice(8);
  const blob = new Blob([imageBytes], { type: mime });
  return { mime, blob };
}
