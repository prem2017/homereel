import { describe, it, expect, beforeEach } from 'vitest';
import { TEXT_SCALES, cycleTextScale, readTextScale } from './textScale';

const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
  setItem: (k: string, v: string) => { memory.set(k, v); },
  removeItem: (k: string) => { memory.delete(k); },
};

describe('text scale', () => {
  beforeEach(() => memory.clear());

  it('starts at 100% and goes round 125%, 150% and back', () => {
    expect(readTextScale()).toBe(1);
    expect(cycleTextScale(1)).toBe(1.25);
    expect(cycleTextScale(1.25)).toBe(1.5);
    expect(cycleTextScale(1.5)).toBe(1);
    expect(TEXT_SCALES).toEqual([1, 1.25, 1.5]);
  });

  it('remembers the size, and ignores one it does not offer', () => {
    cycleTextScale(1);
    expect(readTextScale()).toBe(1.25);
    memory.set('media-player:prefs', JSON.stringify({ 'text-scale': 3 }));
    expect(readTextScale()).toBe(1);
  });
});
