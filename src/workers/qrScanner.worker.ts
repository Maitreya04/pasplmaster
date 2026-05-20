import {
  ZBarConfigType,
  ZBarScanner,
  ZBarSymbolType,
  scanImageData,
} from '@undecaf/zbar-wasm';
import {
  prepareZXingModule,
  readBarcodes,
  type Position,
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
  missStreak?: number;
};

type WorkerRequestMessage = ScanRequestMessage;

export type WorkerBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type WorkerResponseMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'scan-result';
      frameId: number;
      rawValue: string | null;
      boundingBox?: WorkerBoundingBox;
    }
  | {
      type: 'error';
      message: string;
    };

const HARD_PASS_MISS_STREAK = 4;

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

/** Stretch luminance to improve reads on faded or smudged labels. */
function stretchContrast(source: ImageData): ImageData {
  const { data, width, height } = source;
  let min = 255;
  let max = 0;

  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }

  if (max - min < 12) return source;

  const scale = 255 / (max - min);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      out[i + c] = Math.min(255, Math.max(0, Math.round((data[i + c] - min) * scale)));
    }
    out[i + 3] = data[i + 3];
  }

  return new ImageData(out, width, height);
}

function positionToBoundingBox(position: Position): WorkerBoundingBox {
  const xs = [position.topLeft.x, position.topRight.x, position.bottomLeft.x, position.bottomRight.x];
  const ys = [position.topLeft.y, position.topRight.y, position.bottomLeft.y, position.bottomRight.y];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
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
    tryDownscale: !tryHarder,
    tryDenoise: tryHarder,
    binarizer: tryHarder ? 'LocalAverage' : 'GlobalHistogram',
    maxNumberOfSymbols: 4,
    minLineCount: tryHarder ? 1 : 2,
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

type ScanHit = {
  text: string;
  score: number;
  boundingBox?: WorkerBoundingBox;
};

async function scanImageParallel(
  scanner: ZBarScanner,
  imageData: ImageData,
  tryHarder: boolean,
): Promise<ScanHit | null> {
  const [zxingResult, zbarSymbol] = await Promise.all([
    scanBestZXing(imageData, tryHarder),
    tryHarder ? Promise.resolve(null) : scanBestSymbol(scanner, imageData),
  ]);

  let best: ScanHit | null = null;

  if (zxingResult) {
    best = {
      text: zxingResult.text,
      score: scoreZXingResult(zxingResult),
      boundingBox: positionToBoundingBox(zxingResult.position),
    };
  }

  if (zbarSymbol) {
    const score = scoreSymbol(zbarSymbol);
    const text = zbarSymbol.decode().trim();
    if (!best || score > best.score) {
      best = { text, score };
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

  const centerCropOffset = {
    x: image.width * 0.2,
    y: image.height * 0.2,
  };

  const normalizeBoundingBox = (
    bbox: WorkerBoundingBox | undefined,
    source: 'full' | 'center',
    upscale = 1,
  ): WorkerBoundingBox | undefined => {
    if (!bbox) return undefined;
    let normalized = bbox;
    if (upscale !== 1) {
      normalized = {
        x: normalized.x / upscale,
        y: normalized.y / upscale,
        width: normalized.width / upscale,
        height: normalized.height / upscale,
      };
    }
    if (source === 'center') {
      normalized = {
        x: centerCropOffset.x + normalized.x,
        y: centerCropOffset.y + normalized.y,
        width: normalized.width,
        height: normalized.height,
      };
    }
    return normalized;
  };

  const post = (rawValue: string | null, boundingBox?: WorkerBoundingBox) => {
    const response: WorkerResponseMessage = {
      type: 'scan-result',
      frameId: message.frameId,
      rawValue,
      ...(boundingBox ? { boundingBox } : {}),
    };
    self.postMessage(response);
  };

  const fastPassImages: Array<{ image: ImageData; source: 'full' | 'center' }> = [
    { image: centerCrop, source: 'center' },
    { image, source: 'full' },
  ];
  for (const pass of fastPassImages) {
    const hit = await scanImageParallel(scanner, pass.image, false);
    if (hit) {
      post(hit.text, normalizeBoundingBox(hit.boundingBox, pass.source));
      return;
    }
  }

  const missStreak = message.missStreak ?? 0;
  if (missStreak < HARD_PASS_MISS_STREAK) {
    post(null);
    return;
  }

  const hardVariants: Array<{ image: ImageData; source: 'full' | 'center'; upscale: number }> = [
    { image: upscaleNearest(stretchContrast(centerCrop), 2), source: 'center', upscale: 2 },
  ];
  if (message.roiLevel !== 'tight') {
    hardVariants.push({ image: upscaleNearest(stretchContrast(image), 1.35), source: 'full', upscale: 1.35 });
  }

  for (const variant of hardVariants) {
    const hit = await scanImageParallel(scanner, variant.image, true);
    if (hit) {
      post(hit.text, normalizeBoundingBox(hit.boundingBox, variant.source, variant.upscale));
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
