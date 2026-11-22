import { expect, it } from 'vitest';
import {
  pairAfterEdit,
  pairAfterTranslate,
  swapTranslationPair,
  type TranslationPair,
} from '../src/prompt-translation';

const pair: TranslationPair = { current: 'a cat', other: '고양이', showing: 'translated' };

it('keeps the original when a translation is created', () => {
  expect(pairAfterTranslate(null, '고양이', 'a cat')).toEqual(pair);
});

it('swaps both sides without losing either one', () => {
  const swapped = swapTranslationPair(pair);
  expect(swapped).toEqual({ current: '고양이', other: 'a cat', showing: 'original' });
  expect(swapTranslationPair(swapped)).toEqual(pair);
});

it('keeps the first original when a translated prompt is translated again', () => {
  expect(pairAfterTranslate(pair, 'a cat', 'a small cat')).toEqual({
    current: 'a small cat',
    other: '고양이',
    showing: 'translated',
  });
});

it('uses the edited Korean as the new original', () => {
  const original = swapTranslationPair(pair);
  const edited = pairAfterEdit(original, '고양이', '검은 고양이')!;
  expect(pairAfterTranslate(edited, '검은 고양이', 'a black cat')).toEqual({
    current: 'a black cat',
    other: '검은 고양이',
    showing: 'translated',
  });
});

it('follows edits to the visible side and ignores a prompt loaded from elsewhere', () => {
  expect(pairAfterEdit(pair, 'a cat', 'a cat, night')).toEqual({
    ...pair,
    current: 'a cat, night',
  });
  expect(pairAfterEdit(pair, 'preset prompt', 'preset prompt, night')).toBe(pair);
});
