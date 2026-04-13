import { useCallback, useEffect, useRef, useState } from 'react';
import { Lightning } from '@phosphor-icons/react';

type BarcodeDetectorResult = {
  rawValue?: string | null;
};

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

type CameraCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: {
    min?: number;
    max?: number;
  };
};

interface LiveQrScannerProps {
  title: string;
  expectedCodes: string[];
  onClose: () => void;
  onDetected: (rawValue: string) => void;
  onError: (message: string) => void;
}

export function LiveQrScanner({
  title,
  expectedCodes,
  onClose,
  onDetected,
  onError,
}: LiveQrScannerProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const [status, setStatus] = useState('Starting camera...');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const stopScanner = useCallback(() => {
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    stopScanner();
    onClose();
  }, [onClose, stopScanner]);

  const scheduleScan = useCallback((scan: () => Promise<void>) => {
    scanTimerRef.current = window.setTimeout(() => {
      void scan();
    }, 90);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const scanFrame = async () => {
      if (cancelled || completedRef.current) return;
      const detector = detectorRef.current;
      const video = videoRef.current;

      if (!detector || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleScan(scanFrame);
        return;
      }

      try {
        const barcodes = await detector.detect(video);
        const qr = barcodes.find((code) => typeof code.rawValue === 'string' && code.rawValue.trim());
        if (qr?.rawValue) {
          completedRef.current = true;
          stopScanner();
          onDetected(qr.rawValue);
          return;
        }
      } catch (error) {
        console.error('QR scan failed:', error);
      }

      scheduleScan(scanFrame);
    };

    const startScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onError('Camera access is not available on this device');
        return;
      }

      const Detector = (window as Window & typeof globalThis & {
        BarcodeDetector?: BarcodeDetectorCtor;
      }).BarcodeDetector;

      if (!Detector) {
        onError('This browser does not support fast live QR scanning yet');
        return;
      }

      try {
        detectorRef.current = new Detector({ formats: ['qr_code'] });

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();

        const track = stream.getVideoTracks()[0];
        const capabilities = (track.getCapabilities?.() ?? {}) as CameraCapabilities;
        setTorchSupported(Boolean(capabilities.torch));

        try {
          const advanced: Record<string, unknown> = {
            focusMode: 'continuous',
            exposureMode: 'continuous',
            whiteBalanceMode: 'continuous',
          };
          if (capabilities.zoom?.max && capabilities.zoom.max > 1) {
            advanced.zoom = Math.min(2, capabilities.zoom.max);
          }
          await track.applyConstraints({
            advanced: [advanced as MediaTrackConstraintSet],
          });
        } catch {
          // Best-effort tuning only.
        }

        setStatus('Point the QR inside the frame');
        scheduleScan(scanFrame);
      } catch (error) {
        console.error('Camera start failed:', error);
        onError('Could not start the back camera');
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [onDetected, onError, scheduleScan, stopScanner]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;

    const nextValue = !torchEnabled;
    try {
      await track.applyConstraints({
        advanced: [{ torch: nextValue } as MediaTrackConstraintSet],
      });
      setTorchEnabled(nextValue);
    } catch {
      setStatus('Torch control is not available on this camera');
    }
  }, [torchEnabled]);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/95 text-white">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
              Live QR Scan
            </p>
            <h2 className="mt-1 text-lg font-semibold leading-tight text-white">
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-300">{status}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-white/20 px-3 py-2 text-sm font-medium text-white/90"
          >
            Close
          </button>
        </div>

        <div className="px-4">
          <div className="relative overflow-hidden rounded-[28px] border border-white/15 bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="aspect-[3/4] w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 p-5">
              <div className="h-full rounded-[24px] border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.28)]" />
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="flex flex-wrap gap-2">
            {expectedCodes.map((code) => (
              <span
                key={code}
                className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 font-mono text-xs text-emerald-100"
              >
                {code}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={toggleTorch}
              disabled={!torchSupported}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-semibold text-white disabled:opacity-40"
            >
              <Lightning size={18} weight="fill" />
              {torchEnabled ? 'Torch On' : 'Torch Off'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-12 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold text-white"
            >
              Cancel
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
            <p className="font-semibold text-white">Best results</p>
            <p className="mt-2 leading-relaxed">
              Keep the phone steady, fill the frame with the QR, and use the torch in dim aisles.
              The scan matches only the expected Alias 1 or Alias, so the first exact decode wins.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
