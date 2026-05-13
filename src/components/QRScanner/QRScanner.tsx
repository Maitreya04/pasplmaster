import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  clearDisplayCanvas,
  drawQrBrackets,
  getScanCanvasSizing,
  mapQrLocationToDisplay,
  MAX_SCAN_LONG_EDGE,
  SCAN_INTERVAL_MS,
  STABLE_LOCK_FRAMES,
  ZOOM_SCALE,
  resizeCanvasToDisplaySize,
} from './qrScannerCore';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

type CameraCapabilitiesWithFocus = MediaTrackCapabilities & {
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
};

function formatScannedData(data: string): string {
  const trimmed = data.trim();
  if (trimmed.length <= 72) return trimmed;
  return `${trimmed.slice(0, 69)}...`;
}

function cameraErrorMessage(error: unknown): string {
  if (!window.isSecureContext) {
    return 'Camera access needs HTTPS or localhost on Android Chrome.';
  }

  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access and try again.';
    if (error.name === 'NotFoundError') return 'No camera was found on this device.';
    if (error.name === 'NotReadableError') return 'The camera is already in use by another app.';
  }

  return error instanceof Error ? error.message : 'Could not start the camera.';
}

export function QRScanner({ onScan, onClose }: QRScannerProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastDecodeAtRef = useRef(0);
  const stableFramesRef = useRef(0);
  const lastDataRef = useRef<string | null>(null);
  const hasScannedRef = useRef(false);
  const mountedRef = useRef(false);
  const statusRef = useRef('Starting camera...');
  const scanTimeoutRef = useRef<number | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);
  const [status, setStatus] = useState('Starting camera...');
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashActive, setFlashActive] = useState(false);

  const setScannerStatus = useCallback((nextStatus: string) => {
    if (statusRef.current === nextStatus) return;
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const stopCamera = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (scanTimeoutRef.current !== null) {
      window.clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (overlayCanvasRef.current) {
      clearDisplayCanvas(overlayCanvasRef.current);
    }
  }, []);

  const handleClose = useCallback(() => {
    stopCamera();
    onClose();
  }, [onClose, stopCamera]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const scanFrame = (now: number) => {
      if (cancelled) return;
      animationFrameRef.current = requestAnimationFrame(scanFrame);

      if (hasScannedRef.current || now - lastDecodeAtRef.current < SCAN_INTERVAL_MS) return;
      lastDecodeAtRef.current = now;

      const video = videoRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      if (!video || !overlayCanvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      const displayWidth = video.clientWidth;
      const displayHeight = video.clientHeight;
      if (sourceWidth <= 0 || sourceHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) return;

      const scanCanvas = scanCanvasRef.current ?? document.createElement('canvas');
      scanCanvasRef.current = scanCanvas;
      const sizing = getScanCanvasSizing(sourceWidth, sourceHeight, MAX_SCAN_LONG_EDGE);
      if (scanCanvas.width !== sizing.width || scanCanvas.height !== sizing.height) {
        scanCanvas.width = sizing.width;
        scanCanvas.height = sizing.height;
      }

      const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
      if (!scanCtx) {
        setScannerStatus('Canvas is not available for QR scanning.');
        return;
      }

      scanCtx.drawImage(video, 0, 0, sizing.width, sizing.height);
      const imageData = scanCtx.getImageData(0, 0, sizing.width, sizing.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });
      const overlayCtx = resizeCanvasToDisplaySize(overlayCanvas);
      if (!overlayCtx) return;
      overlayCtx.clearRect(0, 0, displayWidth, displayHeight);

      if (!code) {
        stableFramesRef.current = 0;
        lastDataRef.current = null;
        video.style.transformOrigin = 'center center';
        video.style.transform = 'scale(1)';
        setScannerStatus('Point at a QR code');
        return;
      }

      const mappedLocation = mapQrLocationToDisplay(
        code,
        { width: sizing.width, height: sizing.height },
        { width: sourceWidth, height: sourceHeight },
        { width: displayWidth, height: displayHeight },
      );

      if (lastDataRef.current === code.data) {
        stableFramesRef.current += 1;
      } else {
        stableFramesRef.current = 1;
        lastDataRef.current = code.data;
      }

      const locked = stableFramesRef.current >= STABLE_LOCK_FRAMES;
      drawQrBrackets(
        overlayCtx,
        mappedLocation,
        locked ? '#34C759' : 'rgba(255,255,255,0.9)',
      );
      video.style.transformOrigin = `${mappedLocation.center.x}px ${mappedLocation.center.y}px`;
      video.style.transform = `scale(${ZOOM_SCALE})`;

      if (!locked) {
        setScannerStatus('Hold steady...');
        return;
      }

      if (hasScannedRef.current) return;
      hasScannedRef.current = true;
      setScannedData(code.data);
      setScannerStatus('QR locked');
      setFlashActive(true);
      flashTimeoutRef.current = window.setTimeout(() => {
        if (mountedRef.current) setFlashActive(false);
      }, 100);
      scanTimeoutRef.current = window.setTimeout(() => {
        onScan(code.data);
      }, 100);
    };

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not available in this browser.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) throw new Error('Scanner video element is not available.');
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();

        const track = stream.getVideoTracks()[0];
        const capabilities = (track.getCapabilities?.() ?? {}) as CameraCapabilitiesWithFocus;
        const advanced: Record<string, unknown> = {};
        if (capabilities.focusMode?.includes('continuous')) advanced.focusMode = 'continuous';
        if (capabilities.exposureMode?.includes('continuous')) advanced.exposureMode = 'continuous';
        if (capabilities.whiteBalanceMode?.includes('continuous')) advanced.whiteBalanceMode = 'continuous';
        if (Object.keys(advanced).length > 0) {
          await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] }).catch(() => undefined);
        }

        if (!cancelled) {
          setCameraError(null);
          setScannerStatus('Point at a QR code');
          animationFrameRef.current = requestAnimationFrame(scanFrame);
        }
      } catch (error) {
        const message = cameraErrorMessage(error);
        if (!cancelled) {
          setCameraError(message);
          setScannerStatus('Scanner unavailable');
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      stopCamera();
    };
  }, [onScan, setScannerStatus, stopCamera]);

  return (
    <div className="qr-scanner-shell" role="dialog" aria-modal="true" aria-label="QR scanner">
      <video
        ref={videoRef}
        className="qr-scanner-video"
        muted
        autoPlay
        playsInline
      />
      <canvas ref={overlayCanvasRef} className="qr-scanner-overlay" aria-hidden="true" />
      <div className="qr-scanner-viewfinder" aria-hidden="true" />
      {flashActive && <div className="qr-scanner-flash" aria-hidden="true" />}

      <button type="button" className="qr-scanner-close" onClick={handleClose} aria-label="Close scanner">
        X
      </button>

      {cameraError && (
        <div className="qr-scanner-error">
          <p className="qr-scanner-error-title">Camera unavailable</p>
          <p>{cameraError}</p>
        </div>
      )}

      <div className="qr-scanner-status-strip">
        <p className="qr-scanner-status">{status}</p>
        {scannedData && <p className="qr-scanner-pill">{formatScannedData(scannedData)}</p>}
      </div>

      <style>{`
        .qr-scanner-shell {
          position: fixed;
          inset: 0;
          z-index: 90;
          min-height: 100vh;
          min-height: 100dvh;
          overflow: hidden;
          background: #000;
          color: white;
          touch-action: none;
        }

        .qr-scanner-video,
        .qr-scanner-overlay {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }

        .qr-scanner-video {
          object-fit: cover;
          transform: scale(1);
          transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          will-change: transform;
        }

        .qr-scanner-overlay {
          pointer-events: none;
          z-index: 2;
        }

        .qr-scanner-viewfinder {
          position: absolute;
          left: 50%;
          top: 50%;
          z-index: 3;
          width: min(72vw, 340px);
          height: min(42vh, 260px);
          min-height: 190px;
          transform: translate(-50%, -50%);
          border: 0.5px solid rgba(255, 255, 255, 0.48);
          border-radius: 24px;
          pointer-events: none;
        }

        .qr-scanner-close {
          position: absolute;
          right: max(16px, env(safe-area-inset-right));
          top: max(14px, env(safe-area-inset-top));
          z-index: 5;
          display: grid;
          height: 44px;
          width: 44px;
          place-items: center;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.42);
          color: white;
          font-size: 16px;
          font-weight: 700;
          line-height: 1;
          backdrop-filter: blur(10px);
          transition: transform 120ms ease-out, background 120ms ease-out;
        }

        .qr-scanner-close:active {
          transform: scale(0.94);
          background: rgba(255, 255, 255, 0.16);
        }

        .qr-scanner-flash {
          position: absolute;
          inset: 0;
          z-index: 4;
          pointer-events: none;
          background: white;
          animation: qrScannerFlash 100ms ease-out forwards;
        }

        .qr-scanner-status-strip {
          position: absolute;
          inset-inline: 16px;
          bottom: max(18px, env(safe-area-inset-bottom));
          z-index: 5;
          display: flex;
          min-height: 54px;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 18px;
          background: rgba(0, 0, 0, 0.58);
          padding: 10px 12px 10px 16px;
          backdrop-filter: blur(14px);
        }

        .qr-scanner-status {
          margin: 0;
          font-size: 14px;
          font-weight: 650;
          letter-spacing: 0;
        }

        .qr-scanner-pill {
          margin: 0;
          max-width: min(58vw, 520px);
          overflow: hidden;
          border-radius: 999px;
          background: rgba(52, 199, 89, 0.22);
          padding: 7px 10px;
          color: rgb(210, 255, 222);
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .qr-scanner-error {
          position: absolute;
          left: 50%;
          top: 50%;
          z-index: 5;
          width: min(86vw, 360px);
          transform: translate(-50%, -50%);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 20px;
          background: rgba(18, 18, 20, 0.92);
          padding: 18px;
          text-align: left;
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
        }

        .qr-scanner-error p {
          margin: 0;
          color: rgba(255, 255, 255, 0.74);
          font-size: 13px;
          line-height: 1.45;
        }

        .qr-scanner-error-title {
          margin-bottom: 6px !important;
          color: white !important;
          font-size: 15px !important;
          font-weight: 750;
        }

        @keyframes qrScannerFlash {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .qr-scanner-video,
          .qr-scanner-close {
            transition: none;
          }

          .qr-scanner-flash {
            animation-duration: 1ms;
          }
        }
      `}</style>
    </div>
  );
}

export default QRScanner;
