export function detectScannerPlatform() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  /** Chromium exposes a fast on-device path; WebKit's implementation is spottier, so we keep WASM there. */
  const isLikelyChromium =
    typeof (window as Window & { chrome?: unknown }).chrome !== 'undefined' ||
    /Chrome|Chromium|Edg|OPR|Brave/i.test(ua);

  return {
    /** Prefer native on any non-iOS Chromium (desktop Chrome, Edge, etc.), not only Android. */
    preferNativeDetector: !isIOS && isLikelyChromium,
    isIOS,
    isAndroid,
  };
}
