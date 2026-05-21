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
  type ReaderOptions,
} from 'zxing-wasm/reader';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import {
  pickBestBarcodeCandidate,
  type BarcodeHit,
  type PickBarcodeContext,
} from '../lib/scanner/pickBarcodeSelection';

type ScanRequestMessage = {
  type: 'scan';
  frameId: number;
  imageData: ImageData;
  missStreak?: number;
  pickContext?: PickBarcodeContext;
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

function zbarFormatName(type: ZBarSymbolType): string | undefined {
  if (type === ZBarSymbolType.ZBAR_QRCODE) return 'QRCode';
  if (type === ZBarSymbolType.ZBAR_CODE128) return 'Code128';
  if (type === ZBarSymbolType.ZBAR_CODE39) return 'Code39';
  if (type === ZBarSymbolType.ZBAR_CODE93) return 'Code93';
  return undefined;
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

async function scanAllZXing(imageData: ImageData, tryHarder: boolean): Promise<BarcodeHit[]> {
  await prepareZXing();
  const results = await readBarcodes(imageData, {
    formats: ZXING_FORMATS,
    tryHarder,
    tryRotate: tryHarder,
    tryInvert: tryHarder,
    tryDownscale: !tryHarder,
    tryDenoise: tryHarder,
    binarizer: tryHarder ? 'LocalAverage' : 'GlobalHistogram',
    maxNumberOfSymbols: 6,
    minLineCount: tryHarder ? 1 : 2,
    textMode: 'Plain',
  });
  return results
    .filter((result) => result.text.trim().length > 0 && result.isValid)
    .map((result) => ({
      rawValue: result.text.trim(),
      format: result.format,
      boundingBox: positionToBoundingBox(result.position),
    }));
}

async function scanAllZBar(scanner: ZBarScanner, imageData: ImageData): Promise<BarcodeHit[]> {
  const symbols = await scanImageData(imageData, scanner);
  const hits: BarcodeHit[] = [];
  for (const symbol of symbols) {
    const rawValue = symbol.decode().trim();
    if (!rawValue) continue;
    hits.push({
      rawValue,
      format: zbarFormatName(symbol.type),
    });
  }
  return hits;
}

async function scanAllBarcodes(
  scanner: ZBarScanner,
  imageData: ImageData,
  tryHarder: boolean,
  pickContext?: PickBarcodeContext,
): Promise<BarcodeHit | null> {
  const [zxingHits, zbarHits] = await Promise.all([
    scanAllZXing(imageData, tryHarder),
    tryHarder ? Promise.resolve([] as BarcodeHit[]) : scanAllZBar(scanner, imageData),
  ]);

  const merged: BarcodeHit[] = [];
  const seen = new Set<string>();
  for (const hit of [...zxingHits, ...zbarHits]) {
    const key = hit.rawValue.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }

  return pickBestBarcodeCandidate(merged, {
    collectMode: false,
    pickContext,
    frameHeight: imageData.height,
  });
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
  const pickContext = message.pickContext;

  const post = (rawValue: string | null, boundingBox?: WorkerBoundingBox, upscale = 1) => {
    let box = boundingBox;
    if (box && upscale !== 1) {
      box = {
        x: box.x / upscale,
        y: box.y / upscale,
        width: box.width / upscale,
        height: box.height / upscale,
      };
    }
    const response: WorkerResponseMessage = {
      type: 'scan-result',
      frameId: message.frameId,
      rawValue,
      ...(box ? { boundingBox: box } : {}),
    };
    self.postMessage(response);
  };

  const hit = await scanAllBarcodes(scanner, image, false, pickContext);
  if (hit) {
    post(hit.rawValue, hit.boundingBox);
    return;
  }

  const missStreak = message.missStreak ?? 0;
  if (missStreak < HARD_PASS_MISS_STREAK) {
    post(null);
    return;
  }

  const hardImage = upscaleNearest(stretchContrast(image), 2);
  const hardHit = await scanAllBarcodes(scanner, hardImage, true, pickContext);
  if (hardHit) {
    post(hardHit.rawValue, hardHit.boundingBox, 2);
    return;
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
