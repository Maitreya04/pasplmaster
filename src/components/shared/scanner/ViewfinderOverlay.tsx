import type { RefObject } from 'react';
import type { DisplayBox } from '../../../hooks/useQRScanner';

export interface ViewfinderOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  supportMessage: string | null;
  detectedBox: DisplayBox | null;
  flashColor: 'green' | 'red' | null;
}

export function ViewfinderOverlay({
  videoRef,
  supportMessage,
  detectedBox,
  flashColor,
}: ViewfinderOverlayProps): React.JSX.Element {
  if (supportMessage) {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <div className="max-w-sm rounded-[20px] border border-amber-400/20 bg-amber-400/10 p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">
            Browser Limitation
          </p>
          <p className="mt-3 text-base font-semibold text-white">Live scanning not available</p>
          <p className="mt-2 text-sm leading-relaxed text-amber-50/80">{supportMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
      {/* Aim guide + animated scan line */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative h-48 w-64 overflow-hidden rounded-[20px] border-2 border-emerald-400/70 shadow-[0_0_0_9999px_rgba(2,6,23,0.35)]">
          <div
            className="scanner-scan-line pointer-events-none absolute inset-x-[12%] h-[2px] rounded-full bg-emerald-400/80 shadow-[0_0_14px_rgba(52,211,153,0.55)]"
            aria-hidden
          />
        </div>
      </div>
      {detectedBox && (
        <div
          className="pointer-events-none absolute rounded-xl border-2 border-emerald-300 shadow-[0_0_24px_rgba(52,211,153,0.45)]"
          style={{
            left: detectedBox.left,
            top: detectedBox.top,
            width: detectedBox.width,
            height: detectedBox.height,
            transition: 'all 90ms linear',
          }}
        />
      )}
      {flashColor && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              flashColor === 'green' ? 'rgba(52,211,153,0.22)' : 'rgba(239,68,68,0.2)',
            transition: 'opacity 180ms ease-out',
          }}
        />
      )}
      <style>{`
        @keyframes scannerScanLineMove {
          0% { top: 12%; opacity: 0.35; }
          50% { opacity: 0.95; }
          100% { top: 88%; opacity: 0.35; }
        }
        .scanner-scan-line {
          animation: scannerScanLineMove 2.2s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .scanner-scan-line {
            animation: none;
            top: 50%;
            opacity: 0.45;
          }
        }
      `}</style>
    </>
  );
}
