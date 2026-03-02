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
 * Preprocess an image file for better OCR accuracy:
 * grayscale conversion + contrast boost (no binary thresholding to
 * preserve text on colored backgrounds like yellow packaging).
 */
async function preprocessImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const MAX_WIDTH = 2000;
  const scale = bitmap.width > MAX_WIDTH ? MAX_WIDTH / bitmap.width : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const contrastFactor = 1.5;

  for (let i = 0; i < data.length; i += 4) {
    let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray = (gray - 128) * contrastFactor + 128;
    gray = Math.max(0, Math.min(255, gray));
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export async function scanImage(imageFile: File): Promise<OcrScanResult> {
  const processed = await preprocessImage(imageFile);
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
