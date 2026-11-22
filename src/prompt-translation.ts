// Keeps the two sides of a translated prompt so either one can be restored without
// calling the model again. It stays on this device, like an unsent draft.
export type TranslationPair = {
  current: string;
  other: string;
  showing: 'translated' | 'original';
};

const STORAGE_KEY = 'cm-prompt-translation';

export function loadTranslationPair(): TranslationPair | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return typeof value?.current === 'string' &&
      typeof value?.other === 'string' &&
      (value?.showing === 'translated' || value?.showing === 'original')
      ? value
      : null;
  } catch {
    return null;
  }
}

export function saveTranslationPair(pair: TranslationPair | null) {
  try {
    if (pair) localStorage.setItem(STORAGE_KEY, JSON.stringify(pair));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The pair still works until this page is closed.
  }
}

// Translating an already translated prompt again keeps the first Korean original.
export function pairAfterTranslate(
  pair: TranslationPair | null,
  source: string,
  translated: string,
): TranslationPair {
  const keepsOriginal = pair?.showing === 'translated' && pair.current === source;
  return { current: translated, other: keepsOriginal ? pair.other : source, showing: 'translated' };
}

export function swapTranslationPair(pair: TranslationPair): TranslationPair {
  return {
    current: pair.other,
    other: pair.current,
    showing: pair.showing === 'translated' ? 'original' : 'translated',
  };
}

// Only edits made to the visible side carry over; a prompt loaded from elsewhere does not.
export function pairAfterEdit(pair: TranslationPair | null, previous: string, next: string) {
  return pair && pair.current === previous ? { ...pair, current: next } : pair;
}
