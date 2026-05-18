import {
  ZBarConfigType,
  ZBarScanner,
  ZBarSymbolType,
  scanImageData,
} from '@undecaf/zbar-wasm';
import {
  prepareZXingModule,
  readBarcodes,
  type ReadResult,
  type ReaderOptions,
} from 'zxing-wasm/reader';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { isLikelyPartNumber } from '../lib/scanner/scoring';

type ScanRequestMessage = {
  type: 'scan';
  frameId: number;
  imageData: ImageData;
  roiLevel?: 'tight' | 'medium' | 'full';
};

type WorkerRequestMessage = ScanRequestMessage;

type WorkerResponseMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'scan-result';
      frameId: number;
      rawValue: string | null;
    }
  | {
      type: 'error';
      message: string;
    };

function cropImageData(
  source: ImageData,
  sx: number,
  sy: number,
  width: number,
  height: number,
): ImageData {
  const srcWidth = source.width;
  const srcHeight = source.height;
  const x = Math.max(0, Math.min(srcWidth - 1, Math.floor(sx)));
  const y = Math.max(0, Math.min(srcHeight - 1, Math.floor(sy)));
  const w = Math.max(1, Math.min(srcWidth - x, Math.floor(width)));
  const h = Math.max(1, Math.min(srcHeight - y, Math.floor(height)));
  const out = new Uint8ClampedArray(w * h * 4);
  const src = source.data;

  for (let row = 0; row < h; row += 1) {
    const srcOffset = ((y + row) * srcWidth + x) * 4;
    const dstOffset = row * w * 4;
    out.set(src.subarray(srcOffset, srcOffset + w * 4), dstOffset);
  }

  return new ImageData(out, w, h);
}

function upscaleNearestJs(source: ImageData, scale: number): ImageData {
  const targetWidth = Math.max(1, Math.floor(source.width * scale));
  const targetHeight = Math.max(1, Math.floor(source.height * scale));
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const src = source.data;

  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor(x / scale));
      const srcIdx = (sy * source.width + sx) * 4;
      const dstIdx = (y * targetWidth + x) * 4;
      out[dstIdx] = src[srcIdx];
      out[dstIdx + 1] = src[srcIdx + 1];
      out[dstIdx + 2] = src[srcIdx + 2];
      out[dstIdx + 3] = src[srcIdx + 3];
    }
  }

  return new ImageData(out, targetWidth, targetHeight);
}

let scratchCanvas: OffscreenCanvas | null = null;
let targetCanvas: OffscreenCanvas | null = null;

function upscaleNearest(source: ImageData, scale: number): ImageData {
  if (typeof OffscreenCanvas === 'undefined') {
    return upscaleNearestJs(source, scale);
  }

  const tw = Math.max(1, Math.floor(source.width * scale));
  const th = Math.max(1, Math.floor(source.height * scale));

  scratchCanvas ??= new OffscreenCanvas(1, 1);
  targetCanvas ??= new OffscreenCanvas(1, 1);

  scratchCanvas.width = source.width;
  scratchCanvas.height = source.height;
  const sctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  if (!sctx) return upscaleNearestJs(source, scale);

  sctx.putImageData(source, 0, 0);

  targetCanvas.width = tw;
  targetCanvas.height = th;
  const tctx = targetCanvas.getContext('2d', { willReadFrequently: true });
  if (!tctx) return upscaleNearestJs(source, scale);

  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(scratchCanvas, 0, 0, source.width, source.height, 0, 0, tw, th);
  return tctx.getImageData(0, 0, tw, th);
}

function scoreSymbol(symbol: { type: ZBarSymbolType; decode(): string }): number {
  const decoded = symbol.decode().trim();
  if (!decoded) return -1000;

  let score = 0;
  if (symbol.type === ZBarSymbolType.ZBAR_CODE128) score += 12;
  if (symbol.type === ZBarSymbolType.ZBAR_CODE39 || symbol.type === ZBarSymbolType.ZBAR_CODE93) score += 8;
  if (
    symbol.type === ZBarSymbolType.ZBAR_EAN13 ||
    symbol.type === ZBarSymbolType.ZBAR_EAN8 ||
    symbol.type === ZBarSymbolType.ZBAR_UPCA ||
    symbol.type === ZBarSymbolType.ZBAR_UPCE
  ) {
    score += 6;
  }
  if (symbol.type === ZBarSymbolType.ZBAR_QRCODE) score -= 8;
  if (isLikelyPartNumber(decoded)) score += 20;
  if (decoded.length > 26) score -= 4;
  return score;
}

const ZXING_FORMATS: NonNullable<ReaderOptions['formats']> = [
  'QRCode',
  'MicroQRCode',
  'Code128',
  'Code39',
  'Code93',
  'Codabar',
  'DataMatrix',
  'EAN13',
  'EAN8',
  'ITF',
  'PDF417',
  'Aztec',
  'UPCA',
  'UPCE',
];

