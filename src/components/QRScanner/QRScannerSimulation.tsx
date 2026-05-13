import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  averageQrSide,
  drawQrBrackets,
  getScanCanvasSizing,
  mapQrLocationToDisplay,
  STABLE_LOCK_FRAMES,
  type MappedQrLocation,
} from './qrScannerCore';

interface SimulationResult {
  scale: number;
  decodedData: string | null;
  qrSideInScanPixels: number | null;
  qrSideInOriginalPixels: number | null;
  centerInOriginalPixels: { x: number; y: number } | null;
  wouldLock: boolean;
}

const STRESS_SCALES = [1, 0.85, 0.7, 0.55, 0.4, 0.3];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the simulation image.'));
    image.src = src;
  });
}

function shortData(data: string): string {
  return data.length > 96 ? `${data.slice(0, 93)}...` : data;
}

export function QRScannerSimulation(): React.JSX.Element {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [results, setResults] = useState<SimulationResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const bestResult = useMemo(
    () => results.find((result) => result.decodedData) ?? null,
    [results],
  );

  const minimumDetectedSide = useMemo(() => {
    const sides = results
      .map((result) => result.qrSideInScanPixels)
      .filter((side): side is number => typeof side === 'number' && Number.isFinite(side));
    return sides.length > 0 ? Math.min(...sides) : null;
  }, [results]);

  const drawPreview = useCallback(async (src: string) => {
    const image = await loadImage(src);
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
  }, []);

  const runSimulation = useCallback(async (src: string) => {
    setIsRunning(true);
    setErrorMessage(null);
    setResults([]);

    try {
      const image = await loadImage(src);
      const nextResults: SimulationResult[] = [];
      let firstMappedLocation: MappedQrLocation | null = null;

      for (const scale of STRESS_SCALES) {
        const scaledWidth = Math.max(1, Math.round(image.naturalWidth * scale));
        const scaledHeight = Math.max(1, Math.round(image.naturalHeight * scale));
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = scaledWidth;
        sourceCanvas.height = scaledHeight;
        const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
        if (!sourceCtx) continue;
        sourceCtx.drawImage(image, 0, 0, scaledWidth, scaledHeight);

        const scanSizing = getScanCanvasSizing(scaledWidth, scaledHeight);
        const scanCanvas = document.createElement('canvas');
        scanCanvas.width = scanSizing.width;
        scanCanvas.height = scanSizing.height;
        const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
        if (!scanCtx) continue;
        scanCtx.drawImage(sourceCanvas, 0, 0, scanSizing.width, scanSizing.height);
        const imageData = scanCtx.getImageData(0, 0, scanSizing.width, scanSizing.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });

        if (!code) {
          nextResults.push({
            scale,
            decodedData: null,
            qrSideInScanPixels: null,
            qrSideInOriginalPixels: null,
            centerInOriginalPixels: null,
            wouldLock: false,
          });
          continue;
        }

        const sideInScanPixels = averageQrSide([
          code.location.topLeftCorner,
          code.location.topRightCorner,
          code.location.bottomRightCorner,
          code.location.bottomLeftCorner,
        ]);
        const sideInOriginalPixels = sideInScanPixels / scanSizing.scale / scale;
        const mappedLocation = mapQrLocationToDisplay(
          code,
          { width: scanSizing.width, height: scanSizing.height },
          { width: scaledWidth, height: scaledHeight },
          { width: image.naturalWidth, height: image.naturalHeight },
        );

        if (!firstMappedLocation) firstMappedLocation = mappedLocation;

        nextResults.push({
          scale,
          decodedData: code.data,
          qrSideInScanPixels: sideInScanPixels,
          qrSideInOriginalPixels: sideInOriginalPixels,
          centerInOriginalPixels: mappedLocation.center,
          wouldLock: true,
        });
      }

      setResults(nextResults);
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });

      const canvas = previewCanvasRef.current;
      if (canvas) {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0);
          if (firstMappedLocation) {
            drawQrBrackets(ctx, firstMappedLocation, '#34C759', 22, 4);
            ctx.save();
            ctx.fillStyle = '#34C759';
            ctx.beginPath();
            ctx.arc(firstMappedLocation.center.x, firstMappedLocation.center.y, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Simulation failed.');
    } finally {
      setIsRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!imageUrl) return;
    void drawPreview(imageUrl).then(() => runSimulation(imageUrl));
  }, [drawPreview, imageUrl, runSimulation]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const handleFile = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Choose an image file for the QR simulation.');
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextUrl;
    setImageName(file.name);
    setImageUrl(nextUrl);
  }, []);

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--content-primary)]">
              Small-label QR simulation
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--content-tertiary)]">
              Upload the package photo here. The lab runs the same jsQR frame path as the Android scanner and marks the detected code on the image.
            </p>
          </div>
          <label className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-[var(--content-primary)] px-4 text-sm font-semibold text-[var(--bg-primary)] active:scale-[0.97]">
            Choose Photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {imageName && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--content-tertiary)]">
            <span className="rounded-full bg-[var(--bg-tertiary)] px-3 py-1 font-mono">{imageName}</span>
            {imageSize && (
              <span className="rounded-full bg-[var(--bg-tertiary)] px-3 py-1 font-mono">
                {imageSize.width}x{imageSize.height}
              </span>
            )}
            {isRunning && <span>Running detection...</span>}
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="rounded-3xl border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] p-4 text-sm font-semibold text-[var(--content-negative)]">
          {errorMessage}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-black">
          {imageUrl ? (
            <canvas ref={previewCanvasRef} className="block h-auto w-full" />
          ) : (
            <div className="flex min-h-[360px] items-center justify-center p-6 text-center text-sm text-white/55">
              Upload the small QR package photo to preview bracket alignment.
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--content-tertiary)]">
            Detection report
          </p>
          {bestResult ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl bg-[var(--bg-positive-subtle)] p-3">
                <p className="text-sm font-semibold text-[var(--content-positive)]">Decoded</p>
                <p className="mt-1 break-all font-mono text-xs text-[var(--content-primary)]">
                  {shortData(bestResult.decodedData ?? '')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                  <p className="text-xs text-[var(--content-tertiary)]">QR side</p>
                  <p className="mt-1 font-mono font-semibold text-[var(--content-primary)]">
                    {Math.round(bestResult.qrSideInOriginalPixels ?? 0)} px
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                  <p className="text-xs text-[var(--content-tertiary)]">Center</p>
                  <p className="mt-1 font-mono font-semibold text-[var(--content-primary)]">
                    {bestResult.centerInOriginalPixels
                      ? `${Math.round(bestResult.centerInOriginalPixels.x)}, ${Math.round(bestResult.centerInOriginalPixels.y)}`
                      : '-'}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                  <p className="text-xs text-[var(--content-tertiary)]">Lock test</p>
                  <p className="mt-1 font-mono font-semibold text-[var(--content-primary)]">
                    {STABLE_LOCK_FRAMES}/{STABLE_LOCK_FRAMES}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                  <p className="text-xs text-[var(--content-tertiary)]">Min decoded</p>
                  <p className="mt-1 font-mono font-semibold text-[var(--content-primary)]">
                    {minimumDetectedSide ? `${Math.round(minimumDetectedSide)} px` : '-'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm leading-relaxed text-[var(--content-tertiary)]">
              {results.length > 0
                ? 'No QR decoded from this image. Try a closer photo with less glare, or crop tighter around the label.'
                : 'Results appear here after you choose a photo.'}
            </p>
          )}

          {results.length > 0 && (
            <div className="mt-5 space-y-2">
              {results.map((result) => (
                <div
                  key={result.scale}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
                >
                  <span className="font-mono text-[var(--content-secondary)]">
                    {Math.round(result.scale * 100)}%
                  </span>
                  <span className={result.decodedData ? 'font-semibold text-[var(--content-positive)]' : 'text-[var(--content-tertiary)]'}>
                    {result.decodedData ? 'decoded' : 'miss'}
                  </span>
                  <span className="font-mono text-[var(--content-tertiary)]">
                    {result.qrSideInScanPixels ? `${Math.round(result.qrSideInScanPixels)} px` : '-'}
                  </span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </section>
  );
}

export default QRScannerSimulation;
