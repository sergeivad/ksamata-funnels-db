import { describe, it, expect } from 'vitest';
import { copyText } from '../src/lib/clipboard';

// Node environment has neither navigator.clipboard nor document — copyText
// must fail gracefully (return false), never throw. The success paths are
// browser-only and covered by manual verification.
describe('copyText', () => {
  it('returns false when no clipboard API is available, without throwing', async () => {
    expect(await copyText('https://example.com')).toBe(false);
  });

  it('returns false for empty and whitespace-only input', async () => {
    expect(await copyText('')).toBe(false);
    expect(await copyText('   ')).toBe(false);
  });
});
