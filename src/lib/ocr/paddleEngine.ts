import Ocr from '@gutenye/ocr-browser';
import { env } from 'onnxruntime-web';

// Required for Vite/Webpack to serve the ONNX models directly
env.wasm.wasmPaths = '/models/';

export interface OcrScanResult {
  rawText: string;
  confidence: number;
}

let ocrClient: Ocr | null = null;
let ocrInitializing: Promise<Ocr> | null = null;

export async function initWorker(): Promise<Ocr> {
  if (ocrClient) return ocrClient;
  if (ocrInitializing) return ocrInitializing;
  
  ocrInitializing = (async () => {
    try {
      const client = await Ocr.create({
        models: {
          detectionPath: '/models/ch_PP-OCRv4_det_infer.onnx',
          recognitionPath: '/models/ch_PP-OCRv4_rec_infer.onnx',
          dictionaryPath: '/models/ppocr_keys_v1.txt',
        }
      });
      ocrClient = client;
      ocrInitializing = null;
      return client;
    } catch (err) {
      ocrInitializing = null;
      console.error('Failed to init PaddleOCR:', err);
      throw err;
    }
  })();

  return ocrInitializing;
}

export async function scanImage(
  imageSource: File | Blob | HTMLImageElement | HTMLCanvasElement,
): Promise<OcrScanResult> {
  const client = await initWorker();

  let targetElement: string | HTMLImageElement | HTMLCanvasElement | Blob;

  if (imageSource instanceof Blob) {
    // @gutenye detector takes paths (strings) or buffers for easiest interface usually, but lets pass ObjectUrl
    targetElement = URL.createObjectURL(imageSource);
  } else {
    targetElement = imageSource;
  }

  // OCR prediction
  const results = await client.detect(targetElement as any);
  
  if (imageSource instanceof Blob && typeof targetElement === 'string') {
    URL.revokeObjectURL(targetElement);
  }

  if (!results || results.length === 0) {
    return { rawText: '', confidence: 0 };
  }

  // Map paddle lines into one large text block (similar to Tesseract)
  const rawText = results.map(r => r.text).join('\n').trim();
  
  // Calculate average confidence score across all bounded boxes
  const totalScore = results.reduce((sum, r: any) => sum + (r.meanScore || r.score || 0), 0);
  const avgConfidence = totalScore / results.length;
  
  return { 
    rawText, 
    confidence: avgConfidence * 100 
  };
}

export async function terminateWorker(): Promise<void> {
  ocrClient = null;
}
