export function validateThumbParams(filename?: unknown, subfolder?: unknown, type?: unknown): boolean {
  if (
    typeof filename !== 'string' ||
    !filename ||
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    return false;
  }
  if (
    subfolder &&
    (typeof subfolder !== 'string' || subfolder.includes('..') || subfolder.includes('\\'))
  ) {
    return false;
  }
  if (type && !['output', 'input', 'temp'].includes(type as string)) {
    return false;
  }
  return true;
}
