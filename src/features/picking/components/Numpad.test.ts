import { describe, expect, it } from 'vitest';
import { applyNumKey } from './Numpad';

describe('applyNumKey', () => {
  it('replaces prefilled buffer on first digit then appends', () => {
    const replaceOnNextDigit = { current: true };
    let buf = '74';
    const setBuf = (v: string | ((p: string) => string)) => {
      buf = typeof v === 'function' ? v(buf) : v;
    };

    const first = applyNumKey('5', buf, setBuf, { replaceOnNextDigit });
    expect(first).toBe('5');
    expect(replaceOnNextDigit.current).toBe(false);

    const second = applyNumKey('0', buf, setBuf, { replaceOnNextDigit });
    expect(second).toBe('50');
  });

  it('clears with Clear key', () => {
    let buf = '109';
    const setBuf = (v: string | ((p: string) => string)) => {
      buf = typeof v === 'function' ? v(buf) : v;
    };

    const next = applyNumKey('C', buf, setBuf);
    expect(next).toBe('');
  });
});