function scoreZXingResult(result: ReadResult): number {
  const decoded = result.text.trim();
  if (!decoded || !result.isValid) return -1000;

  let score = 0;
  if (result.format === 'Code128') score += 12;
  if (result.format === 'Code39' || result.format === 'Code93') score += 8;
  if (result.format === 'EAN13' || result.format === 'EAN8' || result.format === 'UPCA' || result.format === 'UPCE') {
    score += 6;
  }
  if (result.format === 'QRCode' || result.format === 'MicroQRCode') score -= 8;
  if (isLikelyPartNumber(decoded)) score += 20;
  if (decoded.length > 26) score -= 4;
  return score;
}

let zxingReadyPromise: Promise<unknown> | null = null;

async function prepareZXing(): Promise<void> {
  if (!zxingReadyPromise) {
    zxingReadyPromise = Promise.resolve(
      prepareZXingModule({
        overrides: {
          locateFile: (path: string) => (path.endsWith('.wasm') ? zxingReaderWasmUrl : path),
        },
        fireImmediately: true,
      }),
    );
  }
  await zxingReadyPromise;
}

async function scanBestZXing(imageData: ImageData, tryHarder: boolean): Promise<ReadResult | null> {
  await prepareZXing();
  const results = await readBarcodes(imageData, {
    formats: ZXING_FORMATS,
    tryHarder,
    tryRotate: tryHarder,
    tryInvert: tryHarder,
    tryDownscale: true,
    tryDenoise: tryHarder,
    binarizer: tryHarder ? 'LocalAverage' : 'GlobalHistogram',
    maxNumberOfSymbols: 4,
    minLineCount: 2,
    textMode: 'Plain',
  });
  const usableResults = results.filter((result) => result.text.trim().length > 0 && result.isValid);
  if (usableResults.length === 0) return null;

  let best = usableResults[0];
  let bestScore = scoreZXingResult(best);
  for (let i = 1; i < usableResults.length; i += 1) {
    const candidate = usableResults[i];
    const score = scoreZXingResult(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

async function scanBestSymbol(scanner: ZBarScanner, imageData: ImageData) {
  const symbols = await scanImageData(imageData, scanner);
  const usableSymbols = symbols.filter((symbol) => symbol.decode().trim().length > 0);
  if (usableSymbols.length === 0) return null;

  let best = usableSymbols[0];
  let bestScore = scoreSymbol(best);
  for (let i = 1; i < usableSymbols.length; i += 1) {
    const candidate = usableSymbols[i];
    const score = scoreSymbol(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

let scannerPromise: Promise<ZBarScanner> | null = null;

async function getBarcodeScanner(): Promise<ZBarScanner> {
  if (!scannerPromise) {
    scannerPromise = ZBarScanner.create().then((scanner) => {
      scanner.enableCache(false);

      scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_X_DENSITY, 2);
      scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_Y_DENSITY, 2);

      scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_ENABLE, 0);
      scanner.setConfig(ZBarSymbolType.ZBAR_QRCODE, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_CODE128, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_CODE39, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_CODE93, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_CODABAR, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_EAN13, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_EAN8, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_UPCA, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_UPCE, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_I25, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_DATABAR, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      return scanner;
    });
  }

  return scannerPromise;
}

/** Warm WASM + ZBar scanner before first frame (first scan awaits this implicitly). */
const engineWarmPromise = Promise.all([prepareZXing(), getBarcodeScanner()]).catch((err: unknown) => {
  console.error('[qrScanner.worker] engine warmup failed', err);
  throw err;
});

async function handleScan(message: ScanRequestMessage) {
  const scanner = await getBarcodeScanner();
  const image = message.imageData;
  const centerCrop = cropImageData(
    image,
    image.width * 0.2,
    image.height * 0.2,
    image.width * 0.6,
    image.height * 0.6,
  );

  const post = (rawValue: string | null) => {
    const response: WorkerResponseMessage = {
      type: 'scan-result',
      frameId: message.frameId,
      rawValue,
    };
    self.postMessage(response);
  };

  const fastPassImages: ImageData[] = [centerCrop, image];
  for (const img of fastPassImages) {
    const zxingResult = await scanBestZXing(img, false);
    if (zxingResult) {
      post(zxingResult.text);
      return;
    }
  }

  for (const img of fastPassImages) {
    const symbol = await scanBestSymbol(scanner, img);
    if (symbol) {
      post(symbol.decode());
      return;
    }
  }

  const hardVariants: Array<{ image: ImageData; tryHarder: boolean }> = [
    { image: upscaleNearest(centerCrop, 2), tryHarder: true },
  ];
  if (message.roiLevel !== 'tight') {
    hardVariants.push({ image: upscaleNearest(image, 1.35), tryHarder: true });
  }

  for (const variant of hardVariants) {
    const zxingResult = await scanBestZXing(variant.image, variant.tryHarder);
    if (zxingResult) {
      post(zxingResult.text);
      return;
    }

    const symbol = await scanBestSymbol(scanner, variant.image);
    if (symbol) {
      post(symbol.decode());
      return;
    }
  }

  post(null);
}

self.postMessage({ type: 'ready' } satisfies WorkerResponseMessage);

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const message = event.data;
  if (message.type !== 'scan') return;

  void engineWarmPromise
    .then(() => handleScan(message))
    .catch((error: unknown) => {
      const response: WorkerResponseMessage = {
        type: 'error',
        message: error instanceof Error ? error.message : 'QR worker failed',
      };
      self.postMessage(response);
    });
};
