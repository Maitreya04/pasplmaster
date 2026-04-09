import { useState, useCallback } from 'react';

const RESET_DELAY_MS = 1500;

/**
 * One-tap clipboard copy with visual confirmation.
 *
 * Returns a `copy(text)` function and a `copiedId` string — the last value
 * that was successfully copied (or empty string). Components can compare
 * their own identifier to `copiedId` to show a ✓ indicator.
 *
 * Falls back to `document.execCommand('copy')` for older browsers (iOS < 13.3).
 */
export function useCopyToClipboard(): {
  copy: (text: string, id?: string) => Promise<boolean>;
  copiedId: string;
} {
  const [copiedId, setCopiedId] = useState('');

  const copy = useCallback(async (text: string, id = text): Promise<boolean> => {
    if (!text) return false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older WebKit
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        if (!ok) return false;
      }

      setCopiedId(id);
      setTimeout(() => setCopiedId(''), RESET_DELAY_MS);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { copy, copiedId };
}
