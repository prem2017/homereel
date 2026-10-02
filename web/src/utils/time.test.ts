import { describe, it, expect } from 'vitest';
import { formatTime } from './time';

describe('formatTime', () => {
  it('writes minutes and seconds, and hours only when there are some', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(3723)).toBe('1:02:03');
  });

  it('keeps counting past a day', () => {
    expect(formatTime(25 * 3600)).toBe('25:00:00');
  });

  it('says nothing it does not know', () => {
    // An infinite duration is what a WebM or MKV without a duration field reports.
    expect(formatTime(Infinity)).toBe('--:--');
    expect(formatTime(NaN)).toBe('--:--');
  });
});
