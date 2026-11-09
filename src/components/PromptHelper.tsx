import { useMemo, type RefObject } from 'react';
import type { Job } from '../domain';

export function PromptHelper({
  value,
  onChange,
  jobs,
  textareaRef,
}: {
  value: string;
  onChange: (val: string) => void;
  jobs: Job[];
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  // Insert token or symbol at cursor position or wrap selection
  const insertText = (insert: string, wrapPattern?: { prefix: string; suffix: string }) => {
    const el = textareaRef?.current;
    if (!el) {
      // Fallback: append to end
      const trimmed = value.trim();
      const next = trimmed ? `${trimmed}, ${insert}` : insert;
      onChange(next);
      return;
    }

    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end);

    let nextValue = '';
    let newCursorPos = 0;

    if (selected && wrapPattern) {
      const wrapped = `${wrapPattern.prefix}${selected}${wrapPattern.suffix}`;
      nextValue = value.slice(0, start) + wrapped + value.slice(end);
      newCursorPos = start + wrapped.length;
    } else {
      nextValue = value.slice(0, start) + insert + value.slice(end);
      newCursorPos = start + insert.length;
    }

    onChange(nextValue);

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  // Extract recent prompt tokens from jobs history
  const recentTokens = useMemo(() => {
    const tokenCounts = new Map<string, number>();
    for (const j of jobs.slice(0, 50)) {
      if (!j.settings?.positive) continue;
      const parts = j.settings.positive.split(',');
      for (const raw of parts) {
        const token = raw.trim();
        if (token.length >= 2 && !token.includes(':') && !token.startsWith('(')) {
          tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
        }
      }
    }
    return Array.from(tokenCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([token]) => token);
  }, [jobs]);

  // Current incomplete token at cursor/end
  const currentIncompleteToken = useMemo(() => {
    const parts = value.split(',');
    const last = parts[parts.length - 1];
    return last ? last.trim().toLowerCase() : '';
  }, [value]);

  // Matching autocompletion suggestions
  const autocompleteSuggestions = useMemo(() => {
    if (!currentIncompleteToken || currentIncompleteToken.length < 2) return [];
    return recentTokens
      .filter(
        (t) =>
          t.toLowerCase().includes(currentIncompleteToken) &&
          t.toLowerCase() !== currentIncompleteToken,
      )
      .slice(0, 6);
  }, [recentTokens, currentIncompleteToken]);

  const applyAutocomplete = (token: string) => {
    const parts = value.split(',');
    parts.pop(); // Remove the current incomplete token
    const base = parts.join(',');
    const next = base.trim() ? `${base.trim()}, ${token}, ` : `${token}, `;
    onChange(next);
    if (textareaRef?.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    }
  };

  return (
    <div className="flex flex-col gap-2 pt-1 text-xs">
      {/* Keyboard Quick Bar (C4 보조 바) */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
        <span className="shrink-0 text-[11px] font-semibold text-muted">입력 보조:</span>
        <button
          type="button"
          tabIndex={-1}
          className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg bg-sand/70 px-2.5 font-mono text-xs font-bold text-ink hover:bg-sand active:scale-95"
          onClick={() => insertText('(', { prefix: '(', suffix: ')' })}
          title="괄호 감싸기 / 열기"
        >
          ( )
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg bg-sand/70 px-2.5 font-mono text-xs font-bold text-ink hover:bg-sand active:scale-95"
          onClick={() => insertText(', ')}
          title="쉼표 추가"
        >
          ,
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-sand/70 px-2.5 font-mono text-xs font-semibold text-ink hover:bg-sand active:scale-95"
          onClick={() => insertText(':1.2', { prefix: '(', suffix: ':1.2)' })}
          title="가중치 1.2"
        >
          :1.2
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-sand/70 px-2.5 font-mono text-xs font-semibold text-ink hover:bg-sand active:scale-95"
          onClick={() => insertText(':0.8', { prefix: '(', suffix: ':0.8)' })}
          title="가중치 0.8"
        >
          :0.8
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-sand/70 px-2.5 font-mono text-xs font-semibold text-ink hover:bg-sand active:scale-95"
          onClick={() => insertText('masterpiece, ')}
        >
          masterpiece
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-sand/70 px-2.5 font-mono text-xs font-semibold text-ink hover:bg-sand active:scale-95"
          onClick={() => insertText('8k uhd, ')}
        >
          8k
        </button>
      </div>

      {/* Autocomplete Suggestions Bar (C4 최근 프롬프트 자동완성) */}
      {autocompleteSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-olive/10 p-2">
          <span className="text-[11px] font-semibold text-olive">추천:</span>
          {autocompleteSuggestions.map((token) => (
            <button
              key={token}
              type="button"
              className="inline-flex min-h-[32px] items-center rounded-md bg-white px-2 py-1 text-xs font-medium text-ink shadow-2xs hover:bg-sand active:scale-95"
              onClick={() => applyAutocomplete(token)}
            >
              {token}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
