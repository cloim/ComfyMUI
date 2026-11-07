import { useState, useEffect, useMemo, type RefObject } from 'react';
import { BookmarkPlus, Trash2, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import type { Job } from '../domain';

export type PromptSnippet = {
  id: string;
  title: string;
  content: string;
};

const DEFAULT_SNIPPETS: PromptSnippet[] = [
  {
    id: 'default-masterpiece',
    title: '디테일 강화',
    content: 'masterpiece, best quality, ultra-detailed',
  },
  {
    id: 'default-photo',
    title: '실사 인물',
    content: 'photorealistic, 8k uhd, delicate skin texture, soft natural lighting',
  },
  {
    id: 'default-anime',
    title: '애니메이션',
    content: 'anime style, vibrant colors, clean fine lines',
  },
  {
    id: 'default-cinematic',
    title: '시네마틱',
    content: 'cinematic lighting, moody atmosphere, 35mm photograph',
  },
];

const SNIPPET_STORAGE_KEY = 'cm-prompt-snippets';

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
  const [snippets, setSnippets] = useState<PromptSnippet[]>(() => {
    try {
      const stored = localStorage.getItem(SNIPPET_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    return DEFAULT_SNIPPETS;
  });

  const [showSnippets, setShowSnippets] = useState(false);
  const [newSnippetTitle, setNewSnippetTitle] = useState('');
  const [isAddingSnippet, setIsAddingSnippet] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SNIPPET_STORAGE_KEY, JSON.stringify(snippets));
    } catch {}
  }, [snippets]);

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

  const handleAddSnippet = () => {
    if (!value.trim()) return;
    const title = newSnippetTitle.trim() || value.slice(0, 16);
    const newSnippet: PromptSnippet = {
      id: 'snippet-' + Date.now(),
      title,
      content: value.trim(),
    };
    setSnippets((prev) => [newSnippet, ...prev]);
    setNewSnippetTitle('');
    setIsAddingSnippet(false);
  };

  const handleDeleteSnippet = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  };

  const handleApplySnippet = (content: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      onChange(content);
    } else {
      onChange(`${trimmed}, ${content}`);
    }
    setShowSnippets(false);
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
        <button
          type="button"
          className="ml-auto inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg border border-border bg-white px-2.5 font-medium text-ink hover:bg-paper active:scale-95"
          onClick={() => setShowSnippets((v) => !v)}
        >
          <Sparkles size={13} className="text-olive" />
          <span>스니펫 ({snippets.length})</span>
          {showSnippets ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
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

      {/* Snippets Panel (C4 스니펫 저장/불러오기) */}
      {showSnippets && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-ink">자주 쓰는 프롬프트 스니펫</span>
            {!isAddingSnippet && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-olive hover:bg-sand"
                onClick={() => setIsAddingSnippet(true)}
              >
                <BookmarkPlus size={13} />
                현재 프롬프트 저장
              </button>
            )}
          </div>

          {isAddingSnippet && (
            <div className="flex items-center gap-2 rounded-lg bg-sand/60 p-2">
              <input
                type="text"
                placeholder="스니펫 이름 (예: 실사 질감)"
                value={newSnippetTitle}
                onChange={(e) => setNewSnippetTitle(e.target.value)}
                className="input-text text-xs"
                autoFocus
              />
              <button
                type="button"
                className="btn-primary shrink-0 py-1 text-xs"
                onClick={handleAddSnippet}
              >
                저장
              </button>
              <button
                type="button"
                className="btn-secondary shrink-0 py-1 text-xs"
                onClick={() => setIsAddingSnippet(false)}
              >
                취소
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
            {snippets.map((snippet) => (
              <div
                key={snippet.id}
                role="button"
                tabIndex={0}
                className="group flex items-center justify-between gap-2 rounded-lg border border-border/60 p-2 hover:bg-sand/50 text-left transition-colors cursor-pointer"
                onClick={() => handleApplySnippet(snippet.content)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleApplySnippet(snippet.content);
                  }
                }}
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium text-ink">{snippet.title}</span>
                  <span className="truncate text-[11px] text-muted">{snippet.content}</span>
                </div>
                <button
                  type="button"
                  className="rounded p-1 text-muted hover:text-red-600 opacity-70 group-hover:opacity-100"
                  onClick={(e) => handleDeleteSnippet(snippet.id, e)}
                  title="스니펫 삭제"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
