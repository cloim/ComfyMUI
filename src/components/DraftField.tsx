import { useEffect, useRef, useState, type ComponentPropsWithRef } from 'react';

// Text fields bound to the shared studio store.
// The store publishes a new value one render after the keystroke. A controlled field that
// waits for it is reset to the old text in between, which breaks IME composition: each
// Hangul syllable is entered twice. These fields show their own text at once and pass it
// on; a value that changes from outside (AI rewrite, another device) still replaces it.
function useDraft(value: string, onValueChange: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  // Values sent but not yet echoed back by the store, oldest first.
  const sent = useRef<string[]>([]);
  useEffect(() => {
    const echoed = sent.current.lastIndexOf(value);
    if (echoed >= 0) {
      sent.current.splice(0, echoed + 1);
      return;
    }
    sent.current = [];
    setDraft(value);
  }, [value]);
  const change = (next: string) => {
    sent.current.push(next);
    if (sent.current.length > 100) sent.current.shift();
    setDraft(next);
    onValueChange(next);
  };
  return [draft, change] as const;
}

type DraftProps<T> = Omit<T, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function DraftInput({
  value,
  onValueChange,
  ...rest
}: DraftProps<ComponentPropsWithRef<'input'>>) {
  const [draft, change] = useDraft(value, onValueChange);
  return <input {...rest} value={draft} onChange={(e) => change(e.target.value)} />;
}

export function DraftTextarea({
  value,
  onValueChange,
  ...rest
}: DraftProps<ComponentPropsWithRef<'textarea'>>) {
  const [draft, change] = useDraft(value, onValueChange);
  return <textarea {...rest} value={draft} onChange={(e) => change(e.target.value)} />;
}
