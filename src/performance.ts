export type PowerPreferences = { saving: boolean; keepScreen: boolean; backgroundAudio: boolean };
export const defaultPower: PowerPreferences = {
  saving: true,
  keepScreen: false,
  backgroundAudio: false,
};

export function previewInterval(saving: boolean, hidden: boolean, slow: boolean): number {
  if (hidden) return 5000;
  return saving || slow ? 1500 : 200;
}

// Coalesce frequent progress saves; terminal state changes can explicitly flush.
export function deferredWriter<T>(write: (value: T) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: { value: T } | undefined;
  function flush() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!latest) return;
    const pending = latest;
    latest = undefined;
    write(pending.value);
  }
  return {
    schedule(value: T, immediate = false) {
      latest = { value };
      if (immediate) flush();
      else if (timer === undefined) timer = setTimeout(flush, delay);
    },
    flush,
  };
}
