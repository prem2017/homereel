import { describe, it, expect } from 'vitest';
import { shapeOf, MIN_CHECKED_LENGTH } from './useSubsceneId';

/**
 * The half of the ID box that needs no network.
 *
 * It decides two things: whether what has been typed could be an id at all, and
 * whether it is long enough to be worth asking someone else's server about. The
 * second is the politeness rule - a prefix of an id is a request that can only
 * ever fail, and there is one per keystroke.
 */
describe('shapeOf', () => {
  it('accepts a real ID', () => {
    // The one from the bug report: sub-scene.com/subtitle/1863000
    expect(shapeOf('1863000')).toBe('ok');
    expect(shapeOf('  1863000  ')).toBe('ok');
  });

  it('rejects a whole URL pasted in, which is the usual mistake', () => {
    expect(shapeOf('https://sub-scene.com/subtitle/1863000')).toBe('bad');
    expect(shapeOf('1863000 ')).toBe('ok');
    expect(shapeOf('186 3000')).toBe('bad');
  });

  it('holds off until an ID is long enough to be worth a lookup', () => {
    expect(shapeOf('1')).toBe('short');
    expect(shapeOf('1863')).toBe('short');
    expect(shapeOf('1'.repeat(MIN_CHECKED_LENGTH))).toBe('ok');
  });

  it('says nothing about an empty box', () => {
    expect(shapeOf('')).toBe('empty');
    expect(shapeOf('   ')).toBe('empty');
  });
});
