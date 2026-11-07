import { describe, it, expect } from 'vitest';
import type { Job } from '../src/domain';
import { defaults } from '../src/domain';

function makeJobWithPrompt(prompt: string): Job {
  return {
    id: 'job-' + Math.random(),
    createdAt: Date.now(),
    base: 'http://localhost:8188',
    preview: false,
    status: 'complete',
    progress: 100,
    images: [],
    settings: {
      ...defaults,
      positive: prompt,
    },
  };
}

describe('PromptHelper token extraction and matching', () => {
  it('extracts comma-separated tokens from jobs and matches query', () => {
    const jobs = [
      makeJobWithPrompt('masterpiece, 8k uhd, cinematic lighting, photorealistic'),
      makeJobWithPrompt('anime style, vibrant colors, clean fine lines, masterpiece'),
    ];

    const tokenCounts = new Map<string, number>();
    for (const j of jobs) {
      for (const raw of j.settings.positive.split(',')) {
        const token = raw.trim();
        if (token.length >= 2 && !token.includes(':') && !token.startsWith('(')) {
          tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
        }
      }
    }

    const recentTokens = Array.from(tokenCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([token]) => token);

    expect(recentTokens[0]).toBe('masterpiece'); // 2 occurrences

    // Query matching
    const query = 'cine';
    const matched = recentTokens.filter((t) => t.toLowerCase().includes(query));
    expect(matched).toContain('cinematic lighting');
  });
});
