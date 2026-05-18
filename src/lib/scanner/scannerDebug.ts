/** Debug timings when URL has `?scanner_debug=1`. */
export function isScannerDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('scanner_debug') === '1';
  } catch {
    return false;
  }
}

export function scannerDebugLog(label: string, extra?: Record<string, number | string | undefined>): void {
  if (!isScannerDebugEnabled()) return;
  const t = typeof performance !== 'undefined' ? performance.now().toFixed(1) : String(Date.now());
  if (extra && Object.keys(extra).length > 0) {
    console.log(`[scanner] ${label} @ ${t}ms`, extra);
  } else {
    console.log(`[scanner] ${label} @ ${t}ms`);
  }
}
