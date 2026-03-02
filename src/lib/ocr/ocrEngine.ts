import { createWorker, type Worker } from 'tesseract.js';

let worker: Worker | null = null;
let workerInitializing: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (worker) return worker;
  if (workerInitializing) return workerInitializing;

  workerInitializing = createWorker('eng').then((w) => {
    worker = w;
    workerInitializing = null;
    return w;
  });

  return workerInitializing;
}

export interface OcrScanResult {
  rawText: string;
  confidence: number;
}

/**
 * Preprocess an image source for better OCR accuracy:
 *  1. Scale down to MAX_WIDTH (preserves detail on dense labels)
 *  2. Convert to grayscale
 *  3. Compute dominant luminance to choose adaptive contrast —
 *     dark/blue backgrounds (Suprajit, Varroc) need stronger boost,
 *     light backgrounds (ASK, Lucas TVS) need gentler treatment.
 *  4. Apply contrast enhancement + optional sharpening.
 */
async function preprocessImage(
  source: Blob,
  opts?: { maxWidth?: number },
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);

  const MAX_WIDTH = opts?.maxWidth ?? 2400;
  const scale = bitmap.width > MAX_WIDTH ? MAX_WIDTH / bitmap.width : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas:
    | OffscreenCanvas
    | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });

  const ctx =
    canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
  if (!ctx) throw new Error('Failed to create canvas context');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  let lumSum = 0;
  const pixelCount = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    lumSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const avgLuminance = lumSum / pixelCount;

  const contrastFactor = avgLuminance < 100 ? 1.8 : avgLuminance < 160 ? 1.5 : 1.3;

  for (let i = 0; i < data.length; i += 4) {
    let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray = (gray - 128) * contrastFactor + 128;
    gray = Math.max(0, Math.min(255, gray));
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }

  ctx.putImageData(imageData, 0, 0);

  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/png' });
  }

  return await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((b) => {
      if (!b) reject(new Error('Failed to create blob'));
      else resolve(b);
    }, 'image/png');
  });
}

export async function scanImage(imageFile: File): Promise<OcrScanResult> {
  const processed = await preprocessImage(imageFile);
  const w = await getWorker();
  const {
    data: { text, confidence },
  } = await w.recognize(processed);
  return { rawText: text.trim(), confidence };
}

export async function scanBlob(
  imageBlob: Blob,
  opts?: { maxWidth?: number },
): Promise<OcrScanResult> {
  const processed = await preprocessImage(imageBlob, opts);
  const w = await getWorker();
  const {
    data: { text, confidence },
  } = await w.recognize(processed);
  return { rawText: text.trim(), confidence };
}

export async function terminateWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
