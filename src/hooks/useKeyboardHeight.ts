import { useEffect, useState } from 'react';

/** Tracks soft-keyboard overlap via Visual Viewport API (iOS Safari + Android Chrome). */
export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handler = () => {
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardHeight(Math.max(0, gap));
    };

    handler();
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
    };
  }, []);

  return keyboardHeight;
}
