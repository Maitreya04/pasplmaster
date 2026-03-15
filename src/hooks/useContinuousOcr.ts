import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OrderItem, ScanResult } from '../types';
import { scanImage } from '../lib/ocr/paddleEngine';
import { matchOcrToItem } from '../lib/ocr/ocrMatcher';
import { extractPartNumberCandidates, normalizeForPartMatch } from '../lib/ocr/partNumberExtractor';
import { buildScanResultFromMatch } from '../lib/ocr/scanResult';

export type ContinuousOcrUiState =
  | 'requesting_camera'
  | 'camera_ready'
  | 'reading'
  | 'matched'
  | 'mismatch'
  | 'error';

export interface ContinuousOcrState {
  uiState: ContinuousOcrUiState;
  statusText: string;
  candidateText: string | null;
  lastScanResult: ScanResult | null;
}

type FrameEval = {
  ts: number;
  candidateText: string | null;
  candidateNorm: string | null;
  isMatch: boolean;
  confidence: number;
  scanResult: ScanResult;
};

function pickCandidateText(rawText: string, extractedPart: string | null): string | null {
  if (extractedPart) return extractedPart;
  const cands = extractPartNumberCandidates(rawText);
  return cands[0]?.value ?? null;
}

async function captureCenterRoiBlob(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error('Video not ready');

  // Must match the overlay in LiveOcrScannerSheet: w=86%, h=35%, centered.
  const roiW = vw * 0.86;
  const roiH = vh * 0.35;
  const sx = Math.max(0, (vw - roiW) / 2);
  const sy = Math.max(0, (vh - roiH) / 2);

  // Increased to 1600px to take advantage of 1080p camera input.
  const outW = Math.min(1600, Math.round(roiW));
  const outH = Math.max(1, Math.round(outW * (roiH / roiW)));

  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas context');

  ctx.drawImage(video, sx, sy, roiW, roiH, 0, 0, outW, outH);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) reject(new Error('Failed to create blob'));
      else resolve(b);
    }, 'image/png');
  });
}

function isStableMatch(frames: FrameEval[]): boolean {
  const last = frames.slice(-2);
  return last.length === 2 && last.every((f) => f.isMatch && f.confidence >= 55);
}

function stableMismatchCandidate(frames: FrameEval[]): string | null {
  const recent = frames.slice(-5);
  const freq = new Map<string, number>();
  for (const f of recent) {
    if (f.isMatch) continue;
    if (!f.candidateNorm) continue;
    if (f.confidence < 40) continue;
    freq.set(f.candidateNorm, (freq.get(f.candidateNorm) ?? 0) + 1);
  }
  let best: { k: string; n: number } | null = null;
  for (const [k, n] of freq.entries()) {
    if (!best || n > best.n) best = { k, n };
  }
  return best && best.n >= 3 ? best.k : null;
}

export function useContinuousOcr({
  enabled,
  videoRef,
  expectedItem,
  itemMrp,
  itemMainGroup,
  itemAlias1,
  intervalMs = 750,
  onStableResult,
}: {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  expectedItem: OrderItem;
  itemMrp?: number;
  itemMainGroup?: string | null;
  itemAlias1?: string | null;
  intervalMs?: number;
  onStableResult: (scanResult: ScanResult) => void;
}): ContinuousOcrState {
  const [uiState, setUiState] = useState<ContinuousOcrUiState>('camera_ready');
  const [statusText, setStatusText] = useState('Hold steady — reading…');
  const [candidateText, setCandidateText] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);

  const framesRef = useRef<FrameEval[]>([]);
  const busyRef = useRef(false);
  const settledRef = useRef(false);
  const tickIdRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const reset = useCallback(() => {
    framesRef.current = [];
    busyRef.current = false;
    settledRef.current = false;
    setCandidateText(null);
    setLastScanResult(null);
    setUiState('camera_ready');
    setStatusText('Hold steady — reading…');
  }, []);

  const enabledKey = useMemo(
    () =>
      enabled
        ? `${expectedItem.id}:${itemMrp ?? ''}:${itemMainGroup ?? ''}:${itemAlias1 ?? ''}`
        : 'off',
    [enabled, expectedItem.id, itemAlias1, itemMainGroup, itemMrp],
  );

  useEffect(() => {
    if (!enabled) return;
    reset();
  }, [enabledKey, enabled, reset]);

  useEffect(() => {
    if (!enabled) {
      if (tickIdRef.current) {
        window.clearInterval(tickIdRef.current);
        tickIdRef.current = null;
      }
      return;
    }

    const tick = async () => {
      if (busyRef.current || settledRef.current) return;
      const video = videoRef.current;
      if (!video) return;
      if (!video.videoWidth || !video.videoHeight) return;

      busyRef.current = true;
      try {
        setUiState((s) => (s === 'matched' || s === 'mismatch' ? s : 'reading'));
        if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
        const frameBlob = await captureCenterRoiBlob(video, canvasRef.current);
        const { rawText } = await scanImage(frameBlob);

        const matchResult = matchOcrToItem(
          rawText,
          expectedItem,
          itemMrp,
          itemMainGroup ?? null,
          itemAlias1 ?? null,
        );

        const scanResult = buildScanResultFromMatch({
          rawText,
          matchResult,
          expectedItem,
        });

        setLastScanResult(scanResult);

        const cand = pickCandidateText(rawText, matchResult.ocrExtracted.partNumber);
        setCandidateText(cand);

        const candidateNorm = cand ? normalizeForPartMatch(cand) : null;
        framesRef.current = [
          ...framesRef.current.slice(-5),
          {
            ts: Date.now(),
            candidateText: cand,
            candidateNorm,
            isMatch: matchResult.isMatch,
            confidence: matchResult.confidence,
            scanResult,
          },
        ];

        if (isStableMatch(framesRef.current)) {
          settledRef.current = true;
          setUiState('matched');
          setStatusText('Matched');
          onStableResult(scanResult);
          return;
        }

        const mismatchKey = stableMismatchCandidate(framesRef.current);
        if (mismatchKey) {
          settledRef.current = true;
          setUiState('mismatch');
          setStatusText('Doesn’t match expected');
          const bestFrame =
            [...framesRef.current]
              .reverse()
              .find((f) => !f.isMatch && f.candidateNorm === mismatchKey) ?? null;
          if (bestFrame?.candidateText) setCandidateText(bestFrame.candidateText);
          onStableResult(bestFrame?.scanResult ?? scanResult);
          return;
        }

        setStatusText('Reading…');
      } catch {
        setUiState('error');
        setStatusText('OCR failed — try photo or manual entry');
      } finally {
        busyRef.current = false;
      }
    };

    tickIdRef.current = window.setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      if (tickIdRef.current) {
        window.clearInterval(tickIdRef.current);
        tickIdRef.current = null;
      }
    };
  }, [
    enabled,
    expectedItem,
    intervalMs,
    itemMainGroup,
    itemMrp,
    onStableResult,
    videoRef,
  ]);

  return { uiState, statusText, candidateText, lastScanResult };
}

