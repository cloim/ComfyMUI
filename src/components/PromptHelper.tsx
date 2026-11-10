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

  if (autocompleteSuggestions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 pt-2 text-xs">
      {/* Autocomplete Suggestions Bar (최근 프롬프트 자동완성) */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-olive/10 p-2">
        <span className="text-2xs font-semibold text-olive">추천:</span>
        {autocompleteSuggestions.map((token) => (
          <button
            key={token}
            type="button"
            className="inline-flex min-h-[32px] items-center rounded-md bg-white px-2 py-1 text-xs font-medium text-ink shadow-2xs hover:bg-stone active:scale-95"
            onClick={() => applyAutocomplete(token)}
          >
            {token}
          </button>
        ))}
      </div>
    </div>
  );
}
